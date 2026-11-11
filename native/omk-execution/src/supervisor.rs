use crate::budget::Budget;
use crate::emitter::Emitter;
use crate::identity::Identity;
use crate::protocol::{Control, Event, Start};
use crate::record::{self, Record};
use crate::sandbox::OwnedChild;
use crate::transport::{self, Input};
use std::io::{BufRead, Write};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::thread;
use std::time::{Duration, Instant};

enum Gate {
    Waiting,
    Ready,
    Committed,
}

/// Where events go. A detachable committed execution survives the loss of its
/// parent: events stop, output is retained and the outcome lands in the record.
struct Link<'a> {
    emitter: &'a Emitter,
    record: Option<Record>,
    detachable: bool,
    detached: bool,
}

impl Link<'_> {
    fn detach(&mut self) -> Result<(), &'static str> {
        if !self.detached {
            self.detached = true;
            self.record.as_mut().ok_or("record")?.detached()?;
        }
        Ok(())
    }

    fn send(&mut self, event: &Event<'_>, committed: bool) -> Result<(), &'static str> {
        if self.detached {
            return Ok(());
        }
        match self.emitter.emit(event) {
            Err("disconnected") if self.detachable && committed => self.detach(),
            other => other,
        }
    }
}

pub fn run(
    request: Start,
    reader: impl BufRead + Send + 'static,
    emitter: &Emitter,
) -> Result<(), &'static str> {
    request.validate()?;
    if let Some(deadline) = &request.phase_deadline {
        deadline.check()?;
    }
    // Created before any spawn: a duplicate request ID never reaches the sandbox.
    let record = match &request.record_dir {
        Some(dir) => Some(Record::create_bound(
            dir,
            &request.request_id,
            request.binding_digest.as_deref(),
            request.phase_deadline.as_ref(),
        )?),
        None => None,
    };
    let mut link = Link {
        emitter,
        record,
        detachable: request.detachable,
        detached: false,
    };
    let result = supervise(&request, reader, &mut link);
    if let (Err(code), Some(record)) = (result, link.record.as_mut()) {
        let _ = record.error(code);
    }
    result
}

fn supervise(
    request: &Start,
    reader: impl BufRead + Send + 'static,
    link: &mut Link,
) -> Result<(), &'static str> {
    let started = link
        .record
        .as_ref()
        .map_or_else(Instant::now, Record::started);
    let mut budget = Budget::new(request.timeout_ms, request.max_output_bytes)?;
    if let Some(deadline) = &request.phase_deadline {
        deadline.check()?;
    }
    let mut child = OwnedChild::spawn(request)?;
    link.emitter.emit(&Event::Spawned {
        request_id: &request.request_id,
        pid: child.child.id(),
    })?;
    let stdout = child.child.stdout.take().ok_or("execution_failed")?;
    let stderr = child.child.stderr.take().ok_or("execution_failed")?;
    let mut stdin = child.child.stdin.take();
    let (tx, rx) = mpsc::sync_channel(8);
    let out = {
        let tx = tx.clone();
        thread::spawn(move || transport::output(stdout, "stdout", true, tx))
    };
    let err = {
        let tx = tx.clone();
        thread::spawn(move || transport::output(stderr, "stderr", false, tx))
    };
    // This reader belongs to the CLI process; process exit closes it even if the
    // parent leaves stdin open. It has no process or execution authority.
    thread::spawn(move || transport::controls(reader, tx));
    let cancel_file = request
        .record_dir
        .as_deref()
        .map(|dir| record::cancel_path(dir, &request.request_id));
    let mut cancel_checked = Instant::now();
    let mut retained: (Vec<u8>, Vec<u8>) = (Vec::new(), Vec::new());
    let mut gate = Gate::Waiting;
    let mut identity: Option<Identity> = None;
    let mut closed = 0;
    let mut failure: Option<&str> = None;
    let mut draining: Option<Instant> = None;
    loop {
        let elapsed = started.elapsed().as_millis().min(u64::MAX as u128) as u64;
        if failure.is_none()
            && let Some(reason) = budget.observe(elapsed, 0)
        {
            failure = Some(reason.code());
        }
        if failure.is_none() {
            failure = request
                .phase_deadline
                .as_ref()
                .and_then(|deadline| deadline.check().err());
        }
        if failure.is_none()
            && cancel_checked.elapsed() >= Duration::from_millis(50)
            && let Some(path) = &cancel_file
        {
            cancel_checked = Instant::now();
            if path.exists() {
                failure = Some("cancelled");
            }
        }
        if failure.is_some() && draining.is_none() {
            stdin.take();
            child.stop();
            draining = Some(Instant::now());
        }
        child.poll()?;
        if child.status.is_some() && closed == 2 {
            if identity.as_ref().is_none_or(Identity::gone) {
                out.join().map_err(|_| "unsettled")?;
                err.join().map_err(|_| "unsettled")?;
                if let (Some(owner), Some(dir)) = (&identity, &request.witness_dir) {
                    crate::witness::record(dir, &request.request_id, &owner.terminated())?;
                }
                let committed = matches!(gate, Gate::Committed);
                let exit_code = child.status.and_then(|status| status.code());
                if failure.is_none() && (!committed || exit_code != Some(0)) {
                    failure = Some("execution_failed");
                }
                // Persist before delivery: a flushed pipe is not a durable outcome.
                // Retain detachable output even while attached; the parent can die
                // after the final write without ever acknowledging the result.
                if let Some(record) = link.record.as_mut() {
                    let output = (link.detachable && committed)
                        .then_some((retained.0.as_slice(), retained.1.as_slice()));
                    record.finished(exit_code, failure, elapsed, output)?;
                }
                let emitted = if link.detached {
                    Ok(())
                } else {
                    link.emitter.finish(
                        &Event::Finished {
                            request_id: &request.request_id,
                            exit_code,
                            failure,
                            duration_ms: elapsed,
                        },
                        request.cleanup_ms,
                    )
                };
                return match emitted {
                    Err("disconnected") if link.detachable && committed => Ok(()),
                    other => other,
                };
            }
            if draining.is_none() {
                draining = Some(Instant::now());
            }
        }
        if draining.is_some_and(|at| at.elapsed() >= Duration::from_millis(request.cleanup_ms)) {
            return Err("unsettled");
        }
        let input = match rx.recv_timeout(Duration::from_millis(5)) {
            Ok(input) => input,
            Err(RecvTimeoutError::Timeout) => continue,
            Err(RecvTimeoutError::Disconnected) => {
                thread::sleep(Duration::from_millis(5));
                continue;
            }
        };
        let committed = matches!(gate, Gate::Committed);
        match input {
            Input::Closed => closed += 1,
            Input::Disconnected => {
                if failure.is_none() {
                    if link.detachable && committed {
                        link.detach()?;
                    } else {
                        failure = Some("cancelled");
                    }
                }
            }
            Input::Invalid => {
                if failure.is_none() {
                    failure = Some("protocol");
                }
            }
            Input::Control(Control::Cancel { request_id }) => {
                if failure.is_none() {
                    failure = Some(if request_id == request.request_id {
                        "cancelled"
                    } else {
                        "protocol"
                    });
                }
            }
            Input::Control(Control::Commit { request_id }) if failure.is_none() => {
                if request_id != request.request_id
                    || !matches!(gate, Gate::Ready)
                    || !identity.as_ref().is_some_and(Identity::alive)
                {
                    failure = Some("protocol");
                } else {
                    let elapsed = started.elapsed().as_millis() as u64;
                    if let Some(reason) = budget.observe(elapsed, 0) {
                        failure = Some(reason.code());
                    } else if let Some(Err(code)) = link.record.as_mut().map(Record::committed) {
                        // The durable commit precedes code release, never follows it.
                        failure = Some(code);
                    } else if let Some(code) = request
                        .phase_deadline
                        .as_ref()
                        .and_then(|deadline| deadline.check().err())
                    {
                        failure = Some(code);
                    } else if stdin
                        .as_mut()
                        .is_none_or(|pipe| pipe.write_all(b"go\n").is_err())
                    {
                        failure = Some("execution_failed");
                    } else {
                        stdin.take();
                        gate = Gate::Committed;
                    }
                }
            }
            Input::Ready(info) if failure.is_none() => {
                if !matches!(gate, Gate::Waiting) {
                    failure = Some("protocol");
                    continue;
                }
                match Identity::capture(&info) {
                    Ok(owner) => {
                        if let Some(record) = link.record.as_mut()
                            && let Err(code) = record.ready(&owner.terminated())
                        {
                            failure = Some(code);
                            continue;
                        }
                        identity = Some(owner);
                        gate = Gate::Ready;
                        link.send(
                            &Event::Ready {
                                request_id: &request.request_id,
                                info: &info,
                            },
                            false,
                        )?;
                    }
                    Err(code) => failure = Some(code),
                }
            }
            Input::Output(channel, bytes) if failure.is_none() => {
                let elapsed = started.elapsed().as_millis() as u64;
                if let Some(reason) = budget.observe(elapsed, bytes.len() as u64) {
                    failure = Some(reason.code());
                } else {
                    if link.detachable {
                        let target = if channel == "stdout" {
                            &mut retained.0
                        } else {
                            &mut retained.1
                        };
                        target.extend_from_slice(&bytes);
                    }
                    link.send(
                        &Event::Output {
                            request_id: &request.request_id,
                            channel,
                            data: &bytes,
                        },
                        committed,
                    )?;
                }
            }
            _ => {}
        }
    }
}
