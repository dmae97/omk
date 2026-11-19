use crate::protocol::{Control, frame};
use std::io::{BufRead, BufReader, Read};
use std::sync::mpsc::SyncSender;

pub enum Input {
    Control(Control),
    Disconnected,
    Invalid,
    Ready(serde_json::Value),
    Output(&'static str, Vec<u8>),
    Closed,
}

pub fn controls(mut reader: impl BufRead, tx: SyncSender<Input>) {
    for _ in 0..4 {
        let event = match frame(&mut reader, 1024) {
            Ok(None) => Input::Disconnected,
            Ok(Some(bytes)) => serde_json::from_slice(&bytes)
                .map(Input::Control)
                .unwrap_or(Input::Invalid),
            Err(_) => Input::Invalid,
        };
        let terminal = matches!(event, Input::Disconnected | Input::Invalid);
        if tx.send(event).is_err() || terminal {
            return;
        }
    }
    let _ = tx.send(Input::Invalid);
}

pub fn output(reader: impl Read, channel: &'static str, info: bool, tx: SyncSender<Input>) {
    let mut reader = BufReader::new(reader);
    if info {
        let mut bytes = Vec::new();
        loop {
            let mut byte = [0];
            if reader.read_exact(&mut byte).is_err() || bytes.len() >= 4096 {
                let _ = tx.send(Input::Invalid);
                let _ = tx.send(Input::Closed);
                return;
            }
            bytes.push(byte[0]);
            if byte[0] == b'\n'
                && let Ok(value) = serde_json::from_slice(&bytes)
            {
                if tx.send(Input::Ready(value)).is_err() {
                    return;
                }
                break;
            }
        }
    }
    let mut bytes = [0; 4096];
    loop {
        match reader.read(&mut bytes) {
            Ok(0) => break,
            Ok(count) => {
                if tx
                    .send(Input::Output(channel, bytes[..count].to_vec()))
                    .is_err()
                {
                    return;
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => {
                let _ = tx.send(Input::Invalid);
                break;
            }
        }
    }
    let _ = tx.send(Input::Closed);
}
