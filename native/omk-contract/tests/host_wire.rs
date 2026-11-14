//! Host-wire tests for spec 120 stage K0 (T008).

use omk_contract::HOST_WIRE_VERSION;
use omk_contract::compat::PackageManifestDialect;
use omk_contract::host_wire::{
    CoreFrame, ExtensionApiMethod, ExtensionEntry, ExtensionEvent, ExtensionLoadError, FrameError,
    HandshakeError, HostFrame, MAX_FRAME_BYTES, PendingDisposition, check_frame_len,
    check_wire_version, pending_dispositions, specifier_map,
};

const EXPECTED_EVENTS: [&str; 28] = [
    "resources_discover",
    "session_start",
    "session_info_changed",
    "session_before_fork",
    "session_compact",
    "session_shutdown",
    "session_before_tree",
    "session_tree",
    "context",
    "after_provider_response",
    "before_agent_start",
    "agent_start",
    "agent_end",
    "agent_settled",
    "turn_start",
    "turn_end",
    "message_start",
    "message_update",
    "message_end",
    "tool_execution_start",
    "tool_execution_update",
    "tool_execution_end",
    "model_select",
    "thinking_level_select",
    "tool_call",
    "tool_result",
    "user_bash",
    "input",
];

const EXPECTED_METHODS: [&str; 24] = [
    "appendEntry",
    "exec",
    "getActiveTools",
    "getAllTools",
    "getCommands",
    "getFlag",
    "getSessionName",
    "getThinkingLevel",
    "isMcpToolBound",
    "on",
    "registerCommand",
    "registerFlag",
    "registerMessageRenderer",
    "registerProvider",
    "registerShortcut",
    "registerTool",
    "sendMessage",
    "sendUserMessage",
    "setActiveTools",
    "setLabel",
    "setModel",
    "setSessionName",
    "setThinkingLevel",
    "unregisterProvider",
];

#[test]
fn event_table_has_28_entries_in_typescript_order() {
    assert_eq!(ExtensionEvent::ALL.len(), 28);
    for (index, expected) in EXPECTED_EVENTS.iter().enumerate() {
        let event = ExtensionEvent::ALL[index];
        assert_eq!(event.as_str(), *expected);
        assert_eq!(ExtensionEvent::from_name(expected), Some(event));
        assert_eq!(
            serde_json::to_string(&event).unwrap(),
            format!("\"{expected}\"")
        );
    }
    assert_eq!(ExtensionEvent::from_name("not_an_event"), None);
}

#[test]
fn method_table_has_24_entries_in_typescript_order() {
    assert_eq!(ExtensionApiMethod::ALL.len(), 24);
    for (index, expected) in EXPECTED_METHODS.iter().enumerate() {
        let method = ExtensionApiMethod::ALL[index];
        assert_eq!(method.as_str(), *expected);
        assert_eq!(ExtensionApiMethod::from_name(expected), Some(method));
        assert_eq!(
            serde_json::to_string(&method).unwrap(),
            format!("\"{expected}\"")
        );
    }
    assert_eq!(ExtensionApiMethod::from_name("notAMethod"), None);
}

#[test]
fn specifier_map_is_empty_under_native_dialect() {
    assert!(specifier_map(PackageManifestDialect::Omk).is_empty());
}

#[test]
fn specifier_map_has_14_entries_under_compatibility_dialect() {
    let map = specifier_map(PackageManifestDialect::OmkPlusPi);
    assert_eq!(map.len(), 14);
    let first = &map[0];
    assert_eq!(first.specifier, "@earendil-works/pi-coding-agent");
    assert_eq!(first.target, "coding-agent");
}

#[test]
fn handshake_accepts_only_the_current_version() {
    assert_eq!(check_wire_version(HOST_WIRE_VERSION), Ok(()));
    for offered in [0, 2, 99] {
        assert_eq!(
            check_wire_version(offered),
            Err(HandshakeError::UnsupportedVersion {
                offered,
                supported: HOST_WIRE_VERSION,
            })
        );
    }
}

#[test]
fn frame_bound_fails_closed_above_the_limit() {
    assert_eq!(check_frame_len(0), Ok(()));
    assert_eq!(check_frame_len(MAX_FRAME_BYTES), Ok(()));
    assert_eq!(
        check_frame_len(MAX_FRAME_BYTES + 1),
        Err(FrameError::TooLarge {
            size: MAX_FRAME_BYTES + 1,
            max: MAX_FRAME_BYTES,
        })
    );
}

#[test]
fn core_frames_round_trip_through_json() {
    let frames = vec![
        CoreFrame::Ready {
            wire_version: HOST_WIRE_VERSION,
        },
        CoreFrame::LoadExtensions {
            request_id: 7,
            cwd: "/project".to_string(),
            dialect: PackageManifestDialect::OmkPlusPi,
            specifiers: specifier_map(PackageManifestDialect::OmkPlusPi),
            entries: vec![ExtensionEntry {
                path: "ext/index.ts".to_string(),
            }],
        },
        CoreFrame::DispatchEvent {
            request_id: 8,
            event: ExtensionEvent::ToolCall,
            payload: serde_json::json!({"toolName": "bash"}),
        },
        CoreFrame::ReplicaUpdate {
            revision: 3,
            snapshot: serde_json::json!({"activeTools": ["read"]}),
        },
        CoreFrame::Abort { request_id: 8 },
        CoreFrame::Shutdown,
    ];
    for frame in frames {
        let json = serde_json::to_string(&frame).unwrap();
        let back: CoreFrame = serde_json::from_str(&json).unwrap();
        assert_eq!(back, frame, "round trip failed for {json}");
    }
}

#[test]
fn dialect_serializes_with_typescript_names() {
    assert_eq!(
        serde_json::to_string(&PackageManifestDialect::Omk).unwrap(),
        "\"omk\""
    );
    assert_eq!(
        serde_json::to_string(&PackageManifestDialect::OmkPlusPi).unwrap(),
        "\"omk+pi\""
    );
}

#[test]
fn host_frames_round_trip_through_json() {
    let frames = vec![
        HostFrame::Hello {
            wire_version: HOST_WIRE_VERSION,
            node_version: "22.19.0".to_string(),
        },
        HostFrame::ExtensionsLoaded {
            request_id: 7,
            loaded: vec!["ext/index.ts".to_string()],
            errors: vec![ExtensionLoadError {
                path: "legacy.ts".to_string(),
                message: "Cannot find package '@earendil-works/pi-tui'".to_string(),
                hint: String::new(),
            }],
        },
        HostFrame::EventResult {
            request_id: 8,
            result: serde_json::json!({"block": true}),
        },
        HostFrame::ApiCall {
            call_id: 11,
            method: ExtensionApiMethod::RegisterTool,
            payload: serde_json::json!({"name": "custom"}),
        },
        HostFrame::HostLost {
            pending_request_ids: vec![8, 9],
            reason: "child exited".to_string(),
        },
    ];
    for frame in frames {
        let json = serde_json::to_string(&frame).unwrap();
        let back: HostFrame = serde_json::from_str(&json).unwrap();
        assert_eq!(back, frame, "round trip failed for {json}");
    }
}

#[test]
fn host_loss_marks_every_pending_request_unknown_without_replay() {
    assert!(pending_dispositions(&[]).is_empty());
    let dispositions = pending_dispositions(&[8, 9, 10]);
    assert_eq!(dispositions.len(), 3);
    for (id, disposition) in dispositions {
        assert!(id == 8 || id == 9 || id == 10);
        assert_eq!(disposition, PendingDisposition::Unknown);
    }
}
