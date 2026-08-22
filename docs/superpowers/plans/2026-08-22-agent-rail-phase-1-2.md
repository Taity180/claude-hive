# Hive Agent Rail — Phases 1 & 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the existing Hive window with the new visual system, then add a second "Rail" window that docks to a screen edge, follows the cursor across monitors, and shows the sessions Hive already knows about.

**Architecture:** Phase 1 extends the existing `--hub-*` theme token contract with four new tokens and moves session status from a coloured border onto a single dot. Phase 2 adds a second Tauri webview window (label `rail`) served from the same bundle, routed by window label in `main.tsx`. All geometry maths lives in pure Rust functions over a plain `MonitorRect` struct so it is unit-testable without a running window; Tauri types are converted at the boundary. Rail settings persist to `localStorage`, following the pattern `useTheme` already uses — no disk persistence until Phase 4.

**Tech Stack:** React 19, TypeScript 5.8, Zustand 5, Tailwind 4, Vitest 3 + Testing Library, Tauri 2, Rust 2021, axum 0.8.

**Spec:** `docs/superpowers/specs/2026-08-22-hive-agent-rail-design.md`

## Global Constraints

- **Do not change the six existing `hub_*` MCP tools** or the Claude Code hook flow. Phases 1–2 add no MCP surface at all.
- **All ten themes in `src/themes/index.ts` must keep working.** Every new token gets a value in all ten.
- **The `--hub-*` variable naming convention is the contract.** New tokens are `--hub-*` too.
- **Collapsed mode, expanded mode, session-detail, settings, usage chips and `InlineRename` must all keep working.** Existing tests in `CollapsedBar.test.tsx`, `QuestionPrompt.test.tsx`, `PlanUsage.test.tsx`, `UsageMeter.test.tsx` and `App.test.tsx` must pass untouched.
- **Status colours are fixed and semantic:** `running` `#60a5fa`, `waiting_for_input` `#eab308`, `thinking` `#a78bfa`, `error` `#ef4444`, `idle` `#22c55e`.
- **The unread badge is `#ff453a`** — deliberately outside the status palette, because it means "unread", not "a state a session is in".
- **No outbound network requests.** Nothing in these phases fetches anything.
- **Window controls are minimise + close only, top right.** Both `App.tsx`'s `WindowBar` and `TitleBar.tsx` already do this; the work is styling, not restructuring.
- **Test commands:** frontend `pnpm vitest run <path> -t "<name>"`; Rust `cd src-tauri && cargo test <name>`. Full suites: `pnpm test` and `cargo test`.
- **Platform:** Windows 11, PowerShell. Chain commands with `;`, never `&&`.
- **Commit style:** no `Co-Authored-By` line.

---

# Phase 1 — Foundation & skin

Ships alone: the Hive you already use, restyled. No backend work.

---

### Task 1: Add the four new theme tokens

The new visual system needs a specular highlight, a hairline divider, and a two-step label ramp. These join the existing token contract rather than replacing it.

**Files:**
- Modify: `src/themes/index.ts` (the `Theme` interface plus all ten theme objects)
- Modify: `src/hooks/useTheme.ts:20-30` (the block of `setProperty` calls)
- Test: `src/themes/themes.test.ts` (create)

**Interfaces:**
- Consumes: nothing — first task.
- Produces: `Theme` gains four required fields: `spec: string`, `hair: string`, `textDim: string`, `attention: string`. `useTheme` sets four new CSS variables: `--hub-spec`, `--hub-hair`, `--hub-text-dim`, `--hub-attention`.

- [ ] **Step 1: Write the failing test**

Create `src/themes/themes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { themes, getThemeById, defaultTheme } from "./index";

describe("theme tokens", () => {
  it("still exposes all ten themes", () => {
    expect(themes).toHaveLength(10);
  });

  it("gives every theme all four new tokens", () => {
    for (const theme of themes) {
      expect(theme.spec, `${theme.id} spec`).toMatch(/^rgba?\(/);
      expect(theme.hair, `${theme.id} hair`).toMatch(/^rgba?\(/);
      expect(theme.textDim, `${theme.id} textDim`).toBeTruthy();
      expect(theme.attention, `${theme.id} attention`).toBeTruthy();
    }
  });

  it("keeps the existing token contract intact", () => {
    expect(defaultTheme.id).toBe("frosted-glass");
    expect(getThemeById("nope")).toBe(defaultTheme);
    expect(defaultTheme.accent).toBe("#60a5fa");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/themes/themes.test.ts`
Expected: FAIL — TypeScript/runtime errors that `spec`, `hair`, `textDim`, `attention` are undefined.

- [ ] **Step 3: Add the fields to the interface**

In `src/themes/index.ts`, extend the interface:

```ts
export interface Theme {
  name: string;
  id: string;
  bg: string;
  bgSolid: string;
  surface: string;
  border: string;
  text: string;
  textMuted: string;
  accent: string;
  accentText: string;
  blur: string;
  /** 1px highlight on the top edge only — reads as a lit bevel. */
  spec: string;
  /** Hairline divider, inset from the left in lists. */
  hair: string;
  /** Third-level label, below textMuted. For timestamps and counts. */
  textDim: string;
  /** Background tint for the one row that is blocked on the user. */
  attention: string;
}
```

- [ ] **Step 4: Give all ten themes values**

Add these four lines to each theme object in `src/themes/index.ts`. The values are keyed off each theme's own ground so a light-ground theme is not given a highlight designed for a dark one.

```ts
// frosted-glass
spec: "rgba(255, 255, 255, 0.16)", hair: "rgba(255, 255, 255, 0.09)",
textDim: "rgba(255, 255, 255, 0.28)", attention: "rgba(234, 179, 8, 0.12)",

// warm-neutral
spec: "rgba(255, 255, 255, 0.14)", hair: "rgba(255, 255, 255, 0.08)",
textDim: "rgba(214, 211, 209, 0.32)", attention: "rgba(245, 158, 11, 0.13)",

// cool-slate
spec: "rgba(255, 255, 255, 0.14)", hair: "rgba(255, 255, 255, 0.08)",
textDim: "rgba(203, 213, 225, 0.3)", attention: "rgba(20, 184, 166, 0.13)",

// minimal-carbon
spec: "rgba(255, 255, 255, 0.11)", hair: "rgba(255, 255, 255, 0.06)",
textDim: "rgba(212, 212, 212, 0.28)", attention: "rgba(34, 197, 94, 0.12)",

// nord
spec: "rgba(255, 255, 255, 0.15)", hair: "rgba(255, 255, 255, 0.09)",
textDim: "rgba(236, 239, 244, 0.32)", attention: "rgba(136, 192, 208, 0.14)",

// solarized-dark
spec: "rgba(255, 255, 255, 0.13)", hair: "rgba(255, 255, 255, 0.08)",
textDim: "rgba(253, 246, 227, 0.28)", attention: "rgba(181, 137, 0, 0.16)",

// dracula
spec: "rgba(255, 255, 255, 0.15)", hair: "rgba(255, 255, 255, 0.09)",
textDim: "rgba(248, 248, 242, 0.3)", attention: "rgba(255, 121, 198, 0.13)",

// monokai
spec: "rgba(255, 255, 255, 0.14)", hair: "rgba(255, 255, 255, 0.08)",
textDim: "rgba(248, 248, 242, 0.3)", attention: "rgba(253, 151, 31, 0.14)",

// catppuccin-mocha
spec: "rgba(255, 255, 255, 0.15)", hair: "rgba(255, 255, 255, 0.09)",
textDim: "rgba(205, 214, 244, 0.3)", attention: "rgba(180, 190, 254, 0.14)",

// rose-pine
spec: "rgba(255, 255, 255, 0.14)", hair: "rgba(255, 255, 255, 0.09)",
textDim: "rgba(224, 222, 244, 0.3)", attention: "rgba(235, 188, 186, 0.14)",
```

- [ ] **Step 5: Publish them as CSS variables**

In `src/hooks/useTheme.ts`, add to the `useEffect` block after the existing `setProperty` calls:

```ts
    root.style.setProperty("--hub-spec", theme.spec);
    root.style.setProperty("--hub-hair", theme.hair);
    root.style.setProperty("--hub-text-dim", theme.textDim);
    root.style.setProperty("--hub-attention", theme.attention);
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm vitest run src/themes/themes.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 7: Confirm nothing else broke**

Run: `pnpm test -- --run`
Expected: all existing suites pass. Then `pnpm build` — expected: clean `tsc -b`.

- [ ] **Step 8: Commit**

```bash
git add src/themes/index.ts src/themes/themes.test.ts src/hooks/useTheme.ts
git commit -m "feat: add specular, hairline and label-ramp theme tokens"
```

---

### Task 2: Move session status from the border to a dot

The biggest readability change in the design. Today every pill is ringed in its status colour and animates a pulsing border, so four sessions produce four competing rectangles and the one that needs the user does not stand out. After this, the border is neutral, the colour lives in the dot, and only a session blocked on the user gets a tinted background.

**Files:**
- Modify: `src/components/SessionPill.tsx`
- Test: `src/components/SessionPill.test.tsx` (create)

**Interfaces:**
- Consumes: `--hub-hair` and `--hub-attention` from Task 1.
- Produces: `SessionPill` keeps its exact props (`session`, `hasUnread`, `onClick`). It now renders `data-testid="status-dot"` on the dot and `data-attention="true"` on the wrapper when `session.status === "waiting_for_input"`. `Rail`'s session rows in Task 11 reuse this component unchanged.

- [ ] **Step 1: Write the failing test**

Create `src/components/SessionPill.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SessionPill } from "./SessionPill";
import type { Session } from "../types";

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: "s1",
    projectName: "claude-hive",
    status: "running",
    lastActivity: new Date().toISOString(),
    ...overrides,
  } as Session;
}

describe("SessionPill", () => {
  it("carries the status colour on the dot, not the border", () => {
    render(<SessionPill session={session({ status: "error" })} onClick={vi.fn()} />);
    const dot = screen.getByTestId("status-dot");
    expect(dot).toHaveStyle({ background: "#ef4444" });
  });

  it("uses a neutral border regardless of status", () => {
    const { container } = render(
      <SessionPill session={session({ status: "error" })} onClick={vi.fn()} />
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.style.border).toContain("var(--hub-hair");
    expect(wrapper.style.border).not.toContain("#ef4444");
  });

  it("tints only a session waiting for input", () => {
    const { container: waiting } = render(
      <SessionPill session={session({ status: "waiting_for_input" })} onClick={vi.fn()} />
    );
    expect(waiting.firstElementChild).toHaveAttribute("data-attention", "true");

    const { container: running } = render(
      <SessionPill session={session({ status: "running" })} onClick={vi.fn()} />
    );
    expect(running.firstElementChild).not.toHaveAttribute("data-attention");
  });

  it("no longer applies the pulsing border animation class", () => {
    const { container } = render(
      <SessionPill session={session({ status: "waiting_for_input" })} onClick={vi.fn()} />
    );
    expect(container.firstElementChild?.className).not.toContain("status-border-pulse");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/components/SessionPill.test.tsx`
Expected: FAIL — no `status-dot` testid, border contains `#ef4444`, `status-border-pulse` present.

- [ ] **Step 3: Rewrite the pill's styling**

In `src/components/SessionPill.tsx`, replace the derived colour block and the wrapper `div`'s `className`/`style`. Delete the `borderColor` and `borderDim` consts; keep `color` and `isPulsing`.

```tsx
  const { status, windowHandle } = session;
  const color = statusColors[status];
  const needsUser = status === "waiting_for_input";
  const isPulsing = needsUser || status === "error";
```

Then the wrapper:

```tsx
    <div
      role={editing ? undefined : "button"}
      tabIndex={editing ? undefined : 0}
      data-attention={needsUser ? "true" : undefined}
      onClick={editing ? undefined : onClick}
      onKeyDown={(e) => {
        if (!editing && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onClick();
        }
      }}
      className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] whitespace-nowrap transition-colors ${
        editing ? "" : "hover:brightness-125 cursor-pointer"
      }`}
      style={{
        background: needsUser ? "var(--hub-attention)" : "var(--hub-surface)",
        border: "1px solid var(--hub-hair, rgba(255,255,255,0.09))",
        color: "var(--hub-text-muted)",
      }}
    >
```

And add the testid to the dot:

```tsx
      <span
        data-testid="status-dot"
        className={`w-2 h-2 rounded-full shrink-0 ${isPulsing ? "animate-pulse" : ""}`}
        style={{ background: color }}
      />
```

Note the `React.CSSProperties` cast on the style object is no longer needed — the custom `--pulse-*` properties are gone.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/components/SessionPill.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 5: Check the collapsed bar still passes**

`CollapsedBar.test.tsx` renders pills, so it is the regression canary.

Run: `pnpm vitest run src/components/CollapsedBar.test.tsx`
Expected: PASS, unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/components/SessionPill.tsx src/components/SessionPill.test.tsx
git commit -m "feat: status as a dot rather than a coloured border"
```

---

### Task 3: Apply the same treatment to the list and detailed views

`ExpandedDashboard.tsx` draws its own rows with the same full coloured border and the same `status-border-pulse`, so leaving it alone would make expanded mode disagree with collapsed mode.

**Files:**
- Modify: `src/components/ExpandedDashboard.tsx` (the `ListView` row, and the same pattern in the detailed view)
- Test: `src/components/ExpandedDashboard.test.tsx` (create)

**Interfaces:**
- Consumes: `--hub-hair`, `--hub-attention` from Task 1; the `data-attention` convention from Task 2.
- Produces: nothing new for later tasks.

- [ ] **Step 1: Write the failing test**

Create `src/components/ExpandedDashboard.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { ExpandedDashboard } from "./ExpandedDashboard";
import { useHubStore } from "../stores/hubStore";
import type { Session } from "../types";

const sessions = [
  { id: "a", projectName: "claude-hive", status: "error", lastActivity: new Date().toISOString() },
  { id: "b", projectName: "hourglass-v2", status: "waiting_for_input", lastActivity: new Date().toISOString() },
] as Session[];

describe("ExpandedDashboard list rows", () => {
  beforeEach(() => {
    // View mode is component-local state seeded from localStorage under
    // "claude-hive-view-mode" (see ExpandedDashboard.tsx:259-266), not store
    // state — so it has to be set here, before the component mounts.
    localStorage.setItem("claude-hive-view-mode", "list");
    useHubStore.setState({ sessions });
  });

  it("does not ring rows in their status colour", () => {
    const { container } = render(<ExpandedDashboard />);
    const rows = container.querySelectorAll("[data-session-row]");
    expect(rows.length).toBe(2);
    rows.forEach((row) => {
      expect((row as HTMLElement).style.border).toContain("var(--hub-hair");
      expect((row as HTMLElement).style.border).not.toContain("#ef4444");
    });
  });

  it("tints only the row waiting for input", () => {
    render(<ExpandedDashboard />);
    expect(screen.getByText("hourglass-v2").closest("[data-session-row]"))
      .toHaveAttribute("data-attention", "true");
    expect(screen.getByText("claude-hive").closest("[data-session-row]"))
      .not.toHaveAttribute("data-attention");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/components/ExpandedDashboard.test.tsx`
Expected: FAIL — no `data-session-row` attribute exists yet.

- [ ] **Step 3: Restyle the list row**

In `src/components/ExpandedDashboard.tsx`, in `ListView`, replace the `borderColor`/`borderDim` derivation and the `<button>`'s `className`/`style`:

```tsx
      {sessions.map((session) => {
        const hasUnread = unreadSessions.has(session.id);
        const needsUser = session.status === "waiting_for_input";
        return (
          <button
            key={session.id}
            data-session-row
            data-attention={needsUser ? "true" : undefined}
            onClick={() => setActiveSession(session.id)}
            className="group flex items-center gap-2 w-full text-left px-2.5 py-1.5 rounded-md transition-colors hover:brightness-125"
            style={{
              background: needsUser ? "var(--hub-attention)" : "transparent",
              border: "1px solid var(--hub-hair, rgba(255,255,255,0.09))",
            }}
          >
```

Leave the dot, `InlineRename`, unread bell, `↗` button and timestamp exactly as they are.

- [ ] **Step 4: Apply the same change to the detailed view**

Search `ExpandedDashboard.tsx` for the remaining `status-border-pulse` occurrences and `--pulse-color` style entries in the detailed view's row, and replace them the same way: neutral `var(--hub-hair)` border, `var(--hub-attention)` background only when `session.status === "waiting_for_input"`, `data-session-row` and `data-attention` on the element. Remove the now-unused `React.CSSProperties` casts.

Run: `grep -n "status-border-pulse\|--pulse-color" src/components/ExpandedDashboard.tsx`
Expected: no output.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/components/ExpandedDashboard.test.tsx`
Expected: PASS, 2 tests.

- [ ] **Step 6: Retire the animation from the stylesheet**

`status-border-pulse` now has no consumers. Remove the `@keyframes status-pulse` block and the `.status-border-pulse` rule from `src/index.css`.

Run: `grep -rn "status-border-pulse" src/`
Expected: no output.

- [ ] **Step 7: Full suite and build**

Run: `pnpm test -- --run` then `pnpm build`
Expected: all pass, clean build.

- [ ] **Step 8: Commit**

```bash
git add src/components/ExpandedDashboard.tsx src/components/ExpandedDashboard.test.tsx src/index.css
git commit -m "feat: neutral borders and attention tint in expanded views"
```

---

### Task 4: Material and title bar polish

The remaining visual changes: proper vibrancy (`blur` **plus** `saturate`, which is what stops the glass going grey), a specular top edge, and hairline dividers. Window controls stay where they are — minimise and close, top right — this is styling only.

**Files:**
- Modify: `src/index.css` (root font stack, new `.hub-material` utility)
- Modify: `src/App.tsx` (the `WindowBar` `borderBottom`, the root `div` background)
- Modify: `src/themes/index.ts` (the `blur` value on all ten themes)
- Test: `src/themes/themes.test.ts` (extend the existing file from Task 1)

**Interfaces:**
- Consumes: `--hub-spec`, `--hub-hair` from Task 1.
- Produces: a `.hub-material` CSS class applying the specular highlight and hairline border, used by the Rail window in Task 10.

- [ ] **Step 1: Write the failing test**

Append to `src/themes/themes.test.ts`:

```ts
describe("vibrancy", () => {
  it("saturates as well as blurs, so colour behind the glass survives", () => {
    for (const theme of themes) {
      expect(theme.blur, `${theme.id} blur`).toMatch(/blur\(\d+px\)\s+saturate\(\d+%\)/);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/themes/themes.test.ts -t "saturates"`
Expected: FAIL — current values are `blur(20px)`, `blur(16px)` etc with no `saturate`.

- [ ] **Step 3: Add saturate to every blur value**

In `src/themes/index.ts`, update each theme's `blur`:

- `frosted-glass`: `"blur(30px) saturate(180%)"`
- `warm-neutral`, `cool-slate`, `nord`, `solarized-dark`, `dracula`, `monokai`, `catppuccin-mocha`, `rose-pine`: `"blur(24px) saturate(170%)"`
- `minimal-carbon`: `"blur(18px) saturate(140%)"` — it is the most opaque theme, so it needs the least.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/themes/themes.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Add the material utility**

In `src/index.css`, replace the `:root` font-family stack — `Inter` first is the look the design brief moves away from, and on Windows the native UI face is better — and add the material class:

```css
:root {
  font-family:
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI Variable Text",
    "Segoe UI",
    system-ui,
    sans-serif;
  line-height: 1.5;
  font-weight: 400;
  letter-spacing: -0.005em;
}

/* The AppKit-style edge vocabulary: a lit top edge, a dark outer border,
   and nothing on the other three sides. Applied to window roots. */
.hub-material {
  box-shadow:
    inset 0 1px 0 var(--hub-spec, rgba(255, 255, 255, 0.16)),
    inset 0 0 0 1px rgba(255, 255, 255, 0.045);
}

/* Hairline divider inset from the left, the way a native list draws it. */
.hub-hairline {
  position: relative;
}
.hub-hairline::before {
  content: "";
  position: absolute;
  left: 11px;
  right: 0;
  top: 0;
  height: 1px;
  background: var(--hub-hair, rgba(255, 255, 255, 0.09));
}
```

- [ ] **Step 6: Apply it to the window root and title bar**

In `src/App.tsx`, the `WindowBar` divider becomes a hairline, and the root gains the material class:

```tsx
      style={{
        background: "var(--hub-bg-solid, #111)",
        borderBottom: "1px solid var(--hub-hair, rgba(255,255,255,0.09))",
      }}
```

```tsx
    <div
      className="h-screen w-screen overflow-hidden flex flex-col hub-material"
      style={{ background: "var(--hub-bg-solid, #141414)" }}
    >
```

- [ ] **Step 7: Verify by eye**

Run: `pnpm tauri dev`
Expected: Hive opens; the title bar divider is fainter, the top edge of the window has a faint highlight, session pills show a neutral border with a coloured dot, and a session in `waiting_for_input` has an amber-tinted background. Minimise and close still work and are still top right. Cycle two or three themes from Settings and confirm each still reads correctly.

- [ ] **Step 8: Commit**

```bash
git add src/index.css src/App.tsx src/themes/index.ts src/themes/themes.test.ts
git commit -m "feat: vibrancy, specular edge and hairline dividers"
```

---

# Phase 2 — The Rail window

Ships alone: a rail that docks, follows the cursor, and shows the sessions Hive already has. No agents yet.

---

### Task 5: Pure anchor geometry

Where the rail sits, as a function with no Tauri dependency, so it can be tested exhaustively without a window.

**Files:**
- Create: `src-tauri/src/rail/mod.rs`
- Create: `src-tauri/src/rail/geometry.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod rail;` beside the existing module declarations)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `pub struct MonitorRect { pub x: i32, pub y: i32, pub width: u32, pub height: u32 }`
  - `pub enum Anchor { Left, Right, Top, Bottom, TopLeft, TopRight, BottomLeft, BottomRight }` with `Anchor::is_horizontal(&self) -> bool` and `Anchor::from_str_id(&str) -> Option<Anchor>` accepting `"left" | "right" | "top" | "bottom" | "tl" | "tr" | "bl" | "br"`.
  - `pub fn anchored_position(monitor: MonitorRect, anchor: Anchor, size: (u32, u32), offset: i32) -> (i32, i32)` returning a physical top-left.

- [ ] **Step 1: Write the failing test**

Create `src-tauri/src/rail/geometry.rs` with only the test module for now:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn mon() -> MonitorRect {
        MonitorRect { x: 0, y: 0, width: 2560, height: 1440 }
    }

    #[test]
    fn right_centre_hugs_the_right_edge() {
        let (x, y) = anchored_position(mon(), Anchor::Right, (32, 400), 8);
        assert_eq!(x, 2560 - 32 - 8);
        assert_eq!(y, (1440 - 400) / 2);
    }

    #[test]
    fn left_centre_hugs_the_left_edge() {
        let (x, y) = anchored_position(mon(), Anchor::Left, (32, 400), 8);
        assert_eq!(x, 8);
        assert_eq!(y, (1440 - 400) / 2);
    }

    #[test]
    fn bottom_centre_hugs_the_bottom_edge() {
        let (x, y) = anchored_position(mon(), Anchor::Bottom, (400, 32), 8);
        assert_eq!(x, (2560 - 400) / 2);
        assert_eq!(y, 1440 - 32 - 8);
    }

    #[test]
    fn corners_offset_on_both_axes() {
        let (x, y) = anchored_position(mon(), Anchor::BottomRight, (32, 400), 8);
        assert_eq!(x, 2560 - 32 - 8);
        assert_eq!(y, 1440 - 400 - 8);
    }

    #[test]
    fn a_monitor_at_a_negative_origin_still_resolves() {
        // A second screen placed to the left of the primary reports a
        // negative x. The rail must land on that screen, not on the primary.
        let left_of_primary = MonitorRect { x: -1920, y: 0, width: 1920, height: 1080 };
        let (x, y) = anchored_position(left_of_primary, Anchor::Right, (32, 400), 8);
        assert_eq!(x, -1920 + 1920 - 32 - 8);
        assert_eq!(y, (1080 - 400) / 2);
    }

    #[test]
    fn a_rail_taller_than_the_screen_is_clamped_not_negative() {
        let (_, y) = anchored_position(mon(), Anchor::Right, (32, 2000), 8);
        assert_eq!(y, 0, "must not position above the top of the monitor");
    }

    #[test]
    fn horizontal_anchors_are_reported_as_such() {
        assert!(Anchor::Top.is_horizontal());
        assert!(Anchor::Bottom.is_horizontal());
        assert!(!Anchor::Left.is_horizontal());
        assert!(!Anchor::TopRight.is_horizontal());
    }

    #[test]
    fn anchor_ids_round_trip_from_the_frontend() {
        assert_eq!(Anchor::from_str_id("br"), Some(Anchor::BottomRight));
        assert_eq!(Anchor::from_str_id("left"), Some(Anchor::Left));
        assert_eq!(Anchor::from_str_id("elsewhere"), None);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Create `src-tauri/src/rail/mod.rs` containing `pub mod geometry;`, and add `mod rail;` to `src-tauri/src/lib.rs` beside the other `mod` lines.

Run: `cd src-tauri; cargo test rail::geometry`
Expected: FAIL — `MonitorRect`, `Anchor`, `anchored_position` not found.

- [ ] **Step 3: Write the implementation**

Prepend to `src-tauri/src/rail/geometry.rs`:

```rust
use serde::{Deserialize, Serialize};

/// A monitor's usable area in physical pixels. Deliberately a plain struct
/// rather than a `tauri::Monitor` so the geometry can be tested without a
/// running window; conversion happens at the Tauri boundary.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MonitorRect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Anchor {
    Left,
    Right,
    Top,
    Bottom,
    TopLeft,
    TopRight,
    BottomLeft,
    BottomRight,
}

impl Anchor {
    /// True for the two anchors where the rail lies along a horizontal edge
    /// and is therefore wide rather than tall.
    pub fn is_horizontal(&self) -> bool {
        matches!(self, Anchor::Top | Anchor::Bottom)
    }

    /// Parse the short ids the settings UI sends.
    pub fn from_str_id(id: &str) -> Option<Anchor> {
        Some(match id {
            "left" => Anchor::Left,
            "right" => Anchor::Right,
            "top" => Anchor::Top,
            "bottom" => Anchor::Bottom,
            "tl" => Anchor::TopLeft,
            "tr" => Anchor::TopRight,
            "bl" => Anchor::BottomLeft,
            "br" => Anchor::BottomRight,
            _ => return None,
        })
    }
}

/// Top-left physical position for a rail of `size` on `monitor`, held `offset`
/// pixels clear of the edges it touches. Centred axes are clamped to the
/// monitor origin so an oversized rail never lands off-screen.
pub fn anchored_position(
    monitor: MonitorRect,
    anchor: Anchor,
    size: (u32, u32),
    offset: i32,
) -> (i32, i32) {
    let (w, h) = (size.0 as i32, size.1 as i32);
    let (mw, mh) = (monitor.width as i32, monitor.height as i32);

    let centre = |span: i32, extent: i32| ((span - extent) / 2).max(0);
    let far = |origin: i32, span: i32, extent: i32| origin + span - extent - offset;

    let (dx, dy) = match anchor {
        Anchor::Left => (monitor.x + offset, monitor.y + centre(mh, h)),
        Anchor::Right => (far(monitor.x, mw, w), monitor.y + centre(mh, h)),
        Anchor::Top => (monitor.x + centre(mw, w), monitor.y + offset),
        Anchor::Bottom => (monitor.x + centre(mw, w), far(monitor.y, mh, h)),
        Anchor::TopLeft => (monitor.x + offset, monitor.y + offset),
        Anchor::TopRight => (far(monitor.x, mw, w), monitor.y + offset),
        Anchor::BottomLeft => (monitor.x + offset, far(monitor.y, mh, h)),
        Anchor::BottomRight => (far(monitor.x, mw, w), far(monitor.y, mh, h)),
    };

    (dx, dy)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri; cargo test rail::geometry`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/rail/mod.rs src-tauri/src/rail/geometry.rs src-tauri/src/lib.rs
git commit -m "feat: pure anchor geometry for the rail"
```

---

### Task 6: Resolve which monitor the cursor is on

The other half of the maths, also pure. `lib.rs` today calls `current_monitor()` only to read a scale factor, so none of this exists.

**Files:**
- Modify: `src-tauri/src/rail/geometry.rs`

**Interfaces:**
- Consumes: `MonitorRect` from Task 5.
- Produces: `pub fn monitor_containing(monitors: &[MonitorRect], cursor: (i32, i32)) -> Option<usize>` returning an index into the slice.

- [ ] **Step 1: Write the failing test**

Add to the `tests` module in `src-tauri/src/rail/geometry.rs`:

```rust
    fn two_screens() -> Vec<MonitorRect> {
        vec![
            MonitorRect { x: 0, y: 0, width: 2560, height: 1440 },
            MonitorRect { x: 2560, y: 0, width: 1920, height: 1080 },
        ]
    }

    #[test]
    fn finds_the_monitor_under_the_cursor() {
        assert_eq!(monitor_containing(&two_screens(), (100, 100)), Some(0));
        assert_eq!(monitor_containing(&two_screens(), (3000, 500)), Some(1));
    }

    #[test]
    fn the_left_edge_belongs_to_the_monitor_it_starts() {
        // Exactly on the boundary must resolve to the second screen, not both.
        assert_eq!(monitor_containing(&two_screens(), (2560, 10)), Some(1));
        assert_eq!(monitor_containing(&two_screens(), (2559, 10)), Some(0));
    }

    #[test]
    fn a_cursor_in_the_dead_space_below_a_shorter_screen_finds_nothing() {
        // Screen 2 is only 1080 tall, so y=1200 at x=3000 is off every screen.
        assert_eq!(monitor_containing(&two_screens(), (3000, 1200)), None);
    }

    #[test]
    fn no_monitors_is_not_a_panic() {
        assert_eq!(monitor_containing(&[], (0, 0)), None);
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri; cargo test monitor_containing`
Expected: FAIL — function not found.

- [ ] **Step 3: Write the implementation**

Add to `src-tauri/src/rail/geometry.rs`:

```rust
/// Index of the monitor whose rect contains `cursor`. Half-open on the far
/// edges, so a cursor exactly on a shared boundary belongs to exactly one
/// monitor rather than matching both.
pub fn monitor_containing(monitors: &[MonitorRect], cursor: (i32, i32)) -> Option<usize> {
    let (cx, cy) = cursor;
    monitors.iter().position(|m| {
        cx >= m.x
            && cx < m.x + m.width as i32
            && cy >= m.y
            && cy < m.y + m.height as i32
    })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri; cargo test rail::geometry`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/rail/geometry.rs
git commit -m "feat: resolve the monitor under the cursor"
```

---

### Task 7: Create and position the rail window

Wire the geometry to a real Tauri window. The rail is a second webview on the same bundle, created hidden at startup so opening it is instant.

**Files:**
- Create: `src-tauri/src/rail/window.rs`
- Modify: `src-tauri/src/rail/mod.rs` (add `pub mod window;`)
- Modify: `src-tauri/src/lib.rs` (register the three new commands in the `invoke_handler`)

**Interfaces:**
- Consumes: `Anchor`, `MonitorRect`, `anchored_position`, `monitor_containing` from Tasks 5–6.
- Produces three Tauri commands callable from the frontend:
  - `open_rail(app: AppHandle) -> Result<(), String>`
  - `close_rail(app: AppHandle) -> Result<(), String>`
  - `place_rail(app: AppHandle, anchor: String, width: u32, height: u32, offset: i32) -> Result<(), String>`
  - and a helper `pub fn monitor_rects(app: &AppHandle) -> Result<Vec<MonitorRect>, String>`

- [ ] **Step 1: Write the implementation**

There is no unit test in this task — it is all Tauri I/O, which needs a running app. It is verified by hand in Step 3 and covered end-to-end from the frontend in Task 12.

Create `src-tauri/src/rail/window.rs`:

```rust
use crate::rail::geometry::{anchored_position, monitor_containing, Anchor, MonitorRect};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

pub const RAIL_LABEL: &str = "rail";

/// Every monitor's rect in physical pixels, in the order the OS reports them.
pub fn monitor_rects(app: &AppHandle) -> Result<Vec<MonitorRect>, String> {
    let monitors = app.available_monitors().map_err(|e| e.to_string())?;
    Ok(monitors
        .iter()
        .map(|m| MonitorRect {
            x: m.position().x,
            y: m.position().y,
            width: m.size().width,
            height: m.size().height,
        })
        .collect())
}

/// The rail webview, created on first use. Undecorated, always on top, and
/// kept out of the taskbar — it is a dock, not a window you alt-tab to.
fn ensure_rail(app: &AppHandle) -> Result<tauri::WebviewWindow, String> {
    if let Some(existing) = app.get_webview_window(RAIL_LABEL) {
        return Ok(existing);
    }
    WebviewWindowBuilder::new(app, RAIL_LABEL, WebviewUrl::App("index.html".into()))
        .title("Hive Rail")
        .inner_size(32.0, 140.0)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(true)
        .visible(false)
        .build()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_rail(app: AppHandle) -> Result<(), String> {
    let rail = ensure_rail(&app)?;
    rail.show().map_err(|e| e.to_string())?;
    rail.set_focus().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn close_rail(app: AppHandle) -> Result<(), String> {
    if let Some(rail) = app.get_webview_window(RAIL_LABEL) {
        rail.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Size and place the rail against `anchor` on whichever monitor the cursor
/// is on, falling back to the first monitor when the cursor is in dead space
/// between screens.
#[tauri::command]
pub fn place_rail(
    app: AppHandle,
    anchor: String,
    width: u32,
    height: u32,
    offset: i32,
) -> Result<(), String> {
    let anchor = Anchor::from_str_id(&anchor).ok_or_else(|| format!("unknown anchor: {anchor}"))?;
    let rail = ensure_rail(&app)?;
    let monitors = monitor_rects(&app)?;
    if monitors.is_empty() {
        return Err("no monitors reported".into());
    }

    let cursor = app.cursor_position().map_err(|e| e.to_string())?;
    let index = monitor_containing(&monitors, (cursor.x as i32, cursor.y as i32)).unwrap_or(0);
    let (x, y) = anchored_position(monitors[index], anchor, (width, height), offset);

    rail.set_size(tauri::Size::Physical(tauri::PhysicalSize { width, height }))
        .map_err(|e| e.to_string())?;
    rail.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }))
        .map_err(|e| e.to_string())
}
```

- [ ] **Step 2: Register the commands**

In `src-tauri/src/rail/mod.rs`:

```rust
pub mod geometry;
pub mod window;
```

In `src-tauri/src/lib.rs`, add to the existing `tauri::generate_handler![...]` list:

```rust
            rail::window::open_rail,
            rail::window::close_rail,
            rail::window::place_rail,
```

- [ ] **Step 3: Verify it compiles and runs**

Run: `cd src-tauri; cargo build`
Expected: clean build. If `cursor_position` is not found on `AppHandle` in the installed Tauri 2 patch version, use `rail.cursor_position()` — the same method exists on `WebviewWindow` — and note the change in the commit message.

Then `pnpm tauri dev`, and from the devtools console of the Hive window:

```js
await window.__TAURI__.core.invoke("open_rail");
await window.__TAURI__.core.invoke("place_rail", { anchor: "right", width: 32, height: 400, offset: 8 });
```

Expected: a 32px undecorated strip appears on the right edge of the monitor the cursor is on. Move the cursor to the other monitor, run `place_rail` again, and it moves there.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/rail/window.rs src-tauri/src/rail/mod.rs src-tauri/src/lib.rs
git commit -m "feat: create and place the rail window"
```

---

### Task 8: Route by window label

Both windows load the same `index.html`, so the frontend has to decide what to render based on which window it is running in.

**Files:**
- Modify: `src/main.tsx`
- Create: `src/Rail.tsx`
- Test: `src/main.routing.test.tsx` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `src/windowLabel.ts` exporting `export function currentWindowLabel(): string` — returns the Tauri window label, or `"main"` when Tauri is unavailable (tests, `vite dev` in a browser).
  - `src/Rail.tsx` exporting `export function Rail()` — the rail root, a stub in this task.

- [ ] **Step 1: Write the failing test**

Create `src/main.routing.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";

describe("currentWindowLabel", () => {
  beforeEach(() => {
    vi.resetModules();
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  });

  it("falls back to main outside Tauri", async () => {
    const { currentWindowLabel } = await import("./windowLabel");
    expect(currentWindowLabel()).toBe("main");
  });

  it("reads the label Tauri reports", async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "rail" } },
    };
    const { currentWindowLabel } = await import("./windowLabel");
    expect(currentWindowLabel()).toBe("rail");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/main.routing.test.tsx`
Expected: FAIL — cannot resolve `./windowLabel`.

- [ ] **Step 3: Write the label reader**

Create `src/windowLabel.ts`:

```ts
/**
 * Which Tauri window this bundle is running in. Both windows load the same
 * index.html, so this is what decides whether to render Hive or the Rail.
 * Reads the label synchronously off the internals Tauri injects, because the
 * async `getCurrentWindow()` would mean a frame of the wrong UI.
 */
export function currentWindowLabel(): string {
  const internals = (window as unknown as {
    __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } };
  }).__TAURI_INTERNALS__;
  return internals?.metadata?.currentWindow?.label ?? "main";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/main.routing.test.tsx`
Expected: PASS, 2 tests.

- [ ] **Step 5: Add the rail stub and route to it**

Create `src/Rail.tsx`:

```tsx
import { useTheme } from "./hooks/useTheme";

export function Rail() {
  useTheme();
  return (
    <div
      className="h-screen w-screen overflow-hidden hub-material"
      style={{ background: "var(--hub-bg-solid, #141414)" }}
      data-testid="rail-root"
    />
  );
}
```

In `src/main.tsx`, route on the label. Keep whatever the file already does for `main`, and add:

```tsx
import { currentWindowLabel } from "./windowLabel";
import { Rail } from "./Rail";

const Root = currentWindowLabel() === "rail" ? Rail : App;
```

then render `<Root />` where `<App />` was rendered.

- [ ] **Step 6: Verify both windows render**

Run: `pnpm tauri dev`, then from the Hive devtools console `await window.__TAURI__.core.invoke("open_rail")`.
Expected: the rail strip appears and is themed dark rather than white — proving `useTheme` ran inside the second window.

- [ ] **Step 7: Commit**

```bash
git add src/windowLabel.ts src/Rail.tsx src/main.tsx src/main.routing.test.tsx
git commit -m "feat: route the bundle by Tauri window label"
```

---

### Task 9: Rail settings, with size remembered per anchor

Size is per anchor, not global: a right-edge rail wants tall and narrow, a bottom-edge one wants wide and short, so one remembered size would be wrong for half the anchors.

**Files:**
- Create: `src/stores/railStore.ts`
- Test: `src/stores/railStore.test.ts` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces a Zustand store `useRailStore` with state `{ anchor: AnchorId, offset: number, restingForm: "nub" | "sliver", followCursor: boolean, open: boolean, sizes: Record<AnchorId, [number, number]> }` and actions `setAnchor(a: AnchorId)`, `setOffset(n: number)`, `setRestingForm(f)`, `setFollowCursor(b: boolean)`, `setOpen(b: boolean)`, `setSizeForAnchor(a: AnchorId, size: [number, number])`, `currentSize(): [number, number]`. Exports `export type AnchorId = "left" | "right" | "top" | "bottom" | "tl" | "tr" | "bl" | "br"` and `export const RAIL_STORAGE_KEY = "claude-hive-rail"`.

- [ ] **Step 1: Write the failing test**

Create `src/stores/railStore.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { useRailStore, RAIL_STORAGE_KEY } from "./railStore";

describe("railStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useRailStore.setState(useRailStore.getInitialState(), true);
  });

  it("defaults to a nub on the right that follows the cursor", () => {
    const s = useRailStore.getState();
    expect(s.anchor).toBe("right");
    expect(s.restingForm).toBe("nub");
    expect(s.followCursor).toBe(true);
    expect(s.open).toBe(false);
  });

  it("keeps a separate size per anchor", () => {
    useRailStore.getState().setSizeForAnchor("right", [372, 620]);
    useRailStore.getState().setSizeForAnchor("bottom", [900, 260]);

    useRailStore.getState().setAnchor("right");
    expect(useRailStore.getState().currentSize()).toEqual([372, 620]);

    useRailStore.getState().setAnchor("bottom");
    expect(useRailStore.getState().currentSize()).toEqual([900, 260]);
  });

  it("gives an unsized anchor a sensible default for its orientation", () => {
    useRailStore.getState().setAnchor("bottom");
    const [w, h] = useRailStore.getState().currentSize();
    expect(w).toBeGreaterThan(h);

    useRailStore.getState().setAnchor("left");
    const [w2, h2] = useRailStore.getState().currentSize();
    expect(h2).toBeGreaterThan(w2);
  });

  it("persists settings across a reload", () => {
    useRailStore.getState().setAnchor("bl");
    useRailStore.getState().setOffset(16);
    useRailStore.getState().setSizeForAnchor("bl", [400, 300]);

    const saved = JSON.parse(localStorage.getItem(RAIL_STORAGE_KEY) ?? "{}");
    expect(saved.anchor).toBe("bl");
    expect(saved.offset).toBe(16);
    expect(saved.sizes.bl).toEqual([400, 300]);
  });

  it("survives corrupt stored settings", () => {
    localStorage.setItem(RAIL_STORAGE_KEY, "{not json");
    expect(() => useRailStore.getState().setAnchor("top")).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/stores/railStore.test.ts`
Expected: FAIL — cannot resolve `./railStore`.

- [ ] **Step 3: Write the store**

Create `src/stores/railStore.ts`:

```ts
import { create } from "zustand";

export type AnchorId =
  | "left" | "right" | "top" | "bottom"
  | "tl" | "tr" | "bl" | "br";

export type RestingForm = "nub" | "sliver";

export const RAIL_STORAGE_KEY = "claude-hive-rail";

const HORIZONTAL: AnchorId[] = ["top", "bottom"];

/** A rail on a horizontal edge is wide; on a vertical edge it is tall. */
function defaultSize(anchor: AnchorId): [number, number] {
  return HORIZONTAL.includes(anchor) ? [820, 280] : [372, 620];
}

interface Persisted {
  anchor: AnchorId;
  offset: number;
  restingForm: RestingForm;
  followCursor: boolean;
  sizes: Partial<Record<AnchorId, [number, number]>>;
}

const DEFAULTS: Persisted = {
  anchor: "right",
  offset: 8,
  restingForm: "nub",
  followCursor: true,
  sizes: {},
};

function load(): Persisted {
  try {
    const raw = localStorage.getItem(RAIL_STORAGE_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Persisted>) };
  } catch {
    // Corrupt settings should cost the user their preferences, not the window.
    return DEFAULTS;
  }
}

interface RailState extends Persisted {
  open: boolean;
  setAnchor: (a: AnchorId) => void;
  setOffset: (n: number) => void;
  setRestingForm: (f: RestingForm) => void;
  setFollowCursor: (b: boolean) => void;
  setOpen: (b: boolean) => void;
  setSizeForAnchor: (a: AnchorId, size: [number, number]) => void;
  currentSize: () => [number, number];
}

export const useRailStore = create<RailState>((set, get) => {
  const persist = () => {
    const { anchor, offset, restingForm, followCursor, sizes } = get();
    try {
      localStorage.setItem(
        RAIL_STORAGE_KEY,
        JSON.stringify({ anchor, offset, restingForm, followCursor, sizes })
      );
    } catch {
      // Private-mode or quota failures are not worth breaking the rail over.
    }
  };

  return {
    ...load(),
    open: false,
    setAnchor: (anchor) => { set({ anchor }); persist(); },
    setOffset: (offset) => { set({ offset }); persist(); },
    setRestingForm: (restingForm) => { set({ restingForm }); persist(); },
    setFollowCursor: (followCursor) => { set({ followCursor }); persist(); },
    setOpen: (open) => set({ open }),
    setSizeForAnchor: (a, size) => {
      set({ sizes: { ...get().sizes, [a]: size } });
      persist();
    },
    currentSize: () => {
      const { anchor, sizes } = get();
      return sizes[anchor] ?? defaultSize(anchor);
    },
  };
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/stores/railStore.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/stores/railStore.ts src/stores/railStore.test.ts
git commit -m "feat: rail settings with per-anchor remembered size"
```

---

### Task 10: The resting form and its unread badge

What the rail looks like closed: a nub or a sliver, with status dots and a red unread count.

**Files:**
- Create: `src/components/RailNub.tsx`
- Test: `src/components/RailNub.test.tsx` (create)

**Interfaces:**
- Consumes: `RestingForm` from Task 9; `.hub-material` from Task 4.
- Produces: `export function RailNub({ onOpen }: { onOpen: () => void })`, reading `restingForm` from `useRailStore` and sessions/unread from `useHubStore`. Renders `data-testid="rail-nub"`, a `data-testid="unread-badge"` when the unread count is above zero, and one `data-testid="status-dot"` per distinct status present.

- [ ] **Step 1: Write the failing test**

Create `src/components/RailNub.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RailNub } from "./RailNub";
import { useHubStore } from "../stores/hubStore";
import { useRailStore } from "../stores/railStore";
import type { Session } from "../types";

const sessions = [
  { id: "a", projectName: "one", status: "running", lastActivity: "" },
  { id: "b", projectName: "two", status: "waiting_for_input", lastActivity: "" },
  { id: "c", projectName: "three", status: "running", lastActivity: "" },
] as Session[];

describe("RailNub", () => {
  beforeEach(() => {
    useHubStore.setState({ sessions, unreadSessions: new Set(["a", "b"]) });
    useRailStore.setState({ restingForm: "nub" });
  });

  it("shows one dot per distinct status, not one per session", () => {
    render(<RailNub onOpen={vi.fn()} />);
    expect(screen.getAllByTestId("status-dot")).toHaveLength(2);
  });

  it("counts unread sessions on the badge", () => {
    render(<RailNub onOpen={vi.fn()} />);
    expect(screen.getByTestId("unread-badge")).toHaveTextContent("2");
  });

  it("uses a badge colour outside the status palette", () => {
    render(<RailNub onOpen={vi.fn()} />);
    expect(screen.getByTestId("unread-badge")).toHaveStyle({ background: "#ff453a" });
  });

  it("hides the badge when nothing is unread", () => {
    useHubStore.setState({ unreadSessions: new Set() });
    render(<RailNub onOpen={vi.fn()} />);
    expect(screen.queryByTestId("unread-badge")).toBeNull();
  });

  it("shows a dot rather than a count in sliver form", () => {
    useRailStore.setState({ restingForm: "sliver" });
    render(<RailNub onOpen={vi.fn()} />);
    expect(screen.getByTestId("unread-badge")).toHaveTextContent("");
  });

  it("opens when clicked", async () => {
    const onOpen = vi.fn();
    render(<RailNub onOpen={onOpen} />);
    await userEvent.click(screen.getByTestId("rail-nub"));
    expect(onOpen).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Install the interaction helper if absent**

`userEvent` is not yet a dependency.

Run: `pnpm add -D @testing-library/user-event`

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run src/components/RailNub.test.tsx`
Expected: FAIL — cannot resolve `./RailNub`.

- [ ] **Step 4: Write the component**

Create `src/components/RailNub.tsx`:

```tsx
import { useHubStore } from "../stores/hubStore";
import { useRailStore } from "../stores/railStore";
import type { SessionStatus } from "../types";

const statusColors: Record<SessionStatus, string> = {
  running: "#60a5fa",
  waiting_for_input: "#eab308",
  thinking: "#a78bfa",
  error: "#ef4444",
  idle: "#22c55e",
};

// Order the dots by urgency rather than by session arrival, so the eye lands
// on the colour that matters first.
const STATUS_ORDER: SessionStatus[] = [
  "waiting_for_input",
  "error",
  "running",
  "thinking",
  "idle",
];

export function RailNub({ onOpen }: { onOpen: () => void }) {
  const sessions = useHubStore((s) => s.sessions);
  const unread = useHubStore((s) => s.unreadSessions);
  const restingForm = useRailStore((s) => s.restingForm);

  const present = STATUS_ORDER.filter((status) =>
    sessions.some((s) => s.status === status)
  );
  const unreadCount = unread.size;
  const isSliver = restingForm === "sliver";

  return (
    <button
      type="button"
      data-testid="rail-nub"
      onClick={onOpen}
      aria-label={
        unreadCount > 0 ? `Open Hive rail, ${unreadCount} unread` : "Open Hive rail"
      }
      className="relative h-screen w-screen flex flex-col items-center justify-center gap-2 hub-material"
      style={{
        background: "var(--hub-bg, rgba(20,20,20,0.75))",
        backdropFilter: "var(--hub-blur, blur(30px) saturate(180%))",
        border: 0,
        borderRadius: 0,
        cursor: "pointer",
      }}
    >
      {present.map((status) => (
        <span
          key={status}
          data-testid="status-dot"
          className={`rounded-full shrink-0 ${
            status === "waiting_for_input" || status === "error" ? "animate-pulse" : ""
          }`}
          style={{
            background: statusColors[status],
            width: isSliver ? 5 : 7,
            height: isSliver ? 5 : 7,
          }}
        />
      ))}

      {!isSliver && sessions.length > 0 && (
        <span
          className="font-bold tabular-nums"
          style={{ fontSize: 9.5, color: "var(--hub-text-muted)" }}
        >
          {sessions.length}
        </span>
      )}

      {unreadCount > 0 && (
        <span
          data-testid="unread-badge"
          className="absolute grid place-items-center font-bold tabular-nums"
          style={{
            // Red means "unread", not a status — deliberately outside the
            // five status colours so the two never get confused.
            background: "#ff453a",
            color: "#fff",
            top: isSliver ? -3 : -5,
            right: isSliver ? -3 : -5,
            minWidth: isSliver ? 9 : 15,
            height: isSliver ? 9 : 15,
            borderRadius: 999,
            fontSize: 9.5,
            padding: isSliver ? 0 : "0 4px",
            boxShadow: "0 0 0 1.5px rgba(20,20,22,0.9)",
          }}
        >
          {isSliver ? "" : unreadCount}
        </span>
      )}
    </button>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/components/RailNub.test.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add src/components/RailNub.tsx src/components/RailNub.test.tsx package.json pnpm-lock.yaml
git commit -m "feat: rail resting form with unread badge"
```

---

### Task 11: The opened rail panel

The rail's open state: the sessions Hive already knows about, with go-to-session on every row so the rail is never a dead end.

**Files:**
- Modify: `src/Rail.tsx`
- Create: `src/components/RailPanel.tsx`
- Test: `src/components/RailPanel.test.tsx` (create)

**Interfaces:**
- Consumes: `RailNub` from Task 10, `useRailStore` from Task 9, `SessionPill` from Task 2.
- Produces: `export function RailPanel()` — the opened content. `Rail.tsx` now renders `RailNub` when `open` is false and `RailPanel` when true, and calls `place_rail` whenever anchor, size or open state changes.

- [ ] **Step 1: Write the failing test**

Create `src/components/RailPanel.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RailPanel } from "./RailPanel";
import { useHubStore } from "../stores/hubStore";
import type { Session } from "../types";

const sessions = [
  { id: "a", projectName: "claude-hive", status: "running", statusDetail: "Editing mod.rs", lastActivity: new Date().toISOString(), windowHandle: 42 },
  { id: "b", projectName: "l2u-team-portal", status: "waiting_for_input", statusDetail: "JWT or cookies?", lastActivity: new Date().toISOString() },
] as Session[];

describe("RailPanel", () => {
  beforeEach(() => {
    useHubStore.setState({ sessions, unreadSessions: new Set() });
  });

  it("lists every session", () => {
    render(<RailPanel />);
    expect(screen.getByText("claude-hive")).toBeInTheDocument();
    expect(screen.getByText("l2u-team-portal")).toBeInTheDocument();
  });

  it("puts a session waiting for input above a running one", () => {
    render(<RailPanel />);
    const rows = screen.getAllByTestId("rail-row");
    expect(rows[0]).toHaveTextContent("l2u-team-portal");
  });

  it("offers go-to-session for a session that has a window handle", () => {
    render(<RailPanel />);
    expect(screen.getAllByTitle("Go to session desktop")).toHaveLength(1);
  });

  it("shows what each session is doing", () => {
    render(<RailPanel />);
    expect(screen.getByText("Editing mod.rs")).toBeInTheDocument();
  });

  it("says so when there is nothing connected", () => {
    useHubStore.setState({ sessions: [] });
    render(<RailPanel />);
    expect(screen.getByText(/no sessions connected/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/components/RailPanel.test.tsx`
Expected: FAIL — cannot resolve `./RailPanel`.

- [ ] **Step 3: Write the panel**

Create `src/components/RailPanel.tsx`:

```tsx
import { useHubStore } from "../stores/hubStore";
import { InlineRename } from "./InlineRename";
import type { Session, SessionStatus } from "../types";

const statusColors: Record<SessionStatus, string> = {
  running: "#60a5fa",
  waiting_for_input: "#eab308",
  thinking: "#a78bfa",
  error: "#ef4444",
  idle: "#22c55e",
};

// A blocked session outranks everything, whatever the timestamp says. This is
// the pin that stops a busy feed burying the one row that needs the user.
const URGENCY: Record<SessionStatus, number> = {
  waiting_for_input: 0,
  error: 1,
  running: 2,
  thinking: 3,
  idle: 4,
};

function byUrgencyThenRecency(a: Session, b: Session) {
  const rank = URGENCY[a.status] - URGENCY[b.status];
  if (rank !== 0) return rank;
  return (b.lastActivity ?? "").localeCompare(a.lastActivity ?? "");
}

async function goToSession(handle: number) {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("navigate_to_session", { sessionHandle: handle });
  } catch (err) {
    // Usually a stale HWND — the terminal was restarted. Surfacing it beats
    // a click that silently does nothing.
    console.error("[hive] navigate_to_session failed:", err);
  }
}

export function RailPanel() {
  const sessions = useHubStore((s) => s.sessions);
  const setActiveSession = useHubStore((s) => s.setActiveSession);
  const ordered = [...sessions].sort(byUrgencyThenRecency);

  return (
    <div className="flex flex-col h-full">
      <div
        data-tauri-drag-region
        className="flex items-center gap-2 px-3 py-2 shrink-0 select-none"
        style={{ borderBottom: "1px solid var(--hub-hair)" }}
      >
        <span className="text-[12px] font-semibold" style={{ color: "var(--hub-text)" }}>
          Rail
        </span>
        <span className="text-[11px]" style={{ color: "var(--hub-text-muted)" }}>
          {sessions.length} session{sessions.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-1.5 flex flex-col gap-0.5">
        {ordered.length === 0 && (
          <span className="text-[11px] px-2 py-3" style={{ color: "var(--hub-text-muted)" }}>
            No sessions connected
          </span>
        )}

        {ordered.map((session) => {
          const needsUser = session.status === "waiting_for_input";
          return (
            <div
              key={session.id}
              data-testid="rail-row"
              data-attention={needsUser ? "true" : undefined}
              className="flex gap-2 px-2 py-1.5 rounded-lg"
              style={{ background: needsUser ? "var(--hub-attention)" : "transparent" }}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 mt-1.5 ${
                  needsUser || session.status === "error" ? "animate-pulse" : ""
                }`}
                style={{ background: statusColors[session.status] }}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setActiveSession(session.id)}
                    className="text-[12px] font-semibold truncate text-left"
                    style={{ background: "none", border: 0, color: "var(--hub-text)", padding: 0, cursor: "pointer" }}
                  >
                    <InlineRename session={session} revealOnHover={false} />
                  </button>
                  {session.windowHandle && (
                    <button
                      type="button"
                      title="Go to session desktop"
                      onClick={() => void goToSession(session.windowHandle!)}
                      className="text-[10px] rounded px-1 shrink-0"
                      style={{ background: "var(--hub-surface)", border: 0, color: "var(--hub-text-muted)", cursor: "pointer" }}
                    >
                      &#8599;
                    </button>
                  )}
                </div>
                {session.statusDetail && (
                  <div className="text-[11px] leading-snug" style={{ color: "var(--hub-text-muted)" }}>
                    {session.statusDetail}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

`Session.statusDetail` is `string | null` (`src/types/index.ts:15`), which is why the render is guarded rather than assumed.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/components/RailPanel.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 5: Wire the rail root to switch and reposition**

Replace `src/Rail.tsx`:

```tsx
import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTheme } from "./hooks/useTheme";
import { useWebSocket } from "./hooks/useWebSocket";
import { useRailStore } from "./stores/railStore";
import { RailNub } from "./components/RailNub";
import { RailPanel } from "./components/RailPanel";

// Closed, the rail is a strip; open, it is the remembered size for this edge.
const NUB_SIZE: Record<"nub" | "sliver", [number, number]> = {
  nub: [32, 140],
  sliver: [14, 110],
};

export function Rail() {
  useTheme();
  useWebSocket();

  const open = useRailStore((s) => s.open);
  const setOpen = useRailStore((s) => s.setOpen);
  const anchor = useRailStore((s) => s.anchor);
  const offset = useRailStore((s) => s.offset);
  const restingForm = useRailStore((s) => s.restingForm);
  const sizes = useRailStore((s) => s.sizes);

  useEffect(() => {
    const [w, h] = open
      ? (sizes[anchor] ?? (anchor === "top" || anchor === "bottom" ? [820, 280] : [372, 620]))
      : NUB_SIZE[restingForm];
    invoke("place_rail", { anchor, width: w, height: h, offset }).catch((err) => {
      console.error("[hive] place_rail failed:", err);
    });
  }, [open, anchor, offset, restingForm, sizes]);

  return (
    <div
      className="h-screen w-screen overflow-hidden hub-material"
      style={{ background: open ? "var(--hub-bg)" : "transparent" }}
      data-testid="rail-root"
    >
      {open ? <RailPanel /> : <RailNub onOpen={() => setOpen(true)} />}
    </div>
  );
}
```

- [ ] **Step 6: Verify by hand**

Run: `pnpm tauri dev`, then in the Hive console `await window.__TAURI__.core.invoke("open_rail")`.
Expected: a 32px nub on the right edge showing status dots; clicking it grows the window to 372×620 and lists your sessions with a session waiting for input at the top. The `↗` jumps to that session's terminal.

- [ ] **Step 7: Commit**

```bash
git add src/Rail.tsx src/components/RailPanel.tsx src/components/RailPanel.test.tsx
git commit -m "feat: opened rail panel with urgency ordering"
```

---

### Task 12: Cursor-follow, and the Rail button in Hive

The last two pieces: the rail actually following the cursor, and a way to open it that is not the devtools console.

**Files:**
- Modify: `src/Rail.tsx` (add the follow effect)
- Modify: `src/App.tsx` (add the Rail button to `WindowBar`)
- Test: `src/components/RailButton.test.tsx` (create)

**Interfaces:**
- Consumes: `open_rail` / `close_rail` from Task 7, `useRailStore` from Task 9.
- Produces: `src/components/RailButton.tsx` exporting `export function RailButton()`, rendered in `WindowBar`.

- [ ] **Step 1: Write the failing test**

Create `src/components/RailButton.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const invoke = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { RailButton } from "./RailButton";

describe("RailButton", () => {
  it("opens the rail window when pressed", async () => {
    invoke.mockClear();
    render(<RailButton />);
    await userEvent.click(screen.getByRole("button", { name: /rail/i }));
    expect(invoke).toHaveBeenCalledWith("open_rail");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/components/RailButton.test.tsx`
Expected: FAIL — cannot resolve `./RailButton`.

- [ ] **Step 3: Write the button**

Create `src/components/RailButton.tsx`:

```tsx
import { invoke } from "@tauri-apps/api/core";

export function RailButton() {
  return (
    <button
      type="button"
      onClick={() => {
        void invoke("open_rail").catch((err) => {
          console.error("[hive] open_rail failed:", err);
        });
      }}
      className="text-[10px] px-1.5 py-0.5 rounded transition-opacity hover:opacity-80"
      style={{
        background: "var(--hub-accent)",
        color: "var(--hub-accent-text)",
        border: 0,
        cursor: "pointer",
      }}
      title="Open the Hive rail"
    >
      Rail
    </button>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/components/RailButton.test.tsx`
Expected: PASS, 1 test.

- [ ] **Step 5: Put it in the title bar**

In `src/App.tsx`, import `RailButton` and render it in `WindowBar` immediately before the `{/* Window controls */}` block, so it sits left of minimise and close:

```tsx
      <RailButton />
```

- [ ] **Step 6: Add the follow effect**

In `src/Rail.tsx`, add below the existing placement effect. Polling is the only option — there is no cursor-crossed-monitor event — but 250ms is far below the threshold at which the movement reads as laggy, and repositioning is skipped while the rail is open so it never yanks out from under a click.

```tsx
  const followCursor = useRailStore((s) => s.followCursor);

  useEffect(() => {
    if (!followCursor || open) return;
    const [w, h] = NUB_SIZE[restingForm];
    const tick = () => {
      invoke("place_rail", { anchor, width: w, height: h, offset }).catch(() => {
        // place_rail already logs; a transient failure during a display
        // change should not kill the interval.
      });
    };
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [followCursor, open, anchor, offset, restingForm]);
```

- [ ] **Step 7: Verify the whole phase by hand**

Run: `pnpm tauri dev`

Check each of these:
1. The `Rail` button appears in Hive's title bar and opens the nub.
2. Moving the mouse to your other monitor moves the nub to that monitor's right edge within a beat.
3. Clicking the nub opens the panel; it does **not** jump monitors while open.
4. Sessions list with a waiting session first; `↗` reaches the terminal.
5. Turning off `followCursor` via `useRailStore.setState({ followCursor: false })` in the rail's devtools stops the movement.
6. Hive's collapsed and expanded modes still work, and theme switching still repaints both windows.

- [ ] **Step 8: Full suite, build, commit**

Run: `pnpm test -- --run`; then `pnpm build`; then `cd src-tauri; cargo test`
Expected: all pass.

```bash
git add src/Rail.tsx src/App.tsx src/components/RailButton.tsx src/components/RailButton.test.tsx
git commit -m "feat: cursor-follow and the Rail button"
```

---

## Self-review

**Spec coverage for phases 1–2.** Four new tokens → Task 1. Status-as-dot → Tasks 2–3. Vibrancy, specular edge, hairlines, minimise/close top right → Task 4 (controls already existed; verified rather than rebuilt). Eight anchors → Task 5. Cursor-follow and per-monitor DPI → Tasks 6, 7, 12 (all geometry is in physical pixels, which is what sidesteps mismatched scale factors). Per-anchor remembered size → Task 9. Nub/sliver plus unread badge → Task 10. Go-to-session inside the rail → Task 11. `Rail` button → Task 12. Waiting-sessions-on-top → Task 11's `URGENCY` ordering. All ten themes preserved → Task 1's test.

**Deferred by design, with the phase that owns each:** agent ingest, apps bar, per-app feeds, composer and reply queue (phase 3); Tasks and disk persistence (phase 4); combined mode and the settings UI for these values (phase 5 — phases 1–2 read settings from the store, which is why Task 9 exists before any UI for it). `Hide when nothing is happening` and `Open on hover` are phase 5 too; the store has no field for them yet and neither is needed for the rail to work.

**Placeholder scan.** No TBD, TODO, or "add error handling" steps. Every code step carries the code. Task 7 has no unit test and says so explicitly, with the reason and the manual verification that replaces it.

**Type consistency.** `AnchorId` is the frontend string union; `Anchor` is the Rust enum; `Anchor::from_str_id` accepts exactly the eight `AnchorId` values. `place_rail`'s signature `(anchor: String, width: u32, height: u32, offset: i32)` matches every frontend call site in Tasks 11–12. `currentSize()` returns `[number, number]` and both consumers destructure it as `[w, h]`. `data-testid="status-dot"` is used by both `SessionPill.test.tsx` and `RailNub.test.tsx` and is set in both components.

**Two assumptions checked against source rather than left in the plan.** `Session.statusDetail` exists and is `string | null` (`src/types/index.ts:15`), so Task 11's guarded render is right. The list/detailed view mode is **not** store state — it is `useState` seeded from `localStorage["claude-hive-view-mode"]` (`ExpandedDashboard.tsx:259-266`), so Task 3's test sets localStorage before mount; an earlier draft set a non-existent `sessionViewMode` store key and would have failed.

## Execution handoff

Phases 3–5 get their own plans, written when their inputs are real: phase 3's transport details depend on what phase 2 learns about the second window's lifecycle, and writing them now would be speculation dressed as a plan.
