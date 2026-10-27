#!/usr/bin/env bash
# Spec 096 phase 2 tarball check (doc §14.2): the packed coding-agent tarball ships the
# task-result modules, and its CLI entrypoint behaves the same with OMK_TASK_RESULT off and on.
# Local only: npm pack to a temp dir, never publish. Run after `npm run build` in packages/coding-agent.
set -euo pipefail
repo="$(cd "$(dirname "$0")/../.." && pwd)"
pkg="$repo/packages/coding-agent"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
export HOME="$work/home" OMK_TRUST_PROJECT=0
mkdir -p "$HOME"
unset TYPESAFE_API_KEY
tarball="$(cd "$pkg" && npm pack --silent --ignore-scripts --pack-destination "$work" | tail -1)"
tar -xzf "$work/$tarball" -C "$work"
root="$work/package"
for f in dist/core/task-result.js dist/core/task-result-collector.js dist/cli.js; do
	[[ -f "$root/$f" ]] || { echo "FAIL: tarball is missing $f"; exit 1; }
done
# Dependencies come from the workspace install; the tarball supplies only its own files.
ln -s "$pkg/node_modules" "$root/node_modules"
ln -s "$repo/node_modules" "$work/node_modules"
off="$(env -u OMK_TASK_RESULT node "$root/dist/cli.js" --version)"
on="$(OMK_TASK_RESULT=1 node "$root/dist/cli.js" --version)"
[[ "$off" == "$on" ]] || { echo "FAIL: --version differs with the flag on"; exit 1; }
node --input-type=module -e "
const c = await import('$root/dist/core/task-result-collector.js');
const settled = { promptRunId: 'p', outcome: 'completed' };
delete process.env.OMK_TASK_RESULT;
if (c.beginTaskResult(undefined, {}, 'p') !== undefined) throw new Error('flag off must not collect');
process.env.OMK_TASK_RESULT = '1';
const r = c.beginTaskResult(undefined, {}, 'p');
const e = r.finish(settled, 'All tests passed.');
if (e.type !== 'task_result' || e.projection.check !== 'none' || e.projection.modelClaims[0].source !== 'model_text')
	throw new Error('unexpected projection ' + JSON.stringify(e));
"
echo "PASS: tarball $tarball ships task-result; CLI identical off/on; flag gates collection"
