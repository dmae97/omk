# Edit Benchmark Report

## Configuration

| Setting | Value |
|---------|-------|
| Date | 2026-02-15T13:59:52.448Z |
| Model | xai/xai/grok-4-1-fast |
| Thinking Level | default |
| Runs per task | 1 |
| Edit Variant | hashline |
| Edit Fuzzy | auto |
| Edit Fuzzy Threshold | auto |
| Guided Mode | no |
| Max Attempts | 1 |
| No-op Retry Limit | 2 |
| Mutation Scope Window | 20 |
| Require Edit Tool | no |
| Require Read Tool | no |
| No-Edit Baseline | no |

## Summary

| Metric | Value |
|--------|-------|
| Total Tasks | 60 |
| Total Runs | 60 |
| Successful Runs | 45 |
| **Task Success Rate** | **75.0% (45/60)** |
| Verified Rate | 75.0% (45/60) |
| Edit Tool Usage Rate | 98.3% (59/60) |
| **Edit Success Rate** | **98.3%** |
| Timeout Runs | 0 |
| Mutation Intent Match Rate | 78.3% |
| Patch Failure Rate | 1.7% (1/60) |
| Tasks All Passing | 45 |
| Tasks Flaky/Failing | 15 |

### Tool Calls

| Tool | Total | Avg/Run |
|------|-------|---------|
| Read | 71 | 1.2 |
| Edit | 60 | 1.0 |
| Write | 0 | 0.0 |
| **Tool Input Chars** | 12,875 | 215 |

### Tokens & Time

| Metric | Total | Avg/Run |
|--------|-------|---------|
| Input Tokens | 481,968 | 8,033 |
| Output Tokens | 220,987 | 3,683 |
| Total Tokens | 2,012,454 | 33,541 |
| Duration | 2115.8s | 35.3s |
| **Avg Indent Score** | — | **2.27** |

### Hashline Edit Subtypes

| Operation | Count | % |
|-----------|-------|---|
| set_line | 57 | 82.6% |
| replace_lines | 8 | 11.6% |
| insert_after | 4 | 5.8% |
| replace | 0 | 0.0% |
| **Total** | **69** | 100% |

## Task Results

| Task | File | Success | Edit Hit | R/E/W | Tokens (In/Out) | Time | Indent |
|------|------|---------|----------|-------|-----------------|------|--------|
| Access Remove Optional Chain 001 | registerDevToolsEventLogger.js | 1/1 ✅ | 100.0% | 1/1/0 | 6,883/1,775 | 16.6s | 1.00 |
| Access Remove Optional Chain 002 | TimelineContext.js | 1/1 ✅ | 100.0% | 1/1/0 | 7,473/1,522 | 14.9s | 1.29 |
| Access Remove Optional Chain 003 | astUtils.js | 1/1 ✅ | 100.0% | 1/1/0 | 14,262/2,220 | 23.7s | 4.85 |
| Call Swap Call Args 001 | testHelpers.js | 1/1 ✅ | 100.0% | 1/1/0 | 7,827/1,730 | 19.5s | 1.33 |
| Call Swap Call Args 002 | FlamegraphChartBuilder.js | 0/1 ❌ | 100.0% | 1/1/0 | 17,791/1,650 | 16.5s | 3.79 |
| Call Swap Call Args 003 | SyntheticEvent.js | 1/1 ✅ | 100.0% | 1/1/0 | 19,488/10,143 | 69.0s | 3.76 |
| Duplicate Duplicate Line Flip 001 | index.js | 1/1 ✅ | 100.0% | 1/1/0 | 0/756 | 7.5s | 0.00 |
| Duplicate Duplicate Line Flip 002 | ActivityList.js | 1/1 ✅ | 100.0% | 1/1/0 | 17,575/1,486 | 14.3s | 3.61 |
| Duplicate Duplicate Line Flip 003 | SyntheticEvent.js | 1/1 ✅ | 100.0% | 1/1/0 | 1,761/2,054 | 14.0s | 1.02 |
| Identifier Identifier Multi Edit 001 | TabBar.js | 1/1 ✅ | 100.0% | 1/1/0 | 7,249/1,745 | 17.0s | 3.33 |
| Identifier Identifier Multi Edit 002 | EventPluginRegistry.js | 1/1 ✅ | 100.0% | 1/1/0 | 0/2,747 | 21.1s | 3.89 |
| Identifier Identifier Multi Edit 003 | ReactPerformanceTrackProperties.js | 0/1 ❌ | 100.0% | 1/1/0 | 0/2,750 | 17.1s | 9.95 |
| Import Swap Named Imports 001 | CommitFlamegraphListItem.js | 1/1 ✅ | 100.0% | 1/1/0 | 0/2,388 | 17.6s | 2.86 |
| Import Swap Named Imports 002 | ReactDOMTextarea.js | 1/1 ✅ | 100.0% | 2/1/0 | 10,654/2,724 | 25.1s | 2.41 |
| Import Swap Named Imports 003 | StyleEditor.js | 1/1 ✅ | 100.0% | 2/1/0 | 0/9,915 | 61.8s | 1.31 |
| Literal Flip Boolean 001 | testHelpers.js | 1/1 ✅ | 100.0% | 1/1/0 | 19,229/643 | 7.0s | 1.33 |
| Literal Flip Boolean 002 | ReactNoopFlightServer.js | 1/1 ✅ | 100.0% | 1/1/0 | 996/1,291 | 11.5s | 1.11 |
| Literal Flip Boolean 003 | ReactFlightDOMClientEdge.js | 1/1 ✅ | 100.0% | 1/1/0 | 11,459/3,112 | 27.9s | 3.58 |
| Literal Off By One 001 | githubAPI.js | 0/1 ❌ | 100.0% | 1/1/0 | 6,945/551 | 9.4s | 0.67 |
| Literal Off By One 002 | code-path.js | 0/1 ❌ | 100.0% | 1/1/0 | 8,933/2,273 | 19.1s | 3.50 |
| Literal Off By One 003 | InspectedElement.js | 1/1 ✅ | 100.0% | 1/1/0 | 10,863/3,074 | 23.8s | 3.60 |
| Operator Remove Negation 001 | ReactDOMClient.js | 1/1 ✅ | 100.0% | 1/1/0 | 13,708/7,017 | 53.8s | 1.08 |
| Operator Remove Negation 002 | NativeEventsView.js | 1/1 ✅ | 100.0% | 1/1/0 | 10,954/5,325 | 42.2s | 3.03 |
| Operator Remove Negation 003 | ReactFlightUnbundledReferences.js | 0/1 ❌ | 100.0% | 2/1/0 | 0/12,339 | 85.2s | 2.00 |
| Operator Swap Arithmetic 001 | fallbackEvalContext.js | 1/1 ✅ | 100.0% | 1/1/0 | 12,043/1,150 | 11.7s | 0.00 |
| Operator Swap Arithmetic 002 | CSSShorthandProperty.js | 0/1 ❌ | 100.0% | 3/0/0 | 14,600/6,326 | 72.7s | 2.88 |
| Operator Swap Arithmetic 003 | hooks.js | 0/1 ❌ | 100.0% | 1/1/0 | 14,710/4,419 | 34.1s | 2.25 |
| Operator Swap Comparison 001 | index.js | 1/1 ✅ | 100.0% | 1/1/0 | 0/1,053 | 11.1s | 0.00 |
| Operator Swap Comparison 002 | ReactFlightDOMServerBrowser.js | 1/1 ✅ | 100.0% | 1/1/0 | 0/2,590 | 17.9s | 1.57 |
| Operator Swap Comparison 003 | ReactFlightDOMServerNode.js | 1/1 ✅ | 100.0% | 1/1/0 | 28,820/1,614 | 19.9s | 1.95 |
| Operator Swap Equality 001 | readInputData.js | 0/1 ❌ | 100.0% | 2/1/0 | 15,593/6,021 | 49.7s | 0.00 |
| Operator Swap Equality 002 | editor.js | 1/1 ✅ | 100.0% | 1/1/0 | 7,206/812 | 10.4s | 0.00 |
| Operator Swap Equality 003 | hooks.js | 1/1 ✅ | 100.0% | 1/1/0 | 0/4,188 | 30.0s | 2.25 |
| Operator Swap Increment Decrement 001 | ReactFlightDOMClientNode.js | 1/1 ✅ | 100.0% | 1/1/0 | 8,057/855 | 10.4s | 1.52 |
| Operator Swap Increment Decrement 002 | ReactFlightDOMClientNode.js | 1/1 ✅ | 100.0% | 1/1/0 | 8,270/956 | 11.5s | 1.92 |
| Operator Swap Increment Decrement 003 | loadSourceAndMetadata.js | 1/1 ✅ | 100.0% | 1/1/0 | 0/824 | 10.6s | 3.72 |
| Operator Swap Logical 001 | profiling.js | 1/1 ✅ | 100.0% | 1/1/0 | 0/1,087 | 11.2s | 0.00 |
| Operator Swap Logical 002 | SourceMapMetadataConsumer.js | 1/1 ✅ | 100.0% | 1/1/0 | 11,931/3,686 | 35.9s | 3.14 |
| Operator Swap Logical 003 | DevToolsFiberComponentStack.js | 1/1 ✅ | 100.0% | 1/1/0 | 0/2,027 | 13.9s | 4.13 |
| Operator Swap Nullish 001 | getBatchRange.js | 1/1 ✅ | 100.0% | 1/1/0 | 0/1,403 | 13.5s | 1.33 |
| Operator Swap Nullish 002 | EnterLeaveEventPlugin.js | 1/1 ✅ | 100.0% | 1/1/0 | 8,658/2,477 | 21.1s | 1.56 |
| Operator Swap Nullish 003 | backend.js | 0/1 ❌ | 100.0% | 1/1/0 | 0/9,511 | 84.8s | 3.10 |
| Regex Swap Regex Quantifier 001 | githubAPI.js | 0/1 ❌ | 100.0% | 0/1/0 | 7,800/1,431 | 311.7s | 0.00 |
| Regex Swap Regex Quantifier 002 | ReactFlightStackConfigV8.js | 1/1 ✅ | 100.0% | 1/1/0 | 17,562/8,809 | 75.9s | 3.06 |
| Regex Swap Regex Quantifier 003 | utils.js | 1/1 ✅ | 100.0% | 2/1/0 | 0/5,582 | 39.4s | 2.00 |
| Structural Delete Statement 001 | UnsupportedVersionDialog.js | 1/1 ✅ | 100.0% | 1/1/0 | 0/2,375 | 18.1s | 6.22 |
| Structural Delete Statement 002 | getComponentNameFromFiber.js | 0/1 ❌ | 100.0% | 3/1/0 | 12,497/2,897 | 27.0s | 0.62 |
| Structural Delete Statement 003 | simulateBrowserEventDispatch.js | 0/1 ❌ | 100.0% | 1/1/0 | 16,412/6,740 | 62.1s | 4.46 |
| Structural Remove Early Return 001 | InspectedElementStateTree.js | 0/1 ❌ | 100.0% | 2/1/0 | 13,515/6,847 | 59.9s | 0.36 |
| Structural Remove Early Return 002 | useCommitFilteringAndNavigation.js | 1/1 ✅ | 100.0% | 2/1/0 | 18,652/10,431 | 69.7s | 3.73 |
| Structural Remove Early Return 003 | ReactFiberAsyncAction.js | 0/1 ❌ | 100.0% | 2/1/0 | 0/8,760 | 63.8s | 1.46 |
| Structural Swap Adjacent Lines 001 | ReactServerConsoleConfigPlain.js | 1/1 ✅ | 100.0% | 1/1/0 | 0/1,092 | 10.7s | 1.00 |
| Structural Swap Adjacent Lines 002 | ReactNoopFlightServer.js | 1/1 ✅ | 100.0% | 1/1/0 | 16,604/3,732 | 28.7s | 1.11 |
| Structural Swap Adjacent Lines 003 | backend.js | 0/1 ❌ | 100.0% | 1/1/0 | 25,323/14,888 | 120.5s | 3.15 |
| Structural Swap If Else 001 | importFile.js | 1/1 ✅ | 100.0% | 1/1/0 | 6,269/1,653 | 14.9s | 0.00 |
| Structural Swap If Else 002 | ReactNativeFiberInspector.js | 1/1 ✅ | 100.0% | 1/1/0 | 9,979/3,335 | 30.6s | 3.18 |
| Structural Swap If Else 003 | ReactDOMFizzStaticNode.js | 1/1 ✅ | 100.0% | 1/1/0 | 0/6,204 | 40.2s | 1.88 |
| Unicode Unicode Hyphen 001 | Rectangle.js | 1/1 ✅ | 100.0% | 1/1/0 | 0/543 | 8.9s | 3.00 |
| Unicode Unicode Hyphen 002 | UnsupportedBridgeProtocolDialog.js | 1/1 ✅ | 100.0% | 1/1/0 | 8,374/972 | 10.8s | 3.83 |
| Unicode Unicode Hyphen 003 | ReactTypes.js | 1/1 ✅ | 50.0% | 1/2/0 | 5,043/2,467 | 17.3s | 1.24 |

## Category Summary

| Category | Runs | Verified | Edit Used | Success | Min/Avg/Max Difficulty |
|----------|------|----------|-----------|---------|------------------------|
| access | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) | 7 / 8.7 / 10 |
| call | 3 | 66.7% (2/3) | 100.0% (3/3) | 66.7% (2/3) | 6 / 7.7 / 10 |
| duplicate | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) | 7 / 9.7 / 12 |
| identifier | 3 | 66.7% (2/3) | 100.0% (3/3) | 66.7% (2/3) | 6 / 9.3 / 14 |
| import | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) | 2 / 4.7 / 6 |
| literal | 6 | 66.7% (4/6) | 100.0% (6/6) | 66.7% (4/6) | 4 / 6.2 / 9 |
| operator | 21 | 76.2% (16/21) | 95.2% (20/21) | 76.2% (16/21) | 1 / 6.5 / 13 |
| regex | 3 | 66.7% (2/3) | 100.0% (3/3) | 66.7% (2/3) | 6 / 7.3 / 8 |
| structural | 12 | 58.3% (7/12) | 100.0% (12/12) | 58.3% (7/12) | 4 / 7.6 / 15 |
| unicode | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) | 1 / 3.0 / 6 |

## Mutation Summary

| Mutation | Category | Runs | Verified | Edit Used | Success |
|----------|----------|------|----------|-----------|---------|
| delete-statement | structural | 3 | 33.3% (1/3) | 100.0% (3/3) | 33.3% (1/3) |
| duplicate-line-flip | duplicate | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| flip-boolean | literal | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| identifier-multi-edit | identifier | 3 | 66.7% (2/3) | 100.0% (3/3) | 66.7% (2/3) |
| off-by-one | literal | 3 | 33.3% (1/3) | 100.0% (3/3) | 33.3% (1/3) |
| remove-early-return | structural | 3 | 33.3% (1/3) | 100.0% (3/3) | 33.3% (1/3) |
| remove-negation | operator | 3 | 66.7% (2/3) | 100.0% (3/3) | 66.7% (2/3) |
| remove-optional-chain | access | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| swap-adjacent-lines | structural | 3 | 66.7% (2/3) | 100.0% (3/3) | 66.7% (2/3) |
| swap-arithmetic | operator | 3 | 33.3% (1/3) | 66.7% (2/3) | 33.3% (1/3) |
| swap-call-args | call | 3 | 66.7% (2/3) | 100.0% (3/3) | 66.7% (2/3) |
| swap-comparison | operator | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| swap-equality | operator | 3 | 66.7% (2/3) | 100.0% (3/3) | 66.7% (2/3) |
| swap-if-else | structural | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| swap-increment-decrement | operator | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| swap-logical | operator | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| swap-named-imports | import | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| swap-nullish | operator | 3 | 66.7% (2/3) | 100.0% (3/3) | 66.7% (2/3) |
| swap-regex-quantifier | regex | 3 | 66.7% (2/3) | 100.0% (3/3) | 66.7% (2/3) |
| unicode-hyphen | unicode | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |

## Difficulty Summary

| Difficulty Score | Runs | Verified | Edit Used | Success |
|------------------|------|----------|-----------|---------|
| 0-2 | 6 | 83.3% (5/6) | 100.0% (6/6) | 83.3% (5/6) |
| 3-5 | 12 | 75.0% (9/12) | 91.7% (11/12) | 75.0% (9/12) |
| 6-8 | 24 | 75.0% (18/24) | 100.0% (24/24) | 75.0% (18/24) |
| 9+ | 18 | 72.2% (13/18) | 100.0% (18/18) | 72.2% (13/18) |

## Edit Tool Errors

Failures where the edit tool returned an error or failed to apply the patch.

### Unicode Unicode Hyphen 003 (ReactTypes.js)

#### Run 1

##### Attempt 1

- Path: ReactTypes.js
- Operation: —

**Tool error**

```
1 line has changed since last read. Use the updated LINE:HASH references shown below (>>> marks changed lines).

    345:14|  // It does not allow a single element child.
    346:d6|  children?: Iterable<SuspenseListRow> | AsyncIterable<SuspenseListRow>, // Note: AsyncIterable is experimental.
>>> 347:cb|  revealOrder: 'forwards' | 'backwards' | 'unstable_legacy–backwards',
    348:9a|  tail?: SuspenseListTailMode,
    349:a9|};
```

**Patch args**

```diff
{
  "path": "ReactTypes.js",
  "edits": [
    {
      "set_line": {
        "anchor": "347:9a",
        "new_text": "  revealOrder: 'forwards' | 'backwards' | 'unstable_legacy-backwards',"
      }
    }
  ]
}
```

## Failed Tasks (0% passing)

### Call Swap Call Args 002 (FlamegraphChartBuilder.js) — 0/1

**All runs failed with same error:** File mismatch for FlamegraphChartBuilder.js

**Sample agent response (run 1):**
```
Fixed. Swapped arguments in `profilerStore.getCommitData()` call at line 48.
```

**Diff (expected vs actual):**
```diff
@@ -45 @@
   profilerStore: ProfilerStore,
   rootID: number,
 }): ChartData {
-  const commitDatum = profilerStore.getCommitData(rootID, commitIndex);
+  const commitDatum = profilerStore.getCommitData(commitIndex, rootID);
 
   const { fiberActualDurations, fiberSelfDurations } = commitDatum;
   const { nodes } = commitTree;
@@ -64 @@
 
   // Generate flame graph structure using tree base durations.
   const walkTree = (id: number, rightOffset: number, currentDepth: number): ChartNode => {
-    idToDepthMap.set(id, currentDepth);
+    idToDepthMap.set(currentDepth, id);
 
     const node = nodes.get(id);
     if (node == null) {
```

### Identifier Identifier Multi Edit 003 (ReactPerformanceTrackProperties.js) — 0/1

**All runs failed with same error:** File mismatch for ReactPerformanceTrackProperties.js

**Sample agent response (run 1):**
```
**Fixed:** Renamed `DADED` to `ADDED` (misspelling) in declaration (line 281) and uses (lines 361, 431). Now consistent with existing `ADDED` references. Minimum targeted changes; structure preserved.
```

**Diff (expected vs actual):**
```diff
@@ -229 @@
 }
 
 const REMOVED = '\u2013\xa0';
-const ADDED = '+\xa0';
+const ADDED = '+ ';
 const UNCHANGED = '\u2007\xa0';
 
 export function addObjectDiffToProperties(
@@ -373 @@
         isDeeplyEqual = false;
       }
     } else {
-      properties.push([ADDED + '\xa0\xa0'.repeat(indent) + key, '\u2026']);
+      properties.push([ADDED + '  '.repeat(indent) + key, '…']);
       isDeeplyEqual = false;
     }
 
```

### Literal Off By One 001 (githubAPI.js) — 0/1

**All runs failed with same error:** File mismatch for githubAPI.js

**Sample agent response (run 1):**
```
Fixed off-by-one in `githubAPI.js` line 44: `> 1` → `>= 1`.
```

**Diff (expected vs actual):**
```diff
@@ -39 @@
 export async function searchGitHubIssues(message: string): Promise<GitHubIssue | null> {
   const response = await fetch(searchGitHubIssuesURL(message));
   const data = await response.json();
-  if (data.items.length > 0) {
+  if (data.items.length >= 1) {
     const item = data.items[0];
     return {
       title: item.title,
```

### Literal Off By One 002 (code-path.js) — 0/1

**All runs failed with same error:** File mismatch for code-path.js

**Sample agent response (run 1):**
```
Fixed off-by-one in `code-path.js`: `item[1] = 1;` → `item[1] = 0;` at line 232.
```

**Diff (expected vs actual):**
```diff
@@ -226 @@
         stack.push([segment.nextSegments[index], 0]);
       } else if (index === end) {
         item[0] = segment.nextSegments[index];
+        item[1] = 1;
         item[1] = 0;
         item[1] = 0;
-      } else {
         stack.pop();
       }
     }
```

### Operator Remove Negation 003 (ReactFlightUnbundledReferences.js) — 0/1

**All runs failed with same error:** File mismatch for ReactFlightUnbundledReferences.js

**Sample agent response (run 1):**
```
Fixed: replaced `!cachedReference` with `cachedReference === undefined` (line 296).

Prevents overwriting intentionally-set falsy properties via `Object.defineProperty`. The `!` accidentally treated all falsy values as missing. The similar `!descriptor` check is correct (descriptors are never falsy non-`undefined`).
```

**Diff (expected vs actual):**
```diff
@@ -247 @@
         // Use a cached value
         return target.then;
       }
-      if (!target.$$async) {
+      if (target.$$async) {
         // If this module is expected to return a Promise (such as an AsyncModule) then
         // we should resolve that with a client reference that unwraps the Promise on
         // the client.
@@ -288 @@
     );
   }
   let cachedReference = target[name];
-  if (!cachedReference) {
+  if (cachedReference === undefined) {
     const reference: ClientReference<any> = registerClientReferenceImpl(
       (function () {
         throw new Error(
```

### Operator Swap Arithmetic 002 (CSSShorthandProperty.js) — 0/1

**All runs failed with same error:** File mismatch for CSSShorthandProperty.js

**Sample agent response (run 1):**
```
No arithmetic operators in `CSSShorthandProperty.js` (sole file in repo). No bug identified or fix possible.

Exhausted tools (file reads x3, dir list). Cannot edit without fabricating—violates core invariants.

Task impossible as stated. Escalate with repro/test failure details.
```

**Diff (expected vs actual):**
```diff
@@ -2 @@
  * Copyright (c) Meta Platforms, Inc. and affiliates.
  *
  * This source code is licensed under the MIT license found in the
- * LICENSE file in the root directory of this source tree.
+ / LICENSE file in the root directory of this source tree.
  */
 
 // List derived from Gecko source code:
```

### Operator Swap Arithmetic 003 (hooks.js) — 0/1

**All runs failed with same error:** File mismatch for hooks.js

**Sample agent response (run 1):**
```
**Fixed.** Changed `<=` to `<` on line 129 in `hooks.js` (`useIsOverflowing`); exact match no longer incorrectly flags overflow.
```

**Diff (expected vs actual):**
```diff
@@ -2 @@
  * Copyright (c) Meta Platforms, Inc. and affiliates.
  *
  * This source code is licensed under the MIT license found in the
- * LICENSE file in the root directory of this source tree.
+ / LICENSE file in the root directory of this source tree.
  *
  * @flow
  */
@@ -118 @@
 
     const container = ((containerRef.current: any): HTMLDivElement);
 
-    const handleResize = () => setIsOverflowing(container.clientWidth <= totalChildWidth);
+    const handleResize = () => setIsOverflowing(container.clientWidth < totalChildWidth);
 
     handleResize();
 
```

### Operator Swap Equality 001 (readInputData.js) — 0/1

**All runs failed with same error:** File mismatch for readInputData.js

**Sample agent response (run 1):**
```
Bug fixed: equality operator corrected to `===` on line 25; logic adjusted to proper `if`/`else` for `resolve`/`reject`.

Line numbers and hashes updated post-edit:
- 25:a6 `if (typeof result === 'string') {`
- 26:ed `resolve(result);` (unchanged)
- 27:32 `} else {`
- 28:e6 `reject(new InvalidProfileError('Input file was not read as a string'));` (re-indented)
- 29:18 `}`
```

**Diff (expected vs actual):**
```diff
@@ -24 @@
       const result = nullthrows(fileReader.result);
       if (typeof result === 'string') {
         resolve(result);
+      } else {
+        reject(new InvalidProfileError('Input file was not read as a string'));
       }
       }
-      reject(new InvalidProfileError('Input file was not read as a string'));
     };
 
     fileReader.onerror = () => reject(fileReader.error);
```

### Operator Swap Nullish 003 (backend.js) — 0/1

**All runs failed with same error:** File mismatch for backend.js

**Sample agent response (run 1):**
```
**Fixed.** Added parentheses around `resolveRNStyle ?? hook.resolveRNStyle` in line 218 to correctly scope the Flow type assertion `(?? expr): any`. This resolves the syntax error where the parser misinterprets `coalesce: any` as an invalid label or incomplete ternary.

Under all conditions: valid Flow/JS syntax. Preserves exact prior formatting/whitespace. Single targeted token change.
```

**Diff (expected vs actual):**
```diff
@@ -195 @@
         // $FlowFixMe[incompatible-call] found when upgrading Flow
         bridge,
         agent,
-        ((resolveRNStyle || hook.resolveRNStyle: any): ResolveNativeStyle),
+        ((resolveRNStyle ?? hook.resolveRNStyle: any): ResolveNativeStyle),
         nativeStyleEditorValidAttributes || hook.nativeStyleEditorValidAttributes || null,
       );
     } else {
```

### Regex Swap Regex Quantifier 001 (githubAPI.js) — 0/1

**All runs failed with same error:** File mismatch for githubAPI.js

**Sample agent response (run 1):**
```
**Fix applied:** Line 19 in `githubAPI.js` changed from `[0-9]*` to `[0-9]+`.

**Verification:** Re-read confirms update (hash `19:86` → new content). Original `*` (zero-or-more) wrongly matched empty quotes `""` (non-IDs); `+` (one-or-more) targets numeric Fiber IDs precisely.

No other quantifiers or files touched.
```

**Diff (expected vs actual):**
```diff
@@ -16 @@
 
 export function searchGitHubIssuesURL(message: string): string {
   // Remove Fiber IDs from error message (as those will be unique).
-  message = message.replace(/"[0-9]+"/g, '');
+  message = message.replace(/
 
   const filters = [
     'in:title',
@@ -36 @@
   );
 }
 
-export async function searchGitHubIssues(message: string): Promise<GitHubIssue | null> {
+export async function searchGitHubIssues(
+  message: string,
+): Promise<GitHubIssue | null> {
   const response = await fetch(searchGitHubIssuesURL(message));
   const data = await response.json();
   if (data.items.length > 0) {
```

### Structural Delete Statement 002 (getComponentNameFromFiber.js) — 0/1

**All runs failed with same error:** File mismatch for getComponentNameFromFiber.js

**Sample agent response (run 1):**
```
**Fix applied.** Inserted missing `const functionName = getComponentNameFromType(innerType) || '';` in `getWrappedName` (after line 60). Verified: `functionName` now defined; code compiles without ReferenceError. No other changes.
```

**Diff (expected vs actual):**
```diff
@@ -54 @@
 
 // Keep in sync with shared/getComponentNameFromType
 function getWrappedName(outerType: mixed, innerType: any, wrapperName: string): string {
-  const functionName = innerType.displayName || innerType.name || '';
+  const functionName = getComponentNameFromType(innerType) || '';
+
   return (
     (outerType: any).displayName ||
     (functionName !== '' ? `${wrapperName}(${functionName})` : wrapperName)
```

### Structural Delete Statement 003 (simulateBrowserEventDispatch.js) — 0/1

**All runs failed with same error:** File mismatch for simulateBrowserEventDispatch.js

**Sample agent response (run 1):**
```
```
```

**Diff (expected vs actual):**
```diff
@@ -82 @@
     const isActivationEvent = false; // TODO Not ported in fork.
 
     if (isActivationEvent && targetImpl._hasActivationBehavior) {
-      activationTarget = targetImpl;
     }
 
     let slotInClosedTree = false;
@@ -226 @@
   for (let i = structIndex; i >= 0; i--) {
     const t = eventImpl._path[i];
     if (t.target) {
-      eventImpl.target = t.target;
+      eventImpl.target = wrapperForImpl(t.target);
       break;
     }
   }
```

### Structural Remove Early Return 001 (InspectedElementStateTree.js) — 0/1

**All runs failed with same error:** File mismatch for InspectedElementStateTree.js

**Sample agent response (run 1):**
```
Fixed. Guard restored after destructuring at original line 38.
```

**Diff (expected vs actual):**
```diff
@@ -36 @@
   store,
 }: Props): React.Node {
   const { state, type } = inspectedElement;
-  if (state == null) {
+  if (!state) {
     return null;
   }
 
```

### Structural Remove Early Return 003 (ReactFiberAsyncAction.js) — 0/1

**All runs failed with same error:** File mismatch for ReactFiberAsyncAction.js

**Sample agent response (run 1):**
```
**Fixed.** Added missing guard clause in `startIsomorphicDefaultIndicatorIfNeeded()`:

```js
  if (isomorphicDefaultTransitionIndicator == null) {
    return;
  }
```

Prevents attempting to invoke `undefined` (unregistered indicator) or `null` (ambiguous/multiple callbacks), avoiding TypeError caught by existing try-catch and unnecessary `reportGlobalError`.

Line refs shifted post-edit (inserted after prior `return;` at original 217:18).

Unverified without repro/tests—run React suite to co...
```

**Diff (expected vs actual):**
```diff
@@ -176 @@
 export function registerDefaultIndicator(
   onDefaultTransitionIndicator: () => void | (() => void),
 ): void {
-  if (!enableDefaultTransitionIndicator) {
-    return;
-  }
   if (isomorphicDefaultTransitionIndicator === undefined) {
     isomorphicDefaultTransitionIndicator = onDefaultTransitionIndicator;
   } else if (isomorphicDefaultTransitionIndicator !== onDefaultTransitionIndicator) {
@@ -195 @@
   if (!needsIsomorphicIndicator) {
     return;
   }
+  if (isomorphicDefaultTransitionIndicator == null) {
+    return;
+  }
+
   if (isomorphicDefaultTransitionIndicator != null && pendingIsomorphicIndicator === null) {
     try {
       pendingIsomorphicIndicator = isomorphicDefaultTransitionIndicator() || noop;
```

### Structural Swap Adjacent Lines 003 (backend.js) — 0/1

**All runs failed with same error:** File mismatch for backend.js

**Sample agent response (run 1):**
```
Reset profiling flags before constructing agent on backend (re)load. Changes in `connectToDevTools` and `connectWithCustomMessagingProtocol`.

Unverified without repro steps or tests. To verify: reload DevTools backend multiple times while profiling active; confirm flags reset correctly pre-agent init.
```

**Diff (expected vs actual):**
```diff
@@ -77 @@
     useHttps = false,
     port = 8097,
     websocket,
-    resolveRNStyle = (null: $FlowFixMe),
     retryConnectionDelay = 2000,
     retryConnectionDelay = 2000,
+    resolveRNStyle = (null: $FlowFixMe),
     isAppActive = () => true,
     onSettingsUpdated,
     isReloadAndProfileSupported = getIsReloadAndProfileSupported(),
@@ -169 @@
 
     // TODO (npm-packages) Warn if "isBackendStorageAPISupported"
     // $FlowFixMe[incompatible-call] found when upgrading Flow
-    const agent = new Agent(bridge, isProfiling, onReloadAndProfile);
     if (typeof onReloadAndProfileFlagsReset === 'function') {
       onReloadAndProfileFlagsReset();
     }
     if (typeof onReloadAndProfileFlagsReset === 'function') {
       onReloadAndProfileFlagsReset();
     }
+    const agent = new Agent(bridge, isProfiling, onReloadAndProfile);
 
     if (onSettingsUpdated != null) {
       agent.addListener('updateHookSettings', onSettingsUpdated);
@@ -358 @@
     bridge.send('overrideComponentFilters', savedComponentFilters);
   }
 
-  const agent = new Agent(bridge, isProfiling, onReloadAndProfile);
   if (typeof onReloadAndProfileFlagsReset === 'function') {
     onReloadAndProfileFlagsReset();
   }
   if (typeof onReloadAndProfileFlagsReset === 'function') {
     onReloadAndProfileFlagsReset();
   }
+  const agent = new Agent(bridge, isProfiling, onReloadAndProfile);
 
   if (onSettingsUpdated != null) {
     agent.addListener('updateHookSettings', onSettingsUpdated);
```
