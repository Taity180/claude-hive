#!/usr/bin/env node

// Fires when a Claude Code session ends (terminal closed, /exit, etc).
// Cleanly unregisters the session from the hive so it disappears from the
// dashboard immediately, rather than waiting for the server's stale-session
// pruner to remove it after a timeout.

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", async () => {
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

    await fetch(`${hiveUrl}/api/sessions/${session.id}`, {
      method: "DELETE",
      signal: AbortSignal.timeout(1000),
    });
  } catch {
    // Silently fail — session pruner will eventually clean up.
  }
});
