# Edit Benchmark Report

## Configuration

| Setting | Value |
|---------|-------|
| Date | 2026-01-19T13:15:03.131Z |
| Model | anthropic/p-anthropic/claude-haiku-4-5 |
| Thinking Level | default |
| Runs per task | 3 |
| Edit Variant | patch |
| Edit Fuzzy | auto |
| Edit Fuzzy Threshold | auto |
| Require Edit Tool | no |
| No-Edit Baseline | no |

## Summary

| Metric | Value |
|--------|-------|
| Total Tasks | 60 |
| Total Runs | 180 |
| Successful Runs | 117 |
| **Task Success Rate** | **65.0% (117/180)** |
| Verified Rate | 65.0% (117/180) |
| Edit Tool Usage Rate | 97.8% (176/180) |
| **Edit Success Rate** | **92.0%** |
| Patch Failure Rate | 8.0% (23/287) |
| Tasks All Passing | 29 |
| Tasks Flaky/Failing | 31 |

### Tool Calls

| Tool | Total | Avg/Run |
|------|-------|---------|
| Read | 537 | 3.0 |
| Edit | 287 | 1.6 |
| Write | 6 | 0.0 |
| **Tool Input Chars** | 213,452 | 1,186 |

### Tokens & Time

| Metric | Total | Avg/Run |
|--------|-------|---------|
| Input Tokens | 5,501 | 31 |
| Output Tokens | 242,121 | 1,345 |
| Total Tokens | 12,126,362 | 67,369 |
| Duration | 3788.7s | 21.0s |
| **Avg Indent Score** | — | **2.25** |

## Task Results

| Task | File | Success | Edit Hit | R/E/W | Tokens (In/Out) | Time | Indent |
|------|------|---------|----------|-------|-----------------|------|--------|
| Literal Flip Boolean 001 | testHelpers.js | 3/3 ✅ | 100.0% | 1/1/0 | 15/347 | 7.2s | 1.32 |
| Duplicate Duplicate Line Flip 001 | index.js | 3/3 ✅ | 100.0% | 1/1/0 | 15/369 | 7.3s | 0.00 |
| Duplicate Duplicate Line Flip 002 | ActivityList.js | 3/3 ✅ | 100.0% | 1/1/0 | 19/539 | 11.3s | 3.61 |
| Import Swap Named Imports 001 | CommitFlamegraphListItem.js | 3/3 ✅ | 100.0% | 2/1/0 | 19/735 | 12.4s | 2.86 |
| Import Swap Named Imports 002 | ReactDOMTextarea.js | 2/3 ⚠️ | 100.0% | 2/1/0 | 20/739 | 12.6s | 2.39 |
| Access Remove Optional Chain 002 | TimelineContext.js | 2/3 ⚠️ | 66.7% | 2/2/0 | 32/1,067 | 16.5s | 1.26 |
| Literal Flip Boolean 002 | ReactNoopFlightServer.js | 2/3 ⚠️ | 100.0% | 2/1/0 | 20/686 | 11.6s | 1.11 |
| Identifier Identifier Multi Edit 001 | TabBar.js | 2/3 ⚠️ | 88.9% | 2/3/0 | 35/1,274 | 18.5s | 3.33 |
| Access Remove Optional Chain 001 | registerDevToolsEventLogger.js | 2/3 ⚠️ | 100.0% | 3/1/0 | 27/1,051 | 19.7s | 1.00 |
| Literal Off By One 001 | githubAPI.js | 3/3 ✅ | 100.0% | 1/1/0 | 21/565 | 10.6s | 0.67 |
| Identifier Identifier Multi Edit 002 | EventPluginRegistry.js | 3/3 ✅ | 100.0% | 4/2/0 | 39/1,400 | 22.0s | 3.89 |
| Import Swap Named Imports 003 | StyleEditor.js | 0/3 ❌ | 100.0% | 2/1/0 | 29/1,374 | 20.4s | 1.31 |
| Literal Flip Boolean 003 | ReactFlightDOMClientEdge.js | 0/3 ❌ | 100.0% | 2/1/0 | 27/1,087 | 17.2s | 3.53 |
| Call Swap Call Args 001 | testHelpers.js | 2/3 ⚠️ | 75.0% | 3/3/0 | 34/1,434 | 22.3s | 1.19 |
| Operator Remove Negation 002 | NativeEventsView.js | 3/3 ✅ | 100.0% | 2/1/0 | 19/626 | 10.8s | 3.03 |
| Literal Off By One 003 | InspectedElement.js | 2/3 ⚠️ | 100.0% | 3/1/0 | 28/970 | 14.6s | 3.60 |
| Access Remove Optional Chain 003 | astUtils.js | 0/3 ❌ | 100.0% | 4/1/0 | 37/2,191 | 28.9s | 4.82 |
| Operator Swap Comparison 001 | index.js | 3/3 ✅ | 100.0% | 1/1/0 | 15/358 | 8.4s | 0.67 |
| Operator Swap Arithmetic 001 | fallbackEvalContext.js | 3/3 ✅ | 100.0% | 2/1/0 | 18/530 | 9.2s | 0.00 |
| Operator Swap Arithmetic 002 | CSSShorthandProperty.js | 3/3 ✅ | 100.0% | 2/1/0 | 22/548 | 11.1s | 2.84 |
| Duplicate Duplicate Line Flip 003 | SyntheticEvent.js | 2/3 ⚠️ | 100.0% | 2/1/0 | 26/964 | 25.5s | 1.02 |
| Operator Swap Equality 001 | readInputData.js | 3/3 ✅ | 100.0% | 2/1/0 | 22/542 | 9.9s | 0.00 |
| Operator Swap Increment Decrement 001 | ReactFlightDOMClientNode.js | 3/3 ✅ | 100.0% | 2/1/0 | 19/580 | 10.1s | 1.52 |
| Operator Swap Equality 003 | hooks.js | 3/3 ✅ | 100.0% | 1/1/0 | 19/550 | 10.5s | 2.25 |
| Operator Swap Equality 002 | editor.js | 3/3 ✅ | 100.0% | 2/1/0 | 18/560 | 10.3s | 0.15 |
| Operator Swap Increment Decrement 002 | ReactFlightDOMClientNode.js | 3/3 ✅ | 100.0% | 2/1/0 | 23/625 | 10.9s | 1.92 |
| Operator Swap Comparison 002 | ReactFlightDOMServerBrowser.js | 2/3 ⚠️ | 75.0% | 4/1/0 | 35/1,097 | 18.0s | 1.57 |
| Operator Swap Comparison 003 | ReactFlightDOMServerNode.js | 3/3 ✅ | 100.0% | 2/1/0 | 28/1,077 | 17.7s | 1.95 |
| Identifier Identifier Multi Edit 003 | ReactPerformanceTrackProperties.js | 2/3 ⚠️ | 100.0% | 9/3/0 | 70/2,252 | 35.9s | 8.73 |
| Operator Swap Nullish 001 | getBatchRange.js | 3/3 ✅ | 60.0% | 2/2/0 | 23/731 | 11.1s | 1.33 |
| Operator Swap Increment Decrement 003 | loadSourceAndMetadata.js | 3/3 ✅ | 100.0% | 4/2/0 | 41/1,139 | 19.3s | 3.71 |
| Operator Swap Nullish 003 | backend.js | 1/3 ⚠️ | 100.0% | 1/1/0 | 18/794 | 12.5s | 3.15 |
| Regex Swap Regex Quantifier 001 | githubAPI.js | 3/3 ✅ | 100.0% | 2/1/0 | 22/656 | 13.0s | 0.67 |
| Operator Swap Logical 001 | profiling.js | 3/3 ✅ | 72.7% | 3/4/0 | 38/1,231 | 17.5s | 0.33 |
| Operator Swap Logical 003 | DevToolsFiberComponentStack.js | 3/3 ✅ | 80.0% | 2/2/0 | 30/1,077 | 15.4s | 3.96 |
| Call Swap Call Args 002 | FlamegraphChartBuilder.js | 0/3 ❌ | 87.5% | 6/3/0 | 54/3,086 | 38.9s | 3.79 |
| Regex Swap Regex Quantifier 003 | utils.js | 3/3 ✅ | 100.0% | 1/1/0 | 19/922 | 12.7s | 2.00 |
| Structural Delete Statement 001 | UnsupportedVersionDialog.js | 3/3 ✅ | 100.0% | 2/1/0 | 22/608 | 11.0s | 6.22 |
| Operator Swap Arithmetic 003 | hooks.js | 0/3 ❌ | 100.0% | 3/1/0 | 32/2,137 | 23.9s | 2.25 |
| Structural Delete Statement 002 | getComponentNameFromFiber.js | 1/3 ⚠️ | 100.0% | 2/1/0 | 25/723 | 13.7s | 0.62 |
| Operator Remove Negation 001 | ReactDOMClient.js | 1/3 ⚠️ | 100.0% | 6/2/0 | 45/4,208 | 47.1s | 1.08 |
| Call Swap Call Args 003 | SyntheticEvent.js | 0/3 ❌ | 70.0% | 6/3/1 | 65/6,739 | 60.7s | 3.76 |
| Structural Delete Statement 003 | simulateBrowserEventDispatch.js | 1/3 ⚠️ | 100.0% | 4/1/0 | 31/1,066 | 17.2s | 4.46 |
| Structural Remove Early Return 002 | useCommitFilteringAndNavigation.js | 1/3 ⚠️ | 100.0% | 3/1/0 | 26/734 | 12.5s | 3.61 |
| Regex Swap Regex Quantifier 002 | ReactFlightStackConfigV8.js | 2/3 ⚠️ | 100.0% | 4/1/0 | 31/1,902 | 23.8s | 3.06 |
| Structural Swap If Else 001 | importFile.js | 1/3 ⚠️ | 100.0% | 2/1/0 | 23/649 | 11.5s | 0.00 |
| Unicode Unicode Hyphen 001 | Rectangle.js | 3/3 ✅ | 100.0% | 1/1/0 | 15/290 | 7.0s | 3.00 |
| Unicode Unicode Hyphen 003 | ReactTypes.js | 3/3 ✅ | 100.0% | 1/1/0 | 18/549 | 9.2s | 1.24 |
| Structural Swap If Else 002 | ReactNativeFiberInspector.js | 0/3 ❌ | 100.0% | 3/1/0 | 30/868 | 14.4s | 3.18 |
| Unicode Unicode Hyphen 002 | UnsupportedBridgeProtocolDialog.js | 3/3 ✅ | 100.0% | 2/1/0 | 19/573 | 9.7s | 3.83 |
| Structural Remove Early Return 001 | InspectedElementStateTree.js | 0/3 ❌ | 100.0% | 4/2/0 | 36/1,292 | 20.2s | 0.36 |
| Structural Swap Adjacent Lines 001 | ReactServerConsoleConfigPlain.js | 3/3 ✅ | 90.0% | 5/3/0 | 48/1,479 | 23.4s | 1.00 |
| Structural Remove Early Return 003 | ReactFiberAsyncAction.js | 0/3 ❌ | 100.0% | 5/2/0 | 45/2,546 | 29.4s | 1.42 |
| Structural Swap If Else 003 | ReactDOMFizzStaticNode.js | 3/3 ✅ | 80.0% | 5/2/0 | 44/1,565 | 22.8s | 1.82 |
| Structural Swap Adjacent Lines 002 | ReactNoopFlightServer.js | 0/3 ❌ | 100.0% | 5/2/0 | 40/1,477 | 21.4s | 0.74 |
| Operator Swap Logical 002 | SourceMapMetadataConsumer.js | 3/3 ✅ | 100.0% | 6/4/0 | 58/4,000 | 45.5s | 3.14 |
| Literal Off By One 002 | code-path.js | 0/3 ❌ | 100.0% | 1/1/0 | 13/694 | 49.2s | 3.50 |
| Operator Swap Nullish 002 | EnterLeaveEventPlugin.js | 1/3 ⚠️ | 92.3% | 10/4/0 | 86/5,001 | 61.5s | 1.56 |
| Operator Remove Negation 003 | ReactFlightUnbundledReferences.js | 1/3 ⚠️ | 100.0% | 2/2/0 | 27/2,478 | 68.2s | 2.00 |
| Structural Swap Adjacent Lines 003 | backend.js | 0/3 ❌ | 66.7% | 7/4/0 | 62/3,356 | 77.7s | 3.14 |

## Category Summary

| Category | Runs | Verified | Edit Used | Success | Min/Avg/Max Difficulty |
|----------|------|----------|-----------|---------|------------------------|
| access | 9 | 44.4% (4/9) | 100.0% (9/9) | 44.4% (4/9) | 7 / 8.7 / 10 |
| call | 9 | 22.2% (2/9) | 100.0% (9/9) | 22.2% (2/9) | 6 / 7.7 / 10 |
| duplicate | 9 | 88.9% (8/9) | 88.9% (8/9) | 88.9% (8/9) | 7 / 9.7 / 12 |
| identifier | 9 | 77.8% (7/9) | 100.0% (9/9) | 77.8% (7/9) | 6 / 9.3 / 14 |
| import | 9 | 55.6% (5/9) | 100.0% (9/9) | 55.6% (5/9) | 2 / 4.7 / 6 |
| literal | 18 | 55.6% (10/18) | 94.4% (17/18) | 55.6% (10/18) | 4 / 6.2 / 9 |
| operator | 63 | 81.0% (51/63) | 98.4% (62/63) | 81.0% (51/63) | 1 / 6.5 / 13 |
| regex | 9 | 88.9% (8/9) | 100.0% (9/9) | 88.9% (8/9) | 6 / 7.3 / 8 |
| structural | 36 | 36.1% (13/36) | 97.2% (35/36) | 36.1% (13/36) | 4 / 7.6 / 15 |
| unicode | 9 | 100.0% (9/9) | 100.0% (9/9) | 100.0% (9/9) | 1 / 3.0 / 6 |

## Mutation Summary

| Mutation | Category | Runs | Verified | Edit Used | Success |
|----------|----------|------|----------|-----------|---------|
| delete-statement | structural | 9 | 55.6% (5/9) | 100.0% (9/9) | 55.6% (5/9) |
| duplicate-line-flip | duplicate | 9 | 88.9% (8/9) | 88.9% (8/9) | 88.9% (8/9) |
| flip-boolean | literal | 9 | 55.6% (5/9) | 100.0% (9/9) | 55.6% (5/9) |
| identifier-multi-edit | identifier | 9 | 77.8% (7/9) | 100.0% (9/9) | 77.8% (7/9) |
| off-by-one | literal | 9 | 55.6% (5/9) | 88.9% (8/9) | 55.6% (5/9) |
| remove-early-return | structural | 9 | 11.1% (1/9) | 100.0% (9/9) | 11.1% (1/9) |
| remove-negation | operator | 9 | 55.6% (5/9) | 88.9% (8/9) | 55.6% (5/9) |
| remove-optional-chain | access | 9 | 44.4% (4/9) | 100.0% (9/9) | 44.4% (4/9) |
| swap-adjacent-lines | structural | 9 | 33.3% (3/9) | 88.9% (8/9) | 33.3% (3/9) |
| swap-arithmetic | operator | 9 | 66.7% (6/9) | 100.0% (9/9) | 66.7% (6/9) |
| swap-call-args | call | 9 | 22.2% (2/9) | 100.0% (9/9) | 22.2% (2/9) |
| swap-comparison | operator | 9 | 88.9% (8/9) | 100.0% (9/9) | 88.9% (8/9) |
| swap-equality | operator | 9 | 100.0% (9/9) | 100.0% (9/9) | 100.0% (9/9) |
| swap-if-else | structural | 9 | 44.4% (4/9) | 100.0% (9/9) | 44.4% (4/9) |
| swap-increment-decrement | operator | 9 | 100.0% (9/9) | 100.0% (9/9) | 100.0% (9/9) |
| swap-logical | operator | 9 | 100.0% (9/9) | 100.0% (9/9) | 100.0% (9/9) |
| swap-named-imports | import | 9 | 55.6% (5/9) | 100.0% (9/9) | 55.6% (5/9) |
| swap-nullish | operator | 9 | 55.6% (5/9) | 100.0% (9/9) | 55.6% (5/9) |
| swap-regex-quantifier | regex | 9 | 88.9% (8/9) | 100.0% (9/9) | 88.9% (8/9) |
| unicode-hyphen | unicode | 9 | 100.0% (9/9) | 100.0% (9/9) | 100.0% (9/9) |

## Difficulty Summary

| Difficulty Score | Runs | Verified | Edit Used | Success |
|------------------|------|----------|-----------|---------|
| 0-2 | 18 | 88.9% (16/18) | 100.0% (18/18) | 88.9% (16/18) |
| 3-5 | 36 | 77.8% (28/36) | 100.0% (36/36) | 77.8% (28/36) |
| 6-8 | 72 | 56.9% (41/72) | 98.6% (71/72) | 56.9% (41/72) |
| 9+ | 54 | 59.3% (32/54) | 94.4% (51/54) | 59.3% (32/54) |

## Edit Tool Errors

Failures where the edit tool returned an error or failed to apply the patch.

### Access Remove Optional Chain 002 (TimelineContext.js)

#### Run 1

##### Attempt 1

- Path: /tmp/edit-bench-access-remove-optional-chain-002-Dce2D1/TimelineContext.js
- Operation: —

**Tool error**

```
Found 3 matches for context 'function getState() {' in /tmp/edit-bench-access-remove-optional-chain-002-Dce2D1/TimelineContext.js. Add more surrounding context or additional @@ anchors to make it unique.
```

**Patch args**

```diff
@@ function getState() {
      return store.profilerStore.profilingData.timelineData || null;
    },
+      return store.profilerStore.profilingData?.timelineData || null;
-@@ function getState() {
+    },
```

#### Run 2

##### Attempt 1

- Path: TimelineContext.js
- Operation: —

**Tool error**

```
Found 3 matches for context 'function getState() {' in TimelineContext.js. Add more surrounding context or additional @@ anchors to make it unique.
```

**Patch args**

```diff
@@ function getState() {
      return store.profilerStore.profilingData.timelineData || null;
     },
   },
 );

-    function getState() {
-      return store.profilerStore.profilingData.timelineData || null;
+    function getState() {
+      return store.profilerStore?.profilingData.timelineData || null;
     },
```

### Identifier Identifier Multi Edit 001 (TabBar.js)

#### Run 1

##### Attempt 1

- Path: TabBar.js
- Operation: —

**Tool error**

```
Failed to find expected lines in TabBar.js:
        const {icon, di, label, title} = tab;
        const {icon, di, label, title} = tab;
```

**Patch args**

```diff
@@
         const {icon, di, label, title} = tab;
+        const {icon, id, label, title} = tab;
-        const {icon, di, label, title} = tab;
```

### Call Swap Call Args 001 (testHelpers.js)

#### Run 3

##### Attempt 1

- Path: /tmp/edit-bench-call-swap-call-args-001-XEUjks/testHelpers.js
- Operation: —

**Tool error**

```
Failed to find expected lines in /tmp/edit-bench-call-swap-call-args-001-XEUjks/testHelpers.js:
   value    | name
   value    | name
   ${true}  | ${pointerEvent}
```

**Patch args**

```diff
@@ describe.each`
    value    | name
+   name    | value
-   value    | name
    ${true}  | ${pointerEvent}
```

##### Attempt 2

- Path: /tmp/edit-bench-call-swap-call-args-001-XEUjks/testHelpers.js
- Operation: —

**Tool error**

```
Failed to find expected lines in /tmp/edit-bench-call-swap-call-args-001-XEUjks/testHelpers.js:
    value    | name
    value    | name
    ${true}  | ${pointerEvent}
```

**Patch args**

```diff
@@ describe.each`
     value    | name
+    name    | value
-    value    | name
     ${true}  | ${pointerEvent}
```

### Operator Swap Comparison 002 (ReactFlightDOMServerBrowser.js)

#### Run 2

##### Attempt 1

- Path: /tmp/edit-bench-operator-swap-comparison-002-FUGqBM/ReactFlightDOMServerBrowser.js
- Operation: —

**Tool error**

```
Failed to find expected lines in /tmp/edit-bench-operator-swap-comparison-002-FUGqBM/ReactFlightDOMServerBrowser.js:
    done,
    value,
  }: {
    done: boolean,
    value: ?any,
  }): void | Promise<void> {
    const buffer: Uint8Array = (value: any);
    stringBuffer += done
      ? readFinalStringChunk(stringDecoder, new Uint8Array(0))
      : readPartialStringChunk(stringDecoder, buffer);
    const messages = stringBuffer.split('\n');
    for (let i = 0; i <= messages.length - 1; i++) {
      resolveDebugMessage(request, messages[i]);
    }
    stringBuffer = messages[messages.length - 1];
```

**Patch args**

```diff
@@ function progress({
     done,
     value,
   }: {
     done: boolean,
     value: ?any,
     ...
   }): void | Promise<void> {
     const buffer: Uint8Array = (value: any);
     stringBuffer += done
       ? readFinalStringChunk(stringDecoder, new Uint8Array(0))
       : readPartialStringChunk(stringDecoder, buffer);
     const messages = stringBuffer.split('\n');
-    for (let i = 0; i <= messages.length - 1; i++) {
+    for (let i = 0; i < messages.length; i++) {
       resolveDebugMessage(request, messages[i]);
     }
     stringBuffer = messages[messages.length - 1];

```

### Operator Swap Nullish 001 (getBatchRange.js)

#### Run 2

##### Attempt 1

- Path: /tmp/edit-bench-operator-swap-nullish-001-6T8LkA/getBatchRange.js
- Operation: —

**Tool error**

```
Failed to find expected lines in /tmp/edit-bench-operator-swap-nullish-001-6T8LkA/getBatchRange.js:
 if (measures == null ?? measures.length === 0) {
    throw Error(`Could not find measures with batch UID "${batchUID}"`);
 }
  if (measures == null ?? measures.length === 0) {
    throw Error(`Could not find measures with batch UID "${batchUID}"`);
 }
```

**Patch args**

```diff
@@ const measures = data.batchUIDToMeasuresMap.get(batchUID);
  if (measures == null ?? measures.length === 0) {
     throw Error(`Could not find measures with batch UID "${batchUID}"`);
  }
-  if (measures == null ?? measures.length === 0) {
+  if (measures == null || measures.length === 0) {
     throw Error(`Could not find measures with batch UID "${batchUID}"`);
  }
```

##### Attempt 2

- Path: /tmp/edit-bench-operator-swap-nullish-001-6T8LkA/getBatchRange.js
- Operation: —

**Tool error**

```
Failed to find expected lines in /tmp/edit-bench-operator-swap-nullish-001-6T8LkA/getBatchRange.js:
 if (measures == null ?? measures.length === 0) {
   throw Error(`Could not find measures with batch UID "${batchUID}"`);
 }
  if (measures == null ?? measures.length === 0) {
   throw Error(`Could not find measures with batch UID "${batchUID}"`);
 }
```

**Patch args**

```diff
@@ const measures = data.batchUIDToMeasuresMap.get(batchUID);
  if (measures == null ?? measures.length === 0) {
    throw Error(`Could not find measures with batch UID "${batchUID}"`);
  }
-  if (measures == null ?? measures.length === 0) {
+  if (measures == null || measures.length === 0) {
    throw Error(`Could not find measures with batch UID "${batchUID}"`);
  }
```

### Operator Swap Logical 001 (profiling.js)

#### Run 1

##### Attempt 1

- Path: /tmp/edit-bench-operator-swap-logical-001-suaFff/profiling.js
- Operation: —

**Tool error**

```
Failed to find expected lines in /tmp/edit-bench-operator-swap-logical-001-suaFff/profiling.js:
   typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ === 'undefined' &&
   typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE !== 'function'
 ) {
    typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ === 'undefined' &&
    typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE !== 'function'
```

**Patch args**

```diff
@@ if (
    typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ === 'undefined' &&
    typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE !== 'function'
  ) {
-    typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ === 'undefined' &&
+    typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ === 'undefined' ||
     typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE !== 'function'
```

#### Run 3

##### Attempt 1

- Path: profiling.js
- Operation: —

**Tool error**

```
Failed to find expected lines in profiling.js:
   typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ === 'undefined' &&
   typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE !== 'function'
 ) {@@
if (
   typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ === 'undefined' ||
   typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE !== 'function'
 ) {
```

**Patch args**

```diff
@@ if (
    typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ === 'undefined' &&
    typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE !== 'function'
  ) {@@
 if (
    typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ === 'undefined' ||
    typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE !== 'function'
  ) {
```

##### Attempt 2

- Path: profiling.js
- Operation: —

**Tool error**

```
Failed to find expected lines in profiling.js:
  /* global __REACT_DEVTOOLS_GLOBAL_HOOK__ */
  if (
    typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ === 'undefined' &&
    typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE !== 'function'
  ) {
    typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ === 'undefined' &&
```

**Patch args**

```diff
@@ function checkDCE() {
   /* global __REACT_DEVTOOLS_GLOBAL_HOOK__ */
   if (
     typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ === 'undefined' &&
     typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE !== 'function'
   ) {
-    typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ === 'undefined' &&
+    typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ === 'undefined' ||
```

### Operator Swap Logical 003 (DevToolsFiberComponentStack.js)

#### Run 1

##### Attempt 1

- Path: /tmp/edit-bench-operator-swap-logical-003-jcVf36/DevToolsFiberComponentStack.js
- Operation: —

**Tool error**

```
Found 2 matches for context 'owner = owner.owner;' in /tmp/edit-bench-operator-swap-logical-003-jcVf36/DevToolsFiberComponentStack.js. Add more surrounding context or additional @@ anchors to make it unique.
```

**Patch args**

```diff
@@ owner = owner.owner;
        if (owner || ownerStack) {
          info += '\n' + formatOwnerStack(ownerStack);
        }
       } else {
         break;
       }
     }
     return info;
   } catch (x) {
     return '\nError generating stack: ' + x.message + '\n' + x.stack;
-        if (owner || ownerStack) {
+        if (owner && ownerStack) {
           info += '\n' + formatOwnerStack(ownerStack);
         }
```

### Call Swap Call Args 002 (FlamegraphChartBuilder.js)

#### Run 1

##### Attempt 1

- Path: /tmp/edit-bench-call-swap-call-args-002-nzu8PY/FlamegraphChartBuilder.js
- Operation: —

**Tool error**

```
Failed to find expected lines in /tmp/edit-bench-call-swap-call-args-002-nzu8PY/FlamegraphChartBuilder.js:
       childID,
       rightOffset,
       currentDepth + 1,
     );
     rightOffset -= childChartNode.treeBaseDuration;
      walkTree(
        childID,
        rightOffset,
        currentDepth + 1,
      );
      rightOffset -= childChartNode.treeBaseDuration;
```

**Patch args**

```diff
@@ walkTree(
        childID,
        rightOffset,
        currentDepth + 1,
      );
      rightOffset -= childChartNode.treeBaseDuration;
-      walkTree(
+      const childChartNode: $FlowFixMe = walkTree(
         childID,
-        rightOffset,
-        currentDepth + 1,
+        currentDepth + 1,
+        rightOffset,
       );
       rightOffset -= childChartNode.treeBaseDuration;
```

### Call Swap Call Args 003 (SyntheticEvent.js)

#### Run 2

##### Attempt 1

- Path: ./SyntheticEvent.js
- Operation: —

**Tool error**

```
Failed to find expected lines in ./SyntheticEvent.js:
     instance,
     dispatchConfig,
     targetInst,
     nativeEvent,
     nativeInst,
   );
   );
```

**Patch args**

```diff
@@ EventConstructor.call(
      instance,
      dispatchConfig,
      targetInst,
      nativeEvent,
      nativeInst,
    );
+      instance,
+      dispatchConfig,
+      targetInst,
+      nativeInst,
+      nativeEvent,
    );

```

##### Attempt 2

- Path: ./SyntheticEvent.js
- Operation: —

**Tool error**

```
Failed to find expected lines in ./SyntheticEvent.js:
   EventConstructor.call(
     instance,
     dispatchConfig,
     targetInst,
     nativeEvent,
     nativeInst,
   );
    EventConstructor.call(
      instance,
      dispatchConfig,
      targetInst,
      nativeEvent,
      nativeInst,
    );
```

**Patch args**

```diff
@@ const instance = EventConstructor.eventPool.pop();
    EventConstructor.call(
      instance,
      dispatchConfig,
      targetInst,
      nativeEvent,
      nativeInst,
    );
-    EventConstructor.call(
-      instance,
-      dispatchConfig,
-      targetInst,
-      nativeEvent,
-      nativeInst,
+    EventConstructor.call(
+      instance,
+      dispatchConfig,
+      targetInst,
+      nativeInst,
+      nativeEvent,
     );

```

##### Attempt 3

- Path: ./SyntheticEvent.js
- Operation: —

**Tool error**

```
Failed to find expected lines in ./SyntheticEvent.js:
     instance,
     dispatchConfig,
     targetInst,
     nativeEvent,
     nativeInst,
     nativeInst,
     nativeEvent,
   );
    EventConstructor.call(
      instance,
      dispatchConfig,
      targetInst,
      nativeEvent,
      nativeInst,
      nativeInst,
      nativeEvent,
    );
```

**Patch args**

```diff
@@ EventConstructor.call(
      instance,
      dispatchConfig,
      targetInst,
      nativeEvent,
      nativeInst,
      nativeInst,
      nativeEvent,
    );
-    EventConstructor.call(
-      instance,
-      dispatchConfig,
-      targetInst,
-      nativeEvent,
-      nativeInst,
-      nativeInst,
-      nativeEvent,
+    EventConstructor.call(
+      instance,
+      dispatchConfig,
+      targetInst,
+      nativeInst,
+      nativeEvent,
     );

```

### Structural Swap Adjacent Lines 001 (ReactServerConsoleConfigPlain.js)

#### Run 1

##### Attempt 1

- Path: /tmp/edit-bench-structural-swap-adjacent-lines-001-FVUpDC/ReactServerConsoleConfigPlain.js
- Operation: —

**Tool error**

```
Failed to find expected lines in /tmp/edit-bench-structural-swap-adjacent-lines-001-FVUpDC/ReactServerConsoleConfigPlain.js:
  switch (methodName) {
  let offset = 0;
  let offset = 0;
    case 'dir':
```

**Patch args**

```diff
@@ ): null | string {
   switch (methodName) {
   let offset = 0;
+  let offset = 0;
+  switch (methodName) {
-  let offset = 0;
     case 'dir':
```

### Structural Swap If Else 003 (ReactDOMFizzStaticNode.js)

#### Run 1

##### Attempt 1

- Path: /tmp/edit-bench-structural-swap-if-else-003-vCHptU/ReactDOMFizzStaticNode.js
- Operation: —

**Tool error**

```
Found 4 matches for context 'if (options && options.signal) {' in /tmp/edit-bench-structural-swap-if-else-003-vCHptU/ReactDOMFizzStaticNode.js. Add more surrounding context or additional @@ anchors to make it unique.
```

**Patch args**

```diff
@@ if (options && options.signal) {
        const listener = () => {
          abort(request, (signal: any).reason);
          signal.removeEventListener('abort', listener);
        };
        signal.addEventListener('abort', listener);
      } else {
      const signal = options.signal;
      if (signal.aborted) {
        abort(request, (signal: any).reason);
      }
    }
+    if (options && options.signal) {
+      const signal = options.signal;
+      if (signal.aborted) {
+        abort(request, (signal: any).reason);
+      } else {
+        const listener = () => {
+          abort(request, (signal: any).reason);
+          signal.removeEventListener('abort', listener);
+        };
+        signal.addEventListener('abort', listener);
+      }
+    }
-    if (options && options.signal) {
-        const listener = () => {
-          abort(request, (signal: any).reason);
-          signal.removeEventListener('abort', listener);
-        };
-        signal.addEventListener('abort', listener);
-      } else {
-      const signal = options.signal;
-      if (signal.aborted) {
-        abort(request, (signal: any).reason);
-      }
-    }

```

### Operator Swap Nullish 002 (EnterLeaveEventPlugin.js)

#### Run 2

##### Attempt 1

- Path: /tmp/edit-bench-operator-swap-nullish-002-IRQhbo/EnterLeaveEventPlugin.js
- Operation: —

**Tool error**

```
Failed to find expected lines in /tmp/edit-bench-operator-swap-nullish-002-IRQhbo/EnterLeaveEventPlugin.js:
     win = doc.defaultView ?? doc.parentWindow;
      win = doc.defaultView || doc.parentWindow;
   } else {
   } else {
      win = window;
    }
```

**Patch args**

```diff
@@ if (doc) {
      win = doc.defaultView ?? doc.parentWindow;
       win = doc.defaultView || doc.parentWindow;
    } else {
+      win = doc.defaultView || doc.parentWindow;
    } else {
       win = window;
     }

```

### Structural Swap Adjacent Lines 003 (backend.js)

#### Run 3

##### Attempt 1

- Path: /tmp/edit-bench-structural-swap-adjacent-lines-003-2fz6bF/backend.js
- Operation: —

**Tool error**

```
Line 12: Hunk does not contain any lines
```

**Patch args**

```diff
@@ if (window.__REACT_DEVTOOLS_COMPONENT_FILTERS__ == null) {
    bridge.send('overrideComponentFilters', savedComponentFilters);
  }

  const agent = new Agent(bridge, isProfiling, onReloadAndProfile);
  if (typeof onReloadAndProfileFlagsReset === 'function') {
    onReloadAndProfileFlagsReset();
  }

  if (onSettingsUpdated != null) {
@@
```

##### Attempt 2

- Path: /tmp/edit-bench-structural-swap-adjacent-lines-003-2fz6bF/backend.js
- Operation: —

**Tool error**

```
Found 2 matches for context 'if (window.__REACT_DEVTOOLS_COMPONENT_FILTERS__ == null) {' in /tmp/edit-bench-structural-swap-adjacent-lines-003-2fz6bF/backend.js. Add more surrounding context or additional @@ anchors to make it unique.
```

**Patch args**

```diff
@@ if (window.__REACT_DEVTOOLS_COMPONENT_FILTERS__ == null) {
    bridge.send('overrideComponentFilters', savedComponentFilters);
  }

-
-
-   if (typeof onReloadAndProfileFlagsReset === 'function') {
-     onReloadAndProfileFlagsReset();
-   }
-   const agent = new Agent(bridge, isProfiling, onReloadAndProfile);
-
-   if (onSettingsUpdated != null) {
+  if (typeof onReloadAndProfileFlagsReset === 'function') {
+    onReloadAndProfileFlagsReset();
+  }
+
+  const agent = new Agent(bridge, isProfiling, onReloadAndProfile);
+  if (onSettingsUpdated != null) {

```

##### Attempt 3

- Path: /tmp/edit-bench-structural-swap-adjacent-lines-003-2fz6bF/backend.js
- Operation: —

**Tool error**

```
Found 2 matches for context 'bridge.addListener(' in /tmp/edit-bench-structural-swap-adjacent-lines-003-2fz6bF/backend.js. Add more surrounding context or additional @@ anchors to make it unique.
```

**Patch args**

```diff
@@ bridge.addListener(
    'updateComponentFilters',
    (componentFilters: Array<ComponentFilter>) => {
      // Save filter changes in memory, in case DevTools is reloaded.
      // In that case, the renderer will already be using the updated values.
      // We'll lose these in between backend reloads but that can't be helped.
      savedComponentFilters = componentFilters;
    },
  );

  if (window.__REACT_DEVTOOLS_COMPONENT_FILTERS__ == null) {
    bridge.send('overrideComponentFilters', savedComponentFilters);
  }

-
-
-   if (typeof onReloadAndProfileFlagsReset === 'function') {
-     onReloadAndProfileFlagsReset();
-   }
-   const agent = new Agent(bridge, isProfiling, onReloadAndProfile);
-
-   if (onSettingsUpdated != null) {
+  if (typeof onReloadAndProfileFlagsReset === 'function') {
+    onReloadAndProfileFlagsReset();
+  }
+
+  const agent = new Agent(bridge, isProfiling, onReloadAndProfile);
+  if (onSettingsUpdated != null) {

```

##### Attempt 4

- Path: /tmp/edit-bench-structural-swap-adjacent-lines-003-2fz6bF/backend.js
- Operation: —

**Tool error**

```
Failed to find expected lines in /tmp/edit-bench-structural-swap-adjacent-lines-003-2fz6bF/backend.js:

 bridge.addListener(
   'updateComponentFilters',
   (componentFilters: Array<ComponentFilter>) => {
     // Save filter changes in memory, in case DevTools is reloaded.
     // In that case, the renderer will already be using the updated values.
     // We'll lose these in between backend reloads but that can't be helped.
     savedComponentFilters = componentFilters;
   },
 );

 if (window.__REACT_DEVTOOLS_COMPONENT_FILTERS__ == null) {
   bridge.send('overrideComponentFilters', savedComponentFilters);
 }



   if (typeof onReloadAndProfileFlagsReset === 'function') {
     onReloadAndProfileFlagsReset();
   }
   const agent = new Agent(bridge, isProfiling, onReloadAndProfile);

   if (onSettingsUpdated != null) {
```

**Patch args**

```diff
@@ const bridge: BackendBridge = new Bridge(wall);

  bridge.addListener(
    'updateComponentFilters',
    (componentFilters: Array<ComponentFilter>) => {
      // Save filter changes in memory, in case DevTools is reloaded.
      // In that case, the renderer will already be using the updated values.
      // We'll lose these in between backend reloads but that can't be helped.
      savedComponentFilters = componentFilters;
    },
  );

  if (window.__REACT_DEVTOOLS_COMPONENT_FILTERS__ == null) {
    bridge.send('overrideComponentFilters', savedComponentFilters);
  }

-
-
-   if (typeof onReloadAndProfileFlagsReset === 'function') {
-     onReloadAndProfileFlagsReset();
-   }
-   const agent = new Agent(bridge, isProfiling, onReloadAndProfile);
-
-   if (onSettingsUpdated != null) {
+  if (typeof onReloadAndProfileFlagsReset === 'function') {
+    onReloadAndProfileFlagsReset();
+  }
+
+  const agent = new Agent(bridge, isProfiling, onReloadAndProfile);
+  if (onSettingsUpdated != null) {

```

## Flaky Tasks (partial passing)

### Import Swap Named Imports 002 (ReactDOMTextarea.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for ReactDOMTextarea.js | 20 / 779 | 14.2s |
| 2 | ✅ | — | 19 / 726 | 12.5s |
| 3 | ✅ | — | 20 / 711 | 11.1s |

### Access Remove Optional Chain 002 (TimelineContext.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 26 / 962 | 16.1s |
| 2 | ❌ | File mismatch for TimelineContext.js | 35 / 1,224 | 18.7s |
| 3 | ✅ | — | 35 / 1,015 | 14.8s |

### Literal Flip Boolean 002 (ReactNoopFlightServer.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 19 / 683 | 11.3s |
| 2 | ✅ | — | 23 / 555 | 10.9s |
| 3 | ❌ | File mismatch for ReactNoopFlightServer.js | 18 / 821 | 12.7s |

### Identifier Identifier Multi Edit 001 (TabBar.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 41 / 1,221 | 18.2s |
| 2 | ❌ | File mismatch for TabBar.js | 29 / 1,190 | 16.1s |
| 3 | ✅ | — | 36 / 1,410 | 21.0s |

### Access Remove Optional Chain 001 (registerDevToolsEventLogger.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for registerDevToolsEventLogger.js | 26 / 867 | 16.6s |
| 2 | ✅ | — | 28 / 1,275 | 23.5s |
| 3 | ✅ | — | 26 / 1,011 | 19.0s |

### Call Swap Call Args 001 (testHelpers.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 40 / 2,222 | 31.4s |
| 2 | ✅ | — | 15 / 423 | 9.5s |
| 3 | ❌ | File mismatch for testHelpers.js | 47 / 1,658 | 26.0s |

### Literal Off By One 003 (InspectedElement.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 18 / 721 | 10.9s |
| 2 | ✅ | — | 35 / 1,226 | 18.1s |
| 3 | ❌ | File mismatch for InspectedElement.js | 30 / 964 | 14.9s |

### Duplicate Duplicate Line Flip 003 (SyntheticEvent.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 20 / 983 | 14.2s |
| 2 | ✅ | — | 43 / 1,752 | 25.2s |
| 3 | ❌ | File mismatch for SyntheticEvent.js | 14 / 157 | 37.1s |

### Operator Swap Comparison 002 (ReactFlightDOMServerBrowser.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 43 / 1,190 | 20.1s |
| 2 | ❌ | File mismatch for ReactFlightDOMServerBrowser.js | 39 / 1,384 | 21.3s |
| 3 | ✅ | — | 23 / 716 | 12.5s |

### Identifier Identifier Multi Edit 003 (ReactPerformanceTrackProperties.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 53 / 1,583 | 25.7s |
| 2 | ❌ | File mismatch for ReactPerformanceTrackProperti... | 40 / 1,687 | 24.3s |
| 3 | ✅ | — | 117 / 3,487 | 57.6s |

### Operator Swap Nullish 003 (backend.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for backend.js | 19 / 626 | 11.9s |
| 2 | ❌ | File mismatch for backend.js | 18 / 643 | 10.8s |
| 3 | ✅ | — | 18 / 1,112 | 14.8s |

### Structural Delete Statement 002 (getComponentNameFromFiber.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for getComponentNameFromFiber.js | 20 / 661 | 13.3s |
| 2 | ❌ | File mismatch for getComponentNameFromFiber.js | 24 / 702 | 12.8s |
| 3 | ✅ | — | 31 / 807 | 15.0s |

### Operator Remove Negation 001 (ReactDOMClient.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for ReactDOMClient.js | 46 / 4,444 | 48.2s |
| 2 | ❌ | File mismatch for ReactDOMClient.js | 41 / 5,329 | 57.6s |
| 3 | ✅ | — | 47 / 2,851 | 35.6s |

### Structural Delete Statement 003 (simulateBrowserEventDispatch.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for simulateBrowserEventDispatch.js | 36 / 1,161 | 19.8s |
| 2 | ✅ | — | 38 / 1,143 | 18.9s |
| 3 | ❌ | File mismatch for simulateBrowserEventDispatch.js | 19 / 893 | 12.8s |

### Structural Remove Early Return 002 (useCommitFilteringAndNavigation.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 28 / 809 | 14.1s |
| 2 | ❌ | File mismatch for useCommitFilteringAndNavigati... | 25 / 673 | 12.3s |
| 3 | ❌ | File mismatch for useCommitFilteringAndNavigati... | 26 / 720 | 11.0s |

### Regex Swap Regex Quantifier 002 (ReactFlightStackConfigV8.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 18 / 2,682 | 29.5s |
| 2 | ✅ | — | 38 / 1,267 | 18.5s |
| 3 | ❌ | File mismatch for ReactFlightStackConfigV8.js | 38 / 1,757 | 23.4s |

### Structural Swap If Else 001 (importFile.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for importFile.js | 15 / 562 | 8.4s |
| 2 | ✅ | — | 25 / 657 | 12.5s |
| 3 | ❌ | File mismatch for importFile.js | 28 / 727 | 13.5s |

### Operator Swap Nullish 002 (EnterLeaveEventPlugin.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for EnterLeaveEventPlugin.js | 47 / 3,038 | 38.4s |
| 2 | ✅ | — | 73 / 4,412 | 50.1s |
| 3 | ❌ | File mismatch for EnterLeaveEventPlugin.js | 137 / 7,553 | 96.1s |

### Operator Remove Negation 003 (ReactFlightUnbundledReferences.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for ReactFlightUnbundledReference... | 60 / 5,393 | 61.4s |
| 2 | ✅ | — | 20 / 2,040 | 23.0s |
| 3 | ❌ | Timeout waiting for agent_end | 0 / 0 | 120.2s |

## Failed Tasks (0% passing)

### Import Swap Named Imports 003 (StyleEditor.js) — 0/3

**All runs failed with same error:** File mismatch for StyleEditor.js

**Sample agent response (run 1):**
```
Perfect. The bug was in the import statement on line 11 where `useRef` and `useState` were swapped. I've corrected it so they now appear in the proper order: `useState` before `useRef`, which matches the conventional ordering and the order they're used in the code.
```

**Diff (expected vs actual):**
```diff
@@ -8 @@
  */
 
 import * as React from 'react';
-import { useContext, useMemo, useRef, useState } from 'react';
+import { useMemo, useContext, useState, useRef } from 'react';
 import { copy } from 'clipboard-js';
 import { BridgeContext, StoreContext } from 'react-devtools-shared/src/devtools/views/context';
 import Button from '../../Button';
```

### Literal Flip Boolean 003 (ReactFlightDOMClientEdge.js) — 0/3

**All runs failed with same error:** File mismatch for ReactFlightDOMClientEdge.js

**Sample agent response (run 1):**
```
Perfect. The fix has been applied. The inverted boolean literal on line 100 has been changed from `false` to `true`:

**Before:**
```javascript
__DEV__ && options ? options.replayConsoleLogs === false : false, // defaults to false
```

**After:**
```javascript
__DEV__ && options ? options.replayConsoleLogs === false : true, // defaults to false
```

This corrects the logic: when `options.replayConsoleLogs === false`, it returns `false`; otherwise (when options is provided but replayConsoleLog...
```

**Diff (expected vs actual):**
```diff
@@ -100 @@
     typeof options.nonce === 'string' ? options.nonce : undefined,
     options && options.temporaryReferences ? options.temporaryReferences : undefined,
     __DEV__ && options && options.findSourceMapURL ? options.findSourceMapURL : undefined,
-    __DEV__ && options ? options.replayConsoleLogs === true : false, // defaults to false
+    __DEV__ && options ? options.replayConsoleLogs === false : true, // defaults to false
     __DEV__ && options && options.environmentName ? options.environmentName : undefined,
     __DEV__ && options && options.startTime != null ? options.startTime : undefined,
     __DEV__ && options && options.endTime != null ? options.endTime : undefined,
```

### Access Remove Optional Chain 003 (astUtils.js) — 0/3

**All runs failed with same error:** File mismatch for astUtils.js

**Sample agent response (run 1):**
```
Good, my fix was applied. The optional chaining `?.` is now on line 420 where it accesses `referencePaths`. This was the bug - the optional chaining operator was removed from the property access on `path.scope.bindings[hookDeclaredVariableName]` when accessing `.referencePaths`.

The fix is complete. The minimum change was made to add back the optional chaining operator (`?.`) that was removed from line 420, which accesses the `referencePaths` property on the binding object. This prevents err...
```

**Diff (expected vs actual):**
```diff
@@ -255 @@
   const nodeType = hook.node.id.type;
   switch (nodeType) {
     case AST_NODE_TYPES.ARRAY_PATTERN:
-      return !isCustomHook ? (hook.node.id.elements[0]?.name ?? null) : null;
+      return !isCustomHook ? (hook.node.id.elements[0].name ?? null) : null;
 
     case AST_NODE_TYPES.IDENTIFIER:
       return hook.node.id.name;
```

### Call Swap Call Args 002 (FlamegraphChartBuilder.js) — 0/3

**All runs failed with same error:** File mismatch for FlamegraphChartBuilder.js

**Sample agent response (run 1):**
```
Done. The bug has been fixed on line 49.

**Change made:**
- Line 49: `profilerStore.getCommitData(rootID, commitIndex)` → `profilerStore.getCommitData(commitIndex, rootID)`

The two arguments `rootID` and `commitIndex` were swapped. They are now in the correct order matching the function parameter order defined in the `getChartData` function signature (commitIndex first, then rootID).
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

### Operator Swap Arithmetic 003 (hooks.js) — 0/3

**All runs failed with same error:** File mismatch for hooks.js

**Sample agent response (run 1):**
```
Done. The arithmetic operator `<=` was swapped to `<` on line 132 in the `useIsOverflowing` hook. The logic now correctly identifies overflow only when the container width is strictly less than the total child width, not when they're equal.
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

### Call Swap Call Args 003 (SyntheticEvent.js) — 0/3

**All runs failed with same error:** File mismatch for SyntheticEvent.js

**Sample agent response (run 1):**
```
Perfect! Now I can see the bug clearly:

- The `.call()` version (lines 310-314) now has: `dispatchConfig, nativeEvent, targetInst, nativeInst`
- The `new` version (lines 318-321) has: `dispatchConfig, targetInst, nativeEvent, nativeInst`

The `new` version is correct (matching the constructor parameter order), and the `.call()` version had the swapped arguments for `targetInst` and `nativeEvent`. This has been fixed.

Done.
```

**Diff (expected vs actual):**
```diff
@@ -250 @@
 function getPooledWarningPropertyDefinition(propName, getVal) {
   function set(val) {
     const action = isFunction ? 'setting the method' : 'setting the property';
-    warn(action, 'This is effectively a no-op');
+    warn('This is effectively a no-op', action);
     return val;
   }
 
@@ -286 @@
   const EventConstructor = this;
   if (EventConstructor.eventPool.length) {
     const instance = EventConstructor.eventPool.pop();
-    EventConstructor.call(instance, dispatchConfig, targetInst, nativeEvent, nativeInst);
+    EventConstructor.call(instance, dispatchConfig, nativeEvent, targetInst, nativeInst);
     return instance;
   }
   return new EventConstructor(dispatchConfig, targetInst, nativeEvent, nativeInst);
```

### Structural Swap If Else 002 (ReactNativeFiberInspector.js) — 0/3

**All runs failed with same error:** File mismatch for ReactNativeFiberInspector.js

**Sample agent response (run 1):**
```
Fixed. The condition is now negated (`!__DEV__`), which correctly swaps the logical behavior:
- In production (`!__DEV__` is true): throws error
- In development (`!__DEV__` is false): executes the function body

This matches the error message and the intended design—inspector data should only be available in development.
```

**Diff (expected vs actual):**
```diff
@@ -145 @@
 }
 
 function getInspectorDataForViewTag(viewTag: number): InspectorData {
-  if (__DEV__) {
+  if (!__DEV__) {
+    throw new Error('getInspectorDataForViewTag() is not available in production');
+  } else {
     const closestInstance = getClosestInstanceFromNode(viewTag);
     return getInspectorDataForInstance(closestInstance);
     const closestInstance = getClosestInstanceFromNode(viewTag);
     return getInspectorDataForInstance(closestInstance);
-  } else {
-    throw new Error('getInspectorDataForViewTag() is not available in production');
   }
 }
 
```

### Structural Remove Early Return 001 (InspectedElementStateTree.js) — 0/3

**All runs failed with same error:** File mismatch for InspectedElementStateTree.js

**Sample agent response (run 1):**
```
Perfect. The fix is now complete. 

**Summary of the fix:**

The buggy code had:
```javascript
if (isEmpty || isHostComponent) {
  return null;
}
```

This was incorrect because it returns `null` whenever the state is empty, but the code later needs to render `{isEmpty && <div className={styles.Empty}>None</div>}` to show the "None" message.

The restored guard clause now correctly returns early only for host components:
```javascript
if (isHostComponent) {
  return null;
}
```

This allows t...
```

**Diff (expected vs actual):**
```diff
@@ -36 @@
   store,
 }: Props): React.Node {
   const { state, type } = inspectedElement;
-  if (state == null) {
-    return null;
-  }
 
   // HostSingleton and HostHoistable may have state that we don't want to expose to users
   const isHostComponent = type === ElementTypeHostComponent;
@@ -44 @@
   const isHostComponent = type === ElementTypeHostComponent;
   const entries = Object.entries(state);
   const isEmpty = entries.length === 0;
-  if (isEmpty || isHostComponent) {
+  if (isHostComponent) {
     return null;
   }
 
```

### Structural Remove Early Return 003 (ReactFiberAsyncAction.js) — 0/3

**All runs failed with same error:** File mismatch for ReactFiberAsyncAction.js

**Sample agent response (run 1):**
```
Perfect. The fix is now correct. The guard clause (early return) that was removed has been restored. The function now has:

1. Early return if `!enableDefaultTransitionIndicator`
2. Early return if `!needsIsomorphicIndicator`
3. Early return if `isomorphicDefaultTransitionIndicator == null || pendingIsomorphicIndicator !== null` (the restored guard)
4. Only then proceeds to execute the try-catch block

This ensures that the code inside the try-catch block only executes when:
- The feature is ...
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
-  if (isomorphicDefaultTransitionIndicator != null && pendingIsomorphicIndicator === null) {
-    try {
-      pendingIsomorphicIndicator = isomorphicDefaultTransitionIndicator() || noop;
-    } catch (x) {
-      pendingIsomorphicIndicator = noop;
-      reportGlobalError(x);
-    }
+  if (isomorphicDefaultTransitionIndicator == null || pendingIsomorphicIndicator !== null) {
+    return;
   }
   }
+  try {
+    pendingIsomorphicIndicator = isomorphicDefaultTransitionIndicator() || noop;
+  } catch (x) {
+    pendingIsomorphicIndicator = noop;
+    reportGlobalError(x);
+  }
 }
 }
-
 function stopIsomorphicDefaultIndicator() {
   if (!enableDefaultTransitionIndicator) {
     return;
```

### Structural Swap Adjacent Lines 002 (ReactNoopFlightServer.js) — 0/3

**All runs failed with same error:** File mismatch for ReactNoopFlightServer.js

**Sample agent response (run 1):**
```
Perfect! The bug is now fixed. The two adjacent lines have been swapped back to their original correct order:
- Line 46: `    return textEncoder.encode(content);` (inside `stringToChunk`)
- Line 47: `  },` (closing `stringToChunk`)
- Line 48: `  flushBuffered(destination: Destination): void {},` (separate property)

The `stringToChunk` method now correctly has its return statement, and `flushBuffered` is properly positioned as a separate method property at the object level.
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

### Literal Off By One 002 (code-path.js) — 0/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for code-path.js | 20 / 944 | 13.4s |
| 2 | ❌ | File mismatch for code-path.js | 19 / 1,138 | 13.9s |
| 3 | ❌ | Timeout waiting for agent_end | 0 / 0 | 120.2s |

**Sample agent response (run 1):**
```
Fixed. The off-by-one error was in line 226. The `end` variable should be set to `segment.nextSegments.length` (not `length - 1`), so that the condition `index < end` correctly iterates through all valid indices (0 to length-1) of the nextSegments array.
```

**Diff (expected vs actual):**
```diff
@@ -220 @@
       }
 
       // Update the stack.
-      end = segment.nextSegments.length - 1;
+      end = segment.nextSegments.length;
       if (index < end) {
         item[1] += 1;
         stack.push([segment.nextSegments[index], 0]);
@@ -226 @@
         stack.push([segment.nextSegments[index], 0]);
       } else if (index === end) {
         item[0] = segment.nextSegments[index];
-        item[1] = 0;
+        item[1] = 1;
       } else {
         stack.pop();
       }
```

### Structural Swap Adjacent Lines 003 (backend.js) — 0/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for backend.js | 64 / 3,157 | 36.2s |
| 2 | ❌ | Timeout waiting for agent_end | 0 / 0 | 120.2s |
| 3 | ❌ | File mismatch for backend.js | 122 / 6,911 | 76.6s |

**Sample agent response (run 1):**
```
Perfect. The two adjacent statements have been swapped:
- `nativeStyleResolver` declaration (lines 406-407) now comes BEFORE 
- `initBackend` call (lines 409-414)

This is the correct logical order: determine what style resolver is available before initializing the backend.
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
@@ -376 @@
     hook.emit('shutdown');
   });
 
-  const unsubscribeBackend = initBackend(hook, agent, window, isReloadAndProfileSupported);
-
   const nativeStyleResolver: ResolveNativeStyle | void = resolveRNStyle || hook.resolveRNStyle;
 
   const nativeStyleResolver: ResolveNativeStyle | void = resolveRNStyle || hook.resolveRNStyle;
 
+  const unsubscribeBackend = initBackend(hook, agent, window, isReloadAndProfileSupported);
+
   if (nativeStyleResolver != null) {
     const validAttributes =
       nativeStyleEditorValidAttributes || hook.nativeStyleEditorValidAttributes || null;
```
