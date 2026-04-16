#!/usr/bin/env node

// Fires when Claude's turn ends and it's waiting for user input.
// If the status is still "running" or "thinking" (Claude forgot to update),
// automatically set it to "waiting_for_input".

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

    // Only update if Claude left the status on running/thinking
    // (meaning it forgot to update). Don't override idle/error/waiting_for_input.
    if (session.status !== "running" && session.status !== "thinking") return;

    await fetch(`${hiveUrl}/api/sessions/${session.id}/status`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "waiting_for_input",
        detail: "Waiting for input",
        silent: true,
      }),
      signal: AbortSignal.timeout(1000),
    });
  } catch {
    // Silently fail
  }
});
