# Issue 601 report

SSOT for `https://github.com/can1357/oh-my-pi/issues/601`.

Date: `2026-04-09`
Repo: `/root/projects/project-oh-my-pi-fork`
Branch: `research/native-illegal-instruction`
Base during investigation: `upstream/main @ d350ea60ef2f006945a9da3ce510fbe23093a779`
Reporter on issue: `@MikeeI`
Goal: preserve all verified findings, strongest hypotheses, dead ends, local experiments, and next steps so follow-on agents do not restart from zero.

## Bottom line

- Visible symptom: typing non-empty `@` mention in TUI crashes `omp` with `Illegal instruction`.
- Narrow trigger: `@<char>` enters native `fuzzyFind()` path.
- Root defect almost certainly below TUI and below Bun: broken Linux `x64` native addon artifacts.
- Strongest currently defensible statement:
  1. published Linux `x64` artifacts for `@oh-my-pi/pi-natives` are ISA-unsafe on at least some releases
  2. installed `linux-x64-modern` and `linux-x64-baseline` artifacts on this machine contain AVX-512 markers
  3. direct Node loading of installed `.node` also exits `132`
  4. `@` mention autocomplete only exposes that native crash
- High-value maintainer work: inspect native artifact production/release path, not TUI surgery.

## Confidence map

### Confirmed

- Non-empty `@` mention reaches native `fuzzyFind()`.
- Installed published Linux `x64` artifacts on this machine contain AVX-512 markers.
- Installed published artifact crashes under direct Node load; not Bun-only.
- Existing repo-local `pi_natives.linux-x64-modern.node` on this machine does not show AVX-512 markers and does not crash.
- `v13.17.6 -> v13.18.0` changed no relevant source in native/TUI/CI path.
- `v13.18.0 -> v13.19.0` changed no relevant source in native/TUI/CI path.
- Therefore issue timeline `good -> bad -> good` is not explained by git-tracked source deltas in those windows.
- Local investigation found one real build-pipeline defect: `zlob` host Zig builds default to `native`, bypassing intended x64 ISA contract.
- Local investigation found one experiment-corrupting hazard in `build-native.ts`: stale canonical `.node` files in `packages/natives/native/` can be reused and mistaken for fresh build output.

### Strong but not fully proven

- Release artifacts are nondeterministically wrong or stale-artifact contaminated.
- At least one defect sits in release/build/package flow, not only runtime loading.
- `v14.0.2` likely resurfaced latent native artifact problems by reworking variant build/upload flow.

### Unproven

- Exact release job / exact machine state that produced bad npm artifacts.
- Whether bad ISA comes only from `zlob`, from another native dependency, from linker/LTO, or from artifact reuse.
- Whether current upstream source, in a truly clean release-like environment, still emits bad `modern`, bad `baseline`, or both.

## User-visible timeline

Issue thread facts from `#601`:

- Reporter: crash reproducible typing `@` then letter; first reported on `13.18.0`.
- Comment: `13.17.6` did not crash.
- Comment: `13.19.0` seemed fixed.
- Comment: `14.0.2` regressed / issue back.

Resolved tag commits:

- `v13.17.6` -> `6ef48e02a694eb5deb91bbe7ac8716bcc9cd9261`
- `v13.18.0` -> `3f60ba602abead98563fdab1d9d3db6b28cef429`
- `v13.19.0` -> `e52535c51cc2147f8d1ae2d6e25f92a771ce1df6`
- `v14.0.2` -> `8f8ced7d77a53a6bbc56366cacd0d5ac70cefe8e`
- `v14.0.3` -> `fd67efc046543bb5c65a81fca6c638b57f491dfd`

Regression-hunt result:

- `v13.17.6..v13.18.0`: no relevant changes in `packages/natives`, `packages/tui`, `.github/workflows/ci.yml`, native release scripts; only package version bumps for `pi-natives` and `pi-tui`.
- `v13.18.0..v13.19.0`: same; no relevant native/TUI/CI logic change, only version bumps.
- Consequence: source history alone does not explain `13.17.6 good / 13.18.0 bad / 13.19.0 good`.
- Highest-confidence interpretation: release artifacts or release environment varied; not a simple code regression in that narrow window.

## Repro path in source

Current upstream source path:

- `packages/tui/src/autocomplete.ts`

Relevant control flow:

```ts
const atPrefix = this.#extractAtPrefix(textBeforeCursor);
if (atPrefix) {
	const { rawPrefix, isQuotedPrefix } = parsePathPrefix(atPrefix);
	const suggestions =
		rawPrefix.length > 0
			? await this.#getFuzzyFileSuggestions(rawPrefix, { isQuotedPrefix })
			: await this.#getFileSuggestions("@");
}
```

```ts
const scopedQuery = await this.#resolveScopedFuzzyQuery(query);
const searchPath = scopedQuery?.baseDir ?? this.#basePath;
const fuzzyQuery = scopedQuery?.query ?? query;
const result = await fuzzyFind(buildAutocompleteFuzzyDiscoveryProfile(fuzzyQuery, searchPath), this.#searchDb);
```

Conclusion:

- Bare `@`: does not hit native fuzzy path.
- `@<char>`: does hit native `fuzzyFind()`.
- TUI bug report is accurate at trigger level, misleading at root-cause level.

## Core evidence

### 1. Direct Node load also crashes

Command:

```bash
node -e 'const mod = require("/root/.bun/install/global/node_modules/@oh-my-pi/pi-natives/native/pi_natives.linux-x64-modern.node"); mod.fuzzyFind({ query: "a", path: "/tmp", maxResults: 5, hidden: true, gitignore: true, cache: true }).then(res => console.log(JSON.stringify(res))).catch(err => { console.error(err); process.exit(1); });'
```

Observed:

- exit code `132`
- no JS exception first

Meaning:

- root failure below Bun, below TUI
- native addon alone sufficient to reproduce

### 2. Published installed artifacts contain AVX-512 markers

Command used during investigation:

```bash
python3 - <<'PY'
import subprocess, re
files = {
    'local_repo_modern': '/root/projects/project-oh-my-pi-fork/packages/natives/native/pi_natives.linux-x64-modern.node',
    'global_installed_modern': '/root/.bun/install/global/node_modules/@oh-my-pi/pi-natives/native/pi_natives.linux-x64-modern.node',
    'global_installed_baseline': '/root/.bun/install/global/node_modules/@oh-my-pi/pi-natives/native/pi_natives.linux-x64-baseline.node',
}
for name, path in files.items():
    proc = subprocess.run(['objdump','-d',path], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    text = proc.stdout
    zmm = len(re.findall(r'\bzmm\d+\b', text))
    mask = len(re.findall(r'\bk[0-7]\b', text))
    print(f'{name}: zmm={zmm} mask={mask}')
PY
```

Observed:

```text
local_repo_modern: zmm=0 mask=0
global_installed_modern: zmm=5298 mask=1203
global_installed_baseline: zmm=5298 mask=1203
```

Representative installed disassembly snippet:

```text
60ba1df:	c4 c1 78 92 c9        kmovw  %r9d,%k1
```

Meaning:

- installed published `modern` bad
- installed published `baseline` also bad
- `baseline` showing AVX-512 markers rules out simple `modern too aggressive` story

### 3. Existing repo-local modern artifact works

Command:

```bash
node -e 'const mod = require("/root/projects/project-oh-my-pi-fork/packages/natives/native/pi_natives.linux-x64-modern.node"); mod.fuzzyFind({ query: "a", path: "/tmp", maxResults: 5, hidden: true, gitignore: true, cache: true }).then(res => console.log(JSON.stringify({ ok: true, count: res.matches.length, first: res.matches[0] ?? null }))).catch(err => { console.error(err); process.exit(1); });'
```

Observed:

```json
{"ok":true,"count":5,"first":{"path":"a0629736a5db3561c8b46bdc4b3ce835/","isDirectory":true,"score":110}}
```

Caveat:

- this artifact pre-existed in local workspace; not a clean latest rebuild during investigation
- still strong proof that same machine can run a safe `modern` addon

## Current source intent vs published reality

Current loader/runtime intent:

- `baseline` should mean `x86-64-v2`
- `modern` should mean `x86-64-v3`
- runtime picks `modern` when AVX2 available, else `baseline`

Relevant file:

- `packages/natives/native/index.js`

Relevant logic:

```js
function resolveCpuVariant(override) {
	if (process.arch !== "x64") return null;
	if (override) return override;
	return detectAvx2Support() ? "modern" : "baseline";
}
```

```js
function getAddonFilenames(tag, variant) {
	const defaultFilename = `pi_natives.${tag}.node`;
	if (process.arch !== "x64" || !variant) return [defaultFilename];
	const baselineFilename = `pi_natives.${tag}-baseline.node`;
	const modernFilename = `pi_natives.${tag}-modern.node`;
	if (variant === "modern") {
		return [modernFilename, baselineFilename, defaultFilename];
	}
	return [baselineFilename, defaultFilename];
}
```

Published reality on this machine:

- both installed Linux `x64` variants contain AVX-512 markers
- published artifacts do not match source-level ISA contract

## Earlier commits that introduced risk surface

These commits matter because they created variant-specific x64 release logic and ISA-sensitive builds. They do not, alone, explain the issue timeline.

### `81a270fcd` `ci(workflows): added RUSTFLAGS configuration for x86-64-v3 CPU optimization in CI and native builds`

Effects:

- CI sets `RUSTFLAGS=-C target-cpu=x86-64-v3` for x64 jobs
- local build script defaults host builds to `target-cpu=native` when `RUSTFLAGS` unset

Risk:

- source of ISA-sensitive behavior entered CI and local build path

### `aa68afc2f` `ci(workflows): updated Bun binary build targets to use modern variants`

Effects:

- compiled binary release targets switched to `bun-linux-x64-modern` and `bun-windows-x64-modern`

Risk:

- modern/baseline split became operational in release pipeline

### `e9ab0354f` `feat: added CPU variant support for x64 native addons with AVX2/baseline fallback`

Effects:

- introduced `TARGET_VARIANT`
- introduced `modern` / `baseline` filenames
- introduced runtime CPU variant selection

Risk:

- build/release/packaging complexity increased sharply

### `e928b7834` `refactor(natives): migrated native bindings to NAPI-RS with auto-generated types`

Effects:

- moved build flow to `napi build`
- changed output normalization logic and native packaging shape

Risk:

- another large source of release/build nondeterminism and output-file normalization mistakes

### `8f8ced7d7` `fix(ci): accept napi plain platform filename and pass TARGET_VARIANTS`

Effects:

- `v14.0.2`
- explicitly builds variant matrix with `TARGET_VARIANTS`
- changed native artifact normalization/upload flow again

Interpretation:

- strongest candidate for why issue visibly returned in `14.0.2`
- not strong candidate for original `13.18.0` appearance because it is much later

## New finding: one real upstream build defect in native dependency path

Dependency:

- Cargo crate `zlob v1.3.0`
- file read during investigation: `/root/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/zlob-1.3.0/build.rs`

Relevant behavior in `build.rs`:

- if `target == host` and target not Windows, it sets Zig target to `native`
- then runs `zig build`
- this can compile the Zig static library for host-native ISA even when Rust addon itself targets `x86-64-v2` or `x86-64-v3`

Relevant snippet:

```rs
let zig_target = if target == host && !target.contains("windows") {
    "native"
} else {
    rust_target_to_zig(&target)
};
```

Meaning:

- Rust `RUSTFLAGS=-C target-cpu=x86-64-v2/v3` does not automatically constrain host-built Zig dependencies
- at least one real root-cause path existed in build graph

## New finding: stale artifact reuse hazard in current build script

File:

- `packages/natives/scripts/build-native.ts`

Current logic:

```ts
async function resolveBuiltAddonPath(canonicalFilename: string): Promise<string> {
	const entries = await fs.readdir(nativeDir);

	if (entries.includes(canonicalFilename)) {
		return path.join(nativeDir, canonicalFilename);
	}

	const generatedCandidates = entries.filter(entry => {
		if (!entry.startsWith(`pi_natives.${targetPlatform}-${targetArch}`) || !entry.endsWith(".node")) {
			return false;
		}
		return !siblingVariantFilenames.has(entry);
	});
	...
}
```

Meaning:

- if `packages/natives/native/pi_natives.<platform>-<arch><variant>.node` already exists, script treats it as current build output before checking what `napi build` actually emitted
- stale local artifact can be silently reused
- rebuild experiments can lie unless canonical `.node` files are removed first or output dir is isolated

Importance:

- high for follow-on investigators
- explains why some local rebuild results are lower-confidence than they first appeared
- may or may not explain CI release bug directly; CI fresh checkouts reduce this risk, local/dev/repeated builds do not

Experiment hygiene rule from this finding:

- do not trust any rebuild result while old `.node` files remain in `packages/natives/native/`
- use isolated output dir or ensure canonical files deleted before build

## Local branch work done during investigation

Uncommitted exploratory hardening added on this branch:

- `packages/natives/scripts/build-native.ts`
- `packages/natives/scripts/zig-safe-wrapper.ts`
- `scripts/ci-release-verify-natives.ts`
- `packages/natives/test/build-safety.test.ts`

Purpose:

- force host Zig dependency builds to explicit `x86_64_v2` / `x86_64_v3` contract
- add release-time `objdump` guard for AVX-512 markers
- add focused tests for wrapper/guard logic

What this patch proves:

- `zlob` host-native Zig path is real and preventable
- release verifier can reliably fail on known-bad published artifacts

What this patch does not yet prove:

- full issue fixed
- fresh clean `modern` artifact safe in all cases
- fresh clean `baseline` artifact safe in all cases

## Verification done on local branch

### Focused tests

Command:

```bash
bun test packages/natives/test/build-safety.test.ts
```

Observed:

- `5 pass`

### Workspace typecheck

Command:

```bash
bun check:ts
```

Observed:

- pass

### Verify installed published package with new ISA guard

Command:

```bash
PI_NATIVE_VERIFY_DIR=/root/.bun/install/global/node_modules/@oh-my-pi/pi-natives/native bun scripts/ci-release-verify-natives.ts
```

Observed:

- script reports all expected native files present
- then fails with:

```text
pi_natives.linux-x64-baseline.node contains AVX-512 markers; x86-64-v2 artifacts must stay below x86-64-v4.
pi_natives.linux-x64-modern.node contains AVX-512 markers; x86-64-v3 artifacts must stay below x86-64-v4.
```

Meaning:

- issue reproduced through artifact-level guard, not only runtime crash

## Local rebuild experiments after Zig-wrapper hardening

### Build environment repaired first

Initial blocker:

- `zlob` bindgen failed: `fatal error: 'stddef.h' file not found`

Mitigation used locally:

- installed `clang`, `libc6-dev`, `build-essential`
- downloaded Zig `0.15.2` to `/root/tools/zig-x86_64-linux-0.15.2`

### First baseline build after wrapper patch

Command:

```bash
PATH=/root/tools/zig-x86_64-linux-0.15.2:$PATH CI=1 TARGET_VARIANT=baseline RUSTFLAGS='-C target-cpu=x86-64-v2' bun --cwd=packages/natives run build
```

Observed important line:

```text
Normalizing native addon filename: pi_natives.linux-x64-gnu.node → pi_natives.linux-x64-baseline.node
```

Meaning:

- this particular baseline artifact came from fresh `napi` output normalization, not only stale canonical reuse

Subsequent `objdump` count on baseline after this run:

```text
/root/projects/project-oh-my-pi-fork/packages/natives/native/pi_natives.linux-x64-baseline.node: zmm=5270 mask=38
```

Meaning:

- even after constraining host Zig path, a fresh baseline artifact still showed AVX-512 markers
- therefore `zlob native target` was not the whole problem

### Modern build after wrapper patch

Command:

```bash
PATH=/root/tools/zig-x86_64-linux-0.15.2:$PATH CI=1 TARGET_VARIANT=modern RUSTFLAGS='-C target-cpu=x86-64-v3' bun --cwd=packages/natives run build
```

Subsequent count:

```text
/root/projects/project-oh-my-pi-fork/packages/natives/native/pi_natives.linux-x64-modern.node: zmm=0 mask=0
```

Caution:

- `build-native.ts` stale-canonical logic can reuse existing `pi_natives.linux-x64-modern.node`
- because canonical `modern` file already existed in `packages/natives/native/`, this safe result is lower-confidence than baseline result
- treat `modern safe after wrapper` as suggestive, not conclusive

### Later clean attempts

Commands used:

```bash
cargo clean -p zlob -p pi-natives
cargo clean
```

Why these are not decisive:

- `cargo clean` clears Cargo targets, not `packages/natives/native/*.node`
- stale-canonical reuse path remains unless canonical `.node` files in `native/` are removed or output redirected

## New finding after isolated rebuilds

> This section supersedes the earlier simplistic reading of `any AVX-512 marker == broken build`.

### CPU capability on this machine

- `/proc/cpuinfo` shows no `avx512` flags on this host.

### Exact runtime result of isolated latest-version rebuilds

After hardening `build-native.ts` to isolate `CARGO_TARGET_DIR` and remove preexisting addon outputs, both latest-version Linux `x64` variants were rebuilt locally from current source.

Commands used:

```bash
PATH=/root/tools/zig-x86_64-linux-0.15.2:$PATH CI=1 TARGET_VARIANT=baseline RUSTFLAGS='-C target-cpu=x86-64-v2' bun --cwd=packages/natives run build
PATH=/root/tools/zig-x86_64-linux-0.15.2:$PATH CI=1 TARGET_VARIANT=modern   RUSTFLAGS='-C target-cpu=x86-64-v3' bun --cwd=packages/natives run build
```

Direct runtime checks on rebuilt local artifacts:

```bash
node -e 'const mod = require("/root/projects/project-oh-my-pi-fork/packages/natives/native/pi_natives.linux-x64-baseline.node"); mod.fuzzyFind({ query: "a", path: "/tmp", maxResults: 5, hidden: true, gitignore: true, cache: true }).then(res => console.log(JSON.stringify({ ok: true, count: res.matches.length }))).catch(err => { console.error(err); process.exit(1); });'
node -e 'const mod = require("/root/projects/project-oh-my-pi-fork/packages/natives/native/pi_natives.linux-x64-modern.node");   mod.fuzzyFind({ query: "a", path: "/tmp", maxResults: 5, hidden: true, gitignore: true, cache: true }).then(res => console.log(JSON.stringify({ ok: true, count: res.matches.length }))).catch(err => { console.error(err); process.exit(1); });'
bun -e 'import mod from "./packages/natives/native/index.js"; const res = await mod.fuzzyFind({ query: "a", path: "/tmp", maxResults: 5, hidden: true, gitignore: true, cache: true }); console.log(JSON.stringify({ ok: true, count: res.matches.length }));'
bun -e 'import { CombinedAutocompleteProvider } from "./packages/tui/src/autocomplete.ts"; const provider = new CombinedAutocompleteProvider([], "/tmp"); const line = "@a"; const result = await provider.getSuggestions([line], 0, line.length); console.log(JSON.stringify({ ok: true, count: result?.items.length ?? 0 }));'
```

Observed:

- rebuilt local `baseline`: no crash
- rebuilt local `modern`: no crash
- rebuilt local package under Bun: no crash
- exact autocomplete path `CombinedAutocompleteProvider.getSuggestions(["@a"])`: no crash, returned suggestions
- installed published `modern` package still crashes with exit `132` on the same machine

Meaning:

- latest-version local rebuilds appear to fix the actual crash trigger on this machine
- the original artifact-level verifier heuristic (`any AVX-512 marker => fail`) is too coarse

### Why the original AVX-512 verifier was too coarse

Marker counts after isolated rebuild:

```text
local baseline: zmm=5270 mask=38
local modern:   zmm=5270 mask=38
installed modern: zmm=5298 mask=1203   # earlier installed-package measurement
installed baseline: zmm=5298 mask=1203 # earlier installed-package measurement
```

New deeper finding:

- local rebuilt artifacts still contain some AVX-512 instructions
- but they no longer crash on this non-AVX512 machine in the tested `fuzzyFind` / `@a` path
- installed published artifact contains many more AVX-512 clusters and does crash

Cluster analysis of AVX-512 instruction ranges:

- local rebuilt `modern`: 5 clusters
- installed published `modern`: 117 clusters

Mnemonic distribution difference:

- local rebuilt `modern`: mostly `vpaddd`, `vpxord`, `vprord`, `vpbroadcastd`, limited mask ops
- installed published `modern`: same core block plus many extra `vpcmpeqb`, `vpcmpneqb`, `kortestd`, `kortestw`, `vptestnmb`, `vpblendmb`, `kord`, `kmovd`

Interpretation:

- some AVX-512 in local rebuilds is likely benign dispatch-gated code
- installed artifact contains many additional suspicious AVX-512 blocks not present in local rebuild
- therefore the real issue is closer to `unexpected extra AVX-512 code entered published artifact` than `published artifact contains any AVX-512 bytes at all`

### Source of local rebuilt AVX-512 markers

Scanning static libs in isolated baseline build showed only two marker-bearing libraries:

```text
5308 .../release/deps/libfff_search-*.a
5308 .../release/build/blake3-*/out/libblake3_avx512_assembly.a
```

Meaning:

- local rebuilt AVX-512 markers come from `fff-search` / `blake3` AVX-512 assembly inclusion
- this explains why `any marker == broken` is too strict
- next verifier revision must distinguish expected dispatch-gated assembly from the additional suspicious AVX-512 blocks seen in bad published artifacts

### Updated best interpretation

- build isolation + stale-output removal + host-Zig ISA pinning were real fixes
- those changes appear sufficient to remove the crashing published-artifact behavior in local latest-version rebuilds on this machine
- remaining work is proving the exact difference between safe local rebuild and bad published artifact, then encoding that difference as a durable release guard

## Final fix candidate from dependency tracing

Goal decision: shipped Linux `x64` addons should contain zero AVX-512 instructions.

Dependency trace:

```text
pi-natives -> fff-search -> blake3
```

Key finding from source inspection:

- `blake3` exposes a Cargo feature `no_avx512`, but `blake3-1.8.4/build.rs` does not use it when deciding whether to compile AVX-512 assembly
- therefore enabling `no_avx512` alone does not remove AVX-512 object code from final artifacts
- `blake3` feature `pure` does work for this use case because `build.rs` checks `is_pure()` and skips AVX-512 build steps

Tested fix in current branch:

- added direct `blake3 = { version = "1.8.4", default-features = false, features = ["std", "pure"] }` dependency in `crates/pi-natives/Cargo.toml`
- rationale: Cargo feature unification forces `fff-search`'s transitive `blake3` build onto the `pure` path without vendoring `fff-search` or `blake3`

Observed result after isolated rebuilds:

```text
pi_natives.linux-x64-baseline.node zmm=0 mask=0
pi_natives.linux-x64-modern.node   zmm=0 mask=0
```

Runtime verification after this dependency change:

- direct Node load of rebuilt local `baseline` + `fuzzyFind()` succeeds
- exact Bun autocomplete path for `@a` succeeds
- verifier script passes for rebuilt local linux-x64 artifacts

This is the first configuration in this investigation that simultaneously gives:

- isolated current-source rebuilds
- zero AVX-512 in final Linux `x64` addons
- no crash on the actual `fuzzyFind` / `@a` path

Current best fix recommendation:

1. keep build isolation / stale-output removal / per-variant target dirs
2. keep host-Zig ISA pinning
3. keep artifact-level verify gate
4. force transitive `blake3` onto `pure` for `pi-natives` builds unless/until upstream provides a compile-time-respected `no_avx512` path
5. publish fresh release from latest source with these changes

Potential follow-up refinement:

- if maintainers want AVX2/SSE assembly back while still forbidding AVX-512, upstream `blake3` likely needs a patch so `no_avx512` affects build.rs assembly selection
- until then, `pure` is the simplest durable zero-AVX512 fix

## Best current explanation

Most plausible multi-factor explanation:

1. x64 variant support introduced ISA-sensitive build/release complexity
2. release path produced or selected unsafe artifacts for some releases
3. installed published Linux `x64` artifacts contain AVX-512 markers under both `modern` and `baseline`
4. issue timeline `13.17.6 good / 13.18.0 bad / 13.19.0 good / 14.0.2 bad again` points to artifact nondeterminism or stale artifact reuse, not simple source regression in those narrow windows
5. at least one true build bug existed in dependency graph: host Zig `native`
6. at least one more problem remains: fresh baseline build still too new, or experiment path still contaminated, or both

## What this report rules out

- pure TUI bug
- pure Bun bug
- simple `modern only` ISA issue
- clean source-only regression between `13.17.6` and `13.18.0`
- clean source-only fix between `13.18.0` and `13.19.0`

## Highest-value next steps

### Priority 1: artifact-truth before theory

- reproduce `v13.18.0`, `v13.19.0`, `v14.0.2`, `v14.0.3` native release builds in isolated clean environments
- for each version, inspect final Linux `x64` `.node` files with `objdump`
- record whether `baseline` / `modern` contain `zmm` or `k[0-7]`

### Priority 2: eliminate stale-output lies from experiments

- make build output dir isolated per run, or delete canonical `.node` files before build
- fix `resolveBuiltAddonPath()` so existing canonical file cannot masquerade as fresh build output

### Priority 3: separate compiler vs packaging failures

- inspect raw `napi build` outputs before normalization/rename
- hash raw outputs and final renamed outputs
- verify whether both published filenames were copied from same build lineage

### Priority 4: inspect release workflow statefulness

Targets:

- `.github/workflows/ci.yml`
- `scripts/ci-build-native.ts`
- `scripts/ci-release-verify-natives.ts`
- release publish/staging steps

Questions:

- same workspace used for multiple variant builds?
- previous variant outputs left in `packages/natives/native/`?
- upload/download artifact merge steps able to overwrite or mix variants?
- publish packaging able to include stale local `.node` files?

### Priority 5: inspect baseline-specific contamination

Because fresh baseline looked bad even after Zig wrapper:

- identify which object files/symbols contain AVX-512 markers in fresh baseline build
- determine whether they originate from `zlob`, another dependency, or linker-combined output
- compare `objdump -d` / `nm -an` / section ownership between bad baseline and safe modern/local artifacts

## Commands already useful

### Crash installed published artifact directly

```bash
node -e 'const mod = require("/root/.bun/install/global/node_modules/@oh-my-pi/pi-natives/native/pi_natives.linux-x64-modern.node"); mod.fuzzyFind({ query: "a", path: "/tmp", maxResults: 5, hidden: true, gitignore: true, cache: true }).then(res => console.log(res));'
```

Expected on affected machines:

- exit `132`

### Count AVX-512 markers

```bash
python3 - <<'PY'
import subprocess, re
for path in [
    '/root/.bun/install/global/node_modules/@oh-my-pi/pi-natives/native/pi_natives.linux-x64-modern.node',
    '/root/.bun/install/global/node_modules/@oh-my-pi/pi-natives/native/pi_natives.linux-x64-baseline.node',
]:
    out = subprocess.run(['objdump', '-d', path], check=True, stdout=subprocess.PIPE, text=True).stdout
    zmm = len(re.findall(r'\bzmm\d+\b', out))
    mask = len(re.findall(r'\bk[0-7]\b', out))
    print(path, zmm, mask)
PY
```

### Verify installed package with guard script

```bash
PI_NATIVE_VERIFY_DIR=/root/.bun/install/global/node_modules/@oh-my-pi/pi-natives/native bun scripts/ci-release-verify-natives.ts
```

### Show no relevant source diff in reported good/bad/good windows

```bash
git diff --name-only v13.17.6..v13.18.0
git diff --name-only v13.18.0..v13.19.0
```

### Show risk-introducing commits

```bash
git show e9ab0354f -- .github/workflows/ci.yml packages/natives scripts
git show 81a270fcd -- .github/workflows/ci.yml packages/natives/scripts/build-native.ts
git show 8f8ced7d7 -- .github/workflows/ci.yml scripts/ci-build-native.ts packages/natives/scripts/build-native.ts
```

## Open questions

- Which exact release job produced bad `13.18.0` artifacts?
- Why did `13.19.0` appear good with no relevant source change in native/TUI/CI path?
- Are bad published `baseline` and `modern` identical, near-identical, or merely both unsafe?
- Is baseline bad because of compiler output, dependency output, link output, or stale output reuse?
- Does `modern` truly become safe after host Zig pinning, or was that local result contaminated by stale canonical reuse?
- Which exact symbols / object files in bad baseline carry AVX-512?
- Is `resolveBuiltAddonPath()` stale reuse only a local experiment hazard, or did a comparable statefulness leak into release jobs too?

## External references

- Issue `#601`: `https://github.com/can1357/oh-my-pi/issues/601`
- x86-64 microarchitecture levels, including `x86-64-v4` / AVX-512: `https://en.opensuse.org/X86-64_microarchitecture_levels`
- Zig build-system target/cpu options: `https://zig.guide/build-system/zig-build/`
- Zig build-system overview: `https://ziglang.org/learn/build-system/`
- Example of AVX-512 mismatch causing illegal instruction elsewhere: `https://github.com/jax-ml/jax/issues/2906`
- Recent Node issue showing AVX-512 runtime hazards outside this project: `https://github.com/nodejs/node/issues/53426`

## Handoff note

If another agent continues from here:

- start from this report, not from issue comments alone
- distrust local rebuilds until stale canonical `.node` reuse is eliminated
- focus on artifact provenance and release-state contamination first
- treat TUI changes as mitigation only, not root fix
