use omk_policy_probe::{
    MAX_CLOSURE_BYTES, MAX_NODES, PolicyError, Strategy, closure_bytes, reduce,
};

#[test]
fn small_answers_and_exact_budget_decisions() {
    let graph = vec![vec![], vec![0], vec![0, 1]];
    for (budget, strategy, bytes) in [(0, Strategy::Traversal, 0), (8, Strategy::Bitset, 8)] {
        let result = reduce(&graph, budget).unwrap();
        assert_eq!(result.dependencies, vec![vec![], vec![0], vec![1]]);
        assert_eq!((result.strategy, result.closure_bytes), (strategy, bytes));
        assert_eq!(graph[2], vec![0, 1]);
    }
    for graph in [
        vec![],
        vec![vec![], vec![0]],
        vec![vec![], vec![], vec![0, 1]],
    ] {
        let result = reduce(&graph, MAX_CLOSURE_BYTES).unwrap();
        assert_eq!(result.dependencies, graph);
        assert_eq!(result.strategy, Strategy::AlreadyReduced);
        assert_eq!(result.closure_bytes, 0);
    }
}

#[test]
fn allocation_sum_and_cap_boundary_are_exact() {
    assert_eq!(closure_bytes(0), Ok(0));
    assert_eq!(closure_bytes(34), Ok(136));
    assert_eq!(closure_bytes(66), Ok(396));
    assert_eq!(closure_bytes(16_369), Ok(MAX_CLOSURE_BYTES));
    assert_eq!(closure_bytes(16_370), Ok(16_779_264));
    for n in [4, 31, 32, 33, 64, 512, 16_369, 16_370] {
        let graph: Vec<_> = (0..n)
            .map(|i| match i {
                0 => vec![],
                2 => vec![0],
                3 => vec![0, 1, 2],
                _ => vec![i - 1],
            })
            .collect();
        let result = reduce(&graph, MAX_CLOSURE_BYTES).unwrap();
        assert_eq!(result.dependencies[3], vec![1, 2]);
        assert_eq!(
            result.strategy,
            if n == 16_370 {
                Strategy::Traversal
            } else {
                Strategy::Bitset
            }
        );
        assert!(result.closure_bytes <= MAX_CLOSURE_BYTES);
    }
}

#[test]
fn invalid_typed_inputs_fail_before_reduction() {
    assert_eq!(closure_bytes(MAX_NODES + 1), Err(PolicyError::NodeLimit));
    assert_eq!(reduce(&[], MAX_CLOSURE_BYTES + 1), Err(PolicyError::Budget));
    assert_eq!(
        reduce(&[vec![0; 1_000_001]], 0),
        Err(PolicyError::EdgeLimit)
    );
    for graph in [
        vec![vec![0]],
        vec![vec![], vec![2]],
        vec![vec![], vec![0, 0]],
        vec![vec![], vec![], vec![1, 0]],
    ] {
        assert_eq!(reduce(&graph, 0), Err(PolicyError::Predecessors));
    }
}

fn closure(graph: &[Vec<usize>]) -> Vec<Vec<bool>> {
    let n = graph.len();
    let mut reach = vec![vec![false; n]; n];
    for (to, row) in graph.iter().enumerate() {
        for &from in row {
            reach[from][to] = true;
        }
    }
    for k in 0..n {
        for i in 0..n {
            for j in 0..n {
                reach[i][j] |= reach[i][k] && reach[k][j];
            }
        }
    }
    reach
}

#[test]
fn exhaustive_small_graphs_preserve_closure_and_are_minimal() {
    for n in 1..=5 {
        for mask in 0..(1u32 << (n * (n - 1) / 2)) {
            let mut bit = 0;
            let graph: Vec<_> = (0..n)
                .map(|to| {
                    (0..to)
                        .filter(|_| {
                            let keep = mask & (1 << bit) != 0;
                            bit += 1;
                            keep
                        })
                        .collect()
                })
                .collect();
            let expected = closure(&graph);
            let a = reduce(&graph, 0).unwrap();
            let b = reduce(&graph, MAX_CLOSURE_BYTES).unwrap();
            assert_eq!(a.dependencies, b.dependencies);
            assert_eq!(closure(&a.dependencies), expected);
            for (to, row) in a.dependencies.iter().enumerate() {
                for &from in row {
                    assert!(graph[to].contains(&from));
                    let mut removed = a.dependencies.clone();
                    removed[to].retain(|p| *p != from);
                    assert_ne!(closure(&removed), expected);
                }
            }
        }
    }
}
