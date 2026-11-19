//! Unpublished finite-input policy port; not an execution host.

pub const MAX_CLOSURE_BYTES: usize = 16_777_216;
pub const MAX_NODES: usize = 16_370;
pub const MAX_INPUT_EDGES: usize = 1_000_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PolicyError {
    Budget,
    NodeLimit,
    EdgeLimit,
    Predecessors,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Strategy {
    AlreadyReduced,
    Bitset,
    Traversal,
}

impl Strategy {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::AlreadyReduced => "already-reduced",
            Self::Bitset => "bitset",
            Self::Traversal => "traversal",
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub struct Reduction {
    pub dependencies: Vec<Vec<usize>>,
    pub strategy: Strategy,
    pub closure_bytes: usize,
}

/// Direct integer sum, independently checked against the R closed form.
pub fn closure_bytes(n: usize) -> Result<usize, PolicyError> {
    if n > MAX_NODES {
        return Err(PolicyError::NodeLimit);
    }
    Ok((0..n).map(|i| 4 * i.div_ceil(32)).sum())
}

/// Finite port of the TypeScript reducer's edge/order/strategy contract.
/// An allocation failure in the closure matrix selects exact traversal, never
/// partial output. The closure budget is not a total-process memory bound.
pub fn reduce(graph: &[Vec<usize>], budget: usize) -> Result<Reduction, PolicyError> {
    if budget > MAX_CLOSURE_BYTES {
        return Err(PolicyError::Budget);
    }
    let n = graph.len();
    let bytes = closure_bytes(n)?;
    let mut children = vec![0usize; n];
    let mut multi_parent = false;
    let mut multi_child = false;
    let mut edges = 0usize;
    for (target, row) in graph.iter().enumerate() {
        edges = edges.saturating_add(row.len());
        if edges > MAX_INPUT_EDGES {
            return Err(PolicyError::EdgeLimit);
        }
        let mut previous = None;
        for &predecessor in row {
            if predecessor >= target || previous.is_some_and(|p| predecessor <= p) {
                return Err(PolicyError::Predecessors);
            }
            previous = Some(predecessor);
            children[predecessor] += 1;
            multi_child |= children[predecessor] > 1;
        }
        multi_parent |= row.len() > 1;
    }
    if !multi_parent || !multi_child {
        return Ok(Reduction {
            dependencies: graph.to_vec(),
            strategy: Strategy::AlreadyReduced,
            closure_bytes: 0,
        });
    }
    let mut matrix = Vec::<u32>::new();
    let use_bitset = bytes <= budget && matrix.try_reserve_exact(bytes / 4).is_ok();
    let mut reduced = vec![Vec::new(); n];
    if use_bitset {
        matrix.resize(bytes / 4, 0);
        let mut offsets = vec![0; n + 1];
        for i in 0..n {
            offsets[i + 1] = offsets[i] + i.div_ceil(32);
        }
        for (target, row) in graph.iter().enumerate() {
            let offset = offsets[target];
            for &predecessor in row.iter().rev() {
                let index = offset + predecessor / 32;
                let bit = 1u32 << (predecessor % 32);
                if matrix[index] & bit != 0 {
                    continue;
                }
                reduced[target].push(predecessor);
                matrix[index] |= bit;
                let length = graph[predecessor].last().map_or(0, |p| p / 32 + 1);
                for word in 0..length {
                    let ancestors = matrix[offsets[predecessor] + word];
                    matrix[offset + word] |= ancestors;
                }
            }
            reduced[target].reverse();
        }
    } else {
        let mut marks = vec![0usize; n];
        let mut stack = Vec::with_capacity(n);
        for (target, row) in graph.iter().enumerate() {
            if row.len() <= 1 {
                reduced[target] = row.clone();
                continue;
            }
            let epoch = target + 1;
            for &predecessor in row.iter().rev() {
                if marks[predecessor] == epoch {
                    continue;
                }
                reduced[target].push(predecessor);
                marks[predecessor] = epoch;
                stack.push(predecessor);
                while let Some(node) = stack.pop() {
                    for &ancestor in &reduced[node] {
                        if marks[ancestor] != epoch {
                            marks[ancestor] = epoch;
                            stack.push(ancestor);
                        }
                    }
                }
            }
            reduced[target].reverse();
        }
    }
    Ok(Reduction {
        dependencies: reduced,
        strategy: if use_bitset {
            Strategy::Bitset
        } else {
            Strategy::Traversal
        },
        closure_bytes: if use_bitset { bytes } else { 0 },
    })
}
