#!/usr/bin/env node

// Notifies the Claude Hive dashboard when a tool call may need user permission.
// Fires before every tool use - sets status to "waiting_for_input" with tool details.
// If the tool is auto-approved, the PostToolUse hook quickly resets the status.
// If the tool needs permission, the status stays visible on the dashboard.

import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const FLAG_FILE = join(homedir(), ".claude", "hive-permission-pending");

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", async () => {
  let event;
  try {
    event = JSON.parse(input);
  } catch {
    return;
  }

  const toolName = event.tool_name;

  // Only notify for tools that commonly need user permission
  if (!["Edit", "Write", "Bash"].includes(toolName)) {
    return;
  }

  const port = process.env.CLAUDE_HIVE_PORT || "9400";
  const hiveUrl = `http://localhost:${port}`;
  const cwd = process.cwd();

  try {
    // Find our session by matching working directory
    const sessionsResp = await fetch(`${hiveUrl}/api/sessions`, {
      signal: AbortSignal.timeout(1000),
    });
    if (!sessionsResp.ok) return;

    const sessions = await sessionsResp.json();
    const session = sessions.find((s) => {
      const sessionDir = (s.workingDirectory || "").replace(/\\/g, "/").toLowerCase();
      const currentDir = cwd.replace(/\\/g, "/").toLowerCase();
      return sessionDir === currentDir;
    });

    if (!session) return;

    // Build a detail string from the tool input
    let detail;
    const toolInput = event.tool_input || {};

    if (toolName === "Edit") {
      const fileName = (toolInput.file_path || "file").split(/[/\\]/).pop();
      detail = `Waiting for permission to edit ${fileName}`;
    } else if (toolName === "Write") {
      const fileName = (toolInput.file_path || "file").split(/[/\\]/).pop();
      detail = `Waiting for permission to write ${fileName}`;
    } else if (toolName === "Bash") {
      const cmd = toolInput.command || "";
      const shortCmd = cmd.length > 50 ? cmd.slice(0, 50) + "..." : cmd;
      detail = `Waiting for permission to run: ${shortCmd}`;
    }

    // Set status to waiting_for_input
    await fetch(`${hiveUrl}/api/sessions/${session.id}/status`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "waiting_for_input", detail, silent: true }),
      signal: AbortSignal.timeout(1000),
    });

    // Write flag so PostToolUse knows to reset status after tool completes
    try {
      mkdirSync(join(homedir(), ".claude"), { recursive: true });
      writeFileSync(FLAG_FILE, session.id);
    } catch {}
  } catch {
    // Silently fail - never block tool execution
  }
});
