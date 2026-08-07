---
name: claude-hive
description: "Use when connected to Claude Hive to manage session status, send messages, check for instructions, and coordinate with other sessions. Activated automatically on session start when hive is detected."
---

# Claude Hive Integration

You are connected to Claude Hive, a floating dashboard that the user monitors across all their Claude Code sessions and Windows virtual desktops. The user may not be watching this terminal — they rely on the dashboard to know what every session is doing.

## Setup

If this is the first time using Claude Hive and the user asks to set it up:

1. Check if the hive is running: `curl -s http://localhost:9400/api/health` (or `$CLAUDE_HIVE_PORT` if the user has overridden the default port)
2. If not running, tell the user: "Please start the Claude Hive desktop app first."
3. If running, the MCP server is already configured via this plugin. New sessions will auto-connect.

## MCP Tools Reference

You have 6 tools from the `claude-hive` MCP server. Use them **proactively** — don't wait to be asked.

---

### hub_set_status — Update on EVERY state change

Update your session's status indicator on the dashboard. The user relies on this to see which sessions need attention at a glance.

**Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `status` | string | Yes | One of: `running`, `waiting_for_input`, `thinking`, `error`, `idle` |
| `detail` | string | No | Short description of what you're doing |

**Status meanings:**
| Status | Dashboard Color | When to use |
|--------|----------------|-------------|
| `running` | Blue | Actively working — reading, editing, running commands |
| `thinking` | Purple | Complex reasoning, planning, or analysis |
| `waiting_for_input` | Yellow (pulsing) | Blocked — need user input or permission |
| `error` | Red | Hit an error or failure |
| `idle` | Green | Done, waiting for next instruction |

**When to call — be frequent and specific:**
- **Before reading files**: `{ status: "running", detail: "Reading src/auth.ts" }`
- **Before making edits**: `{ status: "running", detail: "Editing auth middleware" }`
- **Before running commands**: `{ status: "running", detail: "Running npm test" }`
- **When planning**: `{ status: "thinking", detail: "Planning refactor approach" }`
- **When you ask the user a question**: `{ status: "waiting_for_input", detail: "Need DB connection string" }`
- **When a tool needs user permission**: `{ status: "waiting_for_input", detail: "Waiting for permission to edit file" }`
- **When a build/test fails**: `{ status: "error", detail: "Tests failing: 3 assertions" }`
- **When done**: `{ status: "idle", detail: "Task complete, ready for next instruction" }`

Update status every time you start a new sub-task, switch activities, or hit a blocker. ALWAYS include a detail string — never set status without one. The detail field should tell the user what you're doing RIGHT NOW in ~5 words.

Status updates with detail text automatically appear in the session's message feed, so the user sees a full activity log.

---

### hub_send_message — MANDATORY for every meaningful step

Send a message to the hive chat feed. The user reads these across many sessions to stay informed — this is where they follow your work, not the terminal.

**Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `message` | string | Yes | The message content |
| `type` | string | No | One of: `info`, `question`, `completion`, `error`. Default: `info` |

**Send one at minimum for each of these moments:**

| Situation | Message | Type |
|-----------|---------|------|
| Starting a task | "Starting auth middleware refactor" | `info` |
| Completing a step | "Auth middleware refactored, 8 tests passing" | `completion` |
| Finding something notable | "Found 3 unused imports, cleaning up" | `info` |
| Hitting a problem | "Build failing — missing express-session" | `error` |
| Needing user input | "Should I use JWT or session cookies?" | `question` |
| Waiting for permission | "Waiting for permission to run npm install" | `info` |
| All work done | "All done — auth system implemented with tests" | `completion` |

**Cadence:** at least 1 message per 1-3 tool calls, and always at least one per user request. Not every file read — if you read 5 files, send one message about what you learned. If you finish a user request without a single `hub_send_message` call, you failed this requirement.

---

### hub_ask — Ask a question and WAIT for the answer

Post a multiple-choice question to the dashboard. **This call blocks** until the user clicks an option, then returns their choice — so use it instead of asking in the terminal whenever you need a decision. The user is usually on a different virtual desktop, where terminal output is invisible to them.

**Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `question` | string | Yes | Phrase it so the options read as answers |
| `options` | string[] | Yes | 2–8 short, concrete choices. Yes/no is just two options |
| `multi_select` | boolean | No | Let the user pick more than one. Default: `false` |
| `timeout_seconds` | number | No | How long to wait, 10–1800. Default: `300` |

**Behaviour worth knowing:**
- The session's status pill goes yellow while the question is pending and back to running once answered — you don't need a separate `hub_set_status` call around it.
- Asking a second question replaces the first. Don't stack questions; ask one, act on the answer.
- Returns `No answer within Ns` on timeout. Fall back to asking in the terminal — don't guess and don't re-ask in a loop.
- For anything that isn't a small set of choices, ask in the terminal or send a `hub_send_message` question and let the user type a reply.

```
hub_ask({
  question: "JWT or session cookies for auth?",
  options: ["JWT", "Session cookies"]
})
→ "User selected: JWT"
```

---

### hub_get_messages — Check for instructions

Retrieve messages sent to your session from the hive dashboard or from other sessions.

**Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `since` | string | No | ISO 8601 timestamp — only get messages after this time |
| `unread_only` | boolean | No | Only return unread messages. Default: `true` |

**When to call:**
- **At session start** — the user may have queued instructions
- **After completing each task** — check before starting the next
- **When idle** — the user may send new work via the dashboard

---

### hub_notify — MANDATORY for task completion and blocking events

Raise something the user should notice. Native OS toasts were removed in 1.0.7 — this now posts to the session feed and flags the session unread on the dashboard. Call this at least once per user request, typically on completion — the user may be on a different virtual desktop and has no other way to know you need them.

**Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | Yes | Notification title |
| `body` | string | Yes | Notification body text |
| `priority` | string | No | One of: `low`, `normal`, `high`. Default: `normal` |

**Always call for:**
- Task **fully completed** — every user request ends with one
- **Blocking error** that needs immediate attention
- **Urgent question** that stops all progress

Do NOT use it for routine mid-task progress — that's what `hub_send_message` is for. But do not skip the completion notification: a silent finish leaves the user unaware you're done.

---

### hub_broadcast — Cross-session coordination

Send a message to ALL other connected Claude Code sessions.

**Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `message` | string | Yes | The broadcast message |

**When to call:**
- Modifying shared code other sessions might be editing
- Completed a change other sessions depend on
- Breaking changes that affect other sessions
- Use sparingly — every session sees this

---

## Example: Good status/message flow

User asks: "Add input validation to the signup form"

```
1. hub_set_status({ status: "running", detail: "Reading signup form" })
2. hub_send_message({ message: "Starting signup form validation", type: "info" })
3. hub_set_status({ status: "thinking", detail: "Planning validation rules" })
4. hub_set_status({ status: "running", detail: "Adding email validation" })
5. hub_send_message({ message: "Added email + password validation", type: "info" })
6. hub_set_status({ status: "running", detail: "Writing tests" })
7. hub_send_message({ message: "Validation complete, 5 tests passing", type: "completion" })
8. hub_set_status({ status: "idle", detail: "Task complete, ready for next instruction" })
9. hub_notify({ title: "Done", body: "Signup validation added with tests" })
```

## Key Behaviors

1. **Update status on every activity change** — the user watches the dashboard, not this terminal
2. **Send a message for every meaningful step** — at least 1 per 1-3 tool calls, and never finish a user request with zero
3. **Be specific in detail fields** — "Reading auth.ts" not just "Reading files"
4. **Set waiting_for_input when blocked** — including when waiting for tool permissions
5. **Set error immediately when things fail** — with a summary of what went wrong
6. **Set idle when done** — so the user knows you're available
7. **Check messages at natural breakpoints** — between tasks, when idle
8. **Notify at least once per request** — always on completion, plus blocking errors and urgent questions
