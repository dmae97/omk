# Edit Benchmark Report

## Configuration

| Setting | Value |
|---------|-------|
| Date | 2026-02-11T08:45:37.117Z |
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
| Successful Runs | 44 |
| **Task Success Rate** | **73.3% (44/60)** |
| Verified Rate | 73.3% (44/60) |
| Edit Tool Usage Rate | 100.0% (60/60) |
| **Edit Success Rate** | **96.9%** |
| Timeout Runs | 0 |
| Mutation Intent Match Rate | 75.0% |
| Patch Failure Rate | 3.1% (2/65) |
| Tasks All Passing | 44 |
| Tasks Flaky/Failing | 16 |

### Tool Calls

| Tool | Total | Avg/Run |
|------|-------|---------|
| Read | 72 | 1.2 |
| Edit | 65 | 1.1 |
| Write | 0 | 0.0 |
| **Tool Input Chars** | 14,281 | 238 |

### Tokens & Time

| Metric | Total | Avg/Run |
|--------|-------|---------|
| Input Tokens | 858,731 | 14,312 |
| Output Tokens | 245,031 | 4,084 |
| Total Tokens | 2,321,524 | 38,692 |
| Duration | 2503.8s | 41.7s |
| **Avg Indent Score** | — | **2.24** |

### Hashline Edit Subtypes

| Operation | Count | % |
|-----------|-------|---|
| set_line | 60 | 81.1% |
| replace_lines | 8 | 10.8% |
| insert_after | 4 | 5.4% |
| replace | 2 | 2.7% |
| **Total** | **74** | 100% |

## Task Results

| Task | File | Success | Edit Hit | R/E/W | Tokens (In/Out) | Time | Indent |
|------|------|---------|----------|-------|-----------------|------|--------|
| Access Remove Optional Chain 001 | registerDevToolsEventLogger.js | 0/1 ❌ | 100.0% | 1/1/0 | 13,101/8,802 | 86.3s | 0.00 |
| Access Remove Optional Chain 002 | TimelineContext.js | 1/1 ✅ | 100.0% | 1/1/0 | 6,503/1,441 | 16.9s | 1.29 |
| Access Remove Optional Chain 003 | astUtils.js | 1/1 ✅ | 100.0% | 1/1/0 | 21,029/6,479 | 63.4s | 4.85 |
| Call Swap Call Args 001 | testHelpers.js | 1/1 ✅ | 100.0% | 1/1/0 | 28,014/6,477 | 65.1s | 1.33 |
| Call Swap Call Args 002 | FlamegraphChartBuilder.js | 0/1 ❌ | 100.0% | 1/1/0 | 11,292/2,544 | 22.3s | 3.79 |
| Call Swap Call Args 003 | SyntheticEvent.js | 1/1 ✅ | 100.0% | 1/1/0 | 15,578/5,178 | 59.2s | 3.76 |
| Duplicate Duplicate Line Flip 001 | index.js | 1/1 ✅ | 100.0% | 1/1/0 | 12,549/760 | 9.1s | 0.00 |
| Duplicate Duplicate Line Flip 002 | ActivityList.js | 1/1 ✅ | 100.0% | 1/1/0 | 11,412/1,783 | 18.2s | 3.61 |
| Duplicate Duplicate Line Flip 003 | SyntheticEvent.js | 1/1 ✅ | 100.0% | 1/1/0 | 19,695/2,526 | 23.4s | 1.02 |
| Identifier Identifier Multi Edit 001 | TabBar.js | 1/1 ✅ | 100.0% | 1/1/0 | 13,046/1,644 | 17.4s | 3.33 |
| Identifier Identifier Multi Edit 002 | EventPluginRegistry.js | 1/1 ✅ | 100.0% | 2/2/0 | 25,240/2,658 | 25.8s | 4.00 |
| Identifier Identifier Multi Edit 003 | ReactPerformanceTrackProperties.js | 0/1 ❌ | 100.0% | 1/1/0 | 11,955/4,125 | 43.6s | 9.95 |
| Import Swap Named Imports 001 | CommitFlamegraphListItem.js | 1/1 ✅ | 100.0% | 1/1/0 | 6,932/2,254 | 25.4s | 2.86 |
| Import Swap Named Imports 002 | ReactDOMTextarea.js | 1/1 ✅ | 100.0% | 3/1/0 | 13,078/4,164 | 41.2s | 2.41 |
| Import Swap Named Imports 003 | StyleEditor.js | 1/1 ✅ | 100.0% | 5/3/0 | 48,297/11,626 | 115.3s | 1.31 |
| Literal Flip Boolean 001 | testHelpers.js | 1/1 ✅ | 100.0% | 1/1/0 | 15,343/722 | 13.9s | 1.33 |
| Literal Flip Boolean 002 | ReactNoopFlightServer.js | 1/1 ✅ | 100.0% | 1/1/0 | 9,330/1,318 | 16.9s | 1.11 |
| Literal Flip Boolean 003 | ReactFlightDOMClientEdge.js | 1/1 ✅ | 100.0% | 1/1/0 | 9,394/3,549 | 39.4s | 3.58 |
| Literal Off By One 001 | githubAPI.js | 1/1 ✅ | 100.0% | 1/1/0 | 8,024/1,265 | 16.8s | 0.67 |
| Literal Off By One 002 | code-path.js | 1/1 ✅ | 100.0% | 1/1/0 | 14,728/10,193 | 109.7s | 3.50 |
| Literal Off By One 003 | InspectedElement.js | 1/1 ✅ | 100.0% | 1/1/0 | 13,128/2,631 | 25.4s | 3.60 |
| Operator Remove Negation 001 | ReactDOMClient.js | 0/1 ❌ | 100.0% | 1/1/0 | 13,766/9,479 | 90.4s | 1.08 |
| Operator Remove Negation 002 | NativeEventsView.js | 1/1 ✅ | 100.0% | 1/1/0 | 12,201/6,415 | 63.3s | 2.97 |
| Operator Remove Negation 003 | ReactFlightUnbundledReferences.js | 0/1 ❌ | 100.0% | 0/1/0 | 18,752/14,904 | 145.9s | 2.00 |
| Operator Swap Arithmetic 001 | fallbackEvalContext.js | 1/1 ✅ | 100.0% | 1/1/0 | 4,452/958 | 10.0s | 0.20 |
| Operator Swap Arithmetic 002 | CSSShorthandProperty.js | 0/1 ❌ | 100.0% | 2/1/0 | 13,561/8,015 | 87.2s | 2.88 |
| Operator Swap Arithmetic 003 | hooks.js | 0/1 ❌ | 100.0% | 2/1/0 | 14,309/6,700 | 59.1s | 2.25 |
| Operator Swap Comparison 001 | index.js | 1/1 ✅ | 100.0% | 1/1/0 | 5,006/1,149 | 13.8s | 0.00 |
| Operator Swap Comparison 002 | ReactFlightDOMServerBrowser.js | 1/1 ✅ | 100.0% | 1/1/0 | 7,910/1,959 | 20.9s | 1.57 |
| Operator Swap Comparison 003 | ReactFlightDOMServerNode.js | 1/1 ✅ | 100.0% | 2/1/0 | 15,837/1,408 | 20.7s | 1.95 |
| Operator Swap Equality 001 | readInputData.js | 1/1 ✅ | 100.0% | 1/1/0 | 12,018/931 | 11.5s | 0.00 |
| Operator Swap Equality 002 | editor.js | 1/1 ✅ | 100.0% | 1/1/0 | 10,063/1,181 | 14.6s | 0.00 |
| Operator Swap Equality 003 | hooks.js | 1/1 ✅ | 100.0% | 1/1/0 | 13,426/2,194 | 24.5s | 2.21 |
| Operator Swap Increment Decrement 001 | ReactFlightDOMClientNode.js | 1/1 ✅ | 100.0% | 1/1/0 | 17,519/852 | 10.6s | 1.52 |
| Operator Swap Increment Decrement 002 | ReactFlightDOMClientNode.js | 1/1 ✅ | 100.0% | 1/1/0 | 5,895/1,196 | 13.3s | 1.92 |
| Operator Swap Increment Decrement 003 | loadSourceAndMetadata.js | 1/1 ✅ | 100.0% | 1/1/0 | 14,239/1,260 | 13.9s | 3.72 |
| Operator Swap Logical 001 | profiling.js | 1/1 ✅ | 100.0% | 1/1/0 | 4,581/1,085 | 12.2s | 0.00 |
| Operator Swap Logical 002 | SourceMapMetadataConsumer.js | 1/1 ✅ | 100.0% | 1/1/0 | 8,577/3,084 | 38.1s | 3.10 |
| Operator Swap Logical 003 | DevToolsFiberComponentStack.js | 1/1 ✅ | 100.0% | 1/1/0 | 8,873/3,120 | 30.3s | 4.00 |
| Operator Swap Nullish 001 | getBatchRange.js | 1/1 ✅ | 100.0% | 1/1/0 | 8,633/1,324 | 16.2s | 1.33 |
| Operator Swap Nullish 002 | EnterLeaveEventPlugin.js | 1/1 ✅ | 100.0% | 1/1/0 | 12,616/3,746 | 40.6s | 1.56 |
| Operator Swap Nullish 003 | backend.js | 0/1 ❌ | 100.0% | 1/1/0 | 12,790/5,088 | 42.2s | 3.15 |
| Regex Swap Regex Quantifier 001 | githubAPI.js | 0/1 ❌ | 100.0% | 1/1/0 | 14,945/752 | 11.5s | 0.00 |
| Regex Swap Regex Quantifier 002 | ReactFlightStackConfigV8.js | 1/1 ✅ | 50.0% | 1/2/0 | 16,168/6,103 | 66.3s | 3.06 |
| Regex Swap Regex Quantifier 003 | utils.js | 1/1 ✅ | 100.0% | 2/1/0 | 23,543/4,463 | 52.0s | 2.00 |
| Structural Delete Statement 001 | UnsupportedVersionDialog.js | 0/1 ❌ | 100.0% | 1/1/0 | 8,770/1,264 | 15.3s | 5.89 |
| Structural Delete Statement 002 | getComponentNameFromFiber.js | 0/1 ❌ | 100.0% | 1/1/0 | 18,769/1,344 | 13.3s | 0.62 |
| Structural Delete Statement 003 | simulateBrowserEventDispatch.js | 0/1 ❌ | 100.0% | 1/1/0 | 19,137/8,332 | 68.4s | 4.46 |
| Structural Remove Early Return 001 | InspectedElementStateTree.js | 0/1 ❌ | 100.0% | 1/1/0 | 10,260/2,696 | 31.7s | 0.36 |
| Structural Remove Early Return 002 | useCommitFilteringAndNavigation.js | 1/1 ✅ | 100.0% | 2/1/0 | 26,124/9,026 | 79.5s | 3.73 |
| Structural Remove Early Return 003 | ReactFiberAsyncAction.js | 0/1 ❌ | 100.0% | 1/1/0 | 13,031/6,916 | 68.3s | 1.46 |
| Structural Swap Adjacent Lines 001 | ReactServerConsoleConfigPlain.js | 1/1 ✅ | 100.0% | 1/1/0 | 17,171/2,060 | 20.1s | 1.00 |
| Structural Swap Adjacent Lines 002 | ReactNoopFlightServer.js | 0/1 ❌ | 100.0% | 1/1/0 | 11,493/7,380 | 74.7s | 1.11 |
| Structural Swap Adjacent Lines 003 | backend.js | 0/1 ❌ | 100.0% | 1/1/0 | 25,442/10,985 | 96.6s | 3.15 |
| Structural Swap If Else 001 | importFile.js | 1/1 ✅ | 100.0% | 1/1/0 | 10,628/7,209 | 73.7s | 0.00 |
| Structural Swap If Else 002 | ReactNativeFiberInspector.js | 1/1 ✅ | 100.0% | 2/1/0 | 23,265/3,986 | 41.5s | 3.18 |
| Structural Swap If Else 003 | ReactDOMFizzStaticNode.js | 1/1 ✅ | 100.0% | 1/1/0 | 18,057/10,859 | 110.6s | 1.88 |
| Unicode Unicode Hyphen 001 | Rectangle.js | 1/1 ✅ | 100.0% | 1/1/0 | 9,476/1,410 | 15.1s | 2.60 |
| Unicode Unicode Hyphen 002 | UnsupportedBridgeProtocolDialog.js | 1/1 ✅ | 100.0% | 1/1/0 | 9,039/623 | 10.7s | 3.83 |
| Unicode Unicode Hyphen 003 | ReactTypes.js | 1/1 ✅ | 50.0% | 1/2/0 | 20,721/1,436 | 20.4s | 1.24 |

## Category Summary

| Category | Runs | Verified | Edit Used | Success | Min/Avg/Max Difficulty |
|----------|------|----------|-----------|---------|------------------------|
| access | 3 | 66.7% (2/3) | 100.0% (3/3) | 66.7% (2/3) | 7 / 8.7 / 10 |
| call | 3 | 66.7% (2/3) | 100.0% (3/3) | 66.7% (2/3) | 6 / 7.7 / 10 |
| duplicate | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) | 7 / 9.7 / 12 |
| identifier | 3 | 66.7% (2/3) | 100.0% (3/3) | 66.7% (2/3) | 6 / 9.3 / 14 |
| import | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) | 2 / 4.7 / 6 |
| literal | 6 | 100.0% (6/6) | 100.0% (6/6) | 100.0% (6/6) | 4 / 6.2 / 9 |
| operator | 21 | 76.2% (16/21) | 100.0% (21/21) | 76.2% (16/21) | 1 / 6.5 / 13 |
| regex | 3 | 66.7% (2/3) | 100.0% (3/3) | 66.7% (2/3) | 6 / 7.3 / 8 |
| structural | 12 | 41.7% (5/12) | 100.0% (12/12) | 41.7% (5/12) | 4 / 7.6 / 15 |
| unicode | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) | 1 / 3.0 / 6 |

## Mutation Summary

| Mutation | Category | Runs | Verified | Edit Used | Success |
|----------|----------|------|----------|-----------|---------|
| delete-statement | structural | 3 | 0.0% (0/3) | 100.0% (3/3) | 0.0% (0/3) |
| duplicate-line-flip | duplicate | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| flip-boolean | literal | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| identifier-multi-edit | identifier | 3 | 66.7% (2/3) | 100.0% (3/3) | 66.7% (2/3) |
| off-by-one | literal | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| remove-early-return | structural | 3 | 33.3% (1/3) | 100.0% (3/3) | 33.3% (1/3) |
| remove-negation | operator | 3 | 33.3% (1/3) | 100.0% (3/3) | 33.3% (1/3) |
| remove-optional-chain | access | 3 | 66.7% (2/3) | 100.0% (3/3) | 66.7% (2/3) |
| swap-adjacent-lines | structural | 3 | 33.3% (1/3) | 100.0% (3/3) | 33.3% (1/3) |
| swap-arithmetic | operator | 3 | 33.3% (1/3) | 100.0% (3/3) | 33.3% (1/3) |
| swap-call-args | call | 3 | 66.7% (2/3) | 100.0% (3/3) | 66.7% (2/3) |
| swap-comparison | operator | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| swap-equality | operator | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
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
| 3-5 | 12 | 66.7% (8/12) | 100.0% (12/12) | 66.7% (8/12) |
| 6-8 | 24 | 75.0% (18/24) | 100.0% (24/24) | 75.0% (18/24) |
| 9+ | 18 | 72.2% (13/18) | 100.0% (18/18) | 72.2% (13/18) |

## Edit Tool Errors

Failures where the edit tool returned an error or failed to apply the patch.

### Regex Swap Regex Quantifier 002 (ReactFlightStackConfigV8.js)

#### Run 1

##### Attempt 1

- Path: ReactFlightStackConfigV8.js
- Operation: —

**Tool error**

```
1 line has changed since last read. Use the updated LINE:HASH references shown below (>>> marks changed lines).

    146:b1| const frameRegExp =
    147:bb|   /^ {3} at (?:(.+) \((?:(.+):(\d*):(\d+)|\<anonymous\>)\)|(?:async )?(.+):(\d+):(\d+)|\<anonymous\>)$/;
>>> 148:05| 
    149:fb| // DEV-only cache of parsed and filtered stack frames.
    150:cb| const stackTraceCache: WeakMap<Error, ReactStackTrace> = __DEV__

Quick fix — replace stale refs:
	148:bb → 148:05
```

**Patch args**

```diff
{
  "path": "ReactFlightStackConfigV8.js",
  "edits": [
    {
      "set_line": {
        "anchor": "148:bb",
        "new_text": "  /^ {3} at (?:(.+) \\((?:(.+):(\\d+):(\\d+)|\\<anonymous\\>)\\)|(?:async )?(.+):(\\d+):(\\d+)|\\<anonymous\\>)$/;"
      }
    }
  ]
}
```

### Unicode Unicode Hyphen 003 (ReactTypes.js)

#### Run 1

##### Attempt 1

- Path: ReactTypes.js
- Operation: —

**Tool error**

```
1 line has changed since last read. Use the updated LINE:HASH references shown below (>>> marks changed lines).

    345:14|   // It does not allow a single element child.
    346:d6|   children?: Iterable<SuspenseListRow> | AsyncIterable<SuspenseListRow>, // Note: AsyncIterable is experimental.
>>> 347:cb|   revealOrder: 'forwards' | 'backwards' | 'unstable_legacy–backwards',
    348:9a|   tail?: SuspenseListTailMode,
    349:a9| };

Quick fix — replace stale refs:
	347:9a → 347:cb
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

### Access Remove Optional Chain 001 (registerDevToolsEventLogger.js) — 0/1

**All runs failed with same error:** File mismatch for registerDevToolsEventLogger.js

**Sample agent response (run 1):**
```
**Fix applied.** Optional chaining restored on line 36 via substr replace (protected against already-present `?.`).
```

**Diff (expected vs actual):**
```diff
@@ -7 @@
  * @flow strict-local
  */
 
-import type { LoggerEvent } from 'react-devtools-shared/src/Logger';
+import type {LoggerEvent} from 'react-devtools-shared/src/Logger';
 
 
-import { registerEventLogger } from 'react-devtools-shared/src/Logger';
-import { enableLogger } from 'react-devtools-feature-flags';
+import {registerEventLogger} from 'react-devtools-shared/src/Logger';
+import {enableLogger} from 'react-devtools-feature-flags';
 
 let currentLoggingIFrame = null;
 let currentSessionId = null;
@@ -22 @@
 
 export function registerDevToolsEventLogger(
   surface: string,
-  fetchAdditionalContext?: (() => LoggerContext) | (() => Promise<LoggerContext>),
+  fetchAdditionalContext?:
+    | (() => LoggerContext)
+    | (() => Promise<LoggerContext>),
 ): void {
   async function logEvent(event: LoggerEvent) {
     if (enableLogger) {
@@ -27 @@
   async function logEvent(event: LoggerEvent) {
     if (enableLogger) {
       if (currentLoggingIFrame != null && currentSessionId != null) {
-        const { metadata, ...eventWithoutMetadata } = event;
+        const {metadata, ...eventWithoutMetadata} = event;
         const additionalContext: LoggerContext | {} =
           fetchAdditionalContext != null ? await fetchAdditionalContext() : {};
 
         const additionalContext: LoggerContext | {} =
           fetchAdditionalContext != null ? await fetchAdditionalContext() : {};
 
-        currentLoggingIFrame?.contentWindow?.postMessage(
+        currentLoggingIFrame.contentWindow?.postMessage
           {
             source: 'react-devtools-logging',
             event: eventWithoutMetadata,
@@ -55 @@
     currentLoggingIFrame = iframe;
 
     if (missedEvents.length > 0) {
-      missedEvents.forEach((event) => logEvent(event));
+      missedEvents.forEach(event => logEvent(event));
       missedEvents = [];
     }
   }
```

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
Fixed. All occurrences of misspelled identifier "DADED" renamed to "ADDED" in declaration and uses. Existing "ADDED" references now resolve correctly.
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

### Operator Remove Negation 001 (ReactDOMClient.js) — 0/1

**All runs failed with same error:** File mismatch for ReactDOMClient.js

**Sample agent response (run 1):**
```
File updated. Fix applied: removed all instances of stray `!` operator.
```

**Diff (expected vs actual):**
```diff
@@ -20 @@
 
 if (__DEV__) {
   if (
-    typeof Map !== 'function' ||
+    typeof Map == 'function' ||
     // $FlowFixMe[prop-missing] Flow incorrectly thinks Map has no prototype
     Map.prototype == null ||
     // $FlowFixMe[prop-missing] Flow incorrectly thinks Map has no prototype
     Map.prototype == null ||
-    typeof Map.prototype.forEach !== 'function' ||
-    typeof Set !== 'function' ||
+    typeof Map.prototype.forEach == 'function' ||
+    typeof Set == 'function' ||
     // $FlowFixMe[prop-missing] Flow incorrectly thinks Set has no prototype
     Set.prototype == null ||
     // $FlowFixMe[prop-missing] Flow incorrectly thinks Set has no prototype
     Set.prototype == null ||
-    typeof Set.prototype.clear !== 'function' ||
-    typeof Set.prototype.forEach !== 'function'
+    typeof Set.prototype.clear == 'function' ||
+    typeof Set.prototype.forEach == 'function'
   ) {
     console.error(
       'React depends on Map and Set built-in types. Make sure that you load a ' +
@@ -49 @@
 const foundDevTools = injectIntoDevTools();
 
 if (__DEV__) {
-  if (!foundDevTools && canUseDOM && window.top === window.self) {
+  if (foundDevTools && canUseDOM && window.top === window.self) {
     // If we're in Chrome or Firefox, provide a download link if not installed.
     if (
       (navigator.userAgent.indexOf('Chrome') > -1 && navigator.userAgent.indexOf('Edge') === -1) ||
```

### Operator Remove Negation 003 (ReactFlightUnbundledReferences.js) — 0/1

**All runs failed with same error:** File mismatch for ReactFlightUnbundledReferences.js

**Sample agent response (run 1):**
```
**Fixed:** Replaced `!cachedReference` with `cachedReference === undefined` at line 296 to eliminate accidental falsy coercion by the negation operator. This is the sole instance where `!` risks misinterpreting cached falsy values (e.g., `null`, `false`) as absent; the similar `!descriptor` check is safe as descriptors are strictly objects or `undefined`.
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
Fix applied: removed erroneous `/` (division operator) from license comment on line 5.
```

**Diff (expected vs actual):**
```diff
@@ -2 @@
  * Copyright (c) Meta Platforms, Inc. and affiliates.
  *
  * This source code is licensed under the MIT license found in the
- * LICENSE file in the root directory of this source tree.
+  LICENSE file in the root directory of this source tree.
  */
 
 // List derived from Gecko source code:
```

### Operator Swap Arithmetic 003 (hooks.js) — 0/1

**All runs failed with same error:** File mismatch for hooks.js

**Sample agent response (run 1):**
```
**Fixed:** Swapped `<=` to `<` in `useIsOverflowing` at line 129.

Rationale: Overflow occurs when `totalChildWidth > container.clientWidth` (i.e., `container.clientWidth < totalChildWidth`). Using `<=` incorrectly flags equality as overflow, which wastes space showing controls prematurely.

This is the sole numeric comparison in the file fitting "swapped arithmetic operator" (interpreting `<=` swap to `<` as minimal direction-locked correction). No other `+`, `-`, `*`, `/`, `%`, `**`, `++`, ...
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

### Operator Swap Nullish 003 (backend.js) — 0/1

**All runs failed with same error:** File mismatch for backend.js

**Sample agent response (run 1):**
```
Fixed: `resolveRNStyle || hook.resolveRNStyle` → `resolveRNStyle ?? hook.resolveRNStyle` (line 414). Only instance using `||` where `??` belongs.
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
@@ -378 @@
 
   const unsubscribeBackend = initBackend(hook, agent, window, isReloadAndProfileSupported);
 
-  const nativeStyleResolver: ResolveNativeStyle | void = resolveRNStyle || hook.resolveRNStyle;
+  const nativeStyleResolver: ResolveNativeStyle | void = resolveRNStyle ?? hook.resolveRNStyle;
 
   if (nativeStyleResolver != null) {
     const validAttributes =
```

### Regex Swap Regex Quantifier 001 (githubAPI.js) — 0/1

**All runs failed with same error:** File mismatch for githubAPI.js

**Sample agent response (run 1):**
```
Fixed: swapped `*` to `+` in regex on line 19 of `githubAPI.js`.

Matches `"123"` (one or more digits) but skips `""` (zero digits).
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

### Structural Delete Statement 001 (UnsupportedVersionDialog.js) — 0/1

**All runs failed with same error:** File mismatch for UnsupportedVersionDialog.js

**Sample agent response (run 1):**
```
**Fixed.** Inserted `const {store} = useContext(StoreContext);` after line 22. File compiles; `store` now in scope for `useEffect`. No other changes.
```

**Diff (expected vs actual):**
```diff
@@ -19 @@
 
 export default function UnsupportedVersionDialog(_: {}): null {
   const { dispatch } = useContext(ModalDialogContext);
-  const store = useContext(StoreContext);
   const [state, setState] = useState<DAILOG_STATE>('dialog-not-shown');
   const [state, setState] = useState<DAILOG_STATE>('dialog-not-shown');
+  const { store } = useContext(StoreContext);
 
   useEffect(() => {
     if (state === 'dialog-not-shown') {
```

### Structural Delete Statement 002 (getComponentNameFromFiber.js) — 0/1

**All runs failed with same error:** File mismatch for getComponentNameFromFiber.js

**Sample agent response (run 1):**
```
getComponentNameFromFiber.js fixed: restored `const functionName = getComponentNameFromType(innerType);` in `getWrappedName`.
```

**Diff (expected vs actual):**
```diff
@@ -54 @@
 
 // Keep in sync with shared/getComponentNameFromType
 function getWrappedName(outerType: mixed, innerType: any, wrapperName: string): string {
-  const functionName = innerType.displayName || innerType.name || '';
+  const functionName = getComponentNameFromType(innerType);
+
   return (
     (outerType: any).displayName ||
     (functionName !== '' ? `${wrapperName}(${functionName})` : wrapperName)
```

### Structural Delete Statement 003 (simulateBrowserEventDispatch.js) — 0/1

**All runs failed with same error:** File mismatch for simulateBrowserEventDispatch.js

**Sample agent response (run 1):**
```
The bug was a missing `wrapperForImpl` call when setting `eventImpl.target` in `invokeEventListeners`, causing `event.target` to be the raw implementation instead of the JS wrapper (inconsistent with `currentTarget` and `relatedTarget`).

Fixed via targeted edit (line 256). Verified against jsdom event retargeting behavior and DOM spec phases. No other changes required; structure preserved.
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
**Fixed.** Inserted guard clause after line 39:

```
  if (!state) {
    return null;
  }
```

Prevents `Object.entries(state)` error if `state` nullish.

Line numbers after: shifted +3 from original 40+. Hashes invalid post-edit.

Commit: `fix(InspectedElementStateTree): restore state null guard`
```

**Diff (expected vs actual):**
```diff
@@ -36 @@
   store,
 }: Props): React.Node {
   const { state, type } = inspectedElement;
-  if (state == null) {
+
+  if (!state) {
     return null;
   }
 
```

### Structural Remove Early Return 003 (ReactFiberAsyncAction.js) — 0/1

**All runs failed with same error:** File mismatch for ReactFiberAsyncAction.js

**Sample agent response (run 1):**
```
Fix complete: restored guard clause in `pingEngtangledActionScope`.
```

**Diff (expected vs actual):**
```diff
@@ -85 @@
 }
 
 function pingEngtangledActionScope() {
+  if (currentEntangledListeners === null) {
+    return;
+  }
+
   if (--currentEntangledPendingCount === 0) {
     if (enableProfilerTimer && enableComponentPerformanceTrack) {
       if (!hasScheduledTransitionWork()) {
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
```

### Structural Swap Adjacent Lines 002 (ReactNoopFlightServer.js) — 0/1

**All runs failed with same error:** File mismatch for ReactNoopFlightServer.js

**Sample agent response (run 1):**
```
**Fixed.** Swapped contents of lines 46–48 to restore `stringToChunk` body before `flushBuffered`.  
Confirmed:  
```
45:   stringToChunk(content: string): Uint8Array {
46:     return textEncoder.encode(content);
47:   },
48:   flushBuffered(destination: Destination): void {},
```
Syntax/logic restored. No other changes.
```

**Diff (expected vs actual):**
```diff
@@ -42 @@
   completeWriting(destination: Destination): void {},
   close(destination: Destination): void {},
   closeWithError(destination: Destination, error: mixed): void {},
-  flushBuffered(destination: Destination): void {},
   stringToChunk(content: string): Uint8Array {
     return textEncoder.encode(content);
   },
   stringToChunk(content: string): Uint8Array {
     return textEncoder.encode(content);
   },
+  flushBuffered(destination: Destination): void {},
   stringToPrecomputedChunk(content: string): Uint8Array {
     return textEncoder.encode(content);
   },
```

### Structural Swap Adjacent Lines 003 (backend.js) — 0/1

**All runs failed with same error:** File mismatch for backend.js

**Sample agent response (run 1):**
```
**Fixed.** Order of `agent` creation and `onReloadAndProfileFlagsReset()` call swapped in `connectToDevTools` (lines 192–195). Reset now precedes agent initialization for clean state on reconnect. Second instance in `connectWithCustomMessagingProtocol` unchanged per constraints (similar pattern, not confirmed buggy).
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
```
