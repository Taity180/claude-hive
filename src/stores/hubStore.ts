import { create } from "zustand";
import type { Session, Message, ViewState, WsEvent } from "../types";

interface HubState {
  sessions: Session[];
  messages: Record<string, Message[]>;
  viewState: ViewState;
  activeSessionId: string | null;
  unreadSessions: Set<string>;

  setViewState: (view: ViewState) => void;
  setActiveSession: (sessionId: string | null) => void;
  handleWsEvent: (event: WsEvent) => void;
  addUserMessage: (sessionId: string, message: Message) => void;
  setSessions: (sessions: Session[]) => void;
  setMessages: (sessionId: string, messages: Message[]) => void;
  renameSession: (sessionId: string, name: string | null) => void;
  clearMessages: (sessionId: string) => void;
}

export const useHubStore = create<HubState>((set) => ({
  sessions: [],
  messages: {},
  viewState: "collapsed",
  activeSessionId: null,
  unreadSessions: new Set(),

  setViewState: (viewState) => set({ viewState }),

  setActiveSession: (activeSessionId) =>
    set((state) => ({
      activeSessionId,
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

        case "notification":
          return {};

        default:
          return {};
      }
    }),
}));
