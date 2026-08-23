# Hive Agent Rail — Phase 5: settings, per-app mute, combined mode

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the rail's behaviour adjustable — anchor, offset, resting form, follow-cursor, open-on, hide-when-idle, per-app mute — and let the rail's panes live inside the Hive window instead of their own.

**Architecture:** Every setting already has a home (`railStore`, persisted to `localStorage`); this phase adds the missing fields, the behaviour behind each, and one screen to change them. Combined mode reparents the existing pane components into Hive's window and hides the rail window — it never creates a window, because `build()` deadlocks after the event loop starts.

**Tech Stack:** React 19, TypeScript 5.8, Zustand 5, Vitest 3; Rust 2021 for the auto-add safety net.

**Spec:** `docs/superpowers/specs/2026-08-22-hive-agent-rail-design.md`

**Depends on:** Phases 1–4.

## Global Constraints

- **Read the spec's "A recurring failure mode: functions wired to nothing" first.** Three features have already shipped tested and unreachable. For every setting added here, name the user action that reaches it and the observable behaviour it changes. A setting that persists but changes nothing is the same bug in a new coat.
- **Combined mode must not create a window.** `WebviewWindowBuilder::build()` deadlocks once the event loop is running; the rail window is created in `setup()` and combined mode only hides it.
- **`railStore` is shared between both windows** — same origin, same `localStorage` — so a setting changed in one is visible to the other after its next read.
- **The storage key is already `.v2`.** Adding fields is backward-compatible because `load()` merges over `DEFAULTS`; do not bump it again.
- **Existing tests must pass untouched**, all 279 frontend and 198 Rust.
- **Test commands:** `pnpm vitest run <path>`, `pnpm build`, `cd src-tauri && cargo test`.
- **Windows/PowerShell:** chain with `;`. **Commits:** no `Co-Authored-By`.

## Scope

**In:** the five missing settings and their behaviour, a settings pane, per-app mute, combined mode, and auto-add of undeclared apps.

**Out, with reasons:**
- **A toggle for auto-add.** The behaviour ships always-on. A bar that silently drops posts from an undeclared app is worse than one that shows an extra row, and the escape hatch already exists — mute the agent. Adding a toggle would mean a whole client-to-server settings channel for one boolean.
- **`agent_ask`.** Still needs `QuestionStore` generalised past session ids.
- **Per-monitor pinning UI.** `followCursor` off already falls back to the primary monitor; a monitor picker needs a monitor list over IPC, which is more surface than the setting is worth right now. Flagged rather than silently dropped.

---

### Task 1: The missing settings in the store

**Files:** Modify `src/stores/railStore.ts`; create `src/stores/railStore.settings.test.ts`.

**Produces:** `openOn: "click" | "hover"`, `hideWhenIdle: boolean`, `combined: boolean`, `mutedApps: string[]`, plus `setOpenOn`, `setHideWhenIdle`, `setCombined`, `toggleAppMuted`, `isAppMuted`.

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { useRailStore, RAIL_STORAGE_KEY } from "./railStore";

describe("railStore settings", () => {
  beforeEach(() => {
    localStorage.clear();
    useRailStore.setState(useRailStore.getInitialState(), true);
  });

  it("defaults to click-to-open, always visible, own window", () => {
    const s = useRailStore.getState();
    expect(s.openOn).toBe("click");
    expect(s.hideWhenIdle).toBe(false);
    expect(s.combined).toBe(false);
    expect(s.mutedApps).toEqual([]);
  });

  it("mutes and unmutes an app", () => {
    useRailStore.getState().toggleAppMuted("gmail");
    expect(useRailStore.getState().isAppMuted("gmail")).toBe(true);
    expect(useRailStore.getState().isAppMuted("github")).toBe(false);

    useRailStore.getState().toggleAppMuted("gmail");
    expect(useRailStore.getState().isAppMuted("gmail")).toBe(false);
  });

  it("persists every setting across a reload", () => {
    const s = useRailStore.getState();
    s.setOpenOn("hover");
    s.setHideWhenIdle(true);
    s.setCombined(true);
    s.toggleAppMuted("gmail");

    const saved = JSON.parse(localStorage.getItem(RAIL_STORAGE_KEY) ?? "{}");
    expect(saved.openOn).toBe("hover");
    expect(saved.hideWhenIdle).toBe(true);
    expect(saved.combined).toBe(true);
    expect(saved.mutedApps).toEqual(["gmail"]);
  });

  it("keeps settings saved before these fields existed", () => {
    // load() merges over DEFAULTS, so an older file must not lose the user's
    // anchor just because it predates openOn.
    localStorage.setItem(RAIL_STORAGE_KEY, JSON.stringify({ anchor: "bl", offset: 20 }));
    useRailStore.setState(useRailStore.getInitialState(), true);

    // The store reads localStorage at creation, so re-import semantics are
    // covered by load() itself; assert the merge shape directly.
    const merged = { anchor: "bl", offset: 20 };
    expect(merged.anchor).toBe("bl");
  });

  it("does not persist the open flag", () => {
    useRailStore.getState().setOpen(true);
    const saved = JSON.parse(localStorage.getItem(RAIL_STORAGE_KEY) ?? "{}");
    expect(saved.open).toBeUndefined();
  });
});
```

Replace that fourth test's body with a real assertion once `load` is exported, or drop it — merging is already covered by the existing `survives corrupt stored settings` test. Prefer dropping it over keeping a test that asserts a literal.

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Extend the store**

Add to `Persisted`:

```ts
  /** Hover is faster; click avoids opening it by brushing past the edge. */
  openOn: OpenOn;
  /** Fade the rail out while nothing needs the user. */
  hideWhenIdle: boolean;
  /** Panes live inside the Hive window instead of the rail's own. */
  combined: boolean;
  /** App slugs demoted out of the merged feed. Per app, not per agent, so a
   *  noisy Gmail can be quieted without silencing the agent that reports it. */
  mutedApps: string[];
```

with `export type OpenOn = "click" | "hover";`, defaults `openOn: "click"`, `hideWhenIdle: false`, `combined: false`, `mutedApps: []`, and:

```ts
    setOpenOn: (openOn) => { set({ openOn }); persist(); },
    setHideWhenIdle: (hideWhenIdle) => { set({ hideWhenIdle }); persist(); },
    setCombined: (combined) => { set({ combined }); persist(); },
    toggleAppMuted: (appId) => {
      const muted = get().mutedApps.includes(appId)
        ? get().mutedApps.filter((id) => id !== appId)
        : [...get().mutedApps, appId];
      set({ mutedApps: muted });
      persist();
    },
    isAppMuted: (appId) => get().mutedApps.includes(appId),
```

- [ ] **Step 4: Run to verify it passes. Step 5: Commit.**

```bash
git commit -m "feat: open-on, hide-when-idle, combined and per-app mute settings"
```

---

### Task 2: Per-app mute changes the feed

**Files:** Modify `src/feed/buildFeed.ts`, `src/feed/buildFeed.test.ts`, `src/components/RailPanel.tsx`, `src/components/ConnectedAppsBar.tsx`, `src/components/ConnectedAppsBar.test.tsx`.

**Produces:** `BuildFeedOptions` gains `mutedApps?: string[]`; the apps bar shows a muted app as dimmed with a `data-muted` attribute and offers mute on right-click.

- [ ] **Step 1: Write the failing tests**

In `buildFeed.test.ts`:

```ts
  it("drops a muted app's posts from the merged feed", () => {
    const rows = buildFeed(
      [],
      [post("gmail-1", t(10), "gmail"), post("x-1", t(20), "x")],
      { mutedApps: ["gmail"] }
    );
    expect(rows.map((r) => (r.kind === "post" ? r.post.id : ""))).toEqual(["x-1"]);
  });

  it("still shows a muted app in its own per-app view", () => {
    // Muting demotes an app out of All activity; it does not hide it from the
    // view the user deliberately opened.
    const rows = buildFeed([], [post("gmail-1", t(10), "gmail")], {
      appId: "gmail",
      mutedApps: ["gmail"],
    });
    expect(rows).toHaveLength(1);
  });

  it("never mutes a session", () => {
    const rows = buildFeed([session("s1", "running", t(30))], [], { mutedApps: ["gmail"] });
    expect(rows).toHaveLength(1);
  });
```

In `ConnectedAppsBar.test.tsx`:

```ts
  it("marks a muted app", () => {
    useRailStore.setState({ mutedApps: ["gmail"] });
    render(<ConnectedAppsBar selected={null} onSelect={vi.fn()} />);
    expect(nodeFor("gmail")).toHaveAttribute("data-muted", "true");
    expect(nodeFor("x")).not.toHaveAttribute("data-muted");
  });

  it("mutes an app from its context menu", async () => {
    useRailStore.setState({ mutedApps: [] });
    render(<ConnectedAppsBar selected={null} onSelect={vi.fn()} />);
    fireEvent.contextMenu(nodeFor("gmail"));
    expect(useRailStore.getState().isAppMuted("gmail")).toBe(true);
  });
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement**

In `buildFeed`, after the `appId` branch, filter the post rows:

```ts
  const muted = new Set(options.mutedApps ?? []);
  // Sessions are never muted — muting is about a chatty app, not about hiding
  // the user's own work.
  const visiblePosts = posts.filter(
    (post) => !post.appId || !muted.has(post.appId)
  );
```

and build `rows` from `visiblePosts`. The `appId` branch above it stays unfiltered, so a deliberately opened per-app view still shows everything.

In `RailPanel`, read `mutedApps` from `useRailStore` and pass it to `buildFeed`.

In `ConnectedAppsBar`, read `isAppMuted`/`toggleAppMuted`, add `data-muted`, dim a muted tile (`opacity: 0.45`), and add `onContextMenu={(e) => { e.preventDefault(); toggleAppMuted(app.id); }}` with the title extended to say right-click mutes.

- [ ] **Step 4: Run to verify it passes. Step 5: Commit.**

---

### Task 3: Open on hover, and hide when idle

**Files:** Modify `src/components/RailNub.tsx`, `src/components/RailNub.test.tsx`, `src/Rail.tsx`.

**Produces:** the nub opens on `mouseenter` when `openOn === "hover"`; when `hideWhenIdle` is on and nothing needs the user, the nub renders at reduced opacity and full opacity on hover.

- [ ] **Step 1: Write the failing test**

```tsx
  it("opens on hover when set to hover", async () => {
    useRailStore.setState({ openOn: "hover" });
    const onOpen = vi.fn();
    render(<RailNub onOpen={onOpen} />);
    await userEvent.hover(screen.getByTestId("rail-nub"));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("does not open on hover when set to click", async () => {
    // Brushing past the screen edge must not open it.
    useRailStore.setState({ openOn: "click" });
    const onOpen = vi.fn();
    render(<RailNub onOpen={onOpen} />);
    await userEvent.hover(screen.getByTestId("rail-nub"));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("fades out while idle if asked to", () => {
    useRailStore.setState({ hideWhenIdle: true });
    useHubStore.setState({ sessions: [], unreadSessions: new Set(), agentPosts: [], tasks: [] });
    render(<RailNub onOpen={vi.fn()} />);
    expect(screen.getByTestId("rail-nub")).toHaveAttribute("data-dimmed", "true");
  });

  it("stays solid when something needs the user, even if hide-when-idle is on", () => {
    useRailStore.setState({ hideWhenIdle: true });
    useHubStore.setState({
      sessions: [],
      unreadSessions: new Set(),
      agentPosts: [],
      tasks: [
        { id: "t1", externalId: null, agentId: null, title: "a", appId: null, sourceLabel: null, due: null, done: false, completedBy: null, completedAt: null, notes: [], createdAt: "", updatedAt: "" },
      ],
    });
    render(<RailNub onOpen={vi.fn()} />);
    expect(screen.getByTestId("rail-nub")).not.toHaveAttribute("data-dimmed");
  });
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement**

In `RailNub`, read `openOn` and `hideWhenIdle`; add `onMouseEnter={openOn === "hover" ? onOpen : undefined}`, and:

```tsx
  // Dimmed, not hidden: a rail that vanishes entirely is one the user cannot
  // find again without the Hive button.
  const dimmed = hideWhenIdle && isIdle;
```

with `data-dimmed={dimmed ? "true" : undefined}` and `opacity: dimmed ? 0.35 : 1`, plus a CSS transition and `onMouseEnter`/`onMouseLeave` restoring full opacity on hover.

- [ ] **Step 4: Run to verify it passes. Step 5: Commit.**

---

### Task 4: Auto-add an undeclared app

**Files:** Modify `src-tauri/src/mcp/agent_dispatch.rs`, `src-tauri/src/state/agent_registry.rs`.

**Produces:** `AgentRegistry::ensure_app(agent_id, app_id)` adds an app if absent, and `agent_post` / `tasks_upsert` call it so a post from an undeclared app still appears in the bar.

- [ ] **Step 1: Write the failing tests**

In `agent_registry.rs`:

```rust
    #[tokio::test]
    async fn ensure_app_adds_an_undeclared_app_once() {
        let reg = AgentRegistry::new();
        assert!(reg.ensure_app("a1", "gmail").await, "first sighting adds it");
        assert!(!reg.ensure_app("a1", "gmail").await, "second is a no-op");
        assert_eq!(reg.apps("a1").await.len(), 1);
    }

    #[tokio::test]
    async fn ensure_app_labels_it_from_the_slug() {
        // Nothing better is available: the agent never declared a label.
        let reg = AgentRegistry::new();
        reg.ensure_app("a1", "made-up-thing").await;
        assert_eq!(reg.apps("a1").await[0].label, "made-up-thing");
    }

    #[tokio::test]
    async fn a_later_sync_can_still_replace_an_auto_added_app() {
        let reg = AgentRegistry::new();
        reg.ensure_app("a1", "gmail").await;
        reg.sync_apps("a1", vec![]).await;
        assert!(reg.apps("a1").await.is_empty(), "sync stays authoritative");
    }
```

In `agent_dispatch.rs`:

```rust
    #[tokio::test]
    async fn posting_from_an_undeclared_app_still_shows_it_in_the_bar() {
        // Otherwise the post arrives attributed to an app that appears nowhere,
        // and the user cannot filter to or mute it.
        let (state, _dir) = test_state();
        state.agents.upsert("a1", "Grok".into(), None).await;

        call(&state, "agent_post", json!({ "content": "hi", "app_id": "surprise" })).await;

        let apps = state.agents.apps("a1").await;
        assert_eq!(apps.len(), 1);
        assert_eq!(apps[0].id, "surprise");
    }

    #[tokio::test]
    async fn a_task_from_an_undeclared_app_also_registers_it() {
        let (state, _dir) = test_state();
        state.agents.upsert("a1", "Grok".into(), None).await;
        call(&state, "tasks_upsert", json!({ "title": "Thing", "app_id": "surprise" })).await;
        assert_eq!(state.agents.apps("a1").await.len(), 1);
    }
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement**

In `AgentRegistry`:

```rust
    /// Add `app_id` if the agent has not declared it. Returns whether it was
    /// added.
    ///
    /// The safety net for an agent that posts without calling
    /// `agent_apps_sync`: without this the post is attributed to an app that
    /// appears nowhere, so the user can neither filter to it nor mute it.
    /// `sync_apps` stays authoritative and can remove what this added.
    pub async fn ensure_app(&self, agent_id: &str, app_id: &str) -> bool {
        let mut apps = self.apps.write().await;
        let entry = apps.entry(agent_id.to_string()).or_default();
        if entry.iter().any(|a| a.id == app_id) {
            return false;
        }
        entry.push(AgentApp {
            id: app_id.to_string(),
            label: app_id.to_string(),
            health: AppHealth::Ok,
        });
        true
    }
```

(`AppHealth` must move from the test-only import to the module imports.)

In `agent_dispatch`, in both `agent_post` and `tasks_upsert`, after resolving `app_id`:

```rust
            if let Some(ref app) = app_id {
                if state.agents.ensure_app(agent_id, app).await {
                    let _ = state.event_tx.send(WsEvent::AgentAppsChanged {
                        agent_id: agent_id.to_string(),
                        apps: state.agents.apps(agent_id).await,
                    });
                }
            }
```

- [ ] **Step 4: Run to verify it passes. Step 5: Commit.**

---

### Task 5: The settings pane

**Files:** Create `src/components/RailSettingsPane.tsx`, `src/components/RailSettingsPane.test.tsx`.

**Produces:** `RailSettingsPane()` with an 8-way anchor grid, offset stepper, resting-form and open-on selectors, three switches, per-anchor size readout with a reset, and a muted-apps list.

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { RailSettingsPane } from "./RailSettingsPane";
import { useRailStore } from "../stores/railStore";
import { useHubStore } from "../stores/hubStore";

describe("RailSettingsPane", () => {
  beforeEach(() => {
    localStorage.clear();
    useRailStore.setState(useRailStore.getInitialState(), true);
    useHubStore.setState({ agentApps: [] });
  });

  it("offers all eight anchors", () => {
    render(<RailSettingsPane />);
    expect(screen.getAllByTestId("anchor-option")).toHaveLength(8);
  });

  it("changes the anchor", async () => {
    render(<RailSettingsPane />);
    await userEvent.click(screen.getByRole("button", { name: /bottom left/i }));
    expect(useRailStore.getState().anchor).toBe("bl");
  });

  it("marks the current anchor", () => {
    useRailStore.setState({ anchor: "bl" });
    render(<RailSettingsPane />);
    const pressed = screen
      .getAllByTestId("anchor-option")
      .filter((b) => b.getAttribute("aria-pressed") === "true");
    expect(pressed).toHaveLength(1);
  });

  it("changes the edge offset", async () => {
    render(<RailSettingsPane />);
    await userEvent.click(screen.getByRole("button", { name: /increase edge offset/i }));
    expect(useRailStore.getState().offset).toBe(15);
  });

  it("will not take the offset below zero", async () => {
    useRailStore.setState({ offset: 0 });
    render(<RailSettingsPane />);
    await userEvent.click(screen.getByRole("button", { name: /decrease edge offset/i }));
    expect(useRailStore.getState().offset).toBe(0);
  });

  it("switches the resting form", async () => {
    render(<RailSettingsPane />);
    await userEvent.click(screen.getByRole("button", { name: /^sliver$/i }));
    expect(useRailStore.getState().restingForm).toBe("sliver");
  });

  it("switches open-on", async () => {
    render(<RailSettingsPane />);
    await userEvent.click(screen.getByRole("button", { name: /^hover$/i }));
    expect(useRailStore.getState().openOn).toBe("hover");
  });

  it("toggles follow-cursor, hide-when-idle and combined", async () => {
    render(<RailSettingsPane />);
    await userEvent.click(screen.getByRole("switch", { name: /follow my cursor/i }));
    expect(useRailStore.getState().followCursor).toBe(false);

    await userEvent.click(screen.getByRole("switch", { name: /hide when nothing/i }));
    expect(useRailStore.getState().hideWhenIdle).toBe(true);

    await userEvent.click(screen.getByRole("switch", { name: /combine with hive/i }));
    expect(useRailStore.getState().combined).toBe(true);
  });

  it("shows the remembered size for the current anchor and can forget it", async () => {
    useRailStore.setState({ anchor: "right", sizes: { right: [400, 700] } });
    render(<RailSettingsPane />);
    expect(screen.getByTestId("remembered-size")).toHaveTextContent("400");

    await userEvent.click(screen.getByRole("button", { name: /forget remembered size/i }));
    expect(useRailStore.getState().sizes.right).toBeUndefined();
  });

  it("lists muted apps and can unmute one", async () => {
    useHubStore.setState({
      agentApps: [
        { agentId: "a1", agentName: "Grok", id: "gmail", label: "Gmail", health: "ok" },
      ],
    });
    useRailStore.setState({ mutedApps: ["gmail"] });
    render(<RailSettingsPane />);

    await userEvent.click(screen.getByRole("button", { name: /unmute gmail/i }));
    expect(useRailStore.getState().isAppMuted("gmail")).toBe(false);
  });

  it("says so when nothing is muted", () => {
    render(<RailSettingsPane />);
    expect(screen.getByText(/nothing muted/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Write the pane**

Build it from the same primitives as `AgentsPane` — a `SectionTitle`, inset rows on `var(--hub-surface)`, a `Switch` with `role="switch"` and `aria-checked`, and a segmented control for resting form and open-on. The anchor grid is a 3×3 with the centre cell inert, each button `data-testid="anchor-option"` and `aria-label` naming the position ("Top left", "Bottom centre", …) so the tests can address them by name. `setSizeForAnchor` needs a companion `forgetSizeForAnchor(anchor)` in the store — add it in this task with its own test rather than reaching into `sizes` from the component.

- [ ] **Step 4: Run to verify it passes. Step 5: Commit.**

---

### Task 6: Combined mode

**Files:** Modify `src/App.tsx`, `src/Rail.tsx`; create `src/components/CombinedPanes.tsx`, `src/components/CombinedPanes.test.tsx`.

**Produces:** `CombinedPanes()` — a sidebar plus the four panes, rendered inside Hive when `combined` is true. The rail window hides itself while combined. `RailButton` becomes `Detach rail` in that state.

- [ ] **Step 1: Write the failing test**

```tsx
  it("shows a sidebar entry per pane", () => {
    render(<CombinedPanes />);
    for (const label of ["Sessions", "Activity", "Tasks", "Agents", "Settings"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("switches pane", async () => {
    render(<CombinedPanes />);
    await userEvent.click(screen.getByRole("button", { name: "Tasks" }));
    expect(screen.getByTestId("task-add-input")).toBeInTheDocument();
  });

  it("counts what needs the user in the sidebar", () => {
    useHubStore.setState({
      tasks: [
        { id: "t1", externalId: null, agentId: null, title: "a", appId: null, sourceLabel: null, due: null, done: false, completedBy: null, completedAt: null, notes: [], createdAt: "", updatedAt: "" },
      ],
    });
    render(<CombinedPanes />);
    expect(screen.getByTestId("sidebar-count-tasks")).toHaveTextContent("1");
  });
```

And in `Rail.tsx`'s behaviour: when `combined` is true the rail hides itself via `close_rail`, because two copies of the same pane on screen is worse than either alone.

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement**

`CombinedPanes` holds `pane` state, renders a 152px sidebar of buttons with counts from the store, and switches between `<CollapsedBar/ExpandedDashboard>` (Sessions), `RailPanel`, `TasksPane`, `AgentsPane`, `RailSettingsPane`.

In `App.tsx`, when `useRailStore(s => s.combined)` is true, render `<CombinedPanes />` in place of the current view body and swap the `Rail` button for one that calls `setCombined(false)`.

In `Rail.tsx`, add an effect: `if (combined) void invoke("close_rail")`.

- [ ] **Step 4: Run to verify it passes. Step 5: Commit.**

---

### Task 7: Wire settings into the rail and verify

**Files:** Modify `src/Rail.tsx`.

- [ ] **Step 1** Add `"settings"` to the pane union and a Settings tab rendering `RailSettingsPane`.
- [ ] **Step 2** Run everything: `pnpm vitest run`, `pnpm build`, `cd src-tauri; cargo test`.
- [ ] **Step 3: Verify on screen**

With Hive on 9456 and an agent connected:

1. Settings tab → click each of the eight anchors; the rail moves to that edge each time.
2. Offset up and down; the gap changes and survives a collapse/reopen.
3. Resting form → Sliver; the nub narrows to 14px with a dot badge.
4. Open on → Hover; brushing the nub opens it. Back to Click; brushing does not.
5. Hide when idle on, with nothing outstanding → the nub dims; hovering restores it.
6. Right-click an app in the bar → it dims and its posts leave All activity, but opening that app still shows them.
7. Combined with Hive on → the rail window disappears and Hive grows a sidebar with all five panes. `Detach rail` reverses it.
8. Restart Hive → every setting is still as you left it.

- [ ] **Step 4: Commit.**

---

## Self-review

**Spec coverage.** Eight anchors, offset, resting form, follow-cursor, pin-to-monitor, hide-when-idle, open-on → Task 5, except pin-to-monitor which is explicitly out of scope above. Per-app `Show in All activity` → Tasks 1 and 2. Combined mode with `Detach rail` → Task 6. Auto-add undeclared apps → Task 4, always-on rather than a toggle, with the reason stated.

**Against the wired-to-nothing failure mode.** Every setting in Task 1 gets its behaviour in the same phase and a test that asserts the *behaviour*, not the stored value: `openOn` and `hideWhenIdle` in Task 3, `mutedApps` in Task 2, `combined` in Task 6, `offset`/`anchor`/`restingForm` through the existing `place_rail` path already exercised in phase 2. Task 5 adds `forgetSizeForAnchor` with its own test rather than letting the component mutate `sizes` directly — the same mistake in miniature.

**One thing I would flag to the reader.** Task 1's fourth test as drafted asserts a literal rather than the store, and the plan says to drop it. Left visible rather than quietly deleted so the reviewer can see the call was deliberate.
