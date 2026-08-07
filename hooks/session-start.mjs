#!/usr/bin/env node

// Claude Hive session-start hook
// Checks if the hive is running and injects behavioral instructions

import { readEvent, hiveUrl, resolveSession, reportClaudeSession } from "./lib/hive.mjs";

const event = (await readEvent()) || {};
const url = hiveUrl();

let connected = false;
try {
  const healthResp = await fetch(`${url}/api/health`, {
    signal: AbortSignal.timeout(2000),
  });
  connected = healthResp.ok;
} catch {
  // Hive not running
}

let context;
if (connected) {
  // Establish this session's claim now, while nothing destructive depends on
  // it. Later hooks (Stop, SessionEnd) read the claim back instead of guessing
  // from the working directory, which is what lets two Claude Code sessions
  // share a repo without stomping on each other's dashboard pill.
  const resolved = await resolveSession(event);

  // Hand over Claude Code's session id so the hive can find this session's
  // transcript and read its token usage.
  if (resolved) {
    await reportClaudeSession(url, resolved.id, event.session_id);
  }

  // The hive's session list includes us once the MCP server has registered.
  let otherCount = 0;
  try {
    const sessionsResp = await fetch(`${url}/api/sessions`, {
      signal: AbortSignal.timeout(2000),
    });
    if (sessionsResp.ok) {
      const sessions = await sessionsResp.json();
      otherCount = sessions.filter((s) => s.id !== resolved?.id).length;
    }
  } catch {}

  const sessionText =
    otherCount === 0
      ? "no other sessions"
      : otherCount === 1
        ? "1 other session"
        : `${otherCount} other sessions`;

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
    "### hub_send_message - MANDATORY for every meaningful step",
    "",
    "You MUST call hub_send_message for each meaningful step of your work. This is not optional — the user reads these in the dashboard, not this terminal.",
    "",
    "At minimum, send one for each of these moments:",
    "",
    "- Starting a task: 'Starting work on auth middleware refactor' (type: info)",
    "- Completing a step: 'Auth middleware refactored, 8 tests passing' (type: completion)",
    "- Finding an issue: 'Found 3 unused imports in auth.ts, cleaning up' (type: info)",
    "- Hitting a problem: 'Build failing - missing dependency express-session' (type: error)",
    "- Needing input: 'Should I use JWT or session cookies for auth?' (type: question)",
    "- Waiting for permission: 'Waiting for permission to run npm install' (type: info)",
    "- Task complete: 'All done - auth system implemented with tests' (type: completion)",
    "",
    "Target cadence: at least 1 message per 1-3 tool calls, and always at least one per user request. If you finish a user request without any hub_send_message calls, you failed this requirement.",
    "",
    "### hub_ask - Ask the user a question and WAIT for the answer",
    "",
    "When you need a decision, call hub_ask instead of asking in the terminal. It posts the question to the dashboard as clickable options and BLOCKS until the user picks one, then returns their choice. The user is usually on another virtual desktop, so a question asked in this terminal may sit unseen for a long time.",
    "",
    "- Give 2-8 short, concrete options. For yes/no, pass exactly two.",
    "- Set multi_select when more than one option can apply.",
    "- If it returns 'No answer', the user didn't respond - fall back to asking in the terminal.",
    "",
    "Example: hub_ask({ question: 'JWT or session cookies for auth?', options: ['JWT', 'Session cookies'] })",
    "",
    "### hub_get_messages - Check for instructions",
    "",
    "Messages the user types into the dashboard are also delivered to you automatically at the end of each turn, so you do not have to poll for them. Call this when you want them sooner:",
    "- Call at the start of every session",
    "- Call after completing each task before starting the next",
    "- Call when idle with nothing to do",
    "",
    "### hub_notify - MANDATORY for task completion and blocking events",
    "",
    "You MUST call hub_notify at least once per user request — typically on task completion. The user may be on a different virtual desktop; this posts to the session feed and flags the session unread so they see it when they look.",
    "",
    "Always call hub_notify for:",
    "- Task fully complete (every user request ends with one)",
    "- Blocking error that needs user attention",
    "- Urgent question stopping all progress",
    "",
    "Do not skip this. A silent task completion leaves the user unaware you're done.",
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
    `Claude Hive is not running at ${url}. Start the Claude Hive desktop app to enable cross-session messaging and status tracking.`,
  ].join("\n");
}

console.log(context);
