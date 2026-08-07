#!/usr/bin/env node

// Fires when Claude's turn ends. Two jobs.
//
// 1. Deliver anything the user typed into the dashboard. The hub stores those
//    messages fine, but nothing makes Claude read them: the MCP server pushes a
//    resource-updated notification, which only says "something changed" — Claude
//    still has to call hub_get_messages, and it does that at turn boundaries at
//    best. So a reply could sit unread indefinitely and the dashboard's chat box
//    was effectively one-way.
//
//    Blocking here hands the messages back as the reason, which continues the
//    turn with them in front of Claude. This is the only hook that can do it:
//    nothing fires mid-turn, so end-of-turn is the earliest delivery available.
//    That turns "never" into "within one turn".
//
// 2. If the status is still "running" or "thinking" (Claude forgot to call
//    hub_set_status before ending the turn), fall back to "idle" — the turn is
//    over and nothing is actively happening.
//
//    We deliberately do NOT fall back to "waiting_for_input": that status is for
//    cases where Claude explicitly needs the user to do something. If Claude
//    genuinely asked a question, it sets that itself via hub_set_status.
//    Defaulting to it here would make the dashboard pulse yellow every time
//    Claude finishes any task, which is the bug this hook used to have.

import {
  readEvent,
  resolveSession,
  setStatus,
  reportClaudeSession,
  pendingInbox,
  markRead,
} from "./lib/hive.mjs";

// Wrapped in a function so every exit path is a `return`. Calling
// process.exit() straight after writing the decision to stdout races the
// write and aborts the process on Windows before it flushes.
async function main() {
const event = await readEvent();
if (!event) return;

const resolved = await resolveSession(event);
if (!resolved) return;

// Re-assert the transcript link every turn. It costs one request and means a
// session survives a hive restart mid-conversation without losing its usage
// attribution — SessionStart only fires once, and by then it may be too late.
await reportClaudeSession(resolved.url, resolved.id, event.session_id);

// A hook that already blocked once must not block again on the continuation it
// caused, or the turn never ends.
if (!event.stop_hook_active) {
  const inbox = await pendingInbox(resolved.url, resolved.id);
  if (inbox.length > 0) {
    // Mark read *before* handing them over. If this ordering flipped and the
    // mark failed, the same messages would be re-injected every turn forever.
    await markRead(
      resolved.url,
      resolved.id,
      inbox.map((m) => m.id),
    );

    const lines = inbox.map((m) =>
      m.from === "broadcast"
        ? `[broadcast from ${m.fromSessionName ?? "another session"}] ${m.content}`
        : `[user] ${m.content}`,
    );

    await setStatus(resolved.url, resolved.id, "running", "Message from dashboard");

    console.log(
      JSON.stringify({
        decision: "block",
        reason: [
          "The user sent this from the Claude Hive dashboard rather than the terminal:",
          "",
          ...lines,
          "",
          "Respond to it as you would a message typed here.",
        ].join("\n"),
      }),
    );
    return;
  }
}

// Nothing to deliver — only update the status if Claude left it mid-flight.
const { status } = resolved.session;
if (status !== "running" && status !== "thinking") return;

await setStatus(resolved.url, resolved.id, "idle", "Task complete");
}

await main();
