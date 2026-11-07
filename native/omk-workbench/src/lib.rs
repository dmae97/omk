#![forbid(unsafe_code)]

mod model;
mod validation;

pub use model::Snapshot;

pub const MAX_FRAME_BYTES: usize = 262_144;

#[derive(Debug, Eq, PartialEq)]
pub enum GraphError {
    Frame,
    Schema,
    Binding,
    Conflict,
    Regression,
}

pub fn decode_frame(frame: &[u8]) -> Result<Snapshot, GraphError> {
    if frame.len() < 2 || frame.len() > MAX_FRAME_BYTES + 1 || frame.last() != Some(&b'\n') {
        return Err(GraphError::Frame);
    }
    let bytes = &frame[..frame.len() - 1];
    if bytes.iter().any(|b| *b == b'\r' || *b == b'\n') {
        return Err(GraphError::Frame);
    }
    let model::Object(snapshot) = serde_json::from_slice(bytes).map_err(|_| GraphError::Schema)?;
    if !validation::valid(&snapshot) {
        return Err(GraphError::Schema);
    }
    Ok(snapshot)
}

#[derive(Debug, Eq, PartialEq)]
pub enum Update {
    Installed,
    Duplicate,
    Stale,
}

#[derive(Default)]
pub struct GraphView {
    current: Option<Snapshot>,
}

impl GraphView {
    pub fn current(&self) -> Option<&Snapshot> {
        self.current.as_ref()
    }

    /// Full snapshots can skip revisions; this does not implement incremental event replay.
    pub fn apply(&mut self, frame: &[u8]) -> Result<Update, GraphError> {
        let next = decode_frame(frame)?;
        if let Some(current) = &self.current {
            if current.run_id != next.run_id
                || current.cursor.0.contract_digest != next.cursor.0.contract_digest
            {
                return Err(GraphError::Binding);
            }
            let old = &current.cursor.0;
            let new = &next.cursor.0;
            if (new.authority_revision == old.authority_revision
                && new.authority_digest != old.authority_digest)
                || (new.revision == old.revision
                    && (new.generation != old.generation
                        || new.journal_digest != old.journal_digest
                        || new.candidate_digest != old.candidate_digest
                        || new.receipt_digest != old.receipt_digest
                        || new.environment_digest != old.environment_digest
                        || next.state != current.state
                        || next.nodes != current.nodes
                        || next.edges != current.edges))
            {
                return Err(GraphError::Conflict);
            }
            if new.revision <= old.revision
                && new.authority_revision <= old.authority_revision
                && (new.revision < old.revision || new.authority_revision < old.authority_revision)
            {
                return Ok(Update::Stale);
            }
            if new.revision < old.revision || new.authority_revision < old.authority_revision {
                return Err(GraphError::Regression);
            }
            if new.revision == old.revision && new.authority_revision == old.authority_revision {
                return if current == &next {
                    Ok(Update::Duplicate)
                } else {
                    Err(GraphError::Conflict)
                };
            }
            if next.cursor.0.generation < current.cursor.0.generation {
                return Err(GraphError::Regression);
            }
        }
        self.current = Some(next);
        Ok(Update::Installed)
    }
}
