#!/usr/bin/env node

// Notifies the Claude Hive dashboard when a tool call may need user permission.
// Fires before every tool use - sets status to "waiting_for_input" with tool details.
// If the tool is auto-approved, the PostToolUse hook quickly resets the status.
// If the tool needs permission, the status stays visible on the dashboard.

import { mkdirSync, writeFileSync } from "fs";
import { dirname } from "path";

import { readEvent, resolveSession, setStatus, pendingPath } from "./lib/hive.mjs";

const event = await readEvent();
if (!event) process.exit(0);

// Only notify for tools that commonly need user permission
if (!["Edit", "Write", "Bash"].includes(event.tool_name)) {
  process.exit(0);
}

const resolved = await resolveSession(event);
if (!resolved) process.exit(0);

// Build a detail string from the tool input
const toolInput = event.tool_input || {};
let detail;

if (event.tool_name === "Bash") {
  const cmd = toolInput.command || "";
  const shortCmd = cmd.length > 50 ? cmd.slice(0, 50) + "..." : cmd;
  detail = `Waiting for permission to run: ${shortCmd}`;
} else {
  const verb = event.tool_name === "Edit" ? "edit" : "write";
  const fileName = (toolInput.file_path || "file").split(/[/\\]/).pop();
  detail = `Waiting for permission to ${verb} ${fileName}`;
}

await setStatus(resolved.url, resolved.id, "waiting_for_input", detail);

// Flag this session (not the machine) so PostToolUse knows to reset the status
// once the tool completes.
try {
  const path = pendingPath(event);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, resolved.id);
} catch {}
