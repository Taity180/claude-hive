import { create } from "zustand";
import type { Agent, AgentAppRow, AgentPost, Session, Message, PlanUsageSnapshot, Question, UsageSnapshot, ViewState, WsEvent } from "../types";

// Minimum sensible height for the expanded dashboard. Guards against a bad
// value being persisted (e.g. someone resized the window to almost nothing
// before collapsing) and then being restored on expand.
export const MIN_EXPANDED_HEIGHT = 200;
// Default height used when we have no record of the user's previous size.
// Must match the initial height in tauri.conf.json so first-collapse → first-expand
// returns the window to its startup dimensions.
export const DEFAULT_EXPANDED_HEIGHT = 520;

interface HubState {
  sessions: Session[];
  messages: Record<string, Message[]>;
  /** The unanswered question per session, if it has one. */
  questions: Record<string, Question>;
  /** Token usage read from Claude Code transcripts, or null before first load. */
  usage: UsageSnapshot | null;
  /** Plan rate-limit windows, or null before the first poll. */
  planUsage: PlanUsageSnapshot | null;
  /** Whether the usage breakdown panel is showing. */
  usagePanelOpen: boolean;
  /**
   * Measured height of that panel, so a collapsed window can grow to fit it.
   * While collapsed the window is sized to hug its content, so an overlay has
   * to be accounted for or the OS window clips it.
   */
  usagePanelHeight: number;
  viewState: ViewState;
  activeSessionId: string | null;
  unreadSessions: Set<string>;
  expandedHeight: number;

  /** External MCP agents that have completed a handshake. */
  agents: Agent[];
  /** Every declared app across every agent, for the apps bar. */
  agentApps: AgentAppRow[];
  /** Newest first. */
  agentPosts: AgentPost[];

  setViewState: (view: ViewState) => void;
  setActiveSession: (sessionId: string | null) => void;
  setExpandedHeight: (height: number) => void;
  handleWsEvent: (event: WsEvent) => void;
  addUserMessage: (sessionId: string, message: Message) => void;
  setSessions: (sessions: Session[]) => void;
  setMessages: (sessionId: string, messages: Message[]) => void;
  setPendingQuestions: (questions: Question[]) => void;
  setUsage: (usage: UsageSnapshot) => void;
  setPlanUsage: (usage: PlanUsageSnapshot) => void;
  setUsagePanelOpen: (open: boolean) => void;
  setUsagePanelHeight: (height: number) => void;
  renameSession: (sessionId: string, name: string | null) => void;
  clearMessages: (sessionId: string) => void;
  setAgents: (agents: Agent[]) => void;
  setAgentApps: (apps: AgentAppRow[]) => void;
  setAgentPosts: (posts: AgentPost[]) => void;
}

/** Drop one session's question from the map. */
function withoutQuestion(
  questions: Record<string, Question>,
  sessionId: string,
): Record<string, Question> {
  const { [sessionId]: _removed, ...rest } = questions;
  return rest;
}

export const useHubStore = create<HubState>((set) => ({
  sessions: [],
  messages: {},
  questions: {},
  usage: null,
  planUsage: null,
  usagePanelOpen: false,
  usagePanelHeight: 0,
  viewState: "collapsed",
  activeSessionId: null,
  unreadSessions: new Set(),
  agents: [],
  agentApps: [],
  agentPosts: [],
  expandedHeight: DEFAULT_EXPANDED_HEIGHT,

  setViewState: (viewState) =>
    set({ viewState, usagePanelOpen: false, usagePanelHeight: 0 }),

  setExpandedHeight: (height) =>
    set({ expandedHeight: Math.max(MIN_EXPANDED_HEIGHT, height) }),

  setActiveSession: (activeSessionId) =>
    set((state) => ({
      activeSessionId,
      usagePanelOpen: false,
      usagePanelHeight: 0,
      viewState: activeSessionId ? "session-detail" : "expanded",
      // Clear unread when user clicks into a session
      unreadSessions: activeSessionId
        ? new Set([...state.unreadSessions].filter((id) => id !== activeSessionId))
        : state.unreadSessions,
    })),

  setSessions: (sessions) => set({ sessions }),

  setMessages: (sessionId, messages) =>
    set((state) => ({
      messages: { ...state.messages, [sessionId]: messages },
    })),

  setPendingQuestions: (questions) =>
    set({
      questions: Object.fromEntries(questions.map((q) => [q.sessionId, q])),
    }),

  setUsage: (usage) => set({ usage }),

  setPlanUsage: (planUsage) => set({ planUsage }),

  setUsagePanelOpen: (usagePanelOpen) =>
    // Closing always releases the height the panel had reserved. A stale value
    // would leave the collapsed window sized for a panel that is gone.
    set(usagePanelOpen ? { usagePanelOpen } : { usagePanelOpen, usagePanelHeight: 0 }),

  setUsagePanelHeight: (usagePanelHeight) => set({ usagePanelHeight }),

  addUserMessage: (sessionId, message) =>
    set((state) => ({
      messages: {
        ...state.messages,
        [sessionId]: [...(state.messages[sessionId] ?? []), message],
      },
    })),

  renameSession: (sessionId, name) =>
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === sessionId ? { ...s, customName: name } : s
      ),
    })),

  clearMessages: (sessionId) =>
    set((state) => ({
      messages: { ...state.messages, [sessionId]: [] },
    })),

  setAgents: (agents) => set({ agents }),
  setAgentApps: (agentApps) => set({ agentApps }),
  setAgentPosts: (agentPosts) => set({ agentPosts }),

  handleWsEvent: (event) =>
    set((state) => {
      switch (event.type) {
        case "sessionConnected":
          return {
            sessions: state.sessions.some((s) => s.id === event.session.id)
              ? state.sessions
              : [...state.sessions, event.session],
          };

        case "sessionDisconnected":
          return {
            sessions: state.sessions.filter((s) => s.id !== event.sessionId),
            messages: Object.fromEntries(
              Object.entries(state.messages).filter(
                ([id]) => id !== event.sessionId
              )
            ),
            questions: withoutQuestion(state.questions, event.sessionId),
            unreadSessions: new Set(
              [...state.unreadSessions].filter((id) => id !== event.sessionId)
            ),
          };

        case "statusChanged":
          return {
            sessions: state.sessions.map((s) =>
              s.id === event.sessionId
                ? { ...s, status: event.status, statusDetail: event.detail }
                : s
            ),
          };

        case "newMessage": {
          const existing = state.messages[event.message.sessionId] ?? [];
          if (existing.some((m) => m.id === event.message.id)) {
            return {};
          }
          // Mark as unread if the message is from the session (not from user)
          // and the user isn't currently viewing this session
          const sessionId = event.message.sessionId;
          const isViewingThis = state.activeSessionId === sessionId && state.viewState === "session-detail";
          const isFromSession = event.message.from === "session" || event.message.from === "broadcast";
          const newUnread = isFromSession && !isViewingThis
            ? new Set([...state.unreadSessions, sessionId])
            : state.unreadSessions;

          return {
            messages: {
              ...state.messages,
              [sessionId]: [...existing, event.message],
            },
            unreadSessions: newUnread,
          };
        }

        case "notification": {
          // With native toasts gone, an unread pill is how a notification gets
          // noticed. The body is also persisted to the feed server-side.
          const isViewingThis =
            state.activeSessionId === event.sessionId &&
            state.viewState === "session-detail";
          return isViewingThis
            ? {}
            : { unreadSessions: new Set([...state.unreadSessions, event.sessionId]) };
        }

        case "questionAsked": {
          const { question } = event;
          // A question always deserves attention, even if the user happens to
          // be looking at another session.
          const isViewingThis =
            state.activeSessionId === question.sessionId &&
            state.viewState === "session-detail";
          return {
            questions: { ...state.questions, [question.sessionId]: question },
            unreadSessions: isViewingThis
              ? state.unreadSessions
              : new Set([...state.unreadSessions, question.sessionId]),
          };
        }

        case "agentConnected": {
          const known = state.agents.some((a) => a.id === event.agent.id);
          return {
            agents: known
              ? state.agents.map((a) => (a.id === event.agent.id ? event.agent : a))
              : [...state.agents, event.agent],
          };
        }

        case "agentPosted": {
          // A live event can arrive for a post the initial fetch already
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

        case "questionAnswered": {
          // Ignore an answer for a question that has already been superseded,
          // otherwise a late event would clear the newer prompt.
          const current = state.questions[event.sessionId];
          if (!current || current.id !== event.questionId) return {};
          return { questions: withoutQuestion(state.questions, event.sessionId) };
        }

        default:
          return {};
      }
    }),
}));
