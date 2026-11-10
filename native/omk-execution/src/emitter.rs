use crate::protocol::Event;
use std::io::Write;
use std::sync::mpsc::{self, RecvTimeoutError, Sender, SyncSender, TrySendError};
use std::thread;
use std::time::Duration;

struct Packet {
    bytes: Vec<u8>,
    done: Option<Sender<()>>,
}

pub struct Emitter {
    queue: SyncSender<Packet>,
}
impl Default for Emitter {
    fn default() -> Self {
        let (queue, receiver) = mpsc::sync_channel::<Packet>(8);
        thread::spawn(move || {
            let mut stdout = std::io::stdout().lock();
            while let Ok(packet) = receiver.recv() {
                if stdout
                    .write_all(&packet.bytes)
                    .and_then(|()| stdout.flush())
                    .is_err()
                {
                    return;
                }
                if let Some(done) = packet.done {
                    let _ = done.send(());
                    return;
                }
            }
        });
        Self { queue }
    }
}
impl Emitter {
    fn send(&self, event: &Event<'_>, done: Option<Sender<()>>) -> Result<(), &'static str> {
        let mut bytes = serde_json::to_vec(event).map_err(|_| "write")?;
        bytes.push(b'\n');
        if bytes.len() > 65_536 {
            return Err("frame");
        }
        self.queue
            .try_send(Packet { bytes, done })
            .map_err(|e| match e {
                TrySendError::Full(_) => "backpressure",
                TrySendError::Disconnected(_) => "disconnected",
            })
    }
    pub fn emit(&self, event: &Event<'_>) -> Result<(), &'static str> {
        self.send(event, None)
    }
    pub fn finish(&self, event: &Event<'_>, timeout_ms: u64) -> Result<(), &'static str> {
        let (done, result) = mpsc::channel();
        self.send(event, Some(done))?;
        result
            .recv_timeout(Duration::from_millis(timeout_ms))
            .map_err(|e| match e {
                RecvTimeoutError::Timeout => "backpressure",
                RecvTimeoutError::Disconnected => "disconnected",
            })
    }
}
