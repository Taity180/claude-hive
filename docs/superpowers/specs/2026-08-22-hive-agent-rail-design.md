# Hive Agent Rail — design

**Date:** 2026-08-22
**Status:** approved design, ready for an implementation plan
**Mockups:** https://claude.ai/code/artifact/8545e843-43e8-4c3a-992e-49d5e255ff89

## Summary

Claude Hive today is a single 500×520 undecorated window that shows Claude Code sessions and lets you jump to
their terminals. This adds a second surface beside it: a **Rail** — a window that rests as a 32px nub on the
edge of whichever monitor the cursor is on, and opens into a feed where **any MCP-speaking agent** posts
alongside those sessions. It also adds **Tasks**, a checkable list that agents fill from the apps they are
connected to.

Everything that exists today keeps working unchanged: the collapsed bar, the expanded dashboard, inline
rename, usage chips, go-to-session, and all ten themes.

## Goals

- A rail that follows the cursor across monitors and rests out of the way.
- One merged feed of Claude sessions and external agents, plus a feed per connected app.
- A generic agent surface — nothing in the design knows or cares that the first agent is Grok.
- Two-way messaging: reply to an agent from the rail.
- A Tasks list agents can populate from connected apps, which the user can tick and annotate.
- A visual refresh applied to both windows.

## Non-goals

- No change to the six existing `hub_*` tools or the Claude Code hook flow.
- No outbound network calls to draw the UI (see [Icons](#icons)).
- No scheduling or orchestration of agents. Hive is a destination, not a scheduler (see
  [The orchestration constraint](#the-orchestration-constraint)).
- No multi-user or remote access. Everything stays on `127.0.0.1`.

## The orchestration constraint

**This is the most important thing in the document, because getting it wrong makes the feature look broken.**

MCP servers are passive. They advertise tools; the model decides whether to call them. Connecting Hive to an
agent gives that agent the *ability* to post, never the instruction — and "tell James about this email" is
never the agent's current request, so left alone it will never call `agent_post`.

The repo already demonstrates this: `hooks/` injects an emphatic "you MUST call `hub_set_status`" block into
every Claude Code session, because Claude needs telling too. An external agent has no equivalent hook.

Four mechanisms, all of which we ship:

| Mechanism | Reaches the model via | Reliability |
|---|---|---|
| Server `instructions` returned on `initialize` | Client injects into the system prompt | Depends on the client |
| Prompt block pasted into the agent's own instructions | The user, once, from the Agents pane | Reliable |
| Tool descriptions | Always seen, but only nudges | Weak alone |
| A schedule or loop on the agent's side | The agent wakes itself | Strongest — and outside Hive |

Consequence to accept up front: **an agent that only runs when the user prompts it will only post when the
user prompts it.** The Agents pane therefore hands the user a copy-paste prompt block, and the docs say
plainly that a scheduled agent is what makes the Rail feel alive. The same fact is why replies queue rather
than arrive instantly — a server that cannot make a client act cannot make it listen either.

## Window architecture

Three surfaces, two windows, one backend process.

| Surface | Window | Notes |
|---|---|---|
| Hive collapsed | Hive | Unchanged. Session pills plus inline questions, answerable without expanding. |
| Hive expanded | Hive | Unchanged behaviour, restyled. Grid / list / detailed view modes kept. |
| Rail | Rail | New. Rests as a nub, opens to the panes below. |

- A `Rail` button in Hive's title bar opens the Rail window.
- Each window is hideable independently; the tray menu governs both.
- **Combined mode** is a setting that reparents the Rail's panes into Hive behind a sidebar
  (Sessions / All activity / Tasks / Agents / Connectors). `Detach rail` reverses it. Same pane components
  either way.
- Go-to-session (`navigate_to_session`, the `↗` button) appears on session rows in **all** surfaces including
  inside the Rail, so the Rail never becomes a dead end.

### Rail positioning

- Eight anchors: four edges plus four corners. Corners matter because a centre-right rail collides with
  Windows notification toasts and a centre-bottom one lands on the taskbar.
- `Edge offset` in px, because taskbar height varies per machine.
- **Cursor-follow**: poll the global cursor position, resolve which monitor's work area contains it,
  reposition when that changes. Must handle per-monitor DPI — `lib.rs` currently calls `current_monitor()`
  only to read a scale factor, so this is new work.
- `Pin to monitor` as the alternative to following.
- **Size is remembered per anchor**, not globally: a right-edge rail wants tall and narrow, a bottom-edge one
  wants wide and short, so one remembered size would be wrong for half the anchors. Extends the
  expanded-height persistence pattern already in `App.tsx`.
- Resting form is a setting: **nub** (32px, shows counts) or **sliver** (14px, dot only).
- `Open on` — click or hover.
- `Hide when nothing is happening` — fade out while every session is idle.

### The unread badge

A red badge on the resting form, showing a count on the nub and a plain dot on the sliver.

Red is deliberately outside the five status colours. The status palette describes *what a session is doing*;
the badge describes *what the user hasn't seen*. Different axis, so it clears on open rather than on state
change.

## The feed

- **All activity** — one merged timeline of session events and agent posts.
- **Per-app feed** — click an app in the bar to filter to it; click again to return.
- **The connected-apps bar is permanent** on every pane, not just the feed.
- `Show in All activity` is a **per-app** switch, so a noisy Gmail can be demoted without silencing the agent
  that reports it.
- `Keep waiting sessions on top` pins any session in `waiting_for_input` above agent chatter regardless of
  timestamp. This is the defence against a talkative agent burying a blocked session — the known weakness of
  a merged feed.

### Producer identity

Agents are rendered **monochrome** with a text tag. This is not aesthetic: blue, amber, violet, red and green
are all spent on session status, so any colour given to an agent would collide with "running". Monochrome
also means a tenth agent needs no new colour.

**Agent names come from the agent.** MCP clients send `clientInfo: { name, version }` on `initialize`; that
becomes the display name. The user can rename afterwards, reusing the `InlineRename` component.

### Replying

The composer targets whatever pane is in view — a session or an agent. Session replies work as they do today.

Agent replies **queue**. MCP is request/response and the server cannot push to a connected client, so a reply
sits in an inbox until the agent calls `agent_inbox`. The composer shows an explicit "1 reply queued — collected
on its next check-in" line. An honest queue indicator beats a send button that pretends to be instant.

## Tasks

A checkable list, populated by agents from their connected apps, and by the user directly.

- **Source provenance on every task.** The app chip is load-bearing, not decoration: without it a task an
  agent invented is indistinguishable from one that came out of a real email, and the list stops being
  trustworthy.
- **Date filter**: Today / Week / Month / All.
- **Undated tasks get their own group, visible in every filter.** An agent finding "reply to Sarah" has no
  deadline to read, and letting it invent one would put a fake deadline on the user's list.
- **Notes are collapsed behind a count** (`2 notes`) and are two-sided — the user's notes and the agent's
  replies interleave, so a task can carry a small conversation.
- **Agents may complete tasks, always labelled.** An agent completion renders as a blue
  "Completed by <agent>" chip; a user completion gets a plain timestamp. The two must never look alike.
- Add-task row for tasks the user creates.

### Idempotency

The hard part is not the UI. An agent re-reading the same email thread must **update** its task, not create a
second one. Every pushed task carries a stable `external_id` (agent + app + thread/item), and the store
upserts on it. Without this the list fills with duplicates the first time an agent runs twice.

### Persistence

Tasks are the first thing in Hive that needs to survive a restart — everything in `src-tauri/src/state/` is
in-memory today. A task list that empties on relaunch is worse than no task list.

Scope: task rows, their notes, completion state and attribution. Sessions and feed items stay in memory
(session-scoped by nature; the existing session-end message wipe is intentional behaviour and stays).

## MCP surface

A second tool family beside the existing `hub_*` tools, authenticated by bearer token rather than derived
from a Claude Code hook. Nothing below changes `hub_*`.

| Tool | Direction | Purpose |
|---|---|---|
| `agent_hello` | agent → hive | Implicit on first call. Name and version from MCP `clientInfo`. |
| `agent_apps_sync` | agent → hive | Declare the full connected-app list with labels and health. Authoritative — replaces rather than merges, so a disconnected app leaves the bar. |
| `agent_post` | agent → hive | Post to the feed, attributed to one app. The workhorse. |
| `agent_inbox` | hive → agent | Drain queued user replies. Poll-based. |
| `agent_ask` | agent → hive | Ask the user a question with clickable options and block on the answer, as `hub_ask` does for sessions. |
| `tasks_upsert` | agent → hive | Push tasks with a stable `external_id`, source app, optional due date. Idempotent. |
| `tasks_list` | hive → agent | Read tasks with state and notes. |
| `tasks_complete` | agent → hive | Tick a task off. Always recorded with the agent's name. |
| `tasks_note` | agent → hive | Add a note without touching done state. |

### Auth

**One token per agent**, not a shared secret. A shared secret can't be revoked for one agent without breaking
the rest, and the feed can't attribute a message it didn't already trust. Tokens are issued from the Agents
pane and scoped (feed, tasks).

### Registration

There is no registration step. Agents appear in the Agents pane on first authenticated call. The pane's job
is to hand out three things the user cannot get elsewhere — the endpoint, a token, and the prompt block — plus
a per-agent kill switch.

`Add unknown apps automatically` (default on) creates a connector on first message from an app that was never
declared, as a safety net for agents that skip `agent_apps_sync`. Where the two disagree, `agent_apps_sync`
is authoritative.

### Where it lands in the repo

| Concern | Location |
|---|---|
| Routes | `src-tauri/src/server/mod.rs` — a new `/api/agents/*` namespace beside the session routes |
| Handlers | `src-tauri/src/server/routes.rs` |
| MCP tools | `src-tauri/src/mcp/handler.rs` — new match arms; session-id gate at line ~448 needs an agent-token branch |
| Agent state | `src-tauri/src/state/agent_registry.rs` (new), beside `session_registry.rs` |
| Task state | `src-tauri/src/state/task_store.rs` (new), with disk persistence |
| Push to UI | existing `/ws` socket |

Transport confirmed: the agent can reach a port on this machine, so Hive is pushed to. No outbound polling.

## Icons

Two layers, fully offline, covering all 240 catalog entries.

| Layer | Covers | Licence | Look |
|---|---|---|---|
| `simple-icons` npm, bundled | 95 | CC0 | Single-colour glyph in the official brand hex |
| Generated monogram | 145 | ours | Two-letter tile, hue hashed from the name |

Measured, not estimated: `simple-icons` v16 ships 3,453 marks, and only 95 of the 240 match. This is not a
naming problem — Slack, Canva, Playwright, Salesforce, Twilio, Amplitude, Pinecone, Semgrep and Exa are all
genuinely absent, because the project removes logos whose brand guidelines forbid redistribution.

**The favicon-fetch layer was considered and rejected.** It would have covered ~120 more with full-colour
originals, but at the cost of ~120 outbound requests to third-party domains on first cache build. Not worth
it. The result is an icon set that is deterministic, offline, and carries no licence question.

Monogram hues are **hashed from the app name** so they are stable across machines and launches. A random
palette would reshuffle the apps bar's colours on every start, which is worse than no colour.

## Visual system

A macOS-flavoured refinement of the existing theme system, applied to **both** windows.

New tokens (roughly four), added alongside the existing `--hub-*` contract:

- `--spec` — 1px specular highlight, top edge only
- `--hair` — hairline divider, inset from the left
- `--lbl-2`, `--lbl-3` — secondary and tertiary label ramp

Changes, in order of impact:

1. **Status leaves the border.** Today every row is ringed in its status colour, so four sessions means four
   competing rectangles and the row that needs attention doesn't stand out. Status becomes a single dot, and
   the only row with a tinted background is one blocked on the user. This is the biggest readability win.
2. **Window controls: minimise and close only, top right.** Close goes red on hover; neither carries a
   permanent coloured dot.
3. **Vibrancy done properly** — `blur(30px) saturate(180%)` rather than `blur(20px)`. The saturate is what
   lets colour behind the glass bloom through instead of going grey.
4. **Edges, not boxes** — specular top highlight, dark outer border, hairline dividers inset from the left.
   Nested radii step 12 → 9 → 7 instead of sharing one value.
5. **Two-line rows** — name, then what it's doing, at roughly +8px height per row.

Untouched: all ten themes in `src/themes/index.ts`, the `--hub-*` variable contract, collapsed and expanded
modes, usage chips, `InlineRename`. Concretely this is the new tokens plus a revised `SessionPill` and a new
`TitleBar`.

## Build order

Each phase is useful on its own, and each is built **on** the previous rather than beside it.

1. **Foundation & skin** — new tokens, rewritten `TitleBar`, status-as-a-dot in `SessionPill`, applied to the
   existing Hive window. No backend work. Doing this first means everything after is built in the final visual
   language instead of being restyled later.
2. **The Rail window** — second Tauri window, eight anchors, per-anchor remembered size, cursor-follow poller,
   nub/sliver with unread badge, go-to-session inside. Feeds off existing sessions, so it is usable before any
   agent exists.
3. **Agent ingest** — tokens, `/api/agents/*`, the `agent_*` tools, `agent_registry`, permanent apps bar,
   per-app feeds, composer targeting and the reply queue. Where the first agent appears, and where the icon
   set lands.
4. **Tasks** — the `tasks_*` tools plus Hive's first disk persistence, the Tasks pane, filters, the No-date
   group, collapsible notes, agent-completion labelling. Deliberately after ingest: it is the largest piece and
   needs phase 3's plumbing to be worth anything.
5. **Combined mode** — reparent the panes into Hive behind the toggle. Last, because it can only combine panes
   that already exist.

## Testing

Following the existing pattern (`*.test.tsx` beside components, `models/tests.rs` for Rust):

- **Monitor resolution** — cursor position → monitor work area → anchored rect, across mismatched DPI. Pure
  function, so table-driven.
- **Per-anchor size persistence** — set size on one anchor, switch, switch back, assert restoration.
- **`tasks_upsert` idempotency** — same `external_id` twice yields one row with updated fields; this is the
  single most important test in the feature.
- **Task completion attribution** — agent vs user completion produce distinguishable records.
- **Date filter** — undated tasks appear under every range.
- **Token auth** — an unknown or revoked token is rejected; one agent's token cannot post as another.
- **`agent_apps_sync` is a replace** — an app absent from a later sync disappears.
- **Feed ordering** — a `waiting_for_input` session outranks a newer agent post while the pin setting is on.
- **Regression** — existing collapsed-bar and question-prompt tests must pass untouched.

## Risks

| Risk | Mitigation |
|---|---|
| Agent never posts because nothing orchestrates it | Ship all four instruction mechanisms; document plainly that a scheduled agent is required for the Rail to feel live |
| Cursor-follow feels jittery or fights the user | Debounce monitor changes; never reposition while the Rail is open |
| Merged feed buries a blocked session | Pin waiting sessions; per-app demotion switch |
| Duplicate tasks from repeated agent runs | Stable `external_id` + upsert, tested first |
| Task data loss on crash | Write-through persistence rather than write-on-exit |
| Rail overlaps a maximised window and annoys | 32px nub, offset setting, auto-hide-when-idle option |

## Open questions

None blocking. Two worth revisiting once phase 3 is real:

- Whether `agent_ask` should share the existing question store or get its own — depends on how the pending-question
  UI generalises past sessions.
- Whether feed history should persist alongside tasks. Currently no; revisit if the Rail proves useful as a log
  rather than a glance.
