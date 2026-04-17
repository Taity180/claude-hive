#!/usr/bin/env node

// Fires when Claude's turn ends. If the status is still "running" or
// "thinking" (Claude forgot to call hub_set_status before ending the turn),
// fall back to "idle" — the turn is over and nothing is actively happening.
//
// We deliberately do NOT fall back to "waiting_for_input": that status is for
// cases where Claude explicitly needs the user to do something (answer a
// question, grant a permission). If Claude genuinely asked a question, Claude
// is supposed to set "waiting_for_input" itself inside the turn via the
// hub_set_status MCP tool. Defaulting to it here would make the dashboard
// pulse yellow every time Claude finishes any task, which is the bug this
// hook used to have.

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
        status: "idle",
        detail: "Task complete",
        silent: true,
      }),
      signal: AbortSignal.timeout(1000),
    });
  } catch {
    // Silently fail
  }
});
