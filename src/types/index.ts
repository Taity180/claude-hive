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
  /** Estimated cost of `total` at published rates — never a bill. */
  estimatedCostUsd: number | null;
  lastActivity: string | null;
}

export interface DailyUsage {
  /** Local date, YYYY-MM-DD. */
  date: string;
  tokens: number;
  /** False for days read from Claude Code's stats cache, which lags a day. */
  live: boolean;
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
    };

export type ViewState = "collapsed" | "expanded" | "session-detail" | "settings";
export type SessionViewMode = "grid" | "list" | "detailed";
