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
- **The Rail opens into a sidebar**, not a row of tabs: Rail (All activity / Tasks / Agents / Settings),
  plus a Hive group (Sessions) once combined mode is on. One layout for both modes — the sidebar reads
  better at every width the rail is given, and the tab strip could not have carried a fifth pane. The plain
  rail's default width grew from 372px to 520px to make room for it.
- **Declared apps and agents persist** (`agents.json`), like tasks. A session is alive or it is not, but an
  agent's declared apps are a standing fact, and losing them on restart left the connector bar empty until
  every agent happened to call in — which reads as "nothing is connected" rather than "nobody has checked in
  yet". Restored apps report `unknown` health until their agent speaks: the last health seen is not news.
  `enabled` persists for the same reason — a mute that undoes itself on restart is not a mute.
- **Combined mode** is a setting that brings **Hive into the Rail** behind a sidebar
  (Sessions / Activity / Tasks / Agents / Settings). Hive's own window hides itself while it is on, and
  `Detach Hive` in the sidebar reverses it (`show_main_window`). Same pane components either way.
  The direction matters: the Rail is the window that is always there, edge-docked and following the cursor,
  so it is the one worth having everything in. It was built the other way round first — panes reparented into
  Hive, rail closed — and that reads as the toggle doing nothing, because the window you were looking at when
  you flipped it is the one that disappears.
- Combined mode remembers its size **separately per edge** from the plain rail (`sizeKey`): 372px is a panel
  for four panes and a sliver for the whole of Hive.
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
| `agent_ask` | agent → hive | Ask the user a question with clickable options and wait for the answer, as `hub_ask` does for sessions. Waits up to `wait_seconds` (default 30, capped at 60) rather than indefinitely. |
| `agent_ask_result` | hive → agent | Collect the answer to a question the agent did not wait out. |
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
| `simple-icons` npm, bundled | 94 | CC0 | Single-colour glyph in the official brand hex |
| Generated monogram | 146 | ours | Two-letter tile, hue hashed from the name |

Measured, not estimated: `simple-icons` v16 ships 3,453 marks, and only 94 of the 240 match. This is not a
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
5. **Combined mode** — bring Hive into the rail behind the toggle. Last, because it can only combine panes
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

## Platform constraints learned while building phases 1–2

These cost real time to find and are invisible in the source. Anything in later
phases that creates or reparents a window must respect them.

- **Windows must be created during `setup()`, before the event loop starts.**
  `WebviewWindowBuilder::build()` blocks until the webview exists, and once the
  loop is running that wait never completes — from a command worker thread *and*
  from `run_on_main_thread`, because that closure runs on the loop `build()`
  needs to pump. It returns nothing and logs nothing; the window half-exists and
  never paints. **Phase 5's combined mode must not create windows on demand.**
- **Capabilities are per-window.** A window absent from a capability's `windows`
  list gets no core plugin access, so its webview cannot invoke anything. It
  fails silently: no Rust error, only a console message inside a window that may
  not be visible. `rail/window.rs` has a test asserting the file lists the rail.
- **`transparent` CSS on a non-transparent window renders white.** Any window
  root needs a solid background token, or unpainted frames flash white.
- **A GUI process has no console.** `tracing` output through a `pnpm` shim is
  discarded on Windows, so failures leave no trail. The rail appends to
  `%TEMP%/hive-rail.log` for this reason; anything similarly hard to observe
  should do the same.
- **`HIVE_RAIL_AUTOOPEN=1`** opens the rail at startup through the same `show()`
  path as a real click, so window placement can be verified without a human.

## A recurring failure mode: functions wired to nothing

Three features shipped with their logic written, tested, and unreachable:

| Function | Existed since | Nothing called it until |
|---|---|---|
| `close_rail` | phase 2 | the rail could not be dismissed at all |
| `setSizeForAnchor` | phase 2 | dragging the rail's edge did nothing |
| `addTaskNote` | phase 4 | there was no way to write a note |
| `broadcastRailSettings` | (absent) | flipping combined mode in one window never reached the other |
| `.hub-hairline` | phase 1 | no element ever carried the class |

And its mirror image — something wired to *too much*. `useRailResize` recorded
every resize the OS reported as the size the user had dragged. Every placement
reports one; the open animation reports one per frame. So each open recorded an
intermediate frame as the remembered size, started the next open from that
smaller size, and ratcheted the panel down towards nothing. Placement and the
"this resize is ours" window now live in one module, so they cannot drift apart.

Each had passing tests. Each was invisible to the test suite, because a unit
test proves a function behaves, never that anything reaches it.

**The check, before calling any phase done:** for every public function added,
name the user action that reaches it. If there is no such action, either wire it
or delete it. "The store method exists and is tested" is not evidence of a
working feature.

A second habit that would have caught two of these: the affordance has to exist
before the state it depends on. The notes toggle only rendered once a note
existed, so the first note could never be written — a bootstrap gap no test with
seeded data would find.

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

- ~~Whether `agent_ask` should share the existing question store or get its own~~ — **its own**
  (`AgentQuestionStore`). The session store is keyed by session id and its pending questions feed the session
  UI, which would go looking for a session that an agent id does not name. Same shape, separate keyspace, and
  the same one-pending-question-per-asker rule.
- Whether feed history should persist alongside tasks. Currently no — the last 1000 posts, in memory. Paged at
  50 rather than scrolled, which is what a thousand rows needs to be usable at all.

A third habit, from combined mode: **a setting that spans two windows needs a
transport.** Hive and the Rail are separate WebView2 instances, so they hold
separate Zustand stores; `localStorage` is shared but read once at module load.
The toggle was correct, persisted, and tested, and still did nothing visible,
because the window that had to react never learned about it. `railSync.ts` emits
a Tauri event and both windows listen (`useRailSettingsSync`).

### One rule for following the cursor

The rail follows the cursor unless the pointer is on it. That single condition is
the whole of "never move out from under the hand using it", and crossing to
another monitor satisfies it by definition.

It took two wrong versions to get there. First the poll was gated on
`!combined && !open`, and combined mode is always open — blocked twice over, so
it never followed. Then an open panel was still excluded on the theory that it
would yank out from under a click, and it followed anyway: every placement makes
the OS emit a resize, `useRailResize` records it, `sizes` changes identity, and
the placement effect — keyed on `sizes` — re-ran and re-placed at the cursor's
monitor. Behaviour worth having, arrived at by accident, and it also overwrote
the user's remembered size with placement echoes.

Placement is no longer keyed on `sizes`; forgetting a size re-places explicitly,
because that is the only case that needs it. `setSizeForAnchor` ignores an
unchanged value so an echo cannot wake anything either.

### Agent questions

`agent_ask` blocks the agent, so the question outranks everything else in the feed — above even a session
waiting on the user, because something else's work is stopped until the click lands. It is never muted and
never filtered out of an app view for the same reason: hiding it would strand the agent.

The wait is bounded. An MCP call that hangs indefinitely is worse for the agent than being told to collect
the answer later, so `agent_ask` waits `wait_seconds` (default 30, capped at 60) and then hands back a
question id for `agent_ask_result`.

Questions are **not** persisted, unlike tasks and declared apps. A question is a live conversation: an agent
that has been restarted is no longer waiting, so restoring one would present the user with a choice that can
no longer reach anybody.

Answering is keyed on the question id, not the agent: by the time a click lands the agent may have asked
something else, and answering whatever is current would attribute the choice to the wrong question. First
answer wins, so two windows showing the same question cannot double-answer it.

### Opacity

Two settings, not one: **window** and **sidebar**. The sidebar is a constant and
can afford to be more solid than the content beside it, which a single slider
could not express.

Each surface paints its ground exactly once — the root paints nothing — so the
two settings stay independent. Painting the root as well would stack the panel's
alpha underneath the sidebar's and make one setting depend on the other.

The rail window is created **transparent** for this. On an opaque window a
translucent page renders white, which is what the rail looked like during phase
2 while it was being debugged; the window has to allow alpha even though it
paints a solid ground at the default of 100%.

Floored at 30%. A rail faded to nothing is one the user cannot find again —
the same reasoning as dimming rather than hiding when idle.

### Hover is decided by the cursor, not by DOM events

A 32px strip at the screen edge often never receives a `mouseenter`, and an open
panel often never receives the matching `mouseleave`. Hover-to-open appeared to
work anyway — **by accident**: with cursor-follow on, repositioning the window
four times a second made Windows re-run hit-testing and synthesise the events.
Pin the rail to a monitor and the poll stops, so hovering did nothing at all;
leave the panel and it never closed.

`cursor_over_rail` compares the cursor against the window's own rect in Rust,
and the frontend polls it every 200ms whenever hover or cursor-follow is on. Same
question, no accident, and it behaves identically however the rail is placed.
The DOM `mouseenter` on the nub is kept only because it opens instantly when the
event does arrive.

Combined mode is **not** exempt. It was, on the grounds that collapsing the whole
of Hive from a cursor moving away is a lot to happen by accident — but it is the
same Open-on setting either way, so the exemption was the surprise rather than
the closing. The grace period and the typing guard are what keep it from being
twitchy. The settings row says what hover means in there, because a setting whose
effect changes with another setting has to say so.

### Settings, and where Hive's went

The pane you were last on is remembered, along with the app the feed was
filtered to — the rail collapses whenever the cursor leaves, so landing
somewhere else each time would lose your place several times an hour. It is
validated on load: a pane id from an older build, or a hand-edited file, falls
back rather than rendering a pane with nothing behind it.

The rail's settings are five child panes under one sidebar row — Position,
Behaviour, Appearance, Muted apps, Plugin setup — rather than five permanent rows
or one long scroll. The row expands when it is the pane and marks itself active
for any of its children.

**Hive's own settings moved in.** The theme is one palette for both windows, so it
belongs beside the rail's opacity settings rather than in a Hive-only screen; the
plugin-install snippet became the Plugin setup child. Hive's Settings view is
kept, because it is the only way to reach any of this with the rail closed, and
both edit the same store.

### Frosted glass was tried, and removed

Lowering the opacity shows the desktop through unblurred: CSS `backdrop-filter`
only blurs what is inside the page, so a real frost has to come from the
compositor. `window-vibrancy` did that — and it was the flash.

DWM composites the acrylic backdrop the moment the window has size, which is
before the webview presents its first frame at that size. What shows in that
frame is Windows' own acrylic host surface: light grey on a light system theme.
The tint is irrelevant (darkening it changed nothing), and nothing on the page
side can cover it, because the page is not allowed to paint there yet.

Measured, not guessed: 21 screen captures per open, counting frames whose mean
brightness jumped. With acrylic, one to three pale frames every time. Without
it, none. So the choice is frosted glass **or** a clean open, and a clean open
won.

### Showing without a flash

Two separate flashes, both from placing a window after it was already visible.

`open_rail` used to just show the window and leave the frontend to place it. The
window appeared wherever it was last left — the wrong monitor, or the nub's old
rect — and only then jumped. The rail cannot fix this from its own side: it does
not know it is visible until the `rail-visibility` event, which arrives after it
already is. So `open_rail` takes the geometry and places while still hidden, and
both callers pass it from the shared settings (`openRail`).

The second is inside `position_rail`: Tauri has no atomic move-and-resize for a
window, so there is always one frame between `set_position` and `set_size`. Which
order hides that frame depends on the direction — opening out from the nub, move
first and the frame is inside the final rect; collapsing back, resize first. The
wrong order leaves the window briefly hanging off the screen edge.

### Opening, and the three things that flashed

The frosted backdrop exists the moment the window has size — acrylic is painted
by the compositor, not by the page — so anything not ready at that instant shows
as a blank frosted slab. That is the flash, and it took three goes to remove.

1. **Placed after showing.** `open_rail` showed the window and left the frontend
   to position it, so it appeared at whatever rect it last had and then jumped.
   Fixed by passing the geometry to `open_rail` and placing while hidden.
2. **Grown over a few frames.** Animating the window from nub to panel hid the
   slab, but a 32px nub becoming a 520px panel is half a screen of travel — and
   hovering in and out left animations starting from each other's half-finished
   rects, so the window was permanently mid-sweep. Removed, along with the
   easing and interpolation helpers it needed: dead code, not kept "in case".
3. **Painted into a 32px window.** Rendering the panel and resizing two frames
   later left those frames showing a slice of the panel clipped into the nub's
   window.

What works: the panel renders **invisible behind the nub**, so nothing on screen
changes while the webview rasterises it; two frames later the window resizes and
the panel is revealed in the same tick. `opacity: 0` rather than
`visibility: hidden`, which skips painting and would leave nothing rasterised.
Showing it is then a compositor change, not a repaint, so there is nothing for
the frosted slab to be waiting on.

The only motion left is a **content-level drawer reveal** — 180ms, opacity 0→1,
20px translate out of the anchored edge, `cubic-bezier(0.16, 1, 0.3, 1)`. In CSS
rather than Framer Motion: identical output, and the dependency would be ~40KB
for one transition.

### One palette, ten accents

A theme used to redefine every surface — ground, surface, border, text, blur — so
choosing a colour changed the app's character and the "glass" look was ten
different looks. Now the surfaces are fixed dark glass (translucent neutral,
hairlines at 10% white) and a theme contributes only the **accent** that marks
what you are on, plus the tint on a row that is blocked on you. The picker shows
one swatch, because one thing varies.

`--hub-bg-solid` stays opaque on purpose: the rail's opacity setting decides how
much desktop shows through, and multiplying two alphas would make that slider
mean something different at each end. The in-page blur is only for layers that
genuinely sit over other page content, like Hive's usage breakdown —
`backdrop-filter` samples the page, not the screen, which is what the acrylic
backdrop was for and why removing it ended the opening flash.

### The edge gap is part of the target

The offset holds the rail clear of the bezel, and that gap was dead space:
running the cursor to the very edge of the screen — which is the whole gesture —
landed in it and nothing happened. `hover_rect` grows the hover test towards the
anchored edge by the offset, so the gap counts as the rail. Corners grow on both
axes. The offset itself is capped at 100px, past which the rail stops reading as
docked to an edge at all.
