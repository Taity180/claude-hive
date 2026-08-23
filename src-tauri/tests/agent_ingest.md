# Agent ingest — end-to-end verification

Phase 3a task 8. The unit tests cover every branch in isolation; this proves the
wiring, against a real HTTP client talking to a running Hive.

Run on Windows 11, 2026-08-23, commit `f7ced11` + task 8.

```bash
cd src-tauri
CLAUDE_HIVE_PORT=9456 ./target/debug/claude-hive.exe &
```

The default port is 9400 and a running Hive holds it with `.expect()`, so a
second instance must use another port or it panics on startup.

**Before trusting any of this, confirm the binary is the one you just built.**
A stale binary cost real time during phase 2:

```
$ grep -qa agent_apps_sync target/debug/claude-hive.exe && echo PRESENT
PRESENT
```

## 1. Connection info — what the Agents pane will show

```
$ curl -s http://127.0.0.1:9456/api/agents/connection
endpoint  : http://127.0.0.1:9456/mcp
token     : hive_ag_1dba730b8d85...
prompt has agent_post: True
```

The endpoint reflects `CLAUDE_HIVE_PORT`, not a constant. The mockups said
`4317`; handing the user a URL nothing is listening on would be a dead end.

## 2. Auth is enforced

```
no header    : 401
wrong token  : 401
basic auth   : 401

agents after failed attempts: []
```

A rejected call creates nothing.

## 3. Handshake — the agent names itself

```
$ ... -d '{"jsonrpc":"2.0","id":1,"method":"initialize",
           "params":{"clientInfo":{"name":"Grok","version":"2.1"}}}'

protocolVersion : 2024-11-05
serverInfo.name : claude-hive-agents
instructions    : 605 chars, mentions agent_post = True

$ curl -s .../api/agents
name    : Grok
version : 2.1
enabled : True
```

Two things confirmed here that the design depends on:

- **No registration step.** The agent appeared by completing a handshake.
- **`instructions` are returned.** This is one of only two mechanisms that make
  an agent post at all — MCP grants the ability to call tools, never the intent.

## 4. Tools advertised

```
- agent_apps_sync
- agent_post
- agent_inbox
```

No `hub_*` tools: the session tools are not an agent's business.

## 5. Apps and posts

```
$ agent_apps_sync [gmail, x, linear(degraded)]  →  "3 app(s) recorded."
$ agent_post "Tauri v3 alpha dropped…"  app_id=x  →  "Posted."
$ agent_post "Found 2 tasks in the Xero invoicing thread"  app_id=gmail

$ curl -s .../api/agents/apps
  gmail    Gmail    health=ok        via Grok
  x        X        health=ok        via Grok
  linear   Linear   health=degraded  via Grok

$ curl -s .../api/agents/posts
  [gmail] Grok: Found 2 tasks in the Xero invoicing thread
  [x]     Grok: Tauri v3 alpha dropped - window positioning API ch…

$ curl -s '.../api/agents/posts?appId=x'
  count: 1
```

Newest first, and per-app filtering works.

### apps_sync replaces, it does not merge

```
$ agent_apps_sync [gmail]  →  "1 app(s) recorded."
$ curl -s .../api/agents/apps
  apps now: ['gmail']
```

`x` and `linear` are gone. This is the whole point: an app the agent stops
reporting has disconnected, and a merge could never express that.

Note that the earlier post attributed to `x` still exists. Posts are history;
removing an app does not rewrite what already happened.

## 6. Reply round-trip

```
queue reply    : 202
empty reply    : 400
unknown agent  : 404

first  agent_inbox : "1 reply/replies from the user: | - dig into the tauri change"
second agent_inbox : "No replies waiting."
```

The drain is destructive on purpose. MCP is request/response, so this is the
only way a reply reaches an agent, and an agent that polls twice must not act
on the same instruction twice.

## 7. Mute actually stops it

```
$ PUT .../api/agents/{id}/enabled {"enabled":false}
$ agent_post "should be refused"
  isError: True | "This agent is muted in Hive. Nothing you post will be shown…"

post count still: 2
```

Reported as a tool error rather than a JSON-RPC error, so the model can read
why and stop trying.

## 8. The token survives a restart

```
  before restart: hive_ag_1dba730b8d8540adbc48...
  after  restart: hive_ag_1dba730b8d8540adbc48...
  RESULT: IDENTICAL — a configured agent keeps working
```

This is why tokens are persisted ahead of phase 4's store: the user pastes the
token into their agent once, and regenerating it on every restart would break
every agent they had set up, silently.

```
  agents after restart: 0
  posts  after restart: 0
```

Expected. Agents and posts are in-memory in this phase, so the pane is empty
until each agent's next handshake. Task persistence arrives in phase 4; whether
feed history should join it is still open.

## Not covered

- `agent_ask` — deferred; `QuestionStore` is keyed by session id.
- Auto-adding an undeclared app on first post. `agent_post` accepts an `app_id`
  that was never declared and keeps it on the post, but no app row appears. The
  setting for this belongs with phase 3b's UI, where there is a bar to be
  missing from.
- Everything visual — phase 3b.
