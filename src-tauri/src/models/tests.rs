#[cfg(test)]
mod tests {
    use super::super::*;

    #[test]
    fn session_status_serializes_to_snake_case() {
        let status = SessionStatus::WaitingForInput;
        let json = serde_json::to_string(&status).unwrap();
        assert_eq!(json, "\"waiting_for_input\"");
    }

    #[test]
    fn session_status_deserializes_from_snake_case() {
        let status: SessionStatus = serde_json::from_str("\"waiting_for_input\"").unwrap();
        assert_eq!(status, SessionStatus::WaitingForInput);
    }

    #[test]
    fn message_type_defaults_to_info() {
        let json = r#"{"message": "hello"}"#;
        let req: SendMessageRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.message_type, MessageType::Info);
    }

    #[test]
    fn ws_event_serializes_with_type_tag() {
        let event = WsEvent::SessionDisconnected {
            session_id: "abc".to_string(),
        };
        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("\"type\":\"sessionDisconnected\""));
        assert!(json.contains("\"sessionId\":\"abc\""));
    }

    #[test]
    fn register_session_request_parses_camel_case() {
        let json = r#"{"workingDirectory": "/home/user/project", "gitBranch": "main"}"#;
        let req: RegisterSessionRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.working_directory, "/home/user/project");
        assert_eq!(req.git_branch, Some("main".to_string()));
    }
}
