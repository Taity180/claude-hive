#!/usr/bin/env node

// Fires after a tool succeeds. If the PreToolUse hook set "waiting_for_input"
// (for a permission prompt), this resets the status back to "running".
// Uses a flag file to avoid overriding Claude's explicit status updates.

import { readFileSync, unlinkSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const FLAG_FILE = join(homedir(), ".claude", "hive-permission-pending");

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", async () => {
  // Only act if the PreToolUse hook flagged a permission wait
  if (!existsSync(FLAG_FILE)) return;

  // Clear the flag
  try {
    unlinkSync(FLAG_FILE);
  } catch {}

  const port = process.env.CLAUDE_HIVE_PORT || "9400";
  const hiveUrl = `http://localhost:${port}`;
  const cwd = process.cwd();

  try {
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

    // Only reset if still stuck on waiting_for_input
    if (session.status !== "waiting_for_input") return;

    await fetch(`${hiveUrl}/api/sessions/${session.id}/status`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "running",
        detail: "Resumed",
        silent: true,
      }),
      signal: AbortSignal.timeout(1000),
    });
  } catch {
    // Silently fail
  }
});
