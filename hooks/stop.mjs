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

import { readEvent, resolveSession, setStatus } from "./lib/hive.mjs";

const event = await readEvent();
if (!event) process.exit(0);

const resolved = await resolveSession(event);
if (!resolved) process.exit(0);

// Only update if Claude left the status on running/thinking (meaning it forgot
// to update). Don't override idle/error/waiting_for_input.
const { status } = resolved.session;
if (status !== "running" && status !== "thinking") process.exit(0);

await setStatus(resolved.url, resolved.id, "idle", "Task complete");
