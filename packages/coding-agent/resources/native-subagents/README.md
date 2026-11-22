# Native subagent repairs

`0.78.0.patch` contains bounded repairs to the public MIT package
[pi-subagents](https://github.com/nicobailon/pi-subagents), version `0.78.0`.
Upstream copyright and permission terms are in [LICENSE](LICENSE).

Public npm archive:
https://registry.npmjs.org/pi-subagents/-/pi-subagents-0.78.0.tgz

Registry integrity:
`sha512-AsOvPL1xaVFV4bqIlheQKNI2LmAoiAKTPXXxi39/BsWJTdMJIqAkZJ3iLi6bTsh2PZHG7Ur08b7VJOtgAMIAig==`

Scope: final admission/deadline checks, awaited disposal failure propagation,
native SDK model/session creation, selected MCP attachment and cleanup,
runner peer exports, and automatic deadline checkpoints at native turn boundaries.
The alias hunk expects an already native-adapted package using OMK peer names.
This is not a Pi-to-OMK converter or an admission bypass.

OMK's package manager applies these patches only during install/update, to an
explicit native `omk` manifest with the matching name and exact version.
Already repaired files are left untouched. Unknown versions, changed hunk
contexts and unsafe file paths fail before any package file is written.
Direct npm replacement outside OMK does not invoke this hook; use the updated
OMK installer to reapply repairs before loading that native package.
Personal agents, settings, credentials, session transcripts and local evidence
are not included. See [the migration guide](../../docs/omk-2-migration.md).
