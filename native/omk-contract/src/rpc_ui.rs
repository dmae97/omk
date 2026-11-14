use super::{Bool, Optional};
use crate::session::ExtraFields;
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Number;
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RequestTag {
    #[serde(rename = "extension_ui_request")]
    Request,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ResponseTag {
    #[serde(rename = "extension_ui_response")]
    Response,
}
pub type RpcUiRequest = super::Open<UiRequestFields>;
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UiRequestFields {
    #[serde(rename = "type")]
    pub kind: RequestTag,
    pub id: String,
    #[serde(flatten)]
    pub body: UiMethod,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NotifyType {
    Info,
    Warning,
    Error,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WidgetPlacement {
    AboveEditor,
    BelowEditor,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "method",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum UiMethod {
    Select {
        title: String,
        options: Vec<String>,
        #[serde(default, skip_serializing_if = "Optional::is_absent")]
        timeout: Optional<Number>,
    },
    Confirm {
        title: String,
        message: String,
        #[serde(default, skip_serializing_if = "Optional::is_absent")]
        timeout: Optional<Number>,
    },
    Input {
        title: String,
        #[serde(default, skip_serializing_if = "Optional::is_absent")]
        placeholder: Optional<String>,
        #[serde(default, skip_serializing_if = "Optional::is_absent")]
        timeout: Optional<Number>,
    },
    Editor {
        title: String,
        #[serde(default, skip_serializing_if = "Optional::is_absent")]
        prefill: Optional<String>,
    },
    Notify {
        message: String,
        #[serde(default, skip_serializing_if = "Optional::is_absent")]
        notify_type: Optional<NotifyType>,
    },
    SetStatus {
        status_key: String,
        #[serde(default, skip_serializing_if = "Optional::is_absent")]
        status_text: Optional<String>,
    },
    SetWidget {
        widget_key: String,
        #[serde(default, skip_serializing_if = "Optional::is_absent")]
        widget_lines: Optional<Vec<String>>,
        #[serde(default, skip_serializing_if = "Optional::is_absent")]
        widget_placement: Optional<WidgetPlacement>,
    },
    SetTitle {
        title: String,
    },
    #[serde(rename = "set_editor_text")]
    SetEditorText {
        text: String,
    },
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UiResponseFields {
    #[serde(rename = "type")]
    pub kind: ResponseTag,
    pub id: String,
    #[serde(default, skip_serializing_if = "Optional::is_absent")]
    pub value: Optional<String>,
    #[serde(default, skip_serializing_if = "Optional::is_absent")]
    pub confirmed: Optional<bool>,
    #[serde(default, skip_serializing_if = "Optional::is_absent")]
    pub cancelled: Optional<Bool<true>>,
    #[serde(flatten)]
    pub extra: ExtraFields,
}
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(transparent)]
pub struct RpcUiResponse(pub UiResponseFields);
impl<'de> Deserialize<'de> for RpcUiResponse {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let fields = UiResponseFields::deserialize(d)?;
        if fields.value.is_absent() && fields.confirmed.is_absent() && fields.cancelled.is_absent()
        {
            Err(serde::de::Error::custom(
                "UI response needs value, confirmed or cancelled",
            ))
        } else {
            Ok(Self(fields))
        }
    }
}
