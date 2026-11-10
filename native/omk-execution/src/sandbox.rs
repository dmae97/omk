use crate::protocol::Start;
use std::os::unix::process::CommandExt;
use std::process::{Child, Command, ExitStatus, Stdio};

const SYSTEM: &[&str] = &[
    "--unshare-all",
    "--die-with-parent",
    "--new-session",
    "--cap-drop",
    "ALL",
    "--clearenv",
    "--ro-bind",
    "/usr",
    "/usr",
    "--symlink",
    "usr/bin",
    "/bin",
    "--symlink",
    "usr/lib",
    "/lib",
    "--symlink",
    "usr/lib64",
    "/lib64",
    "--proc",
    "/proc",
    "--dev",
    "/dev",
    "--tmpfs",
    "/tmp",
    "--setenv",
    "PATH",
    "/usr/bin:/bin",
    "--setenv",
    "LANG",
    "C.UTF-8",
];

pub(crate) struct OwnedChild {
    pub child: Child,
    pub status: Option<ExitStatus>,
}
impl OwnedChild {
    pub fn spawn(request: &Start) -> Result<Self, &'static str> {
        let child = Command::new("/bin/sh")
            .args([
                "-c",
                "exec 3>&1; exec \"$@\"",
                "omk-rust-supervisor",
                "/usr/bin/bwrap",
            ])
            .args(SYSTEM)
            .arg(if request.writable {
                "--bind"
            } else {
                "--ro-bind"
            })
            .arg(&request.workspace)
            .arg("/workspace")
            .args([
                "--chdir",
                "/workspace",
                "--info-fd",
                "3",
                "--",
                "/bin/sh",
                "-c",
                "IFS= read -r gate && [ \"$gate\" = go ] && exec \"$@\"",
                "omk-process-gate",
            ])
            .args(&request.argv)
            .env_clear()
            .process_group(0)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|_| "execution_failed")?;
        Ok(Self {
            child,
            status: None,
        })
    }
    pub fn stop(&mut self) {
        if self.status.is_some() {
            return;
        }
        let result = Command::new("/usr/bin/kill")
            .args(["-KILL", "--", &format!("-{}", self.child.id())])
            .env_clear()
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
        if !result.is_ok_and(|status| status.success()) {
            let _ = self.child.kill();
        }
    }
    pub fn poll(&mut self) -> Result<(), &'static str> {
        if self.status.is_none() {
            self.status = self.child.try_wait().map_err(|_| "execution_failed")?;
        }
        Ok(())
    }
}
impl Drop for OwnedChild {
    fn drop(&mut self) {
        self.stop();
    }
}
