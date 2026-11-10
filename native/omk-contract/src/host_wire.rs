//! Extension-host wire, version 1 (spec 120, §5).
//!
//! Types and validation only. No transport, no process management. The core is
//! the single writer; the host is a client that runs existing extensions on
//! Node. A version the core does not support fails closed before any extension
//! loads, and a pending request whose host disappears is never replayed.

use serde::{Deserialize, Serialize};

use crate::HOST_WIRE_VERSION;
use crate::compat::{LEGACY_PI_RUNTIME_ALIASES, PackageManifestDialect};

/// Largest accepted serialized frame. Larger frames fail closed.
pub const MAX_FRAME_BYTES: usize = 1_048_576;

/// One legacy-specifier mapping handed to the host as data. The host applies
/// it in its resolver and names no Pi package itself.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SpecifierAlias {
    pub specifier: String,
    pub target: String,
}

/// The specifier map for a dialect. Empty under the native dialect (PA1).
pub fn specifier_map(dialect: PackageManifestDialect) -> Vec<SpecifierAlias> {
    match dialect {
        PackageManifestDialect::Omk => Vec::new(),
        PackageManifestDialect::OmkPlusPi => LEGACY_PI_RUNTIME_ALIASES
            .iter()
            .map(|(specifier, target)| SpecifierAlias {
                specifier: (*specifier).to_string(),
                target: target.as_str().to_string(),
            })
            .collect(),
    }
}

/// The 28 events accepted by `omk.on` at the K0 baseline.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExtensionEvent {
    ResourcesDiscover,
    SessionStart,
    SessionInfoChanged,
    SessionBeforeFork,
    SessionCompact,
    SessionShutdown,
    SessionBeforeTree,
    SessionTree,
    Context,
    AfterProviderResponse,
    BeforeAgentStart,
    AgentStart,
    AgentEnd,
    AgentSettled,
    TurnStart,
    TurnEnd,
    MessageStart,
    MessageUpdate,
    MessageEnd,
    ToolExecutionStart,
    ToolExecutionUpdate,
    ToolExecutionEnd,
    ModelSelect,
    ThinkingLevelSelect,
    ToolCall,
    ToolResult,
    UserBash,
    Input,
}

impl ExtensionEvent {
    pub const ALL: [ExtensionEvent; 28] = [
        Self::ResourcesDiscover,
        Self::SessionStart,
        Self::SessionInfoChanged,
        Self::SessionBeforeFork,
        Self::SessionCompact,
        Self::SessionShutdown,
        Self::SessionBeforeTree,
        Self::SessionTree,
        Self::Context,
        Self::AfterProviderResponse,
        Self::BeforeAgentStart,
        Self::AgentStart,
        Self::AgentEnd,
        Self::AgentSettled,
        Self::TurnStart,
        Self::TurnEnd,
        Self::MessageStart,
        Self::MessageUpdate,
        Self::MessageEnd,
        Self::ToolExecutionStart,
        Self::ToolExecutionUpdate,
        Self::ToolExecutionEnd,
        Self::ModelSelect,
        Self::ThinkingLevelSelect,
        Self::ToolCall,
        Self::ToolResult,
        Self::UserBash,
        Self::Input,
    ];

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::ResourcesDiscover => "resources_discover",
            Self::SessionStart => "session_start",
            Self::SessionInfoChanged => "session_info_changed",
            Self::SessionBeforeFork => "session_before_fork",
            Self::SessionCompact => "session_compact",
            Self::SessionShutdown => "session_shutdown",
            Self::SessionBeforeTree => "session_before_tree",
            Self::SessionTree => "session_tree",
            Self::Context => "context",
            Self::AfterProviderResponse => "after_provider_response",
            Self::BeforeAgentStart => "before_agent_start",
            Self::AgentStart => "agent_start",
            Self::AgentEnd => "agent_end",
            Self::AgentSettled => "agent_settled",
            Self::TurnStart => "turn_start",
            Self::TurnEnd => "turn_end",
            Self::MessageStart => "message_start",
            Self::MessageUpdate => "message_update",
            Self::MessageEnd => "message_end",
            Self::ToolExecutionStart => "tool_execution_start",
            Self::ToolExecutionUpdate => "tool_execution_update",
            Self::ToolExecutionEnd => "tool_execution_end",
            Self::ModelSelect => "model_select",
            Self::ThinkingLevelSelect => "thinking_level_select",
            Self::ToolCall => "tool_call",
            Self::ToolResult => "tool_result",
            Self::UserBash => "user_bash",
            Self::Input => "input",
        }
    }

    pub fn from_name(value: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|event| event.as_str() == value)
    }
}

/// The 24 `ExtensionAPI` methods at the K0 baseline.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ExtensionApiMethod {
    AppendEntry,
    Exec,
    GetActiveTools,
    GetAllTools,
    GetCommands,
    GetFlag,
    GetSessionName,
    GetThinkingLevel,
    IsMcpToolBound,
    On,
    RegisterCommand,
    RegisterFlag,
    RegisterMessageRenderer,
    RegisterProvider,
    RegisterShortcut,
    RegisterTool,
    SendMessage,
    SendUserMessage,
    SetActiveTools,
    SetLabel,
    SetModel,
    SetSessionName,
    SetThinkingLevel,
    UnregisterProvider,
}

impl ExtensionApiMethod {
    pub const ALL: [ExtensionApiMethod; 24] = [
        Self::AppendEntry,
        Self::Exec,
        Self::GetActiveTools,
        Self::GetAllTools,
        Self::GetCommands,
        Self::GetFlag,
        Self::GetSessionName,
        Self::GetThinkingLevel,
        Self::IsMcpToolBound,
        Self::On,
        Self::RegisterCommand,
        Self::RegisterFlag,
        Self::RegisterMessageRenderer,
        Self::RegisterProvider,
        Self::RegisterShortcut,
        Self::RegisterTool,
        Self::SendMessage,
        Self::SendUserMessage,
        Self::SetActiveTools,
        Self::SetLabel,
        Self::SetModel,
        Self::SetSessionName,
        Self::SetThinkingLevel,
        Self::UnregisterProvider,
    ];

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::AppendEntry => "appendEntry",
            Self::Exec => "exec",
            Self::GetActiveTools => "getActiveTools",
            Self::GetAllTools => "getAllTools",
            Self::GetCommands => "getCommands",
            Self::GetFlag => "getFlag",
            Self::GetSessionName => "getSessionName",
            Self::GetThinkingLevel => "getThinkingLevel",
            Self::IsMcpToolBound => "isMcpToolBound",
            Self::On => "on",
            Self::RegisterCommand => "registerCommand",
            Self::RegisterFlag => "registerFlag",
            Self::RegisterMessageRenderer => "registerMessageRenderer",
            Self::RegisterProvider => "registerProvider",
            Self::RegisterShortcut => "registerShortcut",
            Self::RegisterTool => "registerTool",
            Self::SendMessage => "sendMessage",
            Self::SendUserMessage => "sendUserMessage",
            Self::SetActiveTools => "setActiveTools",
            Self::SetLabel => "setLabel",
            Self::SetModel => "setModel",
            Self::SetSessionName => "setSessionName",
            Self::SetThinkingLevel => "setThinkingLevel",
            Self::UnregisterProvider => "unregisterProvider",
        }
    }

    pub fn from_name(value: &str) -> Option<Self> {
        Self::ALL
            .into_iter()
            .find(|method| method.as_str() == value)
    }
}

/// One extension entry file the core selected for loading.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExtensionEntry {
    pub path: String,
}

/// A load failure reported by the host. `hint` carries the migration hint from
/// `compat::legacy_pi_import_hint`, or is empty.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExtensionLoadError {
    pub path: String,
    pub message: String,
    pub hint: String,
}

/// Messages from the core to the host.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum CoreFrame {
    Ready {
        wire_version: u32,
    },
    LoadExtensions {
        request_id: u64,
        cwd: String,
        dialect: PackageManifestDialect,
        specifiers: Vec<SpecifierAlias>,
        entries: Vec<ExtensionEntry>,
    },
    DispatchEvent {
        request_id: u64,
        event: ExtensionEvent,
        payload: serde_json::Value,
    },
    ReplicaUpdate {
        revision: u64,
        snapshot: serde_json::Value,
    },
    Abort {
        request_id: u64,
    },
    Shutdown,
}

/// Messages from the host to the core.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum HostFrame {
    Hello {
        wire_version: u32,
        node_version: String,
    },
    ExtensionsLoaded {
        request_id: u64,
        loaded: Vec<String>,
        errors: Vec<ExtensionLoadError>,
    },
    EventResult {
        request_id: u64,
        result: serde_json::Value,
    },
    ApiCall {
        call_id: u64,
        method: ExtensionApiMethod,
        payload: serde_json::Value,
    },
    HostLost {
        pending_request_ids: Vec<u64>,
        reason: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HandshakeError {
    UnsupportedVersion { offered: u32, supported: u32 },
}

/// Only the exact current version is accepted. Anything else fails closed.
pub fn check_wire_version(offered: u32) -> Result<(), HandshakeError> {
    if offered == HOST_WIRE_VERSION {
        Ok(())
    } else {
        Err(HandshakeError::UnsupportedVersion {
            offered,
            supported: HOST_WIRE_VERSION,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FrameError {
    TooLarge { size: usize, max: usize },
}

pub fn check_frame_len(len: usize) -> Result<(), FrameError> {
    if len > MAX_FRAME_BYTES {
        Err(FrameError::TooLarge {
            size: len,
            max: MAX_FRAME_BYTES,
        })
    } else {
        Ok(())
    }
}

/// A pending request whose host disappeared has an unknown outcome. The core
/// reports it and never replays the handler automatically (spec §5).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PendingDisposition {
    Unknown,
}

pub fn pending_dispositions(pending: &[u64]) -> Vec<(u64, PendingDisposition)> {
    pending
        .iter()
        .map(|id| (*id, PendingDisposition::Unknown))
        .collect()
}
