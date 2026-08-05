#!/usr/bin/env node

// Fires when a Claude Code session ends (terminal closed, /exit, etc).
// Cleanly unregisters the session from the hive so it disappears from the
// dashboard immediately, rather than waiting for the server's stale-session
// pruner to remove it after a timeout.
//
// Deleting is destructive, so this is the one hook that will not guess. It
// uses the claim this session established earlier, and only falls back to
// claiming when exactly one unclaimed session matches this directory. If it
// can't tell which session is ours, it leaves everything alone and lets the
// pruner clean up — better a pill that lingers for a minute than one that
// vanishes out of a session the user is still working in.

import { readEvent, resolveSession, deleteSession, releaseClaim } from "./lib/hive.mjs";

const event = await readEvent();
if (!event) process.exit(0);

const resolved = await resolveSession(event, { requireUnambiguous: true });
releaseClaim(event);

if (!resolved) process.exit(0);

await deleteSession(resolved.url, resolved.id);
