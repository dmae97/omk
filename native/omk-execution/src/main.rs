#![forbid(unsafe_code)]
use omk_execution_host::emitter::Emitter;
use omk_execution_host::protocol::{Event, Start, frame};
use std::io::BufReader;

fn main() {
    let mut reader = BufReader::new(std::io::stdin());
    let request = frame(&mut reader, 262_144).and_then(|bytes| {
        serde_json::from_slice::<Start>(&bytes.ok_or("protocol")?).map_err(|_| "protocol")
    });
    let request = match request {
        Ok(request) => request,
        Err(_) => {
            eprintln!("invalid_request");
            std::process::exit(1);
        }
    };
    let id = request.request_id.clone();
    let emitter = Emitter::default();
    if let Err(code) = omk_execution_host::supervisor::run(request, reader, &emitter) {
        let _ = emitter.finish(
            &Event::Error {
                request_id: &id,
                code,
            },
            500,
        );
        std::process::exit(1);
    }
}
