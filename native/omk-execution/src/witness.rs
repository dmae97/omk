use std::fs::{self, File, OpenOptions};
use std::io::{ErrorKind, Write};
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};

/// A namespace init the host observed terminated within the same boot.
pub struct Terminated<'a> {
    pub pid: u32,
    pub start_ticks: &'a str,
    pub namespace: &'a str,
    pub boot_id: &'a str,
}

impl Terminated<'_> {
    fn inode(&self) -> Option<&str> {
        let inode = self.namespace.strip_prefix("pid:[")?.strip_suffix(']')?;
        (!inode.is_empty() && inode.bytes().all(|b| b.is_ascii_digit())).then_some(inode)
    }

    fn valid(&self) -> bool {
        self.pid > 0
            && !self.start_ticks.is_empty()
            && self.start_ticks.len() <= 32
            && self.start_ticks.bytes().all(|b| b.is_ascii_digit())
            && self.inode().is_some()
            && self.boot_id.len() == 36
            && self
                .boot_id
                .bytes()
                .all(|b| b == b'-' || b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    }

    /// Both sides derive the same name from the recorded identity alone.
    pub fn file_name(&self) -> Option<String> {
        self.valid().then(|| {
            format!(
                "{}-{}-{}-{}.json",
                self.boot_id,
                self.inode().unwrap_or_default(),
                self.pid,
                self.start_ticks
            )
        })
    }

    /// Canonical bytes; the reader compares exactly instead of parsing.
    pub fn bytes(&self) -> Option<Vec<u8>> {
        self.valid().then(|| {
            format!(
                "{{\"version\":1,\"kind\":\"terminated\",\"identity\":{{\"pid\":{},\"startTicks\":\"{}\",\"namespace\":\"{}\",\"bootId\":\"{}\"}}}}\n",
                self.pid, self.start_ticks, self.namespace, self.boot_id
            )
            .into_bytes()
        })
    }
}

pub fn validate_dir(dir: &str) -> Result<(), &'static str> {
    let path = Path::new(dir);
    let meta = fs::symlink_metadata(path).map_err(|_| "witness")?;
    if !path.is_absolute()
        || dir.contains('\0')
        || !meta.file_type().is_dir()
        || meta.permissions().mode() & 0o077 != 0
    {
        return Err("witness");
    }
    Ok(())
}

/// Durable, idempotent: an identical existing receipt is success, a different one is not.
pub fn record(dir: &str, request_id: &str, receipt: &Terminated) -> Result<(), &'static str> {
    validate_dir(dir)?;
    let name = receipt.file_name().ok_or("witness")?;
    let bytes = receipt.bytes().ok_or("witness")?;
    let target = Path::new(dir).join(name);
    match fs::read(&target) {
        Ok(existing) if existing == bytes => return Ok(()),
        Ok(_) => return Err("witness"),
        Err(e) if e.kind() == ErrorKind::NotFound => {}
        Err(_) => return Err("witness"),
    }
    let temp: PathBuf = Path::new(dir).join(format!(".{request_id}.tmp"));
    let written = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&temp)
        .and_then(|mut file| {
            file.write_all(&bytes)?;
            file.sync_all()
        })
        .and_then(|()| fs::rename(&temp, &target))
        .and_then(|()| File::open(dir)?.sync_all());
    if written.is_err() {
        let _ = fs::remove_file(&temp);
        return Err("witness");
    }
    Ok(())
}
