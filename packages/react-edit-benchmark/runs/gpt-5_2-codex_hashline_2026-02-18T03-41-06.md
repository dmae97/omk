# Edit Benchmark Report

## Configuration

| Setting | Value |
|---------|-------|
| Date | 2026-02-18T03:39:23.439Z |
| Model | openai/openai/gpt-5.2-codex |
| Thinking Level | low |
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
| Total Tasks | 80 |
| Total Runs | 80 |
| Successful Runs | 62 |
| **Task Success Rate** | **77.5% (62/80)** |
| Verified Rate | 77.5% (62/80) |
| Edit Tool Usage Rate | 91.3% (73/80) |
| **Edit Success Rate** | **100.0%** |
| Timeout Runs | 0 |
| Mutation Intent Match Rate | 76.3% |
| Patch Failure Rate | 0.0% (0/73) |
| Tasks All Passing | 62 |
| Tasks Flaky/Failing | 18 |

### Tool Calls

| Tool | Total | Avg/Run |
|------|-------|---------|
| Read | 156 | 1.9 |
| Edit | 73 | 0.9 |
| Write | 0 | 0.0 |
| **Tool Input Chars** | 25,730 | 322 |

### Tokens & Time

| Metric | Total | Avg/Run |
|--------|-------|---------|
| Input Tokens | 507,067 | 6,338 |
| Output Tokens | 37,675 | 471 |
| Total Tokens | 2,102,886 | 26,286 |
| Duration | 940.7s | 11.8s |
| **Avg Indent Score** | — | **0.03** |

### Hashline Edit Subtypes

| Operation | Count | % |
|-----------|-------|---|
| set_line | 77 | 90.6% |
| replace_lines | 3 | 3.5% |
| insert_after | 5 | 5.9% |
| replace | 0 | 0.0% |
| **Total** | **85** | 100% |

## Task Results

| Task | File | Success | Edit Hit | R/E/W | Tokens (In/Out) | Time | Indent |
|------|------|---------|----------|-------|-----------------|------|--------|
| Access Remove Optional Chain 001 | fallbackEvalContext.js | 1/1 ✅ | 100.0% | 2/1/0 | 3,150/189 | 5.9s | 0.00 |
| Access Remove Optional Chain 003 | hookNamesCache.js | 1/1 ✅ | 100.0% | 2/1/0 | 4,625/250 | 7.8s | 0.00 |
| Access Remove Optional Chain 005 | registerDevToolsEventLogger.js | 1/1 ✅ | 100.0% | 2/1/0 | 4,352/264 | 7.2s | 0.00 |
| Access Remove Optional Chain 007 | index.js | 1/1 ✅ | 100.0% | 2/1/0 | 9,612/2,603 | 42.2s | 0.00 |
| Call Swap Call Args 001 | formatConsoleArguments.js | 1/1 ✅ | 100.0% | 2/1/0 | 8,468/194 | 5.4s | 0.00 |
| Call Swap Call Args 003 | ReactFlightDOMServerBrowser.js | 1/1 ✅ | 100.0% | 2/1/0 | 4,394/284 | 7.1s | 2.00 |
| Call Swap Call Args 005 | ReactNoopPersistent.js | 1/1 ✅ | 100.0% | 2/1/0 | 3,399/255 | 13.9s | 0.00 |
| Call Swap Call Args 007 | parseSourceAndMetadata.js | 1/1 ✅ | 100.0% | 2/1/0 | 8,003/218 | 6.5s | 0.00 |
| Duplicate Duplicate Line Flip 001 | isCustomElement.js | 1/1 ✅ | 100.0% | 1/1/0 | 3,103/141 | 7.3s | 0.00 |
| Duplicate Duplicate Line Flip 003 | ReactFiberDevToolsHook.js | 0/1 ❌ | 100.0% | 2/1/0 | 8,479/2,078 | 34.4s | 0.00 |
| Duplicate Duplicate Line Flip 005 | shallowEqual.js | 0/1 ❌ | 100.0% | 1/0/0 | 829/38 | 11.6s | 0.00 |
| Duplicate Duplicate Line Flip 007 | ReactDOMEventReplaying.js | 1/1 ✅ | 100.0% | 3/1/0 | 20,099/1,475 | 29.7s | 0.00 |
| Identifier Identifier Multi Edit 001 | Button.js | 1/1 ✅ | 100.0% | 2/1/0 | 2,153/192 | 5.8s | 0.00 |
| Identifier Identifier Multi Edit 003 | ReactFlightDOMClientBrowser.js | 1/1 ✅ | 100.0% | 2/1/0 | 5,241/302 | 8.9s | 0.00 |
| Identifier Identifier Multi Edit 005 | githubAPI.js | 1/1 ✅ | 100.0% | 2/1/0 | 4,160/204 | 5.1s | 0.00 |
| Identifier Identifier Multi Edit 007 | ReactFiberComponentStack.js | 1/1 ✅ | 100.0% | 2/1/0 | 4,670/290 | 7.0s | 0.00 |
| Import Swap Named Imports 001 | ListApp.js | 1/1 ✅ | 100.0% | 2/1/0 | 2,365/160 | 4.6s | 0.00 |
| Import Swap Named Imports 003 | index.js | 1/1 ✅ | 100.0% | 2/1/0 | 4,845/426 | 10.2s | 0.00 |
| Import Swap Named Imports 005 | SuspenseScrubber.js | 1/1 ✅ | 100.0% | 2/1/0 | 4,325/286 | 6.2s | 0.00 |
| Import Swap Named Imports 007 | InspectedElement.js | 0/1 ❌ | 100.0% | 2/1/0 | 11,236/2,218 | 40.1s | 0.00 |
| Literal Flip Boolean 001 | ReactDOMLegacyServerImpl.js | 1/1 ✅ | 100.0% | 2/1/0 | 3,801/405 | 9.9s | 0.00 |
| Literal Flip Boolean 003 | ReactProfilerTimer.js | 1/1 ✅ | 100.0% | 2/1/0 | 10,450/224 | 7.2s | 0.00 |
| Literal Flip Boolean 005 | OpenInEditorButton.js | 1/1 ✅ | 100.0% | 2/1/0 | 2,227/163 | 10.3s | 0.00 |
| Literal Flip Boolean 007 | Element.js | 0/1 ❌ | 100.0% | 1/0/0 | 1,324/27 | 8.9s | 0.00 |
| Literal Off By One 001 | ReactOwnerStackFrames.js | 1/1 ✅ | 100.0% | 2/1/0 | 4,271/174 | 5.3s | 0.00 |
| Literal Off By One 003 | ReactFlightClientConfigBundlerTurbopack.js | 1/1 ✅ | 100.0% | 2/1/0 | 13,250/204 | 8.9s | 0.00 |
| Literal Off By One 005 | ContextMenu.js | 1/1 ✅ | 100.0% | 2/1/0 | 8,927/184 | 4.9s | 0.00 |
| Literal Off By One 007 | index.js | 1/1 ✅ | 100.0% | 2/1/0 | 9,762/205 | 7.6s | 0.00 |
| Operator Remove Negation 001 | prepareInjection.js | 1/1 ✅ | 100.0% | 2/1/0 | 2,634/181 | 5.4s | 0.00 |
| Operator Remove Negation 003 | ReactDOMSelection.js | 1/1 ✅ | 100.0% | 2/1/0 | 3,800/926 | 18.8s | 0.00 |
| Operator Remove Negation 005 | ReactDOMContainer.js | 0/1 ❌ | 100.0% | 2/1/0 | 6,549/2,984 | 48.1s | 0.00 |
| Operator Remove Negation 007 | SelectEventPlugin.js | 1/1 ✅ | 100.0% | 2/1/0 | 7,864/211 | 7.5s | 0.00 |
| Operator Swap Arithmetic 001 | formatConsoleArguments.js | 1/1 ✅ | 100.0% | 2/1/0 | 2,703/182 | 7.6s | 0.00 |
| Operator Swap Arithmetic 003 | ReactFlightDOMServerBrowser.js | 1/1 ✅ | 100.0% | 2/1/0 | 4,855/306 | 17.2s | 0.00 |
| Operator Swap Arithmetic 005 | ReactFiberConfigWithNoResources.js | 1/1 ✅ | 100.0% | 2/1/0 | 6,837/173 | 5.2s | 0.00 |
| Operator Swap Arithmetic 007 | useCanvasInteraction.js | 1/1 ✅ | 100.0% | 2/1/0 | 4,580/329 | 8.2s | 0.00 |
| Operator Swap Comparison 001 | useSmartTooltip.js | 1/1 ✅ | 100.0% | 2/1/0 | 2,959/290 | 10.8s | 0.00 |
| Operator Swap Comparison 003 | ReactFlightDOMServerBrowser.js | 1/1 ✅ | 100.0% | 3/1/0 | 7,827/346 | 13.3s | 0.00 |
| Operator Swap Comparison 005 | Rectangle.js | 1/1 ✅ | 100.0% | 1/1/0 | 2,744/110 | 3.5s | 0.00 |
| Operator Swap Comparison 007 | ReactFiberTreeReflection.js | 1/1 ✅ | 100.0% | 1/1/0 | 12,178/146 | 13.2s | 0.00 |
| Operator Swap Equality 001 | ReactNoopFlightClient.js | 1/1 ✅ | 100.0% | 2/1/0 | 2,787/198 | 5.9s | 0.00 |
| Operator Swap Equality 003 | astUtils.js | 1/1 ✅ | 100.0% | 2/1/0 | 18,430/232 | 6.7s | 0.00 |
| Operator Swap Equality 005 | ReactDOMContainer.js | 1/1 ✅ | 100.0% | 2/1/0 | 1,701/198 | 5.2s | 0.00 |
| Operator Swap Equality 007 | ReactFlightDOMServerBrowser.js | 1/1 ✅ | 100.0% | 4/1/0 | 9,816/1,046 | 22.5s | 0.00 |
| Operator Swap Increment Decrement 001 | index.js | 1/1 ✅ | 100.0% | 2/1/0 | 1,949/181 | 5.5s | 0.00 |
| Operator Swap Increment Decrement 003 | ReactFlightClientConfigBundlerESM.js | 1/1 ✅ | 100.0% | 2/1/0 | 8,163/207 | 7.2s | 0.00 |
| Operator Swap Increment Decrement 005 | ReactFiberViewTransitionComponent.js | 1/1 ✅ | 100.0% | 2/1/0 | 8,153/206 | 6.4s | 0.00 |
| Operator Swap Increment Decrement 007 | ReactFiberConcurrentUpdates.js | 1/1 ✅ | 100.0% | 2/1/0 | 9,331/184 | 5.6s | 0.00 |
| Operator Swap Logical 001 | ErrorView.js | 0/1 ❌ | 100.0% | 2/1/0 | 4,140/465 | 10.1s | 0.00 |
| Operator Swap Logical 003 | DevTools.js | 1/1 ✅ | 100.0% | 1/1/0 | 5,903/135 | 4.2s | 0.00 |
| Operator Swap Logical 005 | UseEffectEvent.js | 1/1 ✅ | 100.0% | 2/1/0 | 3,836/193 | 8.2s | 0.00 |
| Operator Swap Logical 007 | getHookNameForLocation.js | 1/1 ✅ | 100.0% | 2/1/0 | 9,766/274 | 8.8s | 0.00 |
| Operator Swap Nullish 001 | ElementBadges.js | 1/1 ✅ | 100.0% | 2/1/0 | 11,911/238 | 7.2s | 0.00 |
| Operator Swap Nullish 003 | ReactComponentStackFrame.js | 1/1 ✅ | 100.0% | 2/1/0 | 10,606/248 | 7.1s | 0.00 |
| Operator Swap Nullish 005 | ReactLogo.js | 1/1 ✅ | 100.0% | 2/1/0 | 3,083/181 | 13.5s | 0.00 |
| Operator Swap Nullish 007 | SuspenseBreadcrumbs.js | 0/1 ❌ | 100.0% | 1/0/0 | 1,332/38 | 9.2s | 0.00 |
| Regex Swap Regex Quantifier 001 | SimpleValues.js | 1/1 ✅ | 100.0% | 2/1/0 | 1,816/187 | 5.6s | 0.00 |
| Regex Swap Regex Quantifier 003 | utils.js | 1/1 ✅ | 100.0% | 4/1/0 | 17,172/2,665 | 47.3s | 0.00 |
| Regex Swap Regex Quantifier 005 | formatWithStyles.js | 0/1 ❌ | 100.0% | 1/0/0 | 844/74 | 12.0s | 0.00 |
| Regex Swap Regex Quantifier 007 | RunReactCompiler.ts | 1/1 ✅ | 100.0% | 3/1/0 | 23,050/3,494 | 59.8s | 0.00 |
| Structural Delete Statement 001 | useExtensionComponentsPanelVisibility.js | 0/1 ❌ | 100.0% | 1/0/0 | 825/32 | 5.0s | 0.00 |
| Structural Delete Statement 003 | useCanvasInteraction.js | 1/1 ✅ | 100.0% | 1/1/0 | 4,697/169 | 7.4s | 0.00 |
| Structural Delete Statement 005 | StackTraceView.js | 0/1 ❌ | 100.0% | 4/1/0 | 5,727/582 | 13.9s | 0.00 |
| Structural Delete Statement 007 | ReactDOMFizzStaticBrowser.js | 1/1 ✅ | 100.0% | 2/1/0 | 7,571/485 | 9.7s | 0.00 |
| Structural Remove Early Return 001 | ReactFlightAsyncDispatcher.js | 0/1 ❌ | 100.0% | 2/1/0 | 8,937/287 | 8.7s | 0.00 |
| Structural Remove Early Return 003 | ReactDOMComponentTree.js | 0/1 ❌ | 100.0% | 0/0/0 | 0/0 | 8.5s | 0.00 |
| Structural Remove Early Return 005 | TabBar.js | 0/1 ❌ | 100.0% | 2/1/0 | 4,422/270 | 8.3s | 0.00 |
| Structural Remove Early Return 007 | CommitTreeBuilder.js | 0/1 ❌ | 100.0% | 2/1/0 | 7,980/476 | 10.2s | 0.00 |
| Structural Swap Adjacent Lines 001 | reactPolling.js | 1/1 ✅ | 100.0% | 2/1/0 | 4,681/236 | 8.6s | 0.00 |
| Structural Swap Adjacent Lines 003 | OwnersStack.js | 1/1 ✅ | 100.0% | 2/1/0 | 5,529/233 | 7.9s | 0.00 |
| Structural Swap Adjacent Lines 005 | ReactOwnerStackFrames.js | 0/1 ❌ | 100.0% | 1/0/0 | 832/42 | 10.4s | 0.00 |
| Structural Swap Adjacent Lines 007 | ReactFlightClientConfigBundlerWebpack.js | 0/1 ❌ | 100.0% | 2/1/0 | 9,785/777 | 17.3s | 0.00 |
| Structural Swap If Else 001 | utils.js | 0/1 ❌ | 100.0% | 2/1/0 | 5,502/854 | 14.9s | 0.00 |
| Structural Swap If Else 003 | ReactDOMFloat.js | 0/1 ❌ | 100.0% | 2/1/0 | 12,227/1,411 | 24.5s | 0.00 |
| Structural Swap If Else 005 | ReactClientConsoleConfigPlain.js | 1/1 ✅ | 100.0% | 2/1/0 | 2,676/263 | 7.0s | 0.00 |
| Structural Swap If Else 007 | index.js | 1/1 ✅ | 100.0% | 2/1/0 | 10,790/330 | 7.9s | 0.00 |
| Unicode Unicode Hyphen 001 | formatProdErrorMessage.js | 1/1 ✅ | 100.0% | 2/1/0 | 6,006/167 | 5.8s | 0.00 |
| Unicode Unicode Hyphen 003 | SourceMapConsumer.js | 1/1 ✅ | 100.0% | 2/1/0 | 9,551/214 | 5.6s | 0.00 |
| Unicode Unicode Hyphen 005 | babel.config.js | 1/1 ✅ | 100.0% | 2/1/0 | 2,581/165 | 5.4s | 0.00 |
| Unicode Unicode Hyphen 007 | ReactInternalTestUtils.js | 1/1 ✅ | 100.0% | 2/1/0 | 5,909/201 | 7.0s | 0.00 |

## Category Summary

| Category | Runs | Verified | Edit Used | Success | Min/Avg/Max Difficulty |
|----------|------|----------|-----------|---------|------------------------|
| access | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) | 3 / 7.5 / 10 |
| call | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) | 2 / 7.8 / 14 |
| duplicate | 4 | 50.0% (2/4) | 75.0% (3/4) | 50.0% (2/4) | 8 / 11.3 / 17 |
| identifier | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) | 4 / 6.8 / 9 |
| import | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) | 2 / 3.8 / 5 |
| literal | 8 | 87.5% (7/8) | 87.5% (7/8) | 87.5% (7/8) | 3 / 6.9 / 10 |
| operator | 28 | 89.3% (25/28) | 96.4% (27/28) | 89.3% (25/28) | 3 / 6.7 / 10 |
| regex | 4 | 75.0% (3/4) | 75.0% (3/4) | 75.0% (3/4) | 2 / 5.8 / 10 |
| structural | 16 | 37.5% (6/16) | 81.3% (13/16) | 37.5% (6/16) | 4 / 8.3 / 13 |
| unicode | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) | 2 / 4.8 / 8 |

## Mutation Summary

| Mutation | Category | Runs | Verified | Edit Used | Success |
|----------|----------|------|----------|-----------|---------|
| delete-statement | structural | 4 | 50.0% (2/4) | 75.0% (3/4) | 50.0% (2/4) |
| duplicate-line-flip | duplicate | 4 | 50.0% (2/4) | 75.0% (3/4) | 50.0% (2/4) |
| flip-boolean | literal | 4 | 75.0% (3/4) | 75.0% (3/4) | 75.0% (3/4) |
| identifier-multi-edit | identifier | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| off-by-one | literal | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| remove-early-return | structural | 4 | 0.0% (0/4) | 75.0% (3/4) | 0.0% (0/4) |
| remove-negation | operator | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) |
| remove-optional-chain | access | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| swap-adjacent-lines | structural | 4 | 50.0% (2/4) | 75.0% (3/4) | 50.0% (2/4) |
| swap-arithmetic | operator | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| swap-call-args | call | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| swap-comparison | operator | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| swap-equality | operator | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| swap-if-else | structural | 4 | 50.0% (2/4) | 100.0% (4/4) | 50.0% (2/4) |
| swap-increment-decrement | operator | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| swap-logical | operator | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) |
| swap-named-imports | import | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) |
| swap-nullish | operator | 4 | 75.0% (3/4) | 75.0% (3/4) | 75.0% (3/4) |
| swap-regex-quantifier | regex | 4 | 75.0% (3/4) | 75.0% (3/4) | 75.0% (3/4) |
| unicode-hyphen | unicode | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |

## Difficulty Summary

| Difficulty Score | Runs | Verified | Edit Used | Success |
|------------------|------|----------|-----------|---------|
| 0-2 | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| 3-5 | 24 | 75.0% (18/24) | 91.7% (22/24) | 75.0% (18/24) |
| 6-8 | 27 | 74.1% (20/27) | 88.9% (24/27) | 74.1% (20/27) |
| 9+ | 25 | 80.0% (20/25) | 92.0% (23/25) | 80.0% (20/25) |

## Failed Tasks (0% passing)

### Duplicate Duplicate Line Flip 003 (ReactFiberDevToolsHook.js) — 0/1

**All runs failed with same error:** File mismatch for ReactFiberDevToolsHook.js

**Sample agent response (run 1):**
```
Fix applied. No tests run (not requested).
```

**Diff (expected vs actual):**
```diff
@@ -46 @@
 export function injectInternals(internals: Object): boolean {
   if (typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ === 'undefined') {
     // No DevTools
-    return false;
+    return true;
   }
   const hook = __REACT_DEVTOOLS_GLOBAL_HOOK__;
   if (hook.isDisabled) {
@@ -74 @@
   } catch (err) {
     // Catch all errors because it is unsafe to throw during initialization.
     if (__DEV__) {
-      console.error('React instrumentation encountered an error: %o.', err);
+      console.error('React instrumentation encountered an error: %o', err);
     }
   }
   if (hook.checkDCE) {
```

### Duplicate Duplicate Line Flip 005 (shallowEqual.js) — 0/1

**All runs failed with same error:** File mismatch for shallowEqual.js

**Diff (expected vs actual):**
```diff
@@ -17 @@
  */
 function shallowEqual(objA: mixed, objB: mixed): boolean {
   if (is(objA, objB)) {
-    return true;
+    return false;
   }
 
   if (typeof objA !== 'object' || objA === null || typeof objB !== 'object' || objB === null) {
```

### Import Swap Named Imports 007 (InspectedElement.js) — 0/1

**All runs failed with same error:** File mismatch for InspectedElement.js

**Diff (expected vs actual):**
```diff
@@ -10 @@
 import type { SourceMappedLocation } from 'react-devtools-shared/src/symbolicateSource';
 
 import * as React from 'react';
-import { useCallback, useContext, useSyncExternalStore } from 'react';
+import { useSyncExternalStore, useCallback, useContext } from 'react';
 import { TreeStateContext } from './TreeContext';
 import { BridgeContext, StoreContext, OptionsContext } from '../context';
 import Button from '../Button';
```

### Literal Flip Boolean 007 (Element.js) — 0/1

**All runs failed with same error:** File mismatch for Element.js

**Diff (expected vs actual):**
```diff
@@ -42 @@
 
   const element = ownerFlatTree !== null ? ownerFlatTree[index] : store.getElementAtIndex(index);
 
-  const [isHovered, setIsHovered] = useState(false);
+  const [isHovered, setIsHovered] = useState(true);
 
   const errorsAndWarningsSubscription = useMemo(
     () => ({
```

### Operator Remove Negation 005 (ReactDOMContainer.js) — 0/1

**All runs failed with same error:** File mismatch for ReactDOMContainer.js

**Sample agent response (run 1):**
```
Change applied.
```

**Diff (expected vs actual):**
```diff
@@ -12 @@
 import { ELEMENT_NODE, COMMENT_NODE, DOCUMENT_NODE, DOCUMENT_FRAGMENT_NODE } from './HTMLNodeType';
 
 export function isValidContainer(node: any): boolean {
-  return !!(
-    node &&
+  return (
+    !node &&
     (node.nodeType === ELEMENT_NODE ||
       node.nodeType === DOCUMENT_NODE ||
       node.nodeType === DOCUMENT_FRAGMENT_NODE ||
     (node.nodeType === ELEMENT_NODE ||
       node.nodeType === DOCUMENT_NODE ||
       node.nodeType === DOCUMENT_FRAGMENT_NODE ||
-      (!disableCommentsAsDOMContainers &&
+      (!!disableCommentsAsDOMContainers &&
         node.nodeType === COMMENT_NODE &&
         (node: any).nodeValue === ' react-mount-point-unstable '))
   );
```

### Operator Swap Logical 001 (ErrorView.js) — 0/1

**All runs failed with same error:** File mismatch for ErrorView.js

**Sample agent response (run 1):**
```
Applied fix on line 36. No tests run.
```

**Diff (expected vs actual):**
```diff
@@ -32 @@
       {children}
       <div className={styles.ErrorInfo}>
         <div className={styles.HeaderRow}>
-          <div className={styles.ErrorHeader}>Uncaught Error: {errorMessage || ''}</div>
-          {dismissError !== null && (
+          <div className={styles.ErrorHeader}>Uncaught Error: {errorMessage && ''}</div>
+          {dismissError !== null || (
             <Button className={styles.CloseButton} onClick={dismissError}>
               Dismiss
               <ButtonIcon className={styles.CloseButtonIcon} type="close" />
```

### Operator Swap Nullish 007 (SuspenseBreadcrumbs.js) — 0/1

**All runs failed with same error:** File mismatch for SuspenseBreadcrumbs.js

**Diff (expected vs actual):**
```diff
@@ -225 @@
     <Button
       className={parent !== null ? undefined : styles.NotInStore}
       onClick={parent !== null ? selectElement.bind(null, parentID) : null}
-      title={`Up to ${parent === null ? 'Unknown' : parent.name || 'Unknown'}`}
+      title={`Up to ${parent === null ? 'Unknown' : (parent.name ?? 'Unknown')}`}
     >
       <ButtonIcon type="previous" />
     </Button>
```

### Regex Swap Regex Quantifier 005 (formatWithStyles.js) — 0/1

**All runs failed with same error:** File mismatch for formatWithStyles.js

**Diff (expected vs actual):**
```diff
@@ -42 @@
   }
 
   // Matches any of %(o|O|d|i|s|f), but not %%(o|O|d|i|s|f)
-  const REGEXP = /([^%]|^)((%%)*)(%([oOdisf]))/g;
+  const REGEXP = /([^%]|^)((%%)+)(%([oOdisf]))/g;
   if (typeof inputArgs[0] === 'string' && inputArgs[0].match(REGEXP)) {
     return [`%c${inputArgs[0]}`, style, ...inputArgs.slice(1)];
   } else {
```

### Structural Delete Statement 001 (useExtensionComponentsPanelVisibility.js) — 0/1

**All runs failed with same error:** File mismatch for useExtensionComponentsPanelVisibility.js

**Diff (expected vs actual):**
```diff
@@ -13 @@
 // Events that are prefixed with `extension` will only be emitted for the browser extension implementation.
 // For other implementations, this hook will just return constant `true` value.
 export function useExtensionComponentsPanelVisibility(bridge: FrontendBridge): boolean {
-  const [isVisible, setIsVisible] = useState(true);
-
   useEffect(() => {
     function onPanelShown() {
       setIsVisible(true);
```

### Structural Delete Statement 005 (StackTraceView.js) — 0/1

**All runs failed with same error:** File mismatch for StackTraceView.js

**Sample agent response (run 1):**
```
Change applied and verified in `StackTraceView.js`. No other files touched.
```

**Diff (expected vs actual):**
```diff
@@ -34 @@
 export function CallSiteView({ callSite, environmentName }: CallSiteViewProps): React.Node {
   const fetchFileWithCaching = useContext(FetchFileWithCachingContext);
 
-  const [virtualFunctionName, virtualURL, virtualLine, virtualColumn] = callSite;
+  const [virtualFunctionName, virtualURL, virtualLine, virtualColumn, ignored] = callSite;
 
   const symbolicatedCallSite: null | SourceMappedLocation =
     fetchFileWithCaching !== null
@@ -49 @@
   );
   const [functionName, url, line, column] =
     symbolicatedCallSite !== null ? symbolicatedCallSite.location : callSite;
-  const ignored = symbolicatedCallSite !== null ? symbolicatedCallSite.ignored : false;
+
   // TODO: Make an option to be able to toggle the display of ignore listed rows.
   // Ideally this UI should be higher than a single Stack Trace so that there's not
   // multiple buttons in a single inspection taking up space.
```

### Structural Remove Early Return 001 (ReactFlightAsyncDispatcher.js) — 0/1

**All runs failed with same error:** File mismatch for ReactFlightAsyncDispatcher.js

**Sample agent response (run 1):**
```
Guard clause restored in `resolveCache` as requested.
```

**Diff (expected vs actual):**
```diff
@@ -17 @@
   if (request) {
     return getCache(request);
   }
+
   return new Map();
 }
 
```

### Structural Remove Early Return 003 (ReactDOMComponentTree.js) — 0/1

**All runs failed with same error:** File mismatch for ReactDOMComponentTree.js

**Diff (expected vs actual):**
```diff
@@ -185 @@
             ? internalInstanceMap.get(hydrationInstance)
             : // $FlowFixMe[prop-missing]
               hydrationInstance[internalInstanceKey];
-          if (targetFiber) {
-            return targetFiber;
-          }
+
           // If we don't find a Fiber on the comment, it might be because
           // we haven't gotten to hydrate it yet. There might still be a
           // parent boundary that hasn't above this one so we need to find
```

### Structural Remove Early Return 005 (TabBar.js) — 0/1

**All runs failed with same error:** File mismatch for TabBar.js

**Sample agent response (run 1):**
```
Guard clause restored. No tests run.
```

**Diff (expected vs actual):**
```diff
@@ -90 @@
     <Fragment>
       {tabs.map((tab) => {
         if (tab === null) {
-          return <div key="VRule" className={styles.VRule} />;
+          return null;
         }
         }
-
         const { icon, id, label, title } = tab;
 
         let button = (
```

### Structural Remove Early Return 007 (CommitTreeBuilder.js) — 0/1

**All runs failed with same error:** File mismatch for CommitTreeBuilder.js

**Sample agent response (run 1):**
```
Fixed by restoring the early return for cached commit trees in `getCommitTree`. No tests run.
```

**Diff (expected vs actual):**
```diff
@@ -63 @@
   }
 
   const commitTrees = ((rootToCommitTreeMap.get(rootID): any): Array<CommitTree>);
+
   if (commitIndex < commitTrees.length) {
     return commitTrees[commitIndex];
   }
```

### Structural Swap Adjacent Lines 005 (ReactOwnerStackFrames.js) — 0/1

**All runs failed with same error:** File mismatch for ReactOwnerStackFrames.js

**Diff (expected vs actual):**
```diff
@@ -11 @@
 
 export function formatOwnerStack(error: Error): string {
   const prevPrepareStackTrace = Error.prepareStackTrace;
-  Error.prepareStackTrace = DefaultPrepareStackTrace;
   let stack = error.stack;
   let stack = error.stack;
+  Error.prepareStackTrace = DefaultPrepareStackTrace;
   Error.prepareStackTrace = prevPrepareStackTrace;
   if (stack.startsWith('Error: react-stack-top-frame\n')) {
     // V8's default formatting prefixes with the error message which we
```

### Structural Swap Adjacent Lines 007 (ReactFlightClientConfigBundlerWebpack.js) — 0/1

**All runs failed with same error:** File mismatch for ReactFlightClientConfigBundlerWebpack.js

**Sample agent response (run 1):**
```
Swapped the two adjacent statements in `preloadModule` to set the chunk cache before attaching the `then` handler.
```

**Diff (expected vs actual):**
```diff
@@ -184 @@
     const entry = chunkCache.get(chunkId);
     if (entry === undefined) {
       const thenable = loadChunk(chunkId, chunkFilename);
-      promises.push(thenable);
-      // $FlowFixMe[method-unbinding]
       const resolve = chunkCache.set.bind(chunkCache, chunkId, null);
       const resolve = chunkCache.set.bind(chunkCache, chunkId, null);
-      thenable.then(resolve, ignoreReject);
+      // $FlowFixMe[method-unbinding]
+      promises.push(thenable);
       chunkCache.set(chunkId, thenable);
       chunkCache.set(chunkId, thenable);
+      thenable.then(resolve, ignoreReject);
     } else if (entry !== null) {
       promises.push(entry);
     }
```

### Structural Swap If Else 001 (utils.js) — 0/1

**All runs failed with same error:** File mismatch for utils.js

**Sample agent response (run 1):**
```
Swapped the if/else branch bodies in utils.js and verified the region.
```

**Diff (expected vs actual):**
```diff
@@ -23 @@
     if (sourceURL.startsWith('file:///')) {
       filePath = new URL(sourceURL).pathname;
     } else if (sourceURL.includes('://')) {
-      // $FlowFixMe[cannot-resolve-name]
+      filePath = sourceURL;
+    } else {
       if (!__IS_INTERNAL_VERSION__) {
       if (!__IS_INTERNAL_VERSION__) {
-        // In this case, we can't really determine the path to a file, disable a button
-        return { url: null, shouldDisableButton: true };
-      } else {
         const endOfSourceMapURLPattern = '.js/';
         const endOfSourceMapURLIndex = sourceURL.lastIndexOf(endOfSourceMapURLPattern);
         const endOfSourceMapURLPattern = '.js/';
         const endOfSourceMapURLIndex = sourceURL.lastIndexOf(endOfSourceMapURLPattern);
-
         if (endOfSourceMapURLIndex === -1) {
         if (endOfSourceMapURLIndex === -1) {
-          return { url: null, shouldDisableButton: true };
+          return {
+            url: null,
+            shouldDisableButton: true,
+          };
         } else {
           filePath = sourceURL.slice(
             endOfSourceMapURLIndex + endOfSourceMapURLPattern.length,
@@ -39 @@
             sourceURL.length,
           );
         }
+      } else {
+        return {
+          url: null,
+          shouldDisableButton: true,
+        };
       }
       }
-    } else {
-      filePath = sourceURL;
     }
 
     const lineNumberAsString = String(line);
```

### Structural Swap If Else 003 (ReactDOMFloat.js) — 0/1

**All runs failed with same error:** File mismatch for ReactDOMFloat.js

**Sample agent response (run 1):**
```
Applied swap in `preinitModule` dev validation. No other changes.
```

**Diff (expected vs actual):**
```diff
@@ -257 @@
         case 'script': {
           break;
         }
-
-        // We have an invalid as type and need to warn
         default: {
           const typeOfAs = getValueDescriptorExpectingEnumForWarning(as);
           console.error(
```
