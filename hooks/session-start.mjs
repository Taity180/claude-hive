#!/usr/bin/env node

// Claude Hive session-start hook
// Checks if the hive is running and injects behavioral instructions

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", async () => {
  const port = process.env.CLAUDE_HIVE_PORT || "9400";
  const hiveUrl = `http://localhost:${port}`;

  let connected = false;
  let sessionCount = 0;

  try {
    const healthResp = await fetch(`${hiveUrl}/api/health`, {
      signal: AbortSignal.timeout(2000),
    });
    if (healthResp.ok) {
      connected = true;
      const sessionsResp = await fetch(`${hiveUrl}/api/sessions`, {
        signal: AbortSignal.timeout(2000),
      });
      if (sessionsResp.ok) {
        const sessions = await sessionsResp.json();
        sessionCount = sessions.length;
      }
    }
  } catch {
    // Hive not running
  }

  let context;
  if (connected) {
    const sessionText =
      sessionCount === 0
        ? "no other sessions"
        : sessionCount === 1
          ? "1 other session"
          : `${sessionCount} other sessions`;

    const lines = [
      "# [claude-hive] Connected to Claude Hive",
      "",
      `Connected to Claude Hive with ${sessionText} active.`,
      "",
      "You are connected to Claude Hive, a shared dashboard the user monitors across all their Claude Code sessions and virtual desktops. The user may not be watching this terminal - they rely on the dashboard to know what you are doing.",
      "",
      "## MANDATORY: Keep the dashboard updated at ALL times",
      "",
      "You MUST use the claude-hive MCP tools proactively throughout your entire session. The user watches the dashboard, not this terminal.",
      "",
      "### hub_set_status - Update on EVERY state change",
      "",
      "Call hub_set_status whenever your activity changes. Be specific in the detail field:",
      "",
      "- BEFORE reading files or exploring code: set 'running' with 'Reading src/auth.ts'",
      "- BEFORE making edits: set 'running' with 'Editing auth middleware'",
      "- BEFORE running commands: set 'running' with 'Running tests'",
      "- When planning or reasoning: set 'thinking' with 'Planning refactor approach'",
      "- When you ask the user a question: set 'waiting_for_input' with your question",
      "- When a tool call needs user permission: set 'waiting_for_input' with 'Waiting for permission to edit file'",
      "- When a build or test fails: set 'error' with the failure summary",
      "- When you finish work and have nothing to do: set 'idle' with 'Task complete, ready for next instruction'",
      "- ALWAYS include a detail string - never set status without a detail",
      "",
      "Update status frequently - every time you start a new sub-task, switch activities, or hit a blocker.",
      "",
      "### hub_send_message - Keep the user informed",
      "",
      "Send messages for anything the user would want to know about:",
      "",
      "- Starting a task: 'Starting work on auth middleware refactor' (type: info)",
      "- Completed a step: 'Auth middleware refactored, 8 tests passing' (type: completion)",
      "- Found an issue: 'Found 3 unused imports in auth.ts, cleaning up' (type: info)",
      "- Hit a problem: 'Build failing - missing dependency express-session' (type: error)",
      "- Need input: 'Should I use JWT or session cookies for auth?' (type: question)",
      "- Waiting for permission: 'Waiting for permission to run npm install' (type: info)",
      "- Task complete: 'All done - auth system implemented with tests' (type: completion)",
      "",
      "Send a message every 1-3 significant actions. Not every file read, but every meaningful step the user would care about.",
      "",
      "### hub_get_messages - Check for instructions",
      "- Call at the start of every session",
      "- Call after completing each task before starting the next",
      "- Call when idle with nothing to do",
      "",
      "### hub_notify - Desktop notifications for important events only",
      "- Task fully complete",
      "- Blocking error that needs user attention",
      "- Urgent question stopping all progress",
      "",
      "### hub_broadcast - Coordinate with other sessions",
      "- Only when modifying shared code other sessions might be editing",
      "",
      "## Examples of good status/message flow",
      "",
      "User asks: 'Add input validation to the signup form'",
      "1. hub_set_status({ status: 'running', detail: 'Reading signup form component' })",
      "2. hub_send_message({ message: 'Starting signup form validation', type: 'info' })",
      "3. hub_set_status({ status: 'thinking', detail: 'Planning validation rules' })",
      "4. hub_set_status({ status: 'running', detail: 'Adding email validation' })",
      "5. hub_send_message({ message: 'Added email + password validation rules', type: 'info' })",
      "6. hub_set_status({ status: 'running', detail: 'Writing tests' })",
      "7. hub_send_message({ message: 'Validation complete, 5 tests passing', type: 'completion' })",
      "8. hub_set_status({ status: 'idle', detail: 'Task complete, ready for next instruction' })",
      "9. hub_notify({ title: 'Done', body: 'Signup validation added with tests' })",
    ];
    context = lines.join("\n");
  } else {
    context = [
      "# [claude-hive] Claude Hive not detected",
      "",
      `Claude Hive is not running at localhost:${port}. Start the Claude Hive desktop app to enable cross-session messaging and status tracking.`,
    ].join("\n");
  }

  console.log(context);
});
