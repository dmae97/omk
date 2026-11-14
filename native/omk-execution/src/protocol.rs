use crate::budget::Budget;
use crate::phase_deadline::PhaseDeadline;
use serde::{Deserialize, Serialize};
use std::io::{BufRead, Read};
use std::path::Path;

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Start {
    pub version: u8,
    pub request_id: String,
    pub workspace: String,
    pub argv: Vec<String>,
    pub writable: bool,
    pub timeout_ms: u64,
    pub cleanup_ms: u64,
    pub max_output_bytes: u64,
    #[serde(default)]
    pub witness_dir: Option<String>,
    #[serde(default)]
    pub record_dir: Option<String>,
    #[serde(default)]
    pub binding_digest: Option<String>,
    #[serde(default)]
    pub detachable: bool,
    #[serde(default)]
    pub phase_deadline: Option<PhaseDeadline>,
}
impl Start {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.version != 1
            || self.request_id.len() != 32
            || !self
                .request_id
                .bytes()
                .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
        {
            return Err("protocol");
        }
        let path = Path::new(&self.workspace);
        if !path.is_absolute()
            || path.parent().is_none()
            || !path.is_dir()
            || self.workspace.contains('\0')
        {
            return Err("workspace");
        }
        if self.argv.is_empty()
            || self.argv.len() > 256
            || self
                .argv
                .iter()
                .any(|arg| arg.len() > 65_536 || arg.contains('\0'))
        {
            return Err("argv");
        }
        let executable = &self.argv[0];
        if !(executable.starts_with("/usr/bin/") || executable.starts_with("/bin/")) {
            return Err("executable");
        }
        if self.cleanup_ms == 0 || self.cleanup_ms > 60_000 {
            return Err("budget");
        }
        Budget::new(self.timeout_ms, self.max_output_bytes)?;
        if let Some(deadline) = &self.phase_deadline {
            deadline.validate()?;
        }
        if let Some(dir) = &self.witness_dir {
            crate::witness::validate_dir(dir)?;
        }
        if self.binding_digest.as_ref().is_some_and(|digest| {
            digest.len() != 64
                || !digest
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        }) {
            return Err("record");
        }
        match &self.record_dir {
            Some(dir) => crate::witness::validate_dir(dir)?,
            None if self.detachable => return Err("record"),
            None => {}
        }
        Ok(())
    }
}

#[derive(Deserialize)]
#[serde(tag = "type", deny_unknown_fields)]
pub enum Control {
    #[serde(rename = "commit")]
    Commit {
        #[serde(rename = "requestId")]
        request_id: String,
    },
    #[serde(rename = "cancel")]
    Cancel {
        #[serde(rename = "requestId")]
        request_id: String,
    },
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Event<'a> {
    Spawned {
        #[serde(rename = "requestId")]
        request_id: &'a str,
        pid: u32,
    },
    Ready {
        #[serde(rename = "requestId")]
        request_id: &'a str,
        info: &'a serde_json::Value,
    },
    Output {
        #[serde(rename = "requestId")]
        request_id: &'a str,
        channel: &'a str,
        data: &'a [u8],
    },
    Finished {
        #[serde(rename = "requestId")]
        request_id: &'a str,
        #[serde(rename = "exitCode")]
        exit_code: Option<i32>,
        failure: Option<&'a str>,
        #[serde(rename = "durationMs")]
        duration_ms: u64,
    },
    Error {
        #[serde(rename = "requestId")]
        request_id: &'a str,
        code: &'a str,
    },
}

pub fn frame(reader: &mut impl BufRead, limit: usize) -> Result<Option<Vec<u8>>, &'static str> {
    let mut bytes = Vec::new();
    reader
        .by_ref()
        .take((limit + 1) as u64)
        .read_until(b'\n', &mut bytes)
        .map_err(|_| "read")?;
    if bytes.is_empty() {
        return Ok(None);
    }
    if bytes.len() > limit
        || bytes.last() != Some(&b'\n')
        || bytes.contains(&b'\r')
        || bytes.iter().find(|b| !b.is_ascii_whitespace()) != Some(&b'{')
    {
        return Err("frame");
    }
    Ok(Some(bytes))
}
