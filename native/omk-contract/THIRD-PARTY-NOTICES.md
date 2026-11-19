# Third-party notices: omk-contract

This crate is part of OMK and is licensed under MIT, like the rest of the
repository. `LICENSE` at the repository root keeps the original Pi copyright,
and `NOTICE` records the fork lineage. A Rust port of MIT code is still derived
work.

## Direct dependencies

| Crate | Version | License | Repository |
| --- | --- | --- | --- |
| serde | =1.0.229 | MIT OR Apache-2.0 | https://github.com/serde-rs/serde |
| serde_json | =1.0.154 | MIT OR Apache-2.0 | https://github.com/serde-rs/json |

Both are used with `default-features = false`. `serde` enables `std` and
`derive`; `serde_json` enables `std`.

## Transitive dependencies

Resolved in `Cargo.lock`, matching the versions the other `native/` crates use:

| Crate | Version | License |
| --- | --- | --- |
| serde_core | 1.0.229 | MIT OR Apache-2.0 |
| serde_derive | 1.0.229 | MIT OR Apache-2.0 |
| itoa | 1.0.18 | MIT OR Apache-2.0 |
| memchr | 2.8.3 | Unlicense OR MIT |
| zmij | 1.0.23 | MIT |
| proc-macro2 | 1.0.107 | MIT OR Apache-2.0 |
| quote | 1.0.47 | MIT OR Apache-2.0 |
| syn | 3.0.9 | MIT OR Apache-2.0 |
| unicode-ident | 1.0.27 | (MIT OR Apache-2.0) AND Unicode-3.0 |

MIT is selected where there is a choice. Unicode-3.0 remains an additional
mandatory term for unicode-ident, so the graph is not MIT/Apache-only. The
applicable license texts are reproduced in `native/omk-execution/THIRD-PARTY-NOTICES.md`,
which covers the same ten packages at the same versions.

No new third-party code is introduced by this crate.
