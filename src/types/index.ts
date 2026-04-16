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
    };

export type ViewState = "collapsed" | "expanded" | "session-detail" | "settings";
export type SessionViewMode = "grid" | "list" | "detailed";
