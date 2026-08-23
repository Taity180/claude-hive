# Hive Agent Rail — Phase 3b: the agent UI

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show what phase 3a ingests — a permanent connected-apps bar, one merged feed of Claude sessions and agent posts, a per-app drill-down, a composer that can reply to an agent, and an Agents pane that hands out the endpoint, token and prompt block.

**Architecture:** The merged feed is built by a pure function over `(sessions, posts)` returning a discriminated union of rows, so ordering is testable without rendering — the same split that made the rail geometry and the MCP dispatch testable. Icons are generated at dev time from `simple-icons` into a committed module, so the app ships no icon dependency and makes no network request; unknown app slugs fall back to a monogram whose hue is hashed from the name.

**Tech Stack:** React 19, TypeScript 5.8, Zustand 5, Tailwind 4, Vitest 3 + Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-22-hive-agent-rail-design.md`

**Depends on:** Phase 3a (`src-tauri/tests/agent_ingest.md` documents the routes this consumes).

## Global Constraints

- **The route shapes are fixed by phase 3a.** `GET /api/agents`, `/api/agents/apps`, `/api/agents/posts?appId=&limit=`, `/api/agents/connection`, `POST /api/agents/{id}/reply`, `PUT /api/agents/{id}/enabled`. All camelCase.
- **Agents render monochrome.** Blue, amber, violet, red and green all mean *session status*; a colour for an agent would collide with "running". Agents get a white-on-black mark plus a text tag, which also means a tenth agent needs no new colour.
- **The unread badge stays `#ff453a`** — outside the status palette, because it means "unread", not a state.
- **"Needs attention" is `waiting_for_input || error`** everywhere, matching phases 1–2 and `CollapsedBar`.
- **No network requests for UI assets.** Icons are bundled or generated. This was decided explicitly — the favicon-fetch layer was rejected.
- **Every new component takes its colours from `--hub-*` tokens.** All ten themes must keep working.
- **Existing tests must pass untouched:** `App.test.tsx`, `CollapsedBar.test.tsx`, `QuestionPrompt.test.tsx`, `PlanUsage.test.tsx`, `UsageMeter.test.tsx`, `SessionPill.test.tsx`, `ExpandedDashboard.test.tsx`, `RailNub.test.tsx`, `RailPanel.test.tsx`, `RailButton.test.tsx`, `railStore.test.ts`, `themes.test.ts`, `main.routing.test.tsx`.
- **Test commands:** `pnpm vitest run <path>`; full suite `pnpm vitest run`; types `pnpm build`.
- **Windows/PowerShell:** chain with `;`, never `&&`.
- **Commit style:** no `Co-Authored-By` line.

## Scope

**In:** apps bar, merged feed, per-app drill-down, composer with reply queue, Agents pane, icon set, and one small backend addition (a pending-reply count route, because the frontend otherwise cannot know when an agent has drained a reply).

**Out:** Tasks (phase 4), combined mode and the rail settings UI (phase 5), `agent_ask` (needs `QuestionStore` generalised past session ids), auto-adding undeclared apps (a setting that belongs with this bar, deferred to phase 5 with the other settings).

---

### Task 1: Frontend types for agents

**Files:**
- Modify: `src/types/index.ts`

**Interfaces:**
- Consumes: the phase 3a models.
- Produces: `Agent`, `AgentApp`, `AppHealth`, `AgentPost`, `AgentAppRow`, `ConnectionInfo`, and three new `WsEvent` variants — `agentConnected`, `agentAppsChanged`, `agentPosted`.

- [ ] **Step 1: Write the failing test**

Create `src/types/agentTypes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { AgentPost, AgentAppRow, WsEvent } from "./index";

describe("agent types", () => {
  it("models a post the way the API sends it", () => {
    // Shape copied from src-tauri/tests/agent_ingest.md, so a rename on the
    // Rust side breaks this rather than silently producing undefined at runtime.
    const post: AgentPost = {
      id: "p1",
      agentId: "a1",
      agentName: "Grok",
      appId: "gmail",
      content: "Found 2 tasks",
      postType: "info",
      timestamp: new Date().toISOString(),
      read: false,
    };
    expect(post.agentName).toBe("Grok");
  });

  it("models an apps-bar row, which flattens the app onto its owner", () => {
    const row: AgentAppRow = {
      agentId: "a1",
      agentName: "Grok",
      id: "gmail",
      label: "Gmail",
      health: "ok",
    };
    expect(row.id).toBe("gmail");
  });

  it("admits the three new websocket events", () => {
    const events: WsEvent[] = [
      {
        type: "agentPosted",
        post: {
          id: "p1",
          agentId: "a1",
          agentName: "Grok",
          appId: null,
          content: "hi",
          postType: "info",
          timestamp: "2026-08-23T00:00:00Z",
          read: false,
        },
      },
      { type: "agentAppsChanged", agentId: "a1", apps: [] },
    ];
    expect(events).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/types/agentTypes.test.ts`
Expected: FAIL — `AgentPost`, `AgentAppRow` are not exported.

- [ ] **Step 3: Add the types**

Append to `src/types/index.ts`:

```ts
export type AppHealth = "ok" | "degraded" | "down";

/** An external MCP-speaking agent. Not a Claude Code session. */
export interface Agent {
  id: string;
  /** Reported by the agent via MCP clientInfo — never hardcoded per vendor. */
  name: string;
  version: string | null;
  connectedAt: string;
  lastSeen: string;
  /** False mutes the agent without revoking its token. */
  enabled: boolean;
}

export interface AgentApp {
  /** Stable slug the agent chose. Also the icon lookup key. */
  id: string;
  label: string;
  health: AppHealth;
}

/** An app flattened onto its owning agent, as `/api/agents/apps` returns it. */
export interface AgentAppRow extends AgentApp {
  agentId: string;
  agentName: string;
}

export interface AgentPost {
  id: string;
  agentId: string;
  /** Denormalised, so a post outlives its agent disconnecting. */
  agentName: string;
  appId: string | null;
  content: string;
  postType: MessageType;
  timestamp: string;
  read: boolean;
}

export interface ConnectionInfo {
  endpoint: string;
  token: string | null;
  promptBlock: string;
}
```

Then extend the `WsEvent` union:

```ts
  | { type: "agentConnected"; agent: Agent }
  | { type: "agentAppsChanged"; agentId: string; apps: AgentApp[] }
  | { type: "agentPosted"; post: AgentPost };
```

Check `MessageType` is exported from this file; if it is named differently, use the existing name rather than adding a parallel type.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/types/agentTypes.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/types/index.ts src/types/agentTypes.test.ts
git commit -m "feat: frontend types for agents, apps and posts"
```

---

### Task 2: The app icon set

App slugs arrive from agents at runtime and can be anything, so the lookup must handle an unknown slug. Icons are generated into a committed module at dev time: the app ships no icon dependency and makes no network call.

**Files:**
- Create: `scripts/connector-catalog.txt` (copy of the 240-entry catalog, so the generator is reproducible)
- Create: `scripts/generate-app-icons.mjs`
- Create: `src/icons/appIcons.generated.ts`
- Create: `src/icons/appIcon.ts`
- Modify: `package.json` (a `devDependencies` entry for `simple-icons`, and an `icons` script)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `APP_ICONS: Record<string, { hex: string; path: string }>` from the generated module, keyed by lowercase slug
  - `resolveAppIcon(slug: string, label?: string): AppIconSpec` where `AppIconSpec = { kind: "brand"; hex: string; path: string } | { kind: "monogram"; text: string; hue: number }`
  - `monogramHue(name: string): number` — deterministic

- [ ] **Step 1: Write the failing test**

Create `src/icons/appIcon.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveAppIcon, monogramHue } from "./appIcon";

describe("resolveAppIcon", () => {
  it("returns a real brand mark for a known slug", () => {
    const icon = resolveAppIcon("github");
    expect(icon.kind).toBe("brand");
    if (icon.kind === "brand") {
      expect(icon.hex).toMatch(/^[0-9A-Fa-f]{6}$/);
      expect(icon.path.length).toBeGreaterThan(20);
    }
  });

  it("is case and separator insensitive, because agents choose their own slugs", () => {
    expect(resolveAppIcon("GitHub").kind).toBe("brand");
    expect(resolveAppIcon("git-hub").kind).toBe("brand");
  });

  it("falls back to a monogram for an unknown slug", () => {
    const icon = resolveAppIcon("totally-made-up-app", "Totally Made Up");
    expect(icon.kind).toBe("monogram");
    if (icon.kind === "monogram") {
      expect(icon.text).toBe("TO");
    }
  });

  it("takes monogram letters from the label when one is given", () => {
    const icon = resolveAppIcon("xy-internal-thing", "Wibble Corp");
    if (icon.kind !== "monogram") throw new Error("expected monogram");
    expect(icon.text).toBe("WI");
  });

  it("never returns an empty monogram", () => {
    const icon = resolveAppIcon("---", "___");
    if (icon.kind !== "monogram") throw new Error("expected monogram");
    expect(icon.text.length).toBeGreaterThan(0);
  });
});

describe("monogramHue", () => {
  it("is stable for the same name", () => {
    // A random palette would reshuffle the apps bar's colours on every launch,
    // which reads as a bug.
    expect(monogramHue("Semgrep")).toBe(monogramHue("Semgrep"));
  });

  it("is in range and distinguishes different names", () => {
    const a = monogramHue("Semgrep");
    const b = monogramHue("Playwright");
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(360);
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/icons/appIcon.test.ts`
Expected: FAIL — cannot resolve `./appIcon`.

- [ ] **Step 3: Copy the catalog into the repo and add the dev dependency**

```bash
cp "C:/Users/taity/Downloads/connector-catalog.txt" scripts/connector-catalog.txt
pnpm add -D simple-icons@16
```

The catalog is committed so the generator is reproducible on another machine, rather than depending on a file in someone's Downloads folder.

- [ ] **Step 4: Write the generator**

Create `scripts/generate-app-icons.mjs`:

```js
// Generates src/icons/appIcons.generated.ts from simple-icons.
//
// Run with: pnpm icons
//
// Why generate rather than depend on simple-icons at runtime: the package holds
// 3,453 icons and we need at most the ~95 that match our connector catalog.
// Bundling the lot would ship megabytes to draw a 13px glyph. The output is
// committed so a normal build needs neither the package nor a network call.
import * as si from "simple-icons";
import fs from "node:fs";
import path from "node:path";

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

const catalog = fs
  .readFileSync(path.join(import.meta.dirname, "connector-catalog.txt"), "utf8")
  .split(/\r?\n/)
  .filter((l) => l.startsWith("- "))
  .map((l) => l.slice(2).replace(/\s*\[on\]\s*$/, "").trim());

// Catalog names that differ from the brand title in simple-icons.
const ALIASES = {
  "monday.com": "monday",
  "apollo.io": "apollo",
  "shadcn/ui": "shadcnui",
  "neon postgres": "neon",
  "mongodb atlas": "mongodb",
  "hugging face": "huggingface",
  "grafana cloud": "grafana",
  "grafana labs": "grafana",
  "stripe link": "stripe",
  "atlassian forge": "atlassian",
  "atlassian teamwork graph": "atlassian",
  "snyk api & web": "snyk",
  "tabnine context engine": "tabnine",
  "cursor sdk": "cursor",
  "cursor team kit": "cursor",
  "revenuecat play billing": "revenuecat",
  "nvidia skills": "nvidia",
  "meta reality labs": "meta",
  "confidence by spotify": "spotify",
  "observe by snowflake": "snowflake",
  "azure": "microsoftazure",
  "azure cosmos db": "microsoftazure",
  "aws core": "amazonwebservices",
  "aws agents": "amazonwebservices",
  "aws amplify": "awsamplify",
  "aws serverless": "awslambda",
  "aws databases": "amazonrds",
  "aws sagemaker": "amazonwebservices",
  "aws deployments": "amazonwebservices",
  "aws data analytics": "amazonwebservices",
  "claude-api": "claude",
  "claude-hive": "claude",
  "claude-mem": "claude",
};

const icons = Object.values(si).filter((i) => i && i.title && i.path);
const byKey = new Map();
for (const icon of icons) {
  byKey.set(norm(icon.title), icon);
  if (icon.slug) byKey.set(norm(icon.slug), icon);
  for (const alias of icon.aliases?.aka ?? []) byKey.set(norm(alias), icon);
}

const out = {};
const missing = [];
for (const name of catalog) {
  const key = ALIASES[name.toLowerCase()] ?? name;
  const icon = byKey.get(norm(key));
  if (icon) {
    // Keyed by the normalised catalog name so a runtime slug like "google-calendar"
    // resolves through the same normalisation.
    out[norm(name)] = { hex: icon.hex, path: icon.path };
  } else {
    missing.push(name);
  }
}

const header = `// GENERATED by scripts/generate-app-icons.mjs — do not edit by hand.
// Run \`pnpm icons\` to regenerate.
//
// ${Object.keys(out).length} of ${catalog.length} catalog entries have a
// CC0 brand mark in simple-icons. The rest fall back to a generated monogram;
// see src/icons/appIcon.ts. This is not a naming problem — simple-icons removes
// logos whose brand guidelines forbid redistribution, so Slack, Canva,
// Playwright, Salesforce and others are genuinely absent.

export interface BrandIcon {
  hex: string;
  path: string;
}

export const APP_ICONS: Record<string, BrandIcon> = `;

fs.mkdirSync(path.join(import.meta.dirname, "../src/icons"), { recursive: true });
fs.writeFileSync(
  path.join(import.meta.dirname, "../src/icons/appIcons.generated.ts"),
  header + JSON.stringify(out, null, 0) + ";\n"
);

console.log(`wrote ${Object.keys(out).length} icons; ${missing.length} fall back to monograms`);
```

Add to `package.json` scripts:

```json
    "icons": "node scripts/generate-app-icons.mjs",
```

- [ ] **Step 5: Generate the module**

Run: `pnpm icons`
Expected: `wrote 95 icons; 145 fall back to monograms` (the exact split measured during design).

- [ ] **Step 6: Write the lookup**

Create `src/icons/appIcon.ts`:

```ts
import { APP_ICONS } from "./appIcons.generated";

export type AppIconSpec =
  | { kind: "brand"; hex: string; path: string }
  | { kind: "monogram"; text: string; hue: number };

/** Agents choose their own slugs, so "GitHub", "github" and "git-hub" must all hit. */
function normalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * A hue derived from the name, so an app is the same colour on every machine
 * and after every restart. A random palette would reshuffle the apps bar's
 * colours on each launch, which reads as a bug rather than as decoration.
 */
export function monogramHue(name: string): number {
  let hash = 0;
  for (const char of name) {
    hash = (hash * 31 + char.charCodeAt(0)) % 360;
  }
  return hash;
}

function monogramText(source: string): string {
  const letters = source.replace(/[^a-zA-Z]/g, "");
  // "---" with label "___" still has to render something.
  return (letters.slice(0, 2) || "?").toUpperCase();
}

export function resolveAppIcon(slug: string, label?: string): AppIconSpec {
  const brand = APP_ICONS[normalise(slug)];
  if (brand) {
    return { kind: "brand", hex: brand.hex, path: brand.path };
  }
  const source = label?.trim() || slug;
  return { kind: "monogram", text: monogramText(source), hue: monogramHue(source) };
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm vitest run src/icons/appIcon.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 8: Commit**

```bash
git add scripts/ src/icons/ package.json pnpm-lock.yaml
git commit -m "feat: generated app icon set with monogram fallback"
```

---

### Task 3: API client, plus the one missing route

The composer needs to show whether a reply is still queued. Nothing in phase 3a exposes that, so this adds the route — `AgentFeed::pending_reply_count` already exists.

**Files:**
- Modify: `src-tauri/src/server/agent_routes.rs`
- Modify: `src-tauri/src/server/mod.rs`
- Create: `src/api/agents.ts`
- Create: `src/api/agents.test.ts`

**Interfaces:**
- Consumes: `api.baseUrl` from `src/api.ts`; the types from Task 1.
- Produces:
  - Backend: `GET /api/agents/{agent_id}/pending` → `{ "pending": number }`
  - Frontend: `fetchAgents()`, `fetchAgentApps()`, `fetchAgentPosts(appId?, limit?)`, `fetchConnectionInfo()`, `replyToAgent(agentId, message)`, `setAgentEnabled(agentId, enabled)`, `fetchPendingReplies(agentId)`

- [ ] **Step 1: Write the failing backend test**

Add to the `tests` module in `src-tauri/src/server/agent_routes.rs`:

```rust
    #[tokio::test]
    async fn pending_count_reports_what_is_queued() {
        let dir = tempfile::tempdir().unwrap();
        let state = crate::server::app_state::AppState::with_token_dir(dir.path());
        state.agents.upsert("a1", "Grok".into(), None).await;

        assert_eq!(pending_count(&state, "a1").await, 0);
        state.agent_feed.enqueue_reply("a1", "one".into()).await;
        state.agent_feed.enqueue_reply("a1", "two".into()).await;
        assert_eq!(pending_count(&state, "a1").await, 2);

        state.agent_feed.drain_replies("a1").await;
        assert_eq!(pending_count(&state, "a1").await, 0, "a drained queue reads as zero");
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri; cargo test pending_count`
Expected: FAIL — `pending_count` not found.

- [ ] **Step 3: Add the route**

In `src-tauri/src/server/agent_routes.rs`:

```rust
#[derive(Debug, Serialize)]
pub struct PendingReplies {
    pub pending: usize,
}

/// Extracted so the count is testable without spinning up a router.
async fn pending_count(state: &AppState, agent_id: &str) -> usize {
    state.agent_feed.pending_reply_count(agent_id).await
}

/// How many replies are still waiting for an agent to collect.
///
/// The composer shows this: MCP cannot push, so a reply sits here until the
/// agent calls `agent_inbox`, and an honest "queued" indicator beats a send
/// button that pretends to be instant.
pub async fn agent_pending_replies(
    State(state): State<AppState>,
    Path(agent_id): Path<String>,
) -> Json<PendingReplies> {
    Json(PendingReplies {
        pending: pending_count(&state, &agent_id).await,
    })
}
```

In `src-tauri/src/server/mod.rs`, beside the other agent routes:

```rust
        .route("/api/agents/{agent_id}/pending", get(agent_pending_replies))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri; cargo test pending_count`
Expected: PASS, 1 test. Then `cargo test` — all still green.

- [ ] **Step 5: Write the failing frontend test**

Create `src/api/agents.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api", () => ({ api: { baseUrl: "http://localhost:9400" } }));

import {
  fetchAgents,
  fetchAgentApps,
  fetchAgentPosts,
  fetchConnectionInfo,
  replyToAgent,
  fetchPendingReplies,
} from "./agents";

const fetchMock = vi.fn();
globalThis.fetch = fetchMock as unknown as typeof fetch;

function ok(body: unknown) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
}

describe("agent api", () => {
  beforeEach(() => fetchMock.mockReset());

  it("lists agents", async () => {
    fetchMock.mockReturnValue(ok([{ id: "a1", name: "Grok" }]));
    const agents = await fetchAgents();
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:9400/api/agents");
    expect(agents[0].name).toBe("Grok");
  });

  it("passes appId and limit as query params", async () => {
    fetchMock.mockReturnValue(ok([]));
    await fetchAgentPosts("gmail", 20);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("appId=gmail");
    expect(url).toContain("limit=20");
  });

  it("omits appId when asking for the global feed", async () => {
    fetchMock.mockReturnValue(ok([]));
    await fetchAgentPosts();
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("appId");
  });

  it("posts a reply as JSON", async () => {
    fetchMock.mockReturnValue(ok({}));
    await replyToAgent("a1", "dig into it");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("http://localhost:9400/api/agents/a1/reply");
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ message: "dig into it" });
  });

  it("reads the pending reply count", async () => {
    fetchMock.mockReturnValue(ok({ pending: 3 }));
    expect(await fetchPendingReplies("a1")).toBe(3);
  });

  it("returns an empty list rather than throwing when the server is unreachable", async () => {
    // Hive's own window loads before the server is guaranteed up; a rejected
    // fetch must not blank the rail.
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    expect(await fetchAgents()).toEqual([]);
    expect(await fetchAgentApps()).toEqual([]);
    expect(await fetchAgentPosts()).toEqual([]);
  });

  it("returns null connection info when the server is unreachable", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    expect(await fetchConnectionInfo()).toBeNull();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm vitest run src/api/agents.test.ts`
Expected: FAIL — cannot resolve `./agents`.

- [ ] **Step 7: Write the client**

Create `src/api/agents.ts`:

```ts
import { api } from "../api";
import type { Agent, AgentAppRow, AgentPost, ConnectionInfo } from "../types";

/**
 * Read a JSON endpoint, falling back rather than throwing.
 *
 * The rail's webview is created at app startup, before the HTTP server is
 * guaranteed to be accepting connections. A rejected fetch must degrade to an
 * empty pane, not an error boundary.
 */
async function getJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const response = await fetch(`${api.baseUrl}${path}`);
    if (!response.ok) return fallback;
    return (await response.json()) as T;
  } catch (err) {
    console.error(`[hive] GET ${path} failed:`, err);
    return fallback;
  }
}

export function fetchAgents(): Promise<Agent[]> {
  return getJson<Agent[]>("/api/agents", []);
}

export function fetchAgentApps(): Promise<AgentAppRow[]> {
  return getJson<AgentAppRow[]>("/api/agents/apps", []);
}

export function fetchAgentPosts(appId?: string, limit = 100): Promise<AgentPost[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (appId) params.set("appId", appId);
  return getJson<AgentPost[]>(`/api/agents/posts?${params}`, []);
}

export function fetchConnectionInfo(): Promise<ConnectionInfo | null> {
  return getJson<ConnectionInfo | null>("/api/agents/connection", null);
}

export async function fetchPendingReplies(agentId: string): Promise<number> {
  const result = await getJson<{ pending: number }>(
    `/api/agents/${agentId}/pending`,
    { pending: 0 }
  );
  return result.pending;
}

async function send(path: string, method: string, body: unknown): Promise<boolean> {
  try {
    const response = await fetch(`${api.baseUrl}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return response.ok;
  } catch (err) {
    console.error(`[hive] ${method} ${path} failed:`, err);
    return false;
  }
}

export function replyToAgent(agentId: string, message: string): Promise<boolean> {
  return send(`/api/agents/${agentId}/reply`, "POST", { message });
}

export function setAgentEnabled(agentId: string, enabled: boolean): Promise<boolean> {
  return send(`/api/agents/${agentId}/enabled`, "PUT", { enabled });
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm vitest run src/api/agents.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 9: Commit**

```bash
git add src-tauri/src/server/ src/api/
git commit -m "feat: agent api client and pending-reply count route"
```

---

### Task 4: Agent state in the hub store

**Files:**
- Modify: `src/stores/hubStore.ts`
- Create: `src/stores/hubStore.agents.test.ts`

**Interfaces:**
- Consumes: types from Task 1.
- Produces: `HubState` gains `agents: Agent[]`, `agentApps: AgentAppRow[]`, `agentPosts: AgentPost[]`, plus `setAgents`, `setAgentApps`, `setAgentPosts`, and handling for the three new `WsEvent` variants inside `handleWsEvent`.

- [ ] **Step 1: Write the failing test**

Create `src/stores/hubStore.agents.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { useHubStore } from "./hubStore";
import type { AgentPost } from "../types";

function post(id: string, content: string, appId: string | null = null): AgentPost {
  return {
    id,
    agentId: "a1",
    agentName: "Grok",
    appId,
    content,
    postType: "info",
    timestamp: new Date().toISOString(),
    read: false,
  };
}

describe("hubStore agents", () => {
  beforeEach(() => {
    useHubStore.setState({ agents: [], agentApps: [], agentPosts: [] });
  });

  it("adds a connecting agent", () => {
    useHubStore.getState().handleWsEvent({
      type: "agentConnected",
      agent: {
        id: "a1",
        name: "Grok",
        version: "2.1",
        connectedAt: "2026-08-23T00:00:00Z",
        lastSeen: "2026-08-23T00:00:00Z",
        enabled: true,
      },
    });
    expect(useHubStore.getState().agents).toHaveLength(1);
  });

  it("updates an agent that reconnects rather than duplicating it", () => {
    const agent = {
      id: "a1",
      name: "Grok",
      version: null,
      connectedAt: "2026-08-23T00:00:00Z",
      lastSeen: "2026-08-23T00:00:00Z",
      enabled: true,
    };
    const store = useHubStore.getState();
    store.handleWsEvent({ type: "agentConnected", agent });
    store.handleWsEvent({ type: "agentConnected", agent: { ...agent, name: "Grok Bot" } });

    const agents = useHubStore.getState().agents;
    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe("Grok Bot");
  });

  it("puts a new post at the front", () => {
    useHubStore.setState({ agentPosts: [post("p1", "older")] });
    useHubStore.getState().handleWsEvent({ type: "agentPosted", post: post("p2", "newer") });

    const posts = useHubStore.getState().agentPosts;
    expect(posts[0].content).toBe("newer");
    expect(posts).toHaveLength(2);
  });

  it("ignores a post it already has, so a refetch plus a live event cannot double it", () => {
    useHubStore.setState({ agentPosts: [post("p1", "one")] });
    useHubStore.getState().handleWsEvent({ type: "agentPosted", post: post("p1", "one") });
    expect(useHubStore.getState().agentPosts).toHaveLength(1);
  });

  it("replaces an agent's apps on change, keeping other agents' apps", () => {
    useHubStore.setState({
      agentApps: [
        { agentId: "a1", agentName: "Grok", id: "gmail", label: "Gmail", health: "ok" },
        { agentId: "a2", agentName: "Ops", id: "linear", label: "Linear", health: "ok" },
      ],
    });

    useHubStore.getState().handleWsEvent({
      type: "agentAppsChanged",
      agentId: "a1",
      apps: [{ id: "x", label: "X", health: "ok" }],
    });

    const apps = useHubStore.getState().agentApps;
    // a1's gmail is gone (sync replaces), a2 is untouched.
    expect(apps.filter((a) => a.agentId === "a1").map((a) => a.id)).toEqual(["x"]);
    expect(apps.filter((a) => a.agentId === "a2")).toHaveLength(1);
  });

  it("keeps the agent name on rows it rebuilds from an apps event", () => {
    useHubStore.setState({
      agents: [
        {
          id: "a1",
          name: "Grok",
          version: null,
          connectedAt: "",
          lastSeen: "",
          enabled: true,
        },
      ],
      agentApps: [],
    });
    useHubStore.getState().handleWsEvent({
      type: "agentAppsChanged",
      agentId: "a1",
      apps: [{ id: "x", label: "X", health: "ok" }],
    });
    expect(useHubStore.getState().agentApps[0].agentName).toBe("Grok");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/stores/hubStore.agents.test.ts`
Expected: FAIL — no `agents` in state; the new event types are unhandled.

- [ ] **Step 3: Extend the store**

In `src/stores/hubStore.ts`, add to the imports:

```ts
import type { Agent, AgentAppRow, AgentPost } from "../types";
```

Add to the `HubState` interface:

```ts
  /** External MCP agents that have completed a handshake. */
  agents: Agent[];
  /** Every declared app across every agent, for the apps bar. */
  agentApps: AgentAppRow[];
  /** Newest first. */
  agentPosts: AgentPost[];

  setAgents: (agents: Agent[]) => void;
  setAgentApps: (apps: AgentAppRow[]) => void;
  setAgentPosts: (posts: AgentPost[]) => void;
```

Add to the initial state:

```ts
  agents: [],
  agentApps: [],
  agentPosts: [],
```

Add the setters beside the existing ones:

```ts
  setAgents: (agents) => set({ agents }),
  setAgentApps: (agentApps) => set({ agentApps }),
  setAgentPosts: (agentPosts) => set({ agentPosts }),
```

Add three cases to `handleWsEvent`'s switch:

```ts
        case "agentConnected": {
          const existing = state.agents.some((a) => a.id === event.agent.id);
          return {
            agents: existing
              ? state.agents.map((a) => (a.id === event.agent.id ? event.agent : a))
              : [...state.agents, event.agent],
          };
        }

        case "agentPosted": {
          // A live event can arrive for a post an initial fetch already
          // returned; keying on id keeps the feed from showing it twice.
          if (state.agentPosts.some((p) => p.id === event.post.id)) {
            return {};
          }
          return { agentPosts: [event.post, ...state.agentPosts] };
        }

        case "agentAppsChanged": {
          const agentName =
            state.agents.find((a) => a.id === event.agentId)?.name ?? "Unknown agent";
          // agent_apps_sync replaces rather than merges, so this agent's rows
          // are rebuilt wholesale while other agents' rows are left alone.
          const others = state.agentApps.filter((a) => a.agentId !== event.agentId);
          const mine = event.apps.map((app) => ({
            ...app,
            agentId: event.agentId,
            agentName,
          }));
          return { agentApps: [...others, ...mine] };
        }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/stores/hubStore.agents.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/stores/hubStore.ts src/stores/hubStore.agents.test.ts
git commit -m "feat: agent state and websocket handling in the hub store"
```

---

### Task 5: The merged feed, as a pure function

Ordering is the part with real behaviour, so it is separated from rendering and tested directly.

**Files:**
- Create: `src/feed/buildFeed.ts`
- Create: `src/feed/buildFeed.test.ts`

**Interfaces:**
- Consumes: `Session`, `AgentPost` from Task 1 and existing types.
- Produces:
  - `type FeedRow = { kind: "session"; session: Session; at: string } | { kind: "post"; post: AgentPost; at: string }`
  - `buildFeed(sessions: Session[], posts: AgentPost[], options?: { pinAttention?: boolean; appId?: string | null }): FeedRow[]`

- [ ] **Step 1: Write the failing test**

Create `src/feed/buildFeed.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildFeed } from "./buildFeed";
import type { AgentPost, Session } from "../types";

const t = (minutes: number) => new Date(Date.UTC(2026, 7, 23, 12, minutes)).toISOString();

function session(id: string, status: Session["status"], at: string): Session {
  return { id, projectName: id, status, lastActivity: at } as Session;
}

function post(id: string, at: string, appId: string | null = null): AgentPost {
  return {
    id,
    agentId: "a1",
    agentName: "Grok",
    appId,
    content: id,
    postType: "info",
    timestamp: at,
    read: false,
  };
}

describe("buildFeed", () => {
  it("interleaves sessions and posts newest first", () => {
    const rows = buildFeed(
      [session("s-old", "running", t(0)), session("s-new", "running", t(30))],
      [post("p-mid", t(15))]
    );
    expect(rows.map((r) => (r.kind === "session" ? r.session.id : r.post.id))).toEqual([
      "s-new",
      "p-mid",
      "s-old",
    ]);
  });

  it("pins a session needing attention above everything newer", () => {
    // The whole point of the rail is a glance. A blocked session must not be
    // buried by an agent that posts every few seconds.
    const rows = buildFeed(
      [session("blocked", "waiting_for_input", t(0))],
      [post("chatty", t(59))],
      { pinAttention: true }
    );
    expect(rows[0].kind).toBe("session");
    expect(rows[0].kind === "session" && rows[0].session.id).toBe("blocked");
  });

  it("pins an errored session too, matching the rest of the app", () => {
    const rows = buildFeed(
      [session("broken", "error", t(0))],
      [post("chatty", t(59))],
      { pinAttention: true }
    );
    expect(rows[0].kind === "session" && rows[0].session.id).toBe("broken");
  });

  it("does not pin when the setting is off", () => {
    const rows = buildFeed(
      [session("blocked", "waiting_for_input", t(0))],
      [post("chatty", t(59))],
      { pinAttention: false }
    );
    expect(rows[0].kind).toBe("post");
  });

  it("orders two attention sessions among themselves by recency", () => {
    const rows = buildFeed(
      [
        session("older", "waiting_for_input", t(0)),
        session("newer", "error", t(10)),
      ],
      [],
      { pinAttention: true }
    );
    expect(rows[0].kind === "session" && rows[0].session.id).toBe("newer");
  });

  it("filters to one app, dropping sessions entirely", () => {
    // A per-app view is about that app, so a Claude session has no place in it.
    const rows = buildFeed(
      [session("s1", "running", t(30))],
      [post("gmail-1", t(10), "gmail"), post("x-1", t(20), "x")],
      { appId: "gmail" }
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].kind === "post" && rows[0].post.id).toBe("gmail-1");
  });

  it("returns nothing for an app with no posts rather than falling back to everything", () => {
    const rows = buildFeed([session("s1", "running", t(30))], [post("x-1", t(20), "x")], {
      appId: "gmail",
    });
    expect(rows).toEqual([]);
  });

  it("handles empty input", () => {
    expect(buildFeed([], [])).toEqual([]);
  });

  it("tolerates a missing timestamp without dropping the row", () => {
    const broken = { ...post("p1", t(10)), timestamp: "" };
    const rows = buildFeed([], [broken]);
    expect(rows).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/feed/buildFeed.test.ts`
Expected: FAIL — cannot resolve `./buildFeed`.

- [ ] **Step 3: Write the builder**

Create `src/feed/buildFeed.ts`:

```ts
import type { AgentPost, Session } from "../types";

export type FeedRow =
  | { kind: "session"; session: Session; at: string }
  | { kind: "post"; post: AgentPost; at: string };

export interface BuildFeedOptions {
  /** Keep sessions needing the user at the top, whatever the timestamps say. */
  pinAttention?: boolean;
  /** Restrict to one app's posts. Sessions are excluded entirely. */
  appId?: string | null;
}

/**
 * "Needs attention" is waiting-or-error across the whole app — the CollapsedBar
 * filter and the tray badge count use the same definition.
 */
function needsAttention(session: Session): boolean {
  return session.status === "waiting_for_input" || session.status === "error";
}

export function buildFeed(
  sessions: Session[],
  posts: AgentPost[],
  options: BuildFeedOptions = {}
): FeedRow[] {
  const { pinAttention = false, appId = null } = options;

  // A per-app view is about that app. Including Claude sessions there would be
  // answering a question the user did not ask.
  if (appId) {
    return posts
      .filter((post) => post.appId === appId)
      .map((post) => ({ kind: "post" as const, post, at: post.timestamp }))
      .sort(byRecency);
  }

  const rows: FeedRow[] = [
    ...sessions.map((session) => ({
      kind: "session" as const,
      session,
      at: session.lastActivity ?? "",
    })),
    ...posts.map((post) => ({ kind: "post" as const, post, at: post.timestamp })),
  ];

  rows.sort(byRecency);

  if (!pinAttention) return rows;

  const pinned = rows.filter((row) => row.kind === "session" && needsAttention(row.session));
  const rest = rows.filter((row) => !(row.kind === "session" && needsAttention(row.session)));
  return [...pinned, ...rest];
}

/** Newest first. String compare is safe on ISO-8601 and avoids parsing every row. */
function byRecency(a: FeedRow, b: FeedRow): number {
  return b.at.localeCompare(a.at);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/feed/buildFeed.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/feed/
git commit -m "feat: merged feed ordering as a pure function"
```

---

### Task 6: The app icon component and the connected-apps bar

**Files:**
- Create: `src/components/AppIcon.tsx`
- Create: `src/components/ConnectedAppsBar.tsx`
- Create: `src/components/ConnectedAppsBar.test.tsx`

**Interfaces:**
- Consumes: `resolveAppIcon` (Task 2), `agentApps` from the store (Task 4).
- Produces:
  - `AppIcon({ slug, label, size }: { slug: string; label?: string; size?: number })`
  - `ConnectedAppsBar({ selected, onSelect }: { selected: string | null; onSelect: (appId: string | null) => void })`, rendering `data-testid="app-node"` per app with `data-app-id` and `data-selected`.

- [ ] **Step 1: Write the failing test**

Create `src/components/ConnectedAppsBar.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectedAppsBar } from "./ConnectedAppsBar";
import { useHubStore } from "../stores/hubStore";

const apps = [
  { agentId: "a1", agentName: "Grok", id: "gmail", label: "Gmail", health: "ok" as const },
  { agentId: "a1", agentName: "Grok", id: "x", label: "X", health: "ok" as const },
  {
    agentId: "a2",
    agentName: "Ops",
    id: "made-up-thing",
    label: "Made Up Thing",
    health: "degraded" as const,
  },
];

describe("ConnectedAppsBar", () => {
  beforeEach(() => {
    useHubStore.setState({ agentApps: apps });
  });

  it("shows one node per connected app", () => {
    render(<ConnectedAppsBar selected={null} onSelect={vi.fn()} />);
    expect(screen.getAllByTestId("app-node")).toHaveLength(3);
  });

  it("marks the selected app", () => {
    render(<ConnectedAppsBar selected="x" onSelect={vi.fn()} />);
    const selected = screen.getAllByTestId("app-node").filter(
      (n) => n.getAttribute("data-selected") === "true"
    );
    expect(selected).toHaveLength(1);
    expect(selected[0]).toHaveAttribute("data-app-id", "x");
  });

  it("selects an app on click and deselects the same app on a second click", async () => {
    const onSelect = vi.fn();
    render(<ConnectedAppsBar selected="x" onSelect={onSelect} />);
    const nodes = screen.getAllByTestId("app-node");

    await userEvent.click(nodes.find((n) => n.getAttribute("data-app-id") === "gmail")!);
    expect(onSelect).toHaveBeenCalledWith("gmail");

    await userEvent.click(nodes.find((n) => n.getAttribute("data-app-id") === "x")!);
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it("names the owning agent, so two agents exposing Gmail are distinguishable", () => {
    render(<ConnectedAppsBar selected={null} onSelect={vi.fn()} />);
    const node = screen
      .getAllByTestId("app-node")
      .find((n) => n.getAttribute("data-app-id") === "made-up-thing")!;
    expect(node.getAttribute("title")).toContain("Ops");
  });

  it("shows degraded health without inventing a new status colour", () => {
    render(<ConnectedAppsBar selected={null} onSelect={vi.fn()} />);
    const node = screen
      .getAllByTestId("app-node")
      .find((n) => n.getAttribute("data-app-id") === "made-up-thing")!;
    expect(node.getAttribute("data-health")).toBe("degraded");
  });

  it("says so when no agent has declared anything", () => {
    useHubStore.setState({ agentApps: [] });
    render(<ConnectedAppsBar selected={null} onSelect={vi.fn()} />);
    expect(screen.getByText(/no apps connected/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/components/ConnectedAppsBar.test.tsx`
Expected: FAIL — cannot resolve `./ConnectedAppsBar`.

- [ ] **Step 3: Write the icon component**

Create `src/components/AppIcon.tsx`:

```tsx
import { resolveAppIcon } from "../icons/appIcon";

interface AppIconProps {
  slug: string;
  label?: string;
  size?: number;
}

/**
 * A brand mark where one exists, a stable monogram where it does not.
 *
 * Both paths are drawn locally — no request leaves the machine to render a
 * 13px glyph, which is why the favicon-fetch layer was rejected.
 */
export function AppIcon({ slug, label, size = 13 }: AppIconProps) {
  const icon = resolveAppIcon(slug, label);

  if (icon.kind === "brand") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
        <path d={icon.path} fill={`#${icon.hex}`} />
      </svg>
    );
  }

  return (
    <span
      aria-hidden="true"
      style={{
        fontSize: Math.round(size * 0.62),
        fontWeight: 700,
        letterSpacing: "-0.02em",
        lineHeight: 1,
        color: `hsl(${icon.hue} 80% 82%)`,
      }}
    >
      {icon.text}
    </span>
  );
}
```

- [ ] **Step 4: Write the bar**

Create `src/components/ConnectedAppsBar.tsx`:

```tsx
import { useHubStore } from "../stores/hubStore";
import { resolveAppIcon } from "../icons/appIcon";
import { AppIcon } from "./AppIcon";
import type { AppHealth } from "../types";

/**
 * Health is not a session status, so it gets its own muted scale rather than
 * borrowing the status palette — otherwise a degraded app would read as a
 * session that needs attention.
 */
const healthColor: Record<AppHealth, string> = {
  ok: "#22c55e",
  degraded: "#eab308",
  down: "#ef4444",
};

interface ConnectedAppsBarProps {
  selected: string | null;
  onSelect: (appId: string | null) => void;
}

export function ConnectedAppsBar({ selected, onSelect }: ConnectedAppsBarProps) {
  const apps = useHubStore((s) => s.agentApps);

  if (apps.length === 0) {
    return (
      <div
        className="px-3 py-2 text-[10.5px] shrink-0"
        style={{
          color: "var(--hub-text-muted)",
          borderBottom: "1px solid var(--hub-hair)",
        }}
      >
        No apps connected
      </div>
    );
  }

  return (
    <div
      className="flex items-center gap-1.5 px-2 py-2 shrink-0 overflow-x-auto scrollbar-none"
      style={{ borderBottom: "1px solid var(--hub-hair)" }}
    >
      {apps.map((app) => {
        const isSelected = selected === app.id;
        const icon = resolveAppIcon(app.id, app.label);
        return (
          <button
            key={`${app.agentId}:${app.id}`}
            type="button"
            data-testid="app-node"
            data-app-id={app.id}
            data-selected={isSelected ? "true" : undefined}
            data-health={app.health}
            title={`${app.label} — via ${app.agentName}`}
            aria-pressed={isSelected}
            // Clicking the selected app clears the filter, so the bar is both
            // the way in and the way back out.
            onClick={() => onSelect(isSelected ? null : app.id)}
            className="relative shrink-0 grid place-items-center rounded-md"
            style={{
              width: 25,
              height: 25,
              border: 0,
              cursor: "pointer",
              background: isSelected
                ? "var(--hub-accent)"
                : icon.kind === "monogram"
                  ? `hsl(${icon.hue} 45% 22%)`
                  : "var(--hub-surface)",
              boxShadow: isSelected ? "none" : "inset 0 0 0 1px var(--hub-hair)",
            }}
          >
            <AppIcon slug={app.id} label={app.label} />
            <span
              aria-hidden="true"
              style={{
                position: "absolute",
                right: -2,
                bottom: -2,
                width: 7,
                height: 7,
                borderRadius: 999,
                background: healthColor[app.health],
                boxShadow: "0 0 0 1.5px var(--hub-bg-solid)",
              }}
            />
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/components/ConnectedAppsBar.test.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add src/components/AppIcon.tsx src/components/ConnectedAppsBar.tsx src/components/ConnectedAppsBar.test.tsx
git commit -m "feat: connected apps bar with brand and monogram icons"
```

---

### Task 7: Render the merged feed in the rail

**Files:**
- Create: `src/components/AgentPostRow.tsx`
- Modify: `src/components/RailPanel.tsx`
- Modify: `src/components/RailPanel.test.tsx`

**Interfaces:**
- Consumes: `buildFeed` (Task 5), `ConnectedAppsBar` (Task 6), store state (Task 4).
- Produces: `AgentPostRow({ post }: { post: AgentPost })` rendering `data-testid="rail-row"` with `data-row-kind="post"`; `RailPanel` renders the merged feed and adds `data-row-kind="session"` to its session rows.

- [ ] **Step 1: Write the failing test**

Append to `src/components/RailPanel.test.tsx`:

```tsx
  it("interleaves agent posts with sessions in one feed", () => {
    useHubStore.setState({
      sessions,
      agentPosts: [
        {
          id: "p1",
          agentId: "a1",
          agentName: "Grok",
          appId: "x",
          content: "Tauri v3 alpha dropped",
          postType: "info",
          timestamp: new Date().toISOString(),
          read: false,
        },
      ],
      agentApps: [],
    });
    render(<RailPanel />);
    expect(screen.getByText("Tauri v3 alpha dropped")).toBeInTheDocument();
    expect(screen.getAllByTestId("rail-row").length).toBe(3);
  });

  it("tags an agent row as an agent, and does not give it a status colour", () => {
    useHubStore.setState({
      sessions: [],
      agentApps: [],
      agentPosts: [
        {
          id: "p1",
          agentId: "a1",
          agentName: "Grok",
          appId: null,
          content: "hello",
          postType: "info",
          timestamp: new Date().toISOString(),
          read: false,
        },
      ],
    });
    render(<RailPanel />);
    const row = screen.getByTestId("rail-row");
    expect(row).toHaveAttribute("data-row-kind", "post");
    expect(screen.getByText(/agent/i)).toBeInTheDocument();
  });

  it("keeps a blocked session above a newer agent post", () => {
    useHubStore.setState({
      sessions: [
        {
          id: "b",
          projectName: "l2u-team-portal",
          status: "waiting_for_input",
          lastActivity: new Date(Date.now() - 60000).toISOString(),
        } as Session,
      ],
      agentApps: [],
      agentPosts: [
        {
          id: "p1",
          agentId: "a1",
          agentName: "Grok",
          appId: null,
          content: "chatty",
          postType: "info",
          timestamp: new Date().toISOString(),
          read: false,
        },
      ],
    });
    render(<RailPanel />);
    expect(screen.getAllByTestId("rail-row")[0]).toHaveAttribute("data-row-kind", "session");
  });
```

Also update the existing `beforeEach` in that file to reset the new state:

```tsx
    useHubStore.setState({ sessions, unreadSessions: new Set(), agentPosts: [], agentApps: [] });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/components/RailPanel.test.tsx`
Expected: FAIL — posts are not rendered; no `data-row-kind`.

- [ ] **Step 3: Write the post row**

Create `src/components/AgentPostRow.tsx`:

```tsx
import { AppIcon } from "./AppIcon";
import type { AgentPost } from "../types";

/**
 * Agents render monochrome, deliberately.
 *
 * Blue, amber, violet, red and green all mean *session status*. Giving an agent
 * a colour would make it read as a session in some state, and a tenth agent
 * would need a tenth colour. A white mark plus a text tag scales and never
 * collides.
 */
export function AgentPostRow({ post }: { post: AgentPost }) {
  return (
    <div
      data-testid="rail-row"
      data-row-kind="post"
      className="flex gap-2 px-2 py-1.5 rounded-lg"
    >
      <span
        className="shrink-0 grid place-items-center rounded-md mt-0.5"
        style={{ width: 20, height: 20, background: "#f2f4f8" }}
      >
        {post.appId ? (
          <AppIcon slug={post.appId} size={12} />
        ) : (
          <svg width="11" height="11" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 3l9 16H3z" fill="none" stroke="#16181c" strokeWidth="2.4" strokeLinejoin="round" />
          </svg>
        )}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span
            className="text-[12px] font-semibold truncate"
            style={{ color: "var(--hub-text)" }}
          >
            {post.agentName}
          </span>
          <span
            className="text-[8.5px] font-bold uppercase tracking-wide shrink-0 rounded px-1"
            style={{ background: "#e9ecf2", color: "#16181c" }}
          >
            Agent
          </span>
        </div>
        <div className="text-[11px] leading-snug" style={{ color: "var(--hub-text-muted)" }}>
          {post.content}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Rewire RailPanel onto buildFeed**

In `src/components/RailPanel.tsx`: import `useState`, `buildFeed`, `ConnectedAppsBar`, `AgentPostRow`; read `agentPosts` from the store; hold the selected app in local state; replace the `ordered.map(...)` body with a `rows.map(...)` over `FeedRow`, extracting the existing session markup into a local `SessionRow` component and adding `data-row-kind="session"` to it. Delete the now-unused `byUrgencyThenRecency` and `URGENCY` — `buildFeed` owns ordering.

```tsx
  const sessions = useHubStore((s) => s.sessions);
  const agentPosts = useHubStore((s) => s.agentPosts);
  const [selectedApp, setSelectedApp] = useState<string | null>(null);

  const rows = buildFeed(sessions, agentPosts, {
    pinAttention: true,
    appId: selectedApp,
  });
```

```tsx
      <ConnectedAppsBar selected={selectedApp} onSelect={setSelectedApp} />

      <div className="flex-1 overflow-y-auto p-1.5 flex flex-col gap-0.5">
        {rows.length === 0 && (
          <span className="text-[11px] px-2 py-3" style={{ color: "var(--hub-text-muted)" }}>
            {selectedApp ? "Nothing from this app yet" : "No sessions connected"}
          </span>
        )}
        {rows.map((row) =>
          row.kind === "session" ? (
            <SessionRow key={row.session.id} session={row.session} />
          ) : (
            <AgentPostRow key={row.post.id} post={row.post} />
          )
        )}
      </div>
```

Keep the existing header, and keep `goToSession` and `InlineRename` inside `SessionRow` exactly as they are — go-to-session must stay on every session row.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/components/RailPanel.test.tsx`
Expected: PASS, 8 tests (5 existing + 3 new).

- [ ] **Step 6: Commit**

```bash
git add src/components/AgentPostRow.tsx src/components/RailPanel.tsx src/components/RailPanel.test.tsx
git commit -m "feat: merge agent posts into the rail feed"
```

---

### Task 8: The composer, with an honest queue indicator

**Files:**
- Create: `src/components/RailComposer.tsx`
- Create: `src/components/RailComposer.test.tsx`

**Interfaces:**
- Consumes: `replyToAgent`, `fetchPendingReplies` (Task 3), store agents (Task 4).
- Produces: `RailComposer({ agents }: { agents: Agent[] })` with `data-testid="composer-target"`, `data-testid="composer-input"`, `data-testid="composer-send"`, and `data-testid="composer-queued"` when a reply is outstanding.

- [ ] **Step 1: Write the failing test**

Create `src/components/RailComposer.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { replyToAgent, fetchPendingReplies } = vi.hoisted(() => ({
  replyToAgent: vi.fn(),
  fetchPendingReplies: vi.fn(),
}));
vi.mock("../api/agents", () => ({ replyToAgent, fetchPendingReplies }));

import { RailComposer } from "./RailComposer";
import type { Agent } from "../types";

const agents: Agent[] = [
  {
    id: "a1",
    name: "Grok",
    version: null,
    connectedAt: "",
    lastSeen: "",
    enabled: true,
  },
];

describe("RailComposer", () => {
  beforeEach(() => {
    replyToAgent.mockReset().mockResolvedValue(true);
    fetchPendingReplies.mockReset().mockResolvedValue(0);
  });

  it("targets the only connected agent", () => {
    render(<RailComposer agents={agents} />);
    expect(screen.getByTestId("composer-target")).toHaveTextContent("Grok");
  });

  it("sends what was typed and clears the field", async () => {
    render(<RailComposer agents={agents} />);
    await userEvent.type(screen.getByTestId("composer-input"), "dig into it");
    await userEvent.click(screen.getByTestId("composer-send"));

    expect(replyToAgent).toHaveBeenCalledWith("a1", "dig into it");
    await waitFor(() =>
      expect(screen.getByTestId("composer-input")).toHaveValue("")
    );
  });

  it("will not send an empty or whitespace message", async () => {
    render(<RailComposer agents={agents} />);
    await userEvent.click(screen.getByTestId("composer-send"));
    await userEvent.type(screen.getByTestId("composer-input"), "   ");
    await userEvent.click(screen.getByTestId("composer-send"));
    expect(replyToAgent).not.toHaveBeenCalled();
  });

  it("says a reply is queued, because MCP cannot push it", async () => {
    // An honest "waiting to be collected" beats a send button that pretends to
    // be instant — the agent may not run again for a while.
    fetchPendingReplies.mockResolvedValue(2);
    render(<RailComposer agents={agents} />);
    await waitFor(() =>
      expect(screen.getByTestId("composer-queued")).toHaveTextContent("2")
    );
    expect(screen.getByTestId("composer-queued").textContent).toMatch(/collect|queued/i);
  });

  it("hides the queue line when nothing is waiting", async () => {
    fetchPendingReplies.mockResolvedValue(0);
    render(<RailComposer agents={agents} />);
    await waitFor(() => expect(fetchPendingReplies).toHaveBeenCalled());
    expect(screen.queryByTestId("composer-queued")).toBeNull();
  });

  it("disables itself when no agent has connected", () => {
    render(<RailComposer agents={[]} />);
    expect(screen.getByTestId("composer-send")).toBeDisabled();
    expect(screen.getByTestId("composer-target")).toHaveTextContent(/no agent/i);
  });

  it("keeps the text when sending fails, so the user does not lose it", async () => {
    replyToAgent.mockResolvedValue(false);
    render(<RailComposer agents={agents} />);
    await userEvent.type(screen.getByTestId("composer-input"), "important");
    await userEvent.click(screen.getByTestId("composer-send"));
    await waitFor(() => expect(replyToAgent).toHaveBeenCalled());
    expect(screen.getByTestId("composer-input")).toHaveValue("important");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/components/RailComposer.test.tsx`
Expected: FAIL — cannot resolve `./RailComposer`.

- [ ] **Step 3: Write the composer**

Create `src/components/RailComposer.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import { fetchPendingReplies, replyToAgent } from "../api/agents";
import type { Agent } from "../types";

/** How often to re-check whether the agent has collected its replies. */
const PENDING_POLL_MS = 5000;

export function RailComposer({ agents }: { agents: Agent[] }) {
  const target = agents[0] ?? null;
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(0);
  const [sending, setSending] = useState(false);

  const refreshPending = useCallback(async () => {
    if (!target) return;
    setPending(await fetchPendingReplies(target.id));
  }, [target]);

  // Poll rather than listen: the agent draining its inbox happens on the agent's
  // side, and nothing pushes that back to us.
  useEffect(() => {
    void refreshPending();
    const id = window.setInterval(() => void refreshPending(), PENDING_POLL_MS);
    return () => window.clearInterval(id);
  }, [refreshPending]);

  const send = async () => {
    const message = draft.trim();
    if (!target || !message || sending) return;

    setSending(true);
    const ok = await replyToAgent(target.id, message);
    setSending(false);

    // Only clear on success — losing what they typed to a failed request is
    // worse than making them press send again.
    if (ok) {
      setDraft("");
      void refreshPending();
    }
  };

  return (
    <div
      className="shrink-0 px-2 py-2 flex flex-col gap-1"
      style={{ borderTop: "1px solid var(--hub-hair)" }}
    >
      <div className="flex items-center gap-1.5">
        <span
          data-testid="composer-target"
          className="text-[10.5px] font-semibold shrink-0 rounded px-1.5 py-0.5"
          style={{
            background: target ? "rgba(10,132,255,0.2)" : "var(--hub-surface)",
            color: target ? "#9ecbff" : "var(--hub-text-muted)",
          }}
        >
          {target ? `@${target.name}` : "No agent connected"}
        </span>

        <input
          data-testid="composer-input"
          value={draft}
          disabled={!target}
          placeholder="Reply…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void send();
            }
          }}
          className="flex-1 min-w-0 text-[11.5px] rounded-md px-2 py-1"
          style={{
            background: "rgba(0,0,0,0.24)",
            border: 0,
            boxShadow: "inset 0 0 0 1px var(--hub-hair)",
            color: "var(--hub-text)",
            outline: "none",
          }}
        />

        <button
          data-testid="composer-send"
          type="button"
          disabled={!target || sending}
          onClick={() => void send()}
          className="shrink-0 grid place-items-center rounded-md text-[12px]"
          style={{
            width: 24,
            height: 24,
            border: 0,
            background: target ? "var(--hub-accent)" : "var(--hub-surface)",
            color: target ? "var(--hub-accent-text)" : "var(--hub-text-muted)",
            cursor: target ? "pointer" : "default",
          }}
          aria-label="Send reply"
        >
          &uarr;
        </button>
      </div>

      {pending > 0 && (
        <span
          data-testid="composer-queued"
          className="text-[9.5px] flex items-center gap-1.5 px-1"
          style={{ color: "var(--hub-text-muted)" }}
        >
          <span
            aria-hidden="true"
            style={{ width: 5, height: 5, borderRadius: 999, background: "#eab308" }}
          />
          {pending} queued — collected on the agent's next check-in
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/components/RailComposer.test.tsx`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/RailComposer.tsx src/components/RailComposer.test.tsx
git commit -m "feat: rail composer with a queued-reply indicator"
```

---

### Task 9: The Agents pane

**Files:**
- Create: `src/components/AgentsPane.tsx`
- Create: `src/components/AgentsPane.test.tsx`

**Interfaces:**
- Consumes: `fetchConnectionInfo`, `setAgentEnabled` (Task 3), store agents/apps (Task 4), `AppIcon` (Task 6).
- Produces: `AgentsPane()` with `data-testid` values `agents-endpoint`, `agents-token`, `agents-prompt`, `agent-row`, and copy buttons labelled by what they copy.

- [ ] **Step 1: Write the failing test**

Create `src/components/AgentsPane.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchConnectionInfo, setAgentEnabled } = vi.hoisted(() => ({
  fetchConnectionInfo: vi.fn(),
  setAgentEnabled: vi.fn(),
}));
vi.mock("../api/agents", () => ({ fetchConnectionInfo, setAgentEnabled }));

import { AgentsPane } from "./AgentsPane";
import { useHubStore } from "../stores/hubStore";

const connection = {
  endpoint: "http://127.0.0.1:9400/mcp",
  token: "hive_ag_abc123",
  promptBlock: "You are connected to Claude Hive… agent_post … agent_inbox",
};

describe("AgentsPane", () => {
  beforeEach(() => {
    fetchConnectionInfo.mockReset().mockResolvedValue(connection);
    setAgentEnabled.mockReset().mockResolvedValue(true);
    useHubStore.setState({
      agents: [
        {
          id: "a1",
          name: "Grok",
          version: "2.1",
          connectedAt: "",
          lastSeen: "",
          enabled: true,
        },
      ],
      agentApps: [
        { agentId: "a1", agentName: "Grok", id: "gmail", label: "Gmail", health: "ok" },
      ],
    });
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  });

  it("shows the endpoint the server is actually listening on", async () => {
    render(<AgentsPane />);
    await waitFor(() =>
      expect(screen.getByTestId("agents-endpoint")).toHaveTextContent("http://127.0.0.1:9400/mcp")
    );
  });

  it("shows a token and the prompt block", async () => {
    render(<AgentsPane />);
    await waitFor(() => expect(screen.getByTestId("agents-token")).toBeInTheDocument());
    expect(screen.getByTestId("agents-prompt")).toHaveTextContent("agent_post");
  });

  it("copies the token to the clipboard", async () => {
    render(<AgentsPane />);
    await waitFor(() => expect(screen.getByTestId("agents-token")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /copy token/i }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("hive_ag_abc123");
  });

  it("lists connected agents with their apps", async () => {
    render(<AgentsPane />);
    await waitFor(() => expect(screen.getByTestId("agent-row")).toBeInTheDocument());
    expect(screen.getByText("Grok")).toBeInTheDocument();
    expect(screen.getByText(/1 app/i)).toBeInTheDocument();
  });

  it("mutes an agent", async () => {
    render(<AgentsPane />);
    await waitFor(() => expect(screen.getByTestId("agent-row")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /mute grok/i }));
    expect(setAgentEnabled).toHaveBeenCalledWith("a1", false);
  });

  it("explains that connecting alone is not enough", async () => {
    // The single most important thing in this pane: an agent that is merely
    // connected posts nothing.
    render(<AgentsPane />);
    await waitFor(() => expect(screen.getByTestId("agents-prompt")).toBeInTheDocument());
    expect(screen.getByText(/paste/i)).toBeInTheDocument();
  });

  it("says so when no agent has ever connected", async () => {
    useHubStore.setState({ agents: [], agentApps: [] });
    render(<AgentsPane />);
    await waitFor(() => expect(screen.getByTestId("agents-endpoint")).toBeInTheDocument());
    expect(screen.getByText(/no agents connected yet/i)).toBeInTheDocument();
  });

  it("degrades to a message when the server is unreachable", async () => {
    fetchConnectionInfo.mockResolvedValue(null);
    render(<AgentsPane />);
    await waitFor(() => expect(screen.getByText(/could not reach hive/i)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/components/AgentsPane.test.tsx`
Expected: FAIL — cannot resolve `./AgentsPane`.

- [ ] **Step 3: Write the pane**

Create `src/components/AgentsPane.tsx`:

```tsx
import { useEffect, useState } from "react";
import { fetchConnectionInfo, setAgentEnabled } from "../api/agents";
import { useHubStore } from "../stores/hubStore";
import { AppIcon } from "./AppIcon";
import type { ConnectionInfo } from "../types";

function CopyButton({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        } catch (err) {
          // A denied clipboard should not look like a broken button.
          console.error("[hive] clipboard write failed:", err);
        }
      }}
      className="shrink-0 text-[10.5px] rounded px-1.5 py-0.5"
      style={{
        background: "var(--hub-surface)",
        border: 0,
        color: "var(--hub-text)",
        cursor: "pointer",
      }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export function AgentsPane() {
  const agents = useHubStore((s) => s.agents);
  const agentApps = useHubStore((s) => s.agentApps);
  const [connection, setConnection] = useState<ConnectionInfo | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void fetchConnectionInfo().then((info) => {
      setConnection(info);
      setLoaded(true);
    });
  }, []);

  if (loaded && !connection) {
    return (
      <div className="p-3 text-[11px]" style={{ color: "var(--hub-text-muted)" }}>
        Could not reach Hive to read the connection details.
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-3">
      <section className="flex flex-col gap-1.5">
        <h2
          className="text-[10px] font-semibold uppercase tracking-wide px-1"
          style={{ color: "var(--hub-text-dim)" }}
        >
          Connect an agent
        </h2>

        <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg" style={{ background: "var(--hub-surface)" }}>
          <span className="min-w-0 flex-1">
            <span className="block text-[11px]" style={{ color: "var(--hub-text)" }}>
              MCP endpoint
            </span>
            <span
              data-testid="agents-endpoint"
              className="block text-[10px] font-mono truncate"
              style={{ color: "var(--hub-text-muted)" }}
            >
              {connection?.endpoint ?? "…"}
            </span>
          </span>
          {connection && <CopyButton label="Copy endpoint" value={connection.endpoint} />}
        </div>

        {connection?.token && (
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg" style={{ background: "var(--hub-surface)" }}>
            <span className="min-w-0 flex-1">
              <span className="block text-[11px]" style={{ color: "var(--hub-text)" }}>
                Token
              </span>
              <span
                data-testid="agents-token"
                className="block text-[10px] font-mono truncate"
                style={{ color: "var(--hub-text-muted)" }}
              >
                {connection.token}
              </span>
            </span>
            <CopyButton label="Copy token" value={connection.token} />
          </div>
        )}

        {connection && (
          <div className="flex flex-col gap-1 px-2 py-1.5 rounded-lg" style={{ background: "var(--hub-surface)" }}>
            <span className="flex items-center gap-2">
              <span className="min-w-0 flex-1">
                <span className="block text-[11px]" style={{ color: "var(--hub-text)" }}>
                  Prompt block
                </span>
                <span className="block text-[10px]" style={{ color: "var(--hub-text-muted)" }}>
                  Paste into the agent's own instructions. Connecting alone will not
                  make it post — it has the tools, not the intent.
                </span>
              </span>
              <CopyButton label="Copy prompt block" value={connection.promptBlock} />
            </span>
            <pre
              data-testid="agents-prompt"
              className="text-[9.5px] leading-snug whitespace-pre-wrap rounded p-2 m-0 max-h-32 overflow-y-auto"
              style={{ background: "rgba(0,0,0,0.24)", color: "var(--hub-text-muted)" }}
            >
              {connection.promptBlock}
            </pre>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-1.5">
        <h2
          className="text-[10px] font-semibold uppercase tracking-wide px-1"
          style={{ color: "var(--hub-text-dim)" }}
        >
          Connected
        </h2>

        {agents.length === 0 && (
          <span className="text-[11px] px-2 py-1" style={{ color: "var(--hub-text-muted)" }}>
            No agents connected yet. They appear here on their first handshake — there
            is nothing to register.
          </span>
        )}

        {agents.map((agent) => {
          const apps = agentApps.filter((a) => a.agentId === agent.id);
          return (
            <div
              key={agent.id}
              data-testid="agent-row"
              className="flex items-center gap-2 px-2 py-1.5 rounded-lg"
              style={{ background: "var(--hub-surface)" }}
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[12px] font-semibold" style={{ color: "var(--hub-text)" }}>
                  {agent.name}
                </span>
                <span className="block text-[10px]" style={{ color: "var(--hub-text-muted)" }}>
                  {apps.length} app{apps.length === 1 ? "" : "s"}
                  {agent.version ? ` · v${agent.version}` : ""}
                </span>
              </span>

              <span className="flex items-center gap-1 shrink-0">
                {apps.slice(0, 4).map((app) => (
                  <AppIcon key={app.id} slug={app.id} label={app.label} size={12} />
                ))}
              </span>

              <button
                type="button"
                aria-label={`${agent.enabled ? "Mute" : "Unmute"} ${agent.name}`}
                onClick={() => void setAgentEnabled(agent.id, !agent.enabled)}
                className="shrink-0 text-[10.5px] rounded px-1.5 py-0.5"
                style={{
                  background: "var(--hub-surface)",
                  border: 0,
                  color: "var(--hub-text-muted)",
                  cursor: "pointer",
                }}
              >
                {agent.enabled ? "Mute" : "Unmute"}
              </button>
            </div>
          );
        })}
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/components/AgentsPane.test.tsx`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/AgentsPane.tsx src/components/AgentsPane.test.tsx
git commit -m "feat: agents pane with endpoint, token and prompt block"
```

---

### Task 10: Wire it into the rail and load the data

**Files:**
- Modify: `src/Rail.tsx`
- Modify: `src/components/RailPanel.tsx`
- Create: `src/hooks/useAgentData.ts`
- Create: `src/hooks/useAgentData.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: `useAgentData()` — fetches agents, apps and posts once on mount and pushes them into the store; `Rail` gains a two-tab switch between the feed and the Agents pane.

- [ ] **Step 1: Write the failing test**

Create `src/hooks/useAgentData.test.ts`:

```ts
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchAgents, fetchAgentApps, fetchAgentPosts } = vi.hoisted(() => ({
  fetchAgents: vi.fn(),
  fetchAgentApps: vi.fn(),
  fetchAgentPosts: vi.fn(),
}));
vi.mock("../api/agents", () => ({ fetchAgents, fetchAgentApps, fetchAgentPosts }));

import { useAgentData } from "./useAgentData";
import { useHubStore } from "../stores/hubStore";

describe("useAgentData", () => {
  beforeEach(() => {
    fetchAgents.mockReset().mockResolvedValue([
      { id: "a1", name: "Grok", version: null, connectedAt: "", lastSeen: "", enabled: true },
    ]);
    fetchAgentApps.mockReset().mockResolvedValue([
      { agentId: "a1", agentName: "Grok", id: "gmail", label: "Gmail", health: "ok" },
    ]);
    fetchAgentPosts.mockReset().mockResolvedValue([]);
    useHubStore.setState({ agents: [], agentApps: [], agentPosts: [] });
  });

  it("loads agents, apps and posts into the store", async () => {
    renderHook(() => useAgentData());
    await waitFor(() => expect(useHubStore.getState().agents).toHaveLength(1));
    expect(useHubStore.getState().agentApps).toHaveLength(1);
    expect(fetchAgentPosts).toHaveBeenCalled();
  });

  it("fetches once, not on every render", async () => {
    const { rerender } = renderHook(() => useAgentData());
    await waitFor(() => expect(fetchAgents).toHaveBeenCalledTimes(1));
    rerender();
    rerender();
    expect(fetchAgents).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/hooks/useAgentData.test.ts`
Expected: FAIL — cannot resolve `./useAgentData`.

- [ ] **Step 3: Write the hook**

Create `src/hooks/useAgentData.ts`:

```ts
import { useEffect } from "react";
import { fetchAgentApps, fetchAgentPosts, fetchAgents } from "../api/agents";
import { useHubStore } from "../stores/hubStore";

/**
 * Seed the agent state once on mount.
 *
 * Live updates arrive over the websocket after this; the initial fetch exists
 * because the rail's webview is created at app startup and may connect after an
 * agent has already posted. Deduplication on post id in the store keeps the two
 * sources from doubling a row.
 */
export function useAgentData() {
  const setAgents = useHubStore((s) => s.setAgents);
  const setAgentApps = useHubStore((s) => s.setAgentApps);
  const setAgentPosts = useHubStore((s) => s.setAgentPosts);

  useEffect(() => {
    void (async () => {
      const [agents, apps, posts] = await Promise.all([
        fetchAgents(),
        fetchAgentApps(),
        fetchAgentPosts(),
      ]);
      setAgents(agents);
      setAgentApps(apps);
      setAgentPosts(posts);
    })();
  }, [setAgents, setAgentApps, setAgentPosts]);
}
```

- [ ] **Step 4: Add the composer and the pane switch**

In `src/components/RailPanel.tsx`, render `<RailComposer agents={agents} />` at the bottom, reading `agents` from the store.

In `src/Rail.tsx`, call `useAgentData()` beside `useTheme()` and `useWebSocket()`, hold `const [pane, setPane] = useState<"feed" | "agents">("feed")`, and render a small two-button switch in the panel header plus `{pane === "feed" ? <RailPanel /> : <AgentsPane />}`.

- [ ] **Step 5: Run the whole suite**

Run: `pnpm vitest run`
Expected: all suites pass. Then `pnpm build` — clean.

- [ ] **Step 6: Verify against a live agent**

This is the end-to-end check, and it reuses phase 3a's transcript as the driver.

```bash
cd src-tauri
CLAUDE_HIVE_PORT=9456 ./target/debug/claude-hive.exe &
```

Then, with the rail open, run the handshake, `agent_apps_sync` and `agent_post` calls from `src-tauri/tests/agent_ingest.md` against port 9456 and confirm on screen:

1. The apps bar fills with Gmail, X and Linear, Linear showing a degraded dot.
2. Posts appear in the feed, tagged **Agent**, monochrome, interleaved with sessions.
3. Clicking an app filters to it; clicking it again clears the filter.
4. A blocked Claude session stays above a newer agent post.
5. Typing a reply and sending shows the queued line; running `agent_inbox` clears it within ~5s.
6. The Agents pane shows the endpoint on **9456**, a token, the prompt block, and Grok with its app count.

- [ ] **Step 7: Commit**

```bash
git add src/Rail.tsx src/components/RailPanel.tsx src/hooks/useAgentData.ts src/hooks/useAgentData.test.ts
git commit -m "feat: load agent data and switch between feed and agents pane"
```

---

## Self-review

**Spec coverage.** Permanent apps bar → Task 6, rendered by `RailPanel` so it is present on both the feed and per-app views. One merged feed → Tasks 5 and 7. Per-app feed → Task 5's `appId` option plus Task 6's selection. Agents render monochrome with a text tag → Task 7. Two-way replies with a visible queue → Task 8. Agents pane with endpoint, token, prompt block and a per-agent kill switch → Task 9. Icons, two layers, no network → Task 2. Waiting-sessions-on-top → Task 5's `pinAttention`.

**Deferred, and where each lands.** Tasks pane and its persistence → phase 4. Combined mode, the rail settings UI, and `Add unknown apps automatically` → phase 5 (that switch belongs with the other settings, and only means something once the bar exists). `agent_ask` → needs `QuestionStore` generalised past session ids. `Show in All activity` per app is **not** built: it needs somewhere to persist a per-app preference, which is phase 5's settings store — flagged rather than dropped silently.

**Placeholder scan.** No TBD or "add error handling". Every code step carries its code. Task 10 step 6 is a manual check and says so, and it reuses the phase 3a transcript rather than inventing a new procedure.

**Type consistency.** `AgentAppRow extends AgentApp` matches the Rust `#[serde(flatten)]` on `AgentAppRow`, so `row.id` is the app slug — the tests assert exactly that shape. `postType` uses the existing `MessageType`, not a parallel enum. `FeedRow`'s `at` is a plain ISO string compared with `localeCompare`, which is why Task 5 tests an empty timestamp rather than assuming `Date` parsing. `resolveAppIcon(slug, label?)` has the same signature at all three call sites (`AppIcon`, `ConnectedAppsBar`, and the bar's background colour). `fetchPendingReplies` returns `number`, unwrapped from `{ pending }` inside the client so no component sees the envelope.

**One risk worth naming.** Task 8 polls `/api/agents/{id}/pending` every 5 seconds while the rail is open. That is cheap and local, but it is a second poller alongside phase 2's cursor-follow. If a third appears, they should be consolidated rather than multiplied.

## Execution handoff

Phase 4 (Tasks, with the first disk-persisted store) gets its own plan once this is verified on screen.
