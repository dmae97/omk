use crate::WireError;
use crate::framing::{FrameReader, FrameWriter};
use crate::protocol::{Capabilities, Ready, Reply, Request, Unsupported, parse_request};
use std::io::{Read, Write};

pub fn run(input: impl Read, output: impl Write) -> Result<(), WireError> {
    let mut reader = FrameReader::new(input);
    let mut writer = FrameWriter::new(output);
    let first = parse_request(reader.next_frame()?.ok_or(WireError::Eof)?)?;
    let Request::Hello(owner) = first else {
        return Err(WireError::Sequence);
    };
    if owner.control_seq != 1 {
        return Err(WireError::Sequence);
    }
    writer.write_json(&Reply::Ready(Ready {
        identity: &owner.identity,
        control_seq: 1,
        capabilities: Capabilities {
            offline_only: true,
            backend: false,
            execute: false,
        },
    }))?;
    let second = parse_request(reader.next_frame()?.ok_or(WireError::Eof)?)?;
    let Request::Execute(execute) = second else {
        return Err(WireError::Sequence);
    };
    if execute.control_seq != 2 {
        return Err(WireError::Sequence);
    }
    if execute.identity != owner.identity {
        return Err(WireError::Identity);
    }
    writer.write_json(&Reply::Result(Unsupported {
        identity: &owner.identity,
        control_seq: 2,
        status: "unsupported",
        started: false,
    }))
}
