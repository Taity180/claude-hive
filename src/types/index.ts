export type SessionStatus =
  | "running"
  | "waiting_for_input"
  | "thinking"
  | "error"
  | "idle";

export interface Session {
  id: string;
  projectName: string;
  customName: string | null;
  workingDirectory: string;
  gitBranch: string | null;
  status: SessionStatus;
  statusDetail: string | null;
  connectedAt: string;
  lastActivity: string;
  windowHandle: number | null;
  /** Claude Code's own session id, reported by a hook. Joins to token usage. */
  claudeSessionId: string | null;
}

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}

export interface SessionUsage {
  claudeSessionId: string;
  model: string | null;
  /** Size of the prompt sent for the latest turn — how full the window is. */
  contextTokens: number;
  /** The model's context window, or null when we don't know it. */
  contextLimit: number | null;
  total: TokenUsage;
  /** This session's share of today. */
  today: TokenUsage;
  /** Estimated cost of input + output at published rates — never a bill. */
  estimatedCostUsd: number | null;
  /** The same with cache priced in (reads 0.1x, writes 1.25x). */
  estimatedCostWithCacheUsd: number | null;
  lastActivity: string | null;
}

export interface DailyUsage {
  /** Local date, YYYY-MM-DD. */
  date: string;
  tokens: number;
  /** False for days read from Claude Code's stats cache, which lags a day. */
  live: boolean;
}

export interface UsageWindow {
  /** 0-100. */
  utilization: number | null;
  resetsAt: string | null;
}

export interface PlanUsage {
  fiveHour: UsageWindow | null;
  sevenDay: UsageWindow | null;
  sevenDayOpus: UsageWindow | null;
  sevenDaySonnet: UsageWindow | null;
  extraUsage: {
    isEnabled: boolean;
    monthlyLimit: number | null;
    usedCredits: number | null;
    utilization: number | null;
    currency: string | null;
  } | null;
}

export type PlanUsageStatus = "ok" | "notLoggedIn" | "expired" | "unavailable" | "pending";

export interface PlanUsageSnapshot {
  status: PlanUsageStatus;
  usage: PlanUsage | null;
  fetchedAt: string | null;
}

export interface UsageSnapshot {
  sessions: SessionUsage[];
  /** Today across every Claude Code session on this machine. */
  today: TokenUsage;
  /** Today across just the sessions connected to the hive. */
  todayConnected: TokenUsage;
  /** Last 7 days, oldest first. */
  days: DailyUsage[];
  /** Estimated cost of today's usage, or null if nothing could be priced. */
  todayCostUsd: number | null;
  scannedAt: string | null;
}

export type MessageType = "info" | "question" | "completion" | "error";
export type MessageFrom = "user" | "session" | "broadcast";

export interface Message {
  id: string;
  sessionId: string;
  from: MessageFrom;
  fromSessionName: string | null;
  content: string;
  messageType: MessageType;
  timestamp: string;
  read: boolean;
}

/**
 * A multiple-choice question a session is blocked on. The session's `hub_ask`
 * tool call stays open until `answer` is filled in, so answering one from the
 * dashboard is what unblocks the session.
 */
export interface Question {
  id: string;
  sessionId: string;
  question: string;
  options: string[];
  multiSelect: boolean;
  askedAt: string;
  answer: string[] | null;
  answeredAt: string | null;
}

export type NotifyPriority = "low" | "normal" | "high";

export type WsEvent =
  | { type: "sessionConnected"; session: Session }
  | { type: "sessionDisconnected"; sessionId: string }
  | {
      type: "statusChanged";
      sessionId: string;
      status: SessionStatus;
      detail: string | null;
    }
  | { type: "newMessage"; message: Message }
  | {
      type: "notification";
      sessionId: string;
      title: string;
      body: string;
      priority: NotifyPriority;
    }
  | { type: "questionAsked"; question: Question }
  | {
      type: "questionAnswered";
      sessionId: string;
      questionId: string;
      answer: string[];
    }
  | { type: "agentConnected"; agent: Agent }
  | { type: "agentAppsChanged"; agentId: string; apps: AgentApp[] }
  | { type: "agentPosted"; post: AgentPost };

export type ViewState = "collapsed" | "expanded" | "session-detail" | "settings";
export type SessionViewMode = "grid" | "list" | "detailed";

// ── External MCP agents ────────────────────────────────────────────────
// Shapes mirror src-tauri/src/models/agent.rs. Verified against a live
// server in src-tauri/tests/agent_ingest.md.

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
