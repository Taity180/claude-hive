use std::io::{self, BufRead, Write};
use std::sync::{Arc, Mutex};
use serde_json::{json, Value};

use super::types::*;

/// Walk up the process tree to find an ancestor that owns a visible window.
/// MCP process → node (Claude Code) → shell → terminal
#[cfg(windows)]
fn find_ancestor_window() -> Option<u64> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW,
        TH32CS_SNAPPROCESS, PROCESSENTRY32W,
    };
    use std::mem;

    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) }.ok()?;
    let mut entry: PROCESSENTRY32W = unsafe { mem::zeroed() };
    entry.dwSize = mem::size_of::<PROCESSENTRY32W>() as u32;

    let mut pid_to_parent: std::collections::HashMap<u32, u32> = std::collections::HashMap::new();
    if unsafe { Process32FirstW(snapshot, &mut entry) }.is_ok() {
        pid_to_parent.insert(entry.th32ProcessID, entry.th32ParentProcessID);
        while unsafe { Process32NextW(snapshot, &mut entry) }.is_ok() {
            pid_to_parent.insert(entry.th32ProcessID, entry.th32ParentProcessID);
        }
    }
    let _ = unsafe { CloseHandle(snapshot) };

    let mut current_pid = std::process::id();
    for _ in 0..10 {
        if let Some(hwnd) = find_visible_window_for_pid(current_pid) {
            return Some(hwnd as u64);
        }
        match pid_to_parent.get(&current_pid) {
            Some(&parent) if parent != 0 && parent != current_pid => {
                current_pid = parent;
            }
            _ => break,
        }
    }

    None
}

#[cfg(windows)]
fn find_visible_window_for_pid(target_pid: u32) -> Option<usize> {
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowThreadProcessId, IsWindowVisible,
    };
    use windows::Win32::Foundation::{BOOL, HWND, LPARAM};
    use std::sync::Mutex;

    static RESULT: Mutex<Option<usize>> = Mutex::new(None);
    static TARGET: Mutex<u32> = Mutex::new(0);

    *TARGET.lock().unwrap() = target_pid;
    *RESULT.lock().unwrap() = None;

    unsafe extern "system" fn enum_callback(hwnd: HWND, _: LPARAM) -> BOOL {
        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        let target = *TARGET.lock().unwrap();
        if pid == target && IsWindowVisible(hwnd).as_bool() {
            *RESULT.lock().unwrap() = Some(hwnd.0 as usize);
            return BOOL(0);
        }
        BOOL(1)
    }

    unsafe { let _ = EnumWindows(Some(enum_callback), LPARAM(0)); }
    RESULT.lock().unwrap().take()
}

/// Thread-safe stdout writer for sending MCP responses and notifications.
/// Uses a Mutex around raw writes to stdout to be Send + Sync.
struct StdoutWriter {
    _lock: Mutex<()>,
}

impl StdoutWriter {
    fn new() -> Self {
        Self {
            _lock: Mutex::new(()),
        }
    }

    fn send(&self, value: &Value) {
        let _guard = self._lock.lock().unwrap();
        let stdout = io::stdout();
        let mut out = stdout.lock();
        let _ = writeln!(out, "{}", serde_json::to_string(value).unwrap());
        let _ = out.flush();
    }
}

pub struct McpHandler {
    hub_url: String,
    session_id: Option<String>,
    client: reqwest::blocking::Client,
    stdout: Arc<StdoutWriter>,
    subscribed: bool,
    current_status: String,
}

impl McpHandler {
    pub fn new(hub_url: String) -> Self {
        Self {
            hub_url,
            session_id: None,
            client: reqwest::blocking::Client::new(),
            stdout: Arc::new(StdoutWriter::new()),
            subscribed: false,
            current_status: "idle".to_string(),
        }
    }

    pub fn run(&mut self) {
        let stdin = io::stdin();

        self.register_session();
        self.start_heartbeat();

        for line in stdin.lock().lines() {
            let line = match line {
                Ok(l) => l,
                Err(_) => break,
            };

            if line.trim().is_empty() {
                continue;
            }

            let request: JsonRpcRequest = match serde_json::from_str(&line) {
                Ok(r) => r,
                Err(e) => {
                    let resp = JsonRpcResponse::error(None, -32700, format!("Parse error: {}", e));
                    self.stdout.send(&serde_json::to_value(&resp).unwrap());
                    continue;
                }
            };

            let response = self.handle_request(&request.method, request.id.clone(), request.params);
            if let Some(resp) = response {
                self.stdout.send(&serde_json::to_value(&resp).unwrap());
            }
        }

        self.unregister_session();
    }

    fn handle_request(&mut self, method: &str, id: Option<Value>, params: Option<Value>) -> Option<JsonRpcResponse> {
        match method {
            "initialize" => Some(self.handle_initialize(id)),
            // MCP sends "notifications/initialized" (per spec) after initialize.
            // Accept legacy "initialized" too for compatibility. Both are notifications
            // (no id) so we return None — must never respond to notifications.
            "notifications/initialized" | "initialized" => {
                self.start_ws_listener();
                None
            }
            "tools/list" => Some(self.handle_tools_list(id)),
            "tools/call" => Some(self.handle_tools_call(id, params)),
            "resources/list" => Some(self.handle_resources_list(id)),
            "resources/read" => Some(self.handle_resources_read(id, params)),
            "resources/subscribe" => Some(self.handle_resources_subscribe(id, params)),
            "resources/unsubscribe" => Some(self.handle_resources_unsubscribe(id, params)),
            "ping" => Some(JsonRpcResponse::success(id, json!({}))),
            // Silently ignore any other notification (methods starting with "notifications/")
            // — MCP spec: servers MUST NOT respond to notifications.
            method if method.starts_with("notifications/") => None,
            _ => Some(JsonRpcResponse::error(
                id,
                -32601,
                format!("Method not found: {}", method),
            )),
        }
    }

    fn handle_initialize(&self, id: Option<Value>) -> JsonRpcResponse {
        JsonRpcResponse::success(
            id,
            json!({
                "protocolVersion": "2024-11-05",
                "capabilities": {
                    "tools": {},
                    "resources": {
                        "subscribe": true
                    }
                },
                "serverInfo": {
                    "name": "claude-hive",
                    "version": env!("CARGO_PKG_VERSION")
                }
            }),
        )
    }

    fn handle_tools_list(&self, id: Option<Value>) -> JsonRpcResponse {
        let tools: Vec<Value> = MCP_TOOLS
            .iter()
            .map(|t| {
                json!({
                    "name": t.name,
                    "description": t.description,
                    "inputSchema": serde_json::from_str::<Value>(t.schema).unwrap()
                })
            })
            .collect();

        JsonRpcResponse::success(id, json!({ "tools": tools }))
    }

    fn handle_resources_list(&self, id: Option<Value>) -> JsonRpcResponse {
        JsonRpcResponse::success(
            id,
            json!({
                "resources": [
                    {
                        "uri": "hive://messages",
                        "name": "Hive Messages",
                        "description": "Unread messages sent to this session from the Claude Hive dashboard or other sessions. Subscribe to get notified instantly when new messages arrive.",
                        "mimeType": "application/json"
                    }
                ]
            }),
        )
    }

    fn handle_resources_read(&self, id: Option<Value>, params: Option<Value>) -> JsonRpcResponse {
        let uri = params
            .as_ref()
            .and_then(|p| p["uri"].as_str())
            .unwrap_or("");

        if uri != "hive://messages" {
            return JsonRpcResponse::error(id, -32602, format!("Unknown resource: {}", uri));
        }

        let session_id = match &self.session_id {
            Some(s) => s.clone(),
            None => {
                return JsonRpcResponse::error(id, -32603, "Not registered with hub".to_string());
            }
        };

        let body = json!({ "unreadOnly": true });
        let result = self
            .client
            .post(format!("{}/api/sessions/{}/messages/query", self.hub_url, session_id))
            .json(&body)
            .send()
            .and_then(|r| r.text());

        match result {
            Ok(text) => JsonRpcResponse::success(
                id,
                json!({
                    "contents": [
                        {
                            "uri": "hive://messages",
                            "mimeType": "application/json",
                            "text": text
                        }
                    ]
                }),
            ),
            Err(e) => JsonRpcResponse::error(id, -32603, format!("Failed to fetch messages: {}", e)),
        }
    }

    fn handle_resources_subscribe(&mut self, id: Option<Value>, params: Option<Value>) -> JsonRpcResponse {
        let uri = params
            .as_ref()
            .and_then(|p| p["uri"].as_str())
            .unwrap_or("");

        if uri == "hive://messages" {
            self.subscribed = true;
            JsonRpcResponse::success(id, json!({}))
        } else {
            JsonRpcResponse::error(id, -32602, format!("Unknown resource: {}", uri))
        }
    }

    fn handle_resources_unsubscribe(&mut self, id: Option<Value>, params: Option<Value>) -> JsonRpcResponse {
        let uri = params
            .as_ref()
            .and_then(|p| p["uri"].as_str())
            .unwrap_or("");

        if uri == "hive://messages" {
            self.subscribed = false;
            JsonRpcResponse::success(id, json!({}))
        } else {
            JsonRpcResponse::error(id, -32602, format!("Unknown resource: {}", uri))
        }
    }

    /// Start a background thread that connects to the hive WebSocket and
    /// sends MCP resource update notifications when messages arrive for this session.
    fn start_ws_listener(&self) {
        let session_id = match &self.session_id {
            Some(id) => id.clone(),
            None => return,
        };

        let ws_url = self.hub_url.replace("http://", "ws://").replace("https://", "wss://");
        let ws_url = format!("{}/ws", ws_url);
        let stdout = Arc::clone(&self.stdout);

        std::thread::spawn(move || {
            let connect = || -> Result<(), Box<dyn std::error::Error>> {
                let (mut socket, _) = tungstenite::connect(&ws_url)?;
                eprintln!("[claude-hive] WebSocket listener connected for session {}", session_id);

                loop {
                    let msg = socket.read()?;
                    if let tungstenite::Message::Text(text) = msg {
                        if let Ok(event) = serde_json::from_str::<Value>(&text) {
                            let event_type = event["type"].as_str().unwrap_or("");

                            // Check if this event is a message for our session
                            let is_relevant = match event_type {
                                "newMessage" => {
                                    let msg_session = event["message"]["sessionId"].as_str().unwrap_or("");
                                    let msg_from = event["message"]["from"].as_str().unwrap_or("");
                                    // Only notify for messages FROM the user or broadcasts, not our own
                                    msg_session == session_id && (msg_from == "user" || msg_from == "broadcast")
                                }
                                _ => false,
                            };

                            if is_relevant {
                                // Send MCP resource update notification
                                let notification = json!({
                                    "jsonrpc": "2.0",
                                    "method": "notifications/resources/updated",
                                    "params": {
                                        "uri": "hive://messages"
                                    }
                                });
                                stdout.send(&notification);
                                eprintln!("[claude-hive] Sent resource update notification for new message");
                            }
                        }
                    }
                }
            };

            // Reconnect loop
            loop {
                if let Err(e) = connect() {
                    eprintln!("[claude-hive] WebSocket listener error: {}, reconnecting in 3s...", e);
                    std::thread::sleep(std::time::Duration::from_secs(3));
                } else {
                    break;
                }
            }
        });
    }

    /// Send a heartbeat to the hive server every 10 seconds so it knows we're alive.
    /// If the hive responds with 404 (e.g. after a restart), re-register the session.
    fn start_heartbeat(&self) {
        let session_id = match &self.session_id {
            Some(id) => id.clone(),
            None => return,
        };
        let hub_url = self.hub_url.clone();
        let client = self.client.clone();

        // Gather registration info once for re-registration
        let cwd = std::env::current_dir()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| "unknown".to_string());
        let git_branch = std::process::Command::new("git")
            .args(["rev-parse", "--abbrev-ref", "HEAD"])
            .output()
            .ok()
            .and_then(|o| {
                if o.status.success() {
                    Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
                } else {
                    None
                }
            });

        #[cfg(windows)]
        let window_handle = find_ancestor_window();
        #[cfg(not(windows))]
        let window_handle: Option<u64> = None;

        std::thread::spawn(move || {
            loop {
                std::thread::sleep(std::time::Duration::from_secs(10));
                let resp = client
                    .post(format!("{}/api/sessions/{}/heartbeat", hub_url, session_id))
                    .send();

                match resp {
                    Ok(r) if r.status().as_u16() == 404 => {
                        // Session unknown — hive may have restarted. Re-register.
                        eprintln!("[claude-hive] Session not found, re-registering...");
                        let _ = client
                            .post(format!("{}/api/sessions", hub_url))
                            .json(&serde_json::json!({
                                "id": session_id,
                                "workingDirectory": cwd,
                                "gitBranch": git_branch,
                                "windowHandle": window_handle
                            }))
                            .send();
                    }
                    Ok(_) => {} // heartbeat OK
                    Err(_) => {} // hive unreachable, will retry
                }
            }
        });
    }

    fn handle_tools_call(&mut self, id: Option<Value>, params: Option<Value>) -> JsonRpcResponse {
        let params = match params {
            Some(p) => p,
            None => {
                return JsonRpcResponse::error(id, -32602, "Missing params".to_string());
            }
        };

        let tool_name = params["name"].as_str().unwrap_or("");
        let arguments = &params["arguments"];
        let session_id = match &self.session_id {
            Some(s) => s.clone(),
            None => {
                return JsonRpcResponse::error(id, -32603, "Not registered with hub".to_string());
            }
        };

        // Auto-recovery: if status is "waiting_for_input" and Claude is making
        // tool calls (other than status/get_messages), it means Claude resumed
        // after a permission prompt — auto-set back to "running".
        if self.current_status == "waiting_for_input"
            && !matches!(tool_name, "hub_set_status" | "hub_get_messages")
        {
            eprintln!("[claude-hive] Auto-recovering from waiting_for_input → running");
            let _ = self.client
                .put(format!("{}/api/sessions/{}/status", self.hub_url, session_id))
                .json(&json!({ "status": "running", "detail": "Resumed", "silent": true }))
                .send();
            self.current_status = "running".to_string();
        }

        let result = match tool_name {
            "hub_send_message" => self.tool_send_message(&session_id, arguments),
            "hub_set_status" => self.tool_set_status(&session_id, arguments),
            "hub_get_messages" => self.tool_get_messages(&session_id, arguments),
            "hub_notify" => self.tool_notify(&session_id, arguments),
            "hub_broadcast" => self.tool_broadcast(&session_id, arguments),
            _ => Err(format!("Unknown tool: {}", tool_name)),
        };

        match result {
            Ok(content) => JsonRpcResponse::success(
                id,
                json!({
                    "content": [{ "type": "text", "text": content }]
                }),
            ),
            Err(e) => JsonRpcResponse::success(
                id,
                json!({
                    "content": [{ "type": "text", "text": format!("Error: {}", e) }],
                    "isError": true
                }),
            ),
        }
    }

    fn register_session(&mut self) {
        let cwd = std::env::current_dir()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| "unknown".to_string());

        let git_branch = std::process::Command::new("git")
            .args(["rev-parse", "--abbrev-ref", "HEAD"])
            .output()
            .ok()
            .and_then(|o| {
                if o.status.success() {
                    Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
                } else {
                    None
                }
            });

        #[cfg(windows)]
        let window_handle = find_ancestor_window();

        #[cfg(any(target_os = "macos", target_os = "linux"))]
        let window_handle: Option<u64> = {
            let ppid = std::process::Command::new("ps")
                .args(["-o", "ppid=", "-p", &std::process::id().to_string()])
                .output()
                .ok()
                .and_then(|o| {
                    if o.status.success() {
                        String::from_utf8_lossy(&o.stdout)
                            .trim()
                            .parse::<u64>()
                            .ok()
                    } else {
                        None
                    }
                });
            ppid
        };

        #[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
        let window_handle: Option<u64> = None;

        let response = self
            .client
            .post(format!("{}/api/sessions", self.hub_url))
            .json(&serde_json::json!({
                "workingDirectory": cwd,
                "gitBranch": git_branch,
                "windowHandle": window_handle
            }))
            .send();

        if let Ok(resp) = response {
            if let Ok(session) = resp.json::<Value>() {
                self.session_id = session["id"].as_str().map(|s| s.to_string());
                eprintln!("[claude-hive] Registered as session: {}", self.session_id.as_deref().unwrap_or("?"));

                // Persist session_id to a file so hooks can call the hive API directly
                if let Some(ref id) = self.session_id {
                    Self::save_session_file(id, &self.hub_url);
                }
            }
        }
    }

    /// Write session_id and hub_url to ~/.claude/hive-active-session
    /// so that Claude Code hooks can update the hive status directly.
    fn save_session_file(session_id: &str, hub_url: &str) {
        if let Some(home) = dirs::home_dir() {
            let dir = home.join(".claude");
            let _ = std::fs::create_dir_all(&dir);
            let path = dir.join("hive-active-session");
            let content = format!("{}\n{}", session_id, hub_url);
            if std::fs::write(&path, &content).is_ok() {
                eprintln!("[claude-hive] Saved session file: {}", path.display());
            }
        }
    }

    fn remove_session_file() {
        if let Some(home) = dirs::home_dir() {
            let path = home.join(".claude").join("hive-active-session");
            let _ = std::fs::remove_file(&path);
        }
    }

    fn unregister_session(&self) {
        if let Some(ref id) = self.session_id {
            let _ = self
                .client
                .delete(format!("{}/api/sessions/{}", self.hub_url, id))
                .send();
            Self::remove_session_file();
        }
    }

    fn tool_send_message(&self, session_id: &str, args: &Value) -> Result<String, String> {
        let message = args["message"].as_str().ok_or("message is required")?;
        let msg_type = args["type"].as_str().unwrap_or("info");

        self.client
            .post(format!("{}/api/sessions/{}/messages", self.hub_url, session_id))
            .json(&json!({ "message": message, "messageType": msg_type }))
            .send()
            .map_err(|e| e.to_string())?;

        Ok(format!("Message sent to hub: {}", message))
    }

    fn tool_set_status(&mut self, session_id: &str, args: &Value) -> Result<String, String> {
        let status = args["status"].as_str().ok_or("status is required")?;
        let detail = args["detail"].as_str();

        self.client
            .put(format!("{}/api/sessions/{}/status", self.hub_url, session_id))
            .json(&json!({ "status": status, "detail": detail }))
            .send()
            .map_err(|e| e.to_string())?;

        self.current_status = status.to_string();

        Ok(format!("Status updated to: {}", status))
    }

    fn tool_get_messages(&self, session_id: &str, args: &Value) -> Result<String, String> {
        let body = json!({
            "since": args.get("since"),
            "unreadOnly": args["unread_only"].as_bool().unwrap_or(true)
        });

        let response = self
            .client
            .post(format!("{}/api/sessions/{}/messages/query", self.hub_url, session_id))
            .json(&body)
            .send()
            .map_err(|e| e.to_string())?;

        let messages: Value = response.json().map_err(|e| e.to_string())?;
        Ok(serde_json::to_string_pretty(&messages).unwrap_or_default())
    }

    fn tool_notify(&self, session_id: &str, args: &Value) -> Result<String, String> {
        let title = args["title"].as_str().ok_or("title is required")?;
        let body = args["body"].as_str().ok_or("body is required")?;

        self.client
            .post(format!("{}/api/sessions/{}/notify", self.hub_url, session_id))
            .json(&json!({ "title": title, "body": body, "priority": args.get("priority") }))
            .send()
            .map_err(|e| e.to_string())?;

        Ok(format!("Notification sent: {}", title))
    }

    fn tool_broadcast(&self, session_id: &str, args: &Value) -> Result<String, String> {
        let message = args["message"].as_str().ok_or("message is required")?;

        self.client
            .post(format!("{}/api/sessions/{}/broadcast", self.hub_url, session_id))
            .json(&json!({ "message": message }))
            .send()
            .map_err(|e| e.to_string())?;

        Ok(format!("Broadcast sent: {}", message))
    }
}
