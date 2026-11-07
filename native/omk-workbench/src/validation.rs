use crate::model::Snapshot;
use std::collections::HashSet;

const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

fn id(value: &str) -> bool {
    (1..=128).contains(&value.len())
        && value.as_bytes()[0].is_ascii_alphanumeric()
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

fn digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

pub(crate) fn valid(s: &Snapshot) -> bool {
    let c = &s.cursor.0;
    let state = &s.state.0;
    if s.schema_version != "omk.run-graph.v1"
        || s.runtime != "node"
        || s.graph_kind != "verified-run"
        || s.execution_requested
        || s.capabilities.0.execute
        || s.capabilities.0.amend_graph
        || !id(&s.run_id)
        || !(1..=MAX_SAFE_INTEGER).contains(&c.revision)
        || !(1..=MAX_SAFE_INTEGER).contains(&c.generation)
        || c.authority_revision > MAX_SAFE_INTEGER
        || !digest(&c.authority_digest)
        || (c.authority_revision == 0 && c.authority_digest != "0".repeat(64))
        || !digest(&c.journal_digest)
        || !digest(&c.contract_digest)
        || [
            &c.candidate_digest,
            &c.receipt_digest,
            &c.environment_digest,
        ]
        .iter()
        .any(|value| value.as_ref().is_some_and(|text| !digest(text)))
        || !["ready", "running", "paused", "succeeded", "failed"]
            .contains(&state.execution.as_str())
        || !["open", "draining", "settled", "quarantined"].contains(&state.settlement.as_str())
        || !["not_requested", "verified", "violated", "inconclusive"]
            .contains(&state.verification.as_str())
        || !["not_requested", "candidate_ready"].contains(&state.application.as_str())
        || ![
            "none",
            "intent",
            "accepted",
            "failed",
            "reconciliation_required",
        ]
        .contains(&state.publication.as_str())
        || !["verified", "unverified", "inconclusive", "violated"]
            .contains(&s.proof_verdict.as_str())
        || s.nodes.len() > 16
        || s.edges.len() > 240
    {
        return false;
    }
    let ids: HashSet<_> = s.nodes.iter().map(|node| node.0.id.as_str()).collect();
    if ids.len() != s.nodes.len() {
        return false;
    }
    let mut expected = HashSet::new();
    for node in &s.nodes {
        let n = &node.0;
        if !id(&n.id)
            || n.attempt > 2
            || !["pending", "running", "succeeded", "failed", "missing"]
                .contains(&n.status.as_str())
            || n.depends_on.len() > 15
            || n.depends_on
                .iter()
                .any(|dep| dep == &n.id || !ids.contains(dep.as_str()))
            || n.generation.is_some_and(|g| g == 0 || g > c.generation)
            || (n.status == "missing") != n.generation.is_none()
            || (n.status == "missing" && (n.attempt != 0 || n.ready))
            || (n.status != "pending" && n.status != "missing" && n.attempt == 0)
            || (n.ready && (n.status != "pending" || n.generation != Some(c.generation)))
        {
            return false;
        }
        for dep in &n.depends_on {
            if !expected.insert((dep.as_str(), n.id.as_str())) {
                return false;
            }
        }
    }
    let mut edges = HashSet::new();
    for edge in &s.edges {
        let e = &edge.0;
        if e.kind != "dependency" || !edges.insert((e.source.as_str(), e.target.as_str())) {
            return false;
        }
    }
    if edges != expected {
        return false;
    }
    // At most 16 verified-run tasks; this is validation, not a second scheduler.
    let mut visited = HashSet::new();
    loop {
        let before = visited.len();
        for node in &s.nodes {
            if node
                .0
                .depends_on
                .iter()
                .all(|dep| visited.contains(dep.as_str()))
            {
                visited.insert(node.0.id.as_str());
            }
        }
        if visited.len() == before {
            return visited.len() == s.nodes.len();
        }
    }
}
