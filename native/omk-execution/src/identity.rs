use std::fs;
use std::io::ErrorKind;

pub struct Identity {
    pid: u32,
    ticks: String,
    namespace: String,
    boot: String,
}

fn stat(pid: u32) -> std::io::Result<(String, String)> {
    let text = fs::read_to_string(format!("/proc/{pid}/stat"))?;
    let fields: Vec<_> = text
        .rsplit_once(')')
        .ok_or_else(|| std::io::Error::other("stat"))?
        .1
        .split_whitespace()
        .collect();
    let state = fields
        .first()
        .ok_or_else(|| std::io::Error::other("state"))?;
    let ticks = fields
        .get(19)
        .ok_or_else(|| std::io::Error::other("ticks"))?;
    if ticks.is_empty() || !ticks.bytes().all(|b| b.is_ascii_digit()) {
        return Err(std::io::Error::other("ticks"));
    }
    Ok((state.to_string(), ticks.to_string()))
}
fn namespace(pid: u32) -> std::io::Result<String> {
    Ok(fs::read_link(format!("/proc/{pid}/ns/pid"))?
        .to_string_lossy()
        .into_owned())
}
fn boot() -> std::io::Result<String> {
    Ok(fs::read_to_string("/proc/sys/kernel/random/boot_id")?
        .trim()
        .to_owned())
}

impl Identity {
    pub fn capture(info: &serde_json::Value) -> Result<Self, &'static str> {
        let pid = info
            .get("child-pid")
            .and_then(|v| v.as_u64())
            .and_then(|v| u32::try_from(v).ok())
            .filter(|v| *v > 0)
            .ok_or("process_identity")?;
        let inode = info
            .get("pid-namespace")
            .and_then(|v| v.as_u64())
            .ok_or("process_identity")?;
        let (state, ticks) = stat(pid).map_err(|_| "process_identity")?;
        let status =
            fs::read_to_string(format!("/proc/{pid}/status")).map_err(|_| "process_identity")?;
        let pids: Vec<_> = status
            .lines()
            .find_map(|line| line.strip_prefix("NSpid:"))
            .ok_or("process_identity")?
            .split_whitespace()
            .collect();
        let ns = namespace(pid).map_err(|_| "process_identity")?;
        if pids.len() < 2
            || pids.last() != Some(&"1")
            || ns != format!("pid:[{inode}]")
            || ["Z", "X"].contains(&state.as_str())
            || stat(pid).map_err(|_| "process_identity")?.1 != ticks
        {
            return Err("process_identity");
        }
        Ok(Self {
            pid,
            ticks,
            namespace: ns,
            boot: boot().map_err(|_| "process_identity")?,
        })
    }
    pub fn terminated(&self) -> crate::witness::Terminated<'_> {
        crate::witness::Terminated {
            pid: self.pid,
            start_ticks: &self.ticks,
            namespace: &self.namespace,
            boot_id: &self.boot,
        }
    }
    pub fn gone(&self) -> bool {
        if boot().ok().as_ref() != Some(&self.boot) {
            return false;
        }
        match stat(self.pid) {
            Err(e) if e.kind() == ErrorKind::NotFound => true,
            Ok((state, ticks)) if ticks == self.ticks => ["Z", "X"].contains(&state.as_str()),
            _ => false,
        }
    }
    pub fn alive(&self) -> bool {
        stat(self.pid).is_ok_and(|(state, ticks)| {
            ticks == self.ticks && !["Z", "X"].contains(&state.as_str())
        }) && namespace(self.pid).ok().as_ref() == Some(&self.namespace)
    }
}
