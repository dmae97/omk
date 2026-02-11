# Edit Benchmark Report

## Configuration

| Setting | Value |
|---------|-------|
| Date | 2026-02-11T09:17:12.730Z |
| Model | openrouter/openrouter/openai/gpt-5.1-codex-mini |
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
| Successful Runs | 36 |
| **Task Success Rate** | **60.0% (36/60)** |
| Verified Rate | 60.0% (36/60) |
| Edit Tool Usage Rate | 73.3% (44/60) |
| **Edit Success Rate** | **100.0%** |
| Timeout Runs | 0 |
| Mutation Intent Match Rate | 84.1% |
| Patch Failure Rate | 0.0% (0/45) |
| Tasks All Passing | 36 |
| Tasks Flaky/Failing | 24 |

### Tool Calls

| Tool | Total | Avg/Run |
|------|-------|---------|
| Read | 138 | 2.3 |
| Edit | 45 | 0.8 |
| Write | 0 | 0.0 |
| **Tool Input Chars** | 15,012 | 250 |

### Tokens & Time

| Metric | Total | Avg/Run |
|--------|-------|---------|
| Input Tokens | 334,603 | 5,577 |
| Output Tokens | 245,740 | 4,096 |
| Total Tokens | 2,652,919 | 44,215 |
| Duration | 8689.5s | 144.8s |
| **Avg Indent Score** | — | **1.92** |

### Hashline Edit Subtypes

| Operation | Count | % |
|-----------|-------|---|
| set_line | 50 | 92.6% |
| replace_lines | 0 | 0.0% |
| insert_after | 3 | 5.6% |
| replace | 1 | 1.9% |
| **Total** | **54** | 100% |

## Task Results

| Task | File | Success | Edit Hit | R/E/W | Tokens (In/Out) | Time | Indent |
|------|------|---------|----------|-------|-----------------|------|--------|
| Access Remove Optional Chain 001 | registerDevToolsEventLogger.js | 1/1 ✅ | 100.0% | 3/1/0 | 4,455/1,445 | 16.2s | 1.00 |
| Access Remove Optional Chain 002 | TimelineContext.js | 0/1 ❌ | 100.0% | 2/1/0 | 3,786/3,414 | 26.2s | 1.29 |
| Access Remove Optional Chain 003 | astUtils.js | 1/1 ✅ | 100.0% | 0/1/0 | 13,249/14,870 | 213.0s | 4.85 |
| Call Swap Call Args 001 | testHelpers.js | 1/1 ✅ | 100.0% | 1/1/0 | 1,315/708 | 8.6s | 1.33 |
| Call Swap Call Args 002 | FlamegraphChartBuilder.js | 1/1 ✅ | 100.0% | 8/1/0 | 28,428/12,692 | 205.1s | 3.79 |
| Call Swap Call Args 003 | SyntheticEvent.js | 1/1 ✅ | 100.0% | 6/1/0 | 14,257/5,436 | 47.2s | 3.76 |
| Duplicate Duplicate Line Flip 001 | index.js | 1/1 ✅ | 100.0% | 1/1/0 | 2,075/183 | 6.2s | 0.00 |
| Duplicate Duplicate Line Flip 002 | ActivityList.js | 1/1 ✅ | 100.0% | 3/1/0 | 10,222/3,423 | 28.5s | 3.61 |
| Duplicate Duplicate Line Flip 003 | SyntheticEvent.js | 0/1 ❌ | 100.0% | 0/0/0 | 0/0 | 360.6s | 0.00 |
| Identifier Identifier Multi Edit 001 | TabBar.js | 0/1 ❌ | 100.0% | 0/0/0 | 0/0 | 360.4s | 0.00 |
| Identifier Identifier Multi Edit 002 | EventPluginRegistry.js | 1/1 ✅ | 100.0% | 0/1/0 | 1,247/6,114 | 127.3s | 3.94 |
| Identifier Identifier Multi Edit 003 | ReactPerformanceTrackProperties.js | 0/1 ❌ | 100.0% | 0/0/0 | 0/0 | 360.6s | 0.00 |
| Import Swap Named Imports 001 | CommitFlamegraphListItem.js | 1/1 ✅ | 100.0% | 2/1/0 | 3,671/2,735 | 21.3s | 2.86 |
| Import Swap Named Imports 002 | ReactDOMTextarea.js | 1/1 ✅ | 100.0% | 5/1/0 | 8,209/6,565 | 52.1s | 2.41 |
| Import Swap Named Imports 003 | StyleEditor.js | 0/1 ❌ | 100.0% | 3/1/0 | 2,352/21,682 | 329.9s | 1.31 |
| Literal Flip Boolean 001 | testHelpers.js | 1/1 ✅ | 100.0% | 1/1/0 | 1,187/307 | 8.6s | 1.33 |
| Literal Flip Boolean 002 | ReactNoopFlightServer.js | 1/1 ✅ | 100.0% | 2/1/0 | 8,642/2,274 | 19.8s | 1.11 |
| Literal Flip Boolean 003 | ReactFlightDOMClientEdge.js | 1/1 ✅ | 100.0% | 5/1/0 | 19,589/16,211 | 185.2s | 3.58 |
| Literal Off By One 001 | githubAPI.js | 1/1 ✅ | 100.0% | 1/1/0 | 2,170/651 | 7.4s | 0.67 |
| Literal Off By One 002 | code-path.js | 1/1 ✅ | 100.0% | 1/1/0 | 9,231/9,539 | 156.5s | 3.50 |
| Literal Off By One 003 | InspectedElement.js | 0/1 ❌ | 100.0% | 0/0/0 | 0/0 | 360.4s | 0.00 |
| Operator Remove Negation 001 | ReactDOMClient.js | 0/1 ❌ | 100.0% | 0/0/0 | 0/0 | 360.4s | 0.00 |
| Operator Remove Negation 002 | NativeEventsView.js | 0/1 ❌ | 100.0% | 0/0/0 | 0/0 | 360.4s | 0.00 |
| Operator Remove Negation 003 | ReactFlightUnbundledReferences.js | 0/1 ❌ | 100.0% | 0/0/0 | 0/0 | 360.4s | 0.00 |
| Operator Swap Arithmetic 001 | fallbackEvalContext.js | 1/1 ✅ | 100.0% | 1/1/0 | 1,289/397 | 10.6s | 0.00 |
| Operator Swap Arithmetic 002 | CSSShorthandProperty.js | 0/1 ❌ | 100.0% | 0/0/0 | 0/0 | 360.4s | 0.00 |
| Operator Swap Arithmetic 003 | hooks.js | 0/1 ❌ | 100.0% | 2/1/0 | 6,122/19,571 | 123.5s | 2.25 |
| Operator Swap Comparison 001 | index.js | 1/1 ✅ | 100.0% | 1/1/0 | 2,937/175 | 6.1s | 0.00 |
| Operator Swap Comparison 002 | ReactFlightDOMServerBrowser.js | 1/1 ✅ | 100.0% | 2/1/0 | 12,001/1,494 | 17.4s | 1.57 |
| Operator Swap Comparison 003 | ReactFlightDOMServerNode.js | 1/1 ✅ | 100.0% | 4/1/0 | 13,201/7,885 | 53.6s | 1.95 |
| Operator Swap Equality 001 | readInputData.js | 1/1 ✅ | 100.0% | 1/1/0 | 1,287/345 | 7.5s | 0.00 |
| Operator Swap Equality 002 | editor.js | 1/1 ✅ | 100.0% | 1/1/0 | 4,595/428 | 6.8s | 0.00 |
| Operator Swap Equality 003 | hooks.js | 1/1 ✅ | 100.0% | 6/1/0 | 15,032/2,258 | 26.4s | 2.25 |
| Operator Swap Increment Decrement 001 | ReactFlightDOMClientNode.js | 1/1 ✅ | 100.0% | 1/1/0 | 2,256/344 | 10.9s | 1.52 |
| Operator Swap Increment Decrement 002 | ReactFlightDOMClientNode.js | 1/1 ✅ | 100.0% | 2/1/0 | 3,581/643 | 13.6s | 1.92 |
| Operator Swap Increment Decrement 003 | loadSourceAndMetadata.js | 1/1 ✅ | 100.0% | 2/1/0 | 8,429/735 | 16.7s | 3.72 |
| Operator Swap Logical 001 | profiling.js | 1/1 ✅ | 100.0% | 1/1/0 | 2,935/944 | 11.0s | 0.00 |
| Operator Swap Logical 002 | SourceMapMetadataConsumer.js | 1/1 ✅ | 100.0% | 2/1/0 | 11,391/6,933 | 50.7s | 3.14 |
| Operator Swap Logical 003 | DevToolsFiberComponentStack.js | 0/1 ❌ | 100.0% | 0/0/0 | 0/0 | 360.4s | 0.00 |
| Operator Swap Nullish 001 | getBatchRange.js | 1/1 ✅ | 100.0% | 1/1/0 | 3,230/926 | 11.2s | 1.33 |
| Operator Swap Nullish 002 | EnterLeaveEventPlugin.js | 1/1 ✅ | 100.0% | 2/1/0 | 11,520/18,415 | 112.7s | 1.56 |
| Operator Swap Nullish 003 | backend.js | 0/1 ❌ | 100.0% | 0/0/0 | 0/0 | 360.4s | 0.00 |
| Regex Swap Regex Quantifier 001 | githubAPI.js | 1/1 ✅ | 100.0% | 1/1/0 | 2,977/440 | 6.7s | 0.67 |
| Regex Swap Regex Quantifier 002 | ReactFlightStackConfigV8.js | 1/1 ✅ | 100.0% | 1/1/0 | 19,633/8,165 | 177.2s | 3.06 |
| Regex Swap Regex Quantifier 003 | utils.js | 0/1 ❌ | 100.0% | 0/0/0 | 0/0 | 360.6s | 0.00 |
| Structural Delete Statement 001 | UnsupportedVersionDialog.js | 0/1 ❌ | 100.0% | 8/1/0 | 9,484/2,886 | 36.8s | 6.22 |
| Structural Delete Statement 002 | getComponentNameFromFiber.js | 0/1 ❌ | 100.0% | 15/1/0 | 15,136/6,340 | 64.6s | 0.62 |
| Structural Delete Statement 003 | simulateBrowserEventDispatch.js | 0/1 ❌ | 100.0% | 0/0/0 | 0/0 | 360.4s | 0.00 |
| Structural Remove Early Return 001 | InspectedElementStateTree.js | 1/1 ✅ | 100.0% | 17/1/0 | 14,341/10,553 | 217.8s | 0.33 |
| Structural Remove Early Return 002 | useCommitFilteringAndNavigation.js | 0/1 ❌ | 100.0% | 0/0/0 | 0/0 | 360.4s | 0.00 |
| Structural Remove Early Return 003 | ReactFiberAsyncAction.js | 0/1 ❌ | 100.0% | 0/0/0 | 0/0 | 360.6s | 0.00 |
| Structural Swap Adjacent Lines 001 | ReactServerConsoleConfigPlain.js | 1/1 ✅ | 100.0% | 2/1/0 | 3,966/1,170 | 13.5s | 1.00 |
| Structural Swap Adjacent Lines 002 | ReactNoopFlightServer.js | 0/1 ❌ | 100.0% | 6/1/0 | 6,741/14,264 | 222.8s | 0.00 |
| Structural Swap Adjacent Lines 003 | backend.js | 0/1 ❌ | 100.0% | 0/0/0 | 0/0 | 360.3s | 0.00 |
| Structural Swap If Else 001 | importFile.js | 0/1 ❌ | 100.0% | 4/2/0 | 5,889/17,179 | 114.1s | 0.00 |
| Structural Swap If Else 002 | ReactNativeFiberInspector.js | 0/1 ❌ | 100.0% | 7/1/0 | 9,040/13,280 | 98.1s | 3.18 |
| Structural Swap If Else 003 | ReactDOMFizzStaticNode.js | 0/1 ❌ | 100.0% | 0/0/0 | 0/0 | 360.6s | 0.00 |
| Unicode Unicode Hyphen 001 | Rectangle.js | 1/1 ✅ | 100.0% | 1/1/0 | 2,140/281 | 6.9s | 3.00 |
| Unicode Unicode Hyphen 002 | UnsupportedBridgeProtocolDialog.js | 1/1 ✅ | 100.0% | 1/1/0 | 4,696/169 | 4.4s | 3.83 |
| Unicode Unicode Hyphen 003 | ReactTypes.js | 1/1 ✅ | 100.0% | 2/1/0 | 6,669/1,271 | 21.8s | 1.24 |

## Category Summary

| Category | Runs | Verified | Edit Used | Success | Min/Avg/Max Difficulty |
|----------|------|----------|-----------|---------|------------------------|
| access | 3 | 66.7% (2/3) | 100.0% (3/3) | 66.7% (2/3) | 7 / 8.7 / 10 |
| call | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) | 6 / 7.7 / 10 |
| duplicate | 3 | 66.7% (2/3) | 66.7% (2/3) | 66.7% (2/3) | 7 / 9.7 / 12 |
| identifier | 3 | 33.3% (1/3) | 33.3% (1/3) | 33.3% (1/3) | 6 / 9.3 / 14 |
| import | 3 | 66.7% (2/3) | 100.0% (3/3) | 66.7% (2/3) | 2 / 4.7 / 6 |
| literal | 6 | 83.3% (5/6) | 83.3% (5/6) | 83.3% (5/6) | 4 / 6.2 / 9 |
| operator | 21 | 66.7% (14/21) | 71.4% (15/21) | 66.7% (14/21) | 1 / 6.5 / 13 |
| regex | 3 | 66.7% (2/3) | 66.7% (2/3) | 66.7% (2/3) | 6 / 7.3 / 8 |
| structural | 12 | 16.7% (2/12) | 58.3% (7/12) | 16.7% (2/12) | 4 / 7.6 / 15 |
| unicode | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) | 1 / 3.0 / 6 |

## Mutation Summary

| Mutation | Category | Runs | Verified | Edit Used | Success |
|----------|----------|------|----------|-----------|---------|
| delete-statement | structural | 3 | 0.0% (0/3) | 66.7% (2/3) | 0.0% (0/3) |
| duplicate-line-flip | duplicate | 3 | 66.7% (2/3) | 66.7% (2/3) | 66.7% (2/3) |
| flip-boolean | literal | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| identifier-multi-edit | identifier | 3 | 33.3% (1/3) | 33.3% (1/3) | 33.3% (1/3) |
| off-by-one | literal | 3 | 66.7% (2/3) | 66.7% (2/3) | 66.7% (2/3) |
| remove-early-return | structural | 3 | 33.3% (1/3) | 33.3% (1/3) | 33.3% (1/3) |
| remove-negation | operator | 3 | 0.0% (0/3) | 0.0% (0/3) | 0.0% (0/3) |
| remove-optional-chain | access | 3 | 66.7% (2/3) | 100.0% (3/3) | 66.7% (2/3) |
| swap-adjacent-lines | structural | 3 | 33.3% (1/3) | 66.7% (2/3) | 33.3% (1/3) |
| swap-arithmetic | operator | 3 | 33.3% (1/3) | 66.7% (2/3) | 33.3% (1/3) |
| swap-call-args | call | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| swap-comparison | operator | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| swap-equality | operator | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| swap-if-else | structural | 3 | 0.0% (0/3) | 66.7% (2/3) | 0.0% (0/3) |
| swap-increment-decrement | operator | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| swap-logical | operator | 3 | 66.7% (2/3) | 66.7% (2/3) | 66.7% (2/3) |
| swap-named-imports | import | 3 | 66.7% (2/3) | 100.0% (3/3) | 66.7% (2/3) |
| swap-nullish | operator | 3 | 66.7% (2/3) | 66.7% (2/3) | 66.7% (2/3) |
| swap-regex-quantifier | regex | 3 | 66.7% (2/3) | 66.7% (2/3) | 66.7% (2/3) |
| unicode-hyphen | unicode | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |

## Difficulty Summary

| Difficulty Score | Runs | Verified | Edit Used | Success |
|------------------|------|----------|-----------|---------|
| 0-2 | 6 | 83.3% (5/6) | 83.3% (5/6) | 83.3% (5/6) |
| 3-5 | 12 | 50.0% (6/12) | 83.3% (10/12) | 50.0% (6/12) |
| 6-8 | 24 | 70.8% (17/24) | 83.3% (20/24) | 70.8% (17/24) |
| 9+ | 18 | 44.4% (8/18) | 50.0% (9/18) | 44.4% (8/18) |

## Failed Tasks (0% passing)

### Access Remove Optional Chain 002 (TimelineContext.js) — 0/1

**All runs failed with same error:** File mismatch for TimelineContext.js

**Sample agent response (run 1):**
```
Optional chaining reinstated on `store.profilerStore?.profilingData` inside `TimelineContextController`.
```

**Diff (expected vs actual):**
```diff
@@ -80 @@
       };
     },
     function getState() {
-      return store.profilerStore.profilingData?.timelineData || null;
+      return store.profilerStore?.profilingData || null;
     },
   );
 
```

### Duplicate Duplicate Line Flip 003 (SyntheticEvent.js) — 0/1

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | — | 0 / 0 | 360.6s |

### Identifier Identifier Multi Edit 001 (TabBar.js) — 0/1

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | — | 0 / 0 | 360.4s |

### Identifier Identifier Multi Edit 003 (ReactPerformanceTrackProperties.js) — 0/1

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | — | 0 / 0 | 360.6s |

### Import Swap Named Imports 003 (StyleEditor.js) — 0/1

**All runs failed with same error:** File mismatch for StyleEditor.js

**Sample agent response (run 1):**
```
BridgeContext and StoreContext imports were swapped. Fixed so BridgeContext is imported first and StoreContext second, matching their usage.
```

**Diff (expected vs actual):**
```diff
@@ -8 @@
  */
 
 import * as React from 'react';
-import { useContext, useMemo, useRef, useState } from 'react';
+import { useMemo, useContext, useRef, useState } from 'react';
 import { copy } from 'clipboard-js';
 import { copy } from 'clipboard-js';
-import { BridgeContext, StoreContext } from 'react-devtools-shared/src/devtools/views/context';
+import { StoreContext, BridgeContext } from 'react-devtools-shared/src/devtools/views/context';
 import Button from '../../Button';
 import ButtonIcon from '../../ButtonIcon';
 import { serializeDataForCopy } from '../../utils';
```

### Literal Off By One 003 (InspectedElement.js) — 0/1

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | — | 0 / 0 | 360.4s |

### Operator Remove Negation 001 (ReactDOMClient.js) — 0/1

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | — | 0 / 0 | 360.4s |

### Operator Remove Negation 002 (NativeEventsView.js) — 0/1

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | — | 0 / 0 | 360.4s |

### Operator Remove Negation 003 (ReactFlightUnbundledReferences.js) — 0/1

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | — | 0 / 0 | 360.4s |

### Operator Swap Arithmetic 002 (CSSShorthandProperty.js) — 0/1

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | — | 0 / 0 | 360.4s |

### Operator Swap Arithmetic 003 (hooks.js) — 0/1

**All runs failed with same error:** File mismatch for hooks.js

**Sample agent response (run 1):**
```
Changed overflow detection to use `<` instead of `<=` to avoid false positives when widths equal.
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

### Operator Swap Logical 003 (DevToolsFiberComponentStack.js) — 0/1

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | — | 0 / 0 | 360.4s |

### Operator Swap Nullish 003 (backend.js) — 0/1

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | — | 0 / 0 | 360.4s |

### Regex Swap Regex Quantifier 003 (utils.js) — 0/1

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | — | 0 / 0 | 360.6s |

### Structural Delete Statement 001 (UnsupportedVersionDialog.js) — 0/1

**All runs failed with same error:** File mismatch for UnsupportedVersionDialog.js

**Sample agent response (run 1):**
```
Assumed the missing statement was the store context lookup given the surrounding logic. The dialog now references `store` after reintroducing `const store = useContext(StoreContext);`.
```

**Diff (expected vs actual):**
```diff
@@ -20 @@
 export default function UnsupportedVersionDialog(_: {}): null {
   const { dispatch } = useContext(ModalDialogContext);
   const store = useContext(StoreContext);
+
   const [state, setState] = useState<DAILOG_STATE>('dialog-not-shown');
 
   useEffect(() => {
```

### Structural Delete Statement 002 (getComponentNameFromFiber.js) — 0/1

**All runs failed with same error:** File mismatch for getComponentNameFromFiber.js

**Sample agent response (run 1):**
```
Restored the missing `functionName` calculation inside `getWrappedName`, matching the pattern used in `shared/getComponentNameFromType`.
```

**Diff (expected vs actual):**
```diff
@@ -54 @@
 
 // Keep in sync with shared/getComponentNameFromType
 function getWrappedName(outerType: mixed, innerType: any, wrapperName: string): string {
-  const functionName = innerType.displayName || innerType.name || '';
+  const functionName = (innerType: any).displayName || (innerType: any).name || '';
+
   return (
     (outerType: any).displayName ||
     (functionName !== '' ? `${wrapperName}(${functionName})` : wrapperName)
```

### Structural Delete Statement 003 (simulateBrowserEventDispatch.js) — 0/1

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | — | 0 / 0 | 360.4s |

### Structural Remove Early Return 002 (useCommitFilteringAndNavigation.js) — 0/1

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | — | 0 / 0 | 360.4s |

### Structural Remove Early Return 003 (ReactFiberAsyncAction.js) — 0/1

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | — | 0 / 0 | 360.6s |

### Structural Swap Adjacent Lines 002 (ReactNoopFlightServer.js) — 0/1

**All runs failed with same error:** File mismatch for ReactNoopFlightServer.js

**Sample agent response (run 1):**
```
Swapped the adjacent `stringToChunk` and `flushBuffered` lines back to their original order so the encoder definition now directly precedes its body while keeping the empty flush helper immediately afterward.
```

**Diff (expected vs actual):**
```diff
@@ -14 @@
  * environment.
  */
 
-import type { ReactClientValue } from 'react-server/src/ReactFlightServer';
+import type {ReactClientValue} from 'react-server/src/ReactFlightServer';
 
 
-import { saveModule } from 'react-noop-renderer/flight-modules';
+import {saveModule} from 'react-noop-renderer/flight-modules';
 
 import ReactFlightServer from 'react-server/flight';
 
@@ -42 @@
   completeWriting(destination: Destination): void {},
   close(destination: Destination): void {},
   closeWithError(destination: Destination, error: mixed): void {},
-  flushBuffered(destination: Destination): void {},
   stringToChunk(content: string): Uint8Array {
   stringToChunk(content: string): Uint8Array {
+  flushBuffered(destination: Destination): void {},
     return textEncoder.encode(content);
   },
   stringToPrecomputedChunk(content: string): Uint8Array {
@@ -58 @@
   getClientReferenceKey(reference: Object): Object {
     return reference;
   },
-  resolveClientReferenceMetadata(config: void, reference: { $$typeof: symbol, value: any }) {
+  resolveClientReferenceMetadata(
+    config: void,
+    reference: {$$typeof: symbol, value: any},
+  ) {
     return saveModule(reference.value);
   },
 });
@@ -68 @@
   filterStackFrame?: (url: string, functionName: string) => boolean,
   identifierPrefix?: string,
   signal?: AbortSignal,
-  debugChannel?: { onMessage?: (message: string) => void },
+  debugChannel?: {onMessage?: (message: string) => void},
   onError?: (error: mixed) => void,
 };
 
@@ -98 @@
     }
   }
   if (__DEV__ && options && options.debugChannel !== undefined) {
-    options.debugChannel.onMessage = (message) => {
+    options.debugChannel.onMessage = message => {
       ReactNoopFlightServer.resolveDebugMessage(request, message);
     };
   }
@@ -107 @@
   return destination;
 }
 
-export { render };
+export {render};
```

### Structural Swap Adjacent Lines 003 (backend.js) — 0/1

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | — | 0 / 0 | 360.3s |

### Structural Swap If Else 001 (importFile.js) — 0/1

**All runs failed with same error:** File mismatch for importFile.js

**Sample agent response (run 1):**
```
Condition now negated; branch bodies swapped to match.
```

**Diff (expected vs actual):**
```diff
@@ -31 @@
       processedData,
     };
   } catch (error) {
-    if (error instanceof InvalidProfileError) {
+    if (!(error instanceof InvalidProfileError)) {
       return {
         status: 'INVALID_PROFILE_ERROR',
         error,
```

### Structural Swap If Else 002 (ReactNativeFiberInspector.js) — 0/1

**All runs failed with same error:** File mismatch for ReactNativeFiberInspector.js

**Sample agent response (run 1):**
```
Changes: negated the `__DEV__` check in `getInspectorDataForViewTag` so the branch bodies now match their intended execution paths.
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

### Structural Swap If Else 003 (ReactDOMFizzStaticNode.js) — 0/1

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | — | 0 / 0 | 360.6s |
