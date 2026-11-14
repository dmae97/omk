# Finite Rust policy parity

The unpublished [`omk-policy-probe`](../../../native/omk-policy/README.md) is an
inactive mathematical port, not an execution host. Production remains Node.
R is used only by developer acceptance checks, never by the production agent loop.

## Scope

The first slice ports exact tool-DAG transitive reduction and its closure-memory
strategy. Input rows have fixed topological order and unique ascending predecessor
indices. The Rust domain is at most 16,370 nodes and 1,000,000 edges, with an integer
closure budget from zero through 16,777,216 bytes. Out-of-domain values fail closed.

Tests compare exact reduced predecessor rows, strategy labels and allocated
closure bytes. They do not compare only approximate scores or matching seeds.
The existing TypeScript producer and independent base-R oracle remain unchanged:

- 1,107 fixed graphs, including all 1,099 ordered DAGs with one to five nodes.
- Two budgets per graph: 2,214 DAG cases, including actual cross-word reductions.
- 16 allocation cases, including the exact 16 MiB boundary and traversal above it.
- Existing WPL and invalid-JavaScript checks still run in R, but are not Rust ports.

R checks closure and edge-removal minimality independently of the production
reducer. Its closed-form allocation check is separate from Rust's integer sum.
Large memory cases use fixed sparse graphs, not a huge R closure matrix. No
floating-point tolerance is needed for this slice. Allocation-failure injection,
stochastic routing, cost policies, process recovery and scheduler ownership remain
separate work.

## Run the gate

Build the Rust fixture executable as described in its README, with isolated
cache/output and read-only source. Then use the existing exporter without
overwriting an earlier bundle:

```sh
node --experimental-strip-types scripts/architecture/export-fixtures.mjs /path/to/new-bundle
OMK_RSCRIPT=/absolute/path/to/Rscript node scripts/architecture/verify-rust-policy.mjs /path/to/new-bundle /path/to/policy-fixtures
```

The Rust fixture program computes from the input columns only; it does not use
the expected reduction or strategy columns. The controller first requires the
real base-R PASS receipt, then compares every byte of the Rust result, including
case identity, graph order, strategy and closure bytes. Missing R, a failed child,
partial output, changed inputs or mismatched decisions fail the gate.
Direct and symlink CLI entries both run the gate; importing its exported function
does not execute the CLI.

The original six-source manifest stays unchanged. The additional receipt binds
the selected executable, new Rust sources, Cargo files and controller before and
after verification. These are integrity observations, not authentication or proof
that the supplied binary was built from those sources. Record the exact build
command and binary digest. The controller assumes trusted developer executables
and no hostile ABA writer; it does not prove process-tree cleanup.

```sh
OMK_RSCRIPT=/absolute/path/to/Rscript POLICY_TEST_BINARY=/path/to/policy-fixtures node --experimental-strip-types --test scripts/test/rust-policy-oracle.test.mjs
```

Without those explicit test inputs, the corresponding integration tests report
named skips. The gate CLI itself never converts unavailable R into success.
Negative controls include a changed strategy with an identical graph, a missing
case, a zero exit without output and binary drift after genuine R verification.

See [the migration roadmap](omk-2-migration.md) for unimplemented host and UI work.
