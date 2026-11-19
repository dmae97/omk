use crate::phase_deadline::PhaseDeadline;
use crate::witness::Terminated;
use std::fs::{self, File, OpenOptions};
use std::io::{ErrorKind, Write};
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

/// Durable per-request execution record. The request ID is the file name and
/// `create_new` makes a second start for the same request fail before any spawn.
pub struct Record {
    file: File,
    done: bool,
    started: Instant,
    dir: PathBuf,
    head: PathBuf,
    temp: PathBuf,
    size: u64,
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn path(dir: &str, request_id: &str) -> std::path::PathBuf {
    Path::new(dir).join(format!("{request_id}.jsonl"))
}

pub fn cancel_path(dir: &str, request_id: &str) -> std::path::PathBuf {
    Path::new(dir).join(format!("{request_id}.cancel"))
}

/// Start ticks of this host process, so a reader can tell a live host from a reused PID.
fn own_ticks() -> Result<String, &'static str> {
    let text = std::fs::read_to_string("/proc/self/stat").map_err(|_| "record")?;
    let ticks = text
        .rsplit_once(')')
        .and_then(|(_, rest)| rest.split_whitespace().nth(19))
        .ok_or("record")?;
    if ticks.is_empty() || !ticks.bytes().all(|b| b.is_ascii_digit()) {
        return Err("record");
    }
    Ok(ticks.to_owned())
}

impl Record {
    pub fn create(dir: &str, request_id: &str) -> Result<Self, &'static str> {
        Self::create_bound(dir, request_id, None, None)
    }

    pub fn started(&self) -> Instant {
        self.started
    }

    pub fn create_bound(
        dir: &str,
        request_id: &str,
        binding: Option<&str>,
        phase_deadline: Option<&PhaseDeadline>,
    ) -> Result<Self, &'static str> {
        let started = Instant::now();
        let started_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| "record")?
            .as_millis();
        let boot =
            std::fs::read_to_string("/proc/sys/kernel/random/boot_id").map_err(|_| "record")?;
        if request_id.len() != 32
            || !request_id
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            return Err("record");
        }
        crate::witness::validate_dir(dir)?;
        let file = OpenOptions::new()
            .append(true)
            .create_new(true)
            .mode(0o600)
            .open(path(dir, request_id))
            .map_err(|e| {
                if e.kind() == ErrorKind::AlreadyExists {
                    "duplicate"
                } else {
                    "record"
                }
            })?;
        File::open(dir)
            .and_then(|d| d.sync_all())
            .map_err(|_| "record")?;
        let mut record = Self {
            file,
            done: false,
            started,
            dir: PathBuf::from(dir),
            head: Path::new(dir).join(format!("{request_id}.head")),
            temp: Path::new(dir).join(format!(".{request_id}.head.tmp")),
            size: 0,
        };
        let deadline = phase_deadline
            .map(|value| {
                serde_json::to_string(value).map(|json| format!(",\"phaseDeadline\":{json}"))
            })
            .transpose()
            .map_err(|_| "record")?
            .unwrap_or_default();
        record.append(&format!(
            "{{\"kind\":\"accepted\",\"requestId\":\"{request_id}\",\"hostPid\":{},\"hostTicks\":\"{}\",\"hostBootId\":{},\"startedAtMs\":{started_at},\"bindingDigest\":{}{deadline}}}",
            std::process::id(),
            own_ticks()?,
            serde_json::to_string(boot.trim()).map_err(|_| "record")?,
            serde_json::to_string(&binding).map_err(|_| "record")?
        ))?;
        Ok(record)
    }

    fn append(&mut self, line: &str) -> Result<(), &'static str> {
        let bytes = format!("{line}\n");
        let next_size = self.size.checked_add(bytes.len() as u64).ok_or("record")?;
        let result = (|| -> std::io::Result<()> {
            self.file.write_all(bytes.as_bytes())?;
            self.file.sync_data()?;
            // Readers may see complete page-cache lines before fsync returns.
            // Only publish the durable prefix after the payload has synced.
            let mut temp = OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .open(&self.temp)?;
            temp.write_all(format!("{next_size}\n").as_bytes())?;
            temp.sync_all()?;
            fs::rename(&self.temp, &self.head)?;
            File::open(&self.dir)?.sync_all()
        })();
        if result.is_err() {
            self.done = true;
            return Err("record");
        }
        self.size = next_size;
        Ok(())
    }

    pub fn ready(&mut self, identity: &Terminated) -> Result<(), &'static str> {
        if identity.file_name().is_none() {
            return Err("record");
        }
        self.append(&format!(
            "{{\"kind\":\"ready\",\"identity\":{{\"pid\":{},\"startTicks\":\"{}\",\"namespace\":\"{}\",\"bootId\":\"{}\"}}}}",
            identity.pid, identity.start_ticks, identity.namespace, identity.boot_id
        ))
    }

    pub fn committed(&mut self) -> Result<(), &'static str> {
        self.append("{\"kind\":\"committed\"}")
    }

    pub fn detached(&mut self) -> Result<(), &'static str> {
        self.append("{\"kind\":\"detached\"}")
    }

    /// Detachable executions retain output regardless of final delivery to the parent.
    pub fn finished(
        &mut self,
        exit_code: Option<i32>,
        failure: Option<&str>,
        duration_ms: u64,
        output: Option<(&[u8], &[u8])>,
    ) -> Result<(), &'static str> {
        let exit = exit_code.map_or("null".to_owned(), |code| code.to_string());
        let failure = failure.map_or("null".to_owned(), |code| format!("\"{code}\""));
        let output = output.map_or(String::new(), |(out, err)| {
            format!(",\"stdout\":\"{}\",\"stderr\":\"{}\"", hex(out), hex(err))
        });
        self.done = true;
        self.append(&format!(
            "{{\"kind\":\"finished\",\"exitCode\":{exit},\"failure\":{failure},\"durationMs\":{duration_ms}{output}}}"
        ))
    }

    /// A no-op after `finished`: delivery failures never overwrite a witnessed outcome.
    pub fn error(&mut self, code: &str) -> Result<(), &'static str> {
        if self.done {
            return Ok(());
        }
        self.done = true;
        self.append(&format!("{{\"kind\":\"error\",\"code\":\"{code}\"}}"))
    }
}
