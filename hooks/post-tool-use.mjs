#!/usr/bin/env node

// Fires after a tool succeeds. If the PreToolUse hook set "waiting_for_input"
// (for a permission prompt), this resets the status back to "running".
// Uses a per-session flag file to avoid overriding Claude's explicit status
// updates — and to avoid one session clearing another session's flag.

import { existsSync } from "fs";

import {
  readEvent,
  resolveSession,
  setStatus,
  pendingPath,
  removeFile,
} from "./lib/hive.mjs";

const event = await readEvent();
if (!event) process.exit(0);

// Only act if this session's PreToolUse hook flagged a permission wait
const flag = pendingPath(event);
if (!existsSync(flag)) process.exit(0);
removeFile(flag);

const resolved = await resolveSession(event);
if (!resolved) process.exit(0);

// Only reset if still stuck on waiting_for_input
if (resolved.session.status !== "waiting_for_input") process.exit(0);

await setStatus(resolved.url, resolved.id, "running", "Resumed");
