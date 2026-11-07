#![forbid(unsafe_code)]

pub mod framing;
pub mod protocol;
mod state;

pub use state::run;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum WireError {
    Read,
    Write,
    Frame,
    Utf8,
    FrameLimit,
    InputLimit,
    OutputLimit,
    Schema,
    Identity,
    Sequence,
    Eof,
}

impl WireError {
    pub fn code(self) -> &'static str {
        match self {
            Self::Read => "E_READ",
            Self::Write => "E_WRITE",
            Self::Frame => "E_FRAME",
            Self::Utf8 => "E_UTF8",
            Self::FrameLimit => "E_FRAME_LIMIT",
            Self::InputLimit => "E_INPUT_LIMIT",
            Self::OutputLimit => "E_OUTPUT_LIMIT",
            Self::Schema => "E_SCHEMA",
            Self::Identity => "E_IDENTITY",
            Self::Sequence => "E_SEQUENCE",
            Self::Eof => "E_EOF",
        }
    }
}
