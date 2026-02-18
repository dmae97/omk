# Edit Benchmark Report

## Configuration

| Setting | Value |
|---------|-------|
| Date | 2026-02-18T03:55:30.521Z |
| Model | p-anthropic/p-anthropic/claude-sonnet-4-6 |
| Thinking Level | low |
| Runs per task | 1 |
| Edit Variant | replace |
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
| Successful Runs | 66 |
| **Task Success Rate** | **82.5% (66/80)** |
| Verified Rate | 82.5% (66/80) |
| Edit Tool Usage Rate | 98.8% (79/80) |
| **Edit Success Rate** | **98.8%** |
| Timeout Runs | 0 |
| Mutation Intent Match Rate | 81.0% |
| Tasks All Passing | 66 |
| Tasks Flaky/Failing | 14 |

### Tool Calls

| Tool | Total | Avg/Run |
|------|-------|---------|
| Read | 166 | 2.1 |
| Edit | 85 | 1.1 |
| Write | 1 | 0.0 |
| **Tool Input Chars** | 39,493 | 494 |

### Tokens & Time

| Metric | Total | Avg/Run |
|--------|-------|---------|
| Input Tokens | 479 | 6 |
| Output Tokens | 141,030 | 1,763 |
| Total Tokens | 2,912,688 | 36,409 |
| Duration | 3043.1s | 38.0s |
| **Avg Indent Score** | — | **0.00** |

## Task Results

| Task | File | Success | Edit Hit | R/E/W | Tokens (In/Out) | Time | Indent |
|------|------|---------|----------|-------|-----------------|------|--------|
| Access Remove Optional Chain 001 | fallbackEvalContext.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/363 | 9.8s | 0.00 |
| Access Remove Optional Chain 003 | hookNamesCache.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/591 | 12.9s | 0.00 |
| Access Remove Optional Chain 005 | registerDevToolsEventLogger.js | 1/1 ✅ | 100.0% | 3/1/0 | 7/1,277 | 22.7s | 0.00 |
| Access Remove Optional Chain 007 | index.js | 0/1 ❌ | 100.0% | 0/0/0 | 0/0 | 360.0s | 0.00 |
| Call Swap Call Args 001 | formatConsoleArguments.js | 1/1 ✅ | 100.0% | 1/1/0 | 5/239 | 5.0s | 0.00 |
| Call Swap Call Args 003 | ReactFlightDOMServerBrowser.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/501 | 12.2s | 0.00 |
| Call Swap Call Args 005 | ReactNoopPersistent.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/563 | 10.4s | 0.00 |
| Call Swap Call Args 007 | parseSourceAndMetadata.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/580 | 12.2s | 0.00 |
| Duplicate Duplicate Line Flip 001 | isCustomElement.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/679 | 13.3s | 0.00 |
| Duplicate Duplicate Line Flip 003 | ReactFiberDevToolsHook.js | 0/1 ❌ | 100.0% | 1/1/0 | 3/14,081 | 207.9s | 0.00 |
| Duplicate Duplicate Line Flip 005 | shallowEqual.js | 1/1 ✅ | 100.0% | 1/1/0 | 5/316 | 7.2s | 0.00 |
| Duplicate Duplicate Line Flip 007 | ReactDOMEventReplaying.js | 1/1 ✅ | 100.0% | 1/1/0 | 3/721 | 128.5s | 0.00 |
| Identifier Identifier Multi Edit 001 | Button.js | 1/1 ✅ | 100.0% | 2/2/0 | 7/766 | 15.5s | 0.00 |
| Identifier Identifier Multi Edit 003 | ReactFlightDOMClientBrowser.js | 1/1 ✅ | 100.0% | 2/3/0 | 8/894 | 17.9s | 0.00 |
| Identifier Identifier Multi Edit 005 | githubAPI.js | 1/1 ✅ | 100.0% | 2/2/0 | 7/575 | 12.1s | 0.00 |
| Identifier Identifier Multi Edit 007 | ReactFiberComponentStack.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/619 | 11.5s | 0.00 |
| Import Swap Named Imports 001 | ListApp.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/804 | 17.4s | 0.00 |
| Import Swap Named Imports 003 | index.js | 0/1 ❌ | 100.0% | 2/1/0 | 6/2,968 | 60.3s | 0.00 |
| Import Swap Named Imports 005 | SuspenseScrubber.js | 1/1 ✅ | 100.0% | 3/1/0 | 7/1,297 | 25.8s | 0.00 |
| Import Swap Named Imports 007 | InspectedElement.js | 1/1 ✅ | 100.0% | 1/1/0 | 3/17,783 | 341.4s | 0.00 |
| Literal Flip Boolean 001 | ReactDOMLegacyServerImpl.js | 1/1 ✅ | 100.0% | 3/1/0 | 7/2,768 | 47.1s | 0.00 |
| Literal Flip Boolean 003 | ReactProfilerTimer.js | 1/1 ✅ | 100.0% | 3/1/0 | 7/756 | 18.6s | 0.00 |
| Literal Flip Boolean 005 | OpenInEditorButton.js | 1/1 ✅ | 100.0% | 3/1/0 | 7/2,093 | 31.1s | 0.00 |
| Literal Flip Boolean 007 | Element.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/545 | 10.6s | 0.00 |
| Literal Off By One 001 | ReactOwnerStackFrames.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/395 | 8.8s | 0.00 |
| Literal Off By One 003 | ReactFlightClientConfigBundlerTurbopack.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/522 | 12.4s | 0.00 |
| Literal Off By One 005 | ContextMenu.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/477 | 10.6s | 0.00 |
| Literal Off By One 007 | index.js | 1/1 ✅ | 100.0% | 1/1/0 | 5/476 | 14.7s | 0.00 |
| Operator Remove Negation 001 | prepareInjection.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/321 | 7.9s | 0.00 |
| Operator Remove Negation 003 | ReactDOMSelection.js | 1/1 ✅ | 100.0% | 3/1/0 | 7/1,287 | 24.6s | 0.00 |
| Operator Remove Negation 005 | ReactDOMContainer.js | 0/1 ❌ | 100.0% | 3/1/0 | 7/7,034 | 118.5s | 0.00 |
| Operator Remove Negation 007 | SelectEventPlugin.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/531 | 11.3s | 0.00 |
| Operator Swap Arithmetic 001 | formatConsoleArguments.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/441 | 8.4s | 0.00 |
| Operator Swap Arithmetic 003 | ReactFlightDOMServerBrowser.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/651 | 13.4s | 0.00 |
| Operator Swap Arithmetic 005 | ReactFiberConfigWithNoResources.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/342 | 8.0s | 0.00 |
| Operator Swap Arithmetic 007 | useCanvasInteraction.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/455 | 10.5s | 0.00 |
| Operator Swap Comparison 001 | useSmartTooltip.js | 1/1 ✅ | 100.0% | 3/1/0 | 7/2,746 | 39.6s | 0.00 |
| Operator Swap Comparison 003 | ReactFlightDOMServerBrowser.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/655 | 15.7s | 0.00 |
| Operator Swap Comparison 005 | Rectangle.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/408 | 9.2s | 0.00 |
| Operator Swap Comparison 007 | ReactFiberTreeReflection.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/637 | 13.3s | 0.00 |
| Operator Swap Equality 001 | ReactNoopFlightClient.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/422 | 10.2s | 0.00 |
| Operator Swap Equality 003 | astUtils.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/1,049 | 24.0s | 0.00 |
| Operator Swap Equality 005 | ReactDOMContainer.js | 1/1 ✅ | 100.0% | 3/1/0 | 7/529 | 12.2s | 0.00 |
| Operator Swap Equality 007 | ReactFlightDOMServerBrowser.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/963 | 18.3s | 0.00 |
| Operator Swap Increment Decrement 001 | index.js | 1/1 ✅ | 100.0% | 1/1/0 | 5/237 | 5.4s | 0.00 |
| Operator Swap Increment Decrement 003 | ReactFlightClientConfigBundlerESM.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/432 | 11.1s | 0.00 |
| Operator Swap Increment Decrement 005 | ReactFiberViewTransitionComponent.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/456 | 11.6s | 0.00 |
| Operator Swap Increment Decrement 007 | ReactFiberConcurrentUpdates.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/657 | 13.7s | 0.00 |
| Operator Swap Logical 001 | ErrorView.js | 1/1 ✅ | 100.0% | 1/2/0 | 4/8,703 | 200.7s | 0.00 |
| Operator Swap Logical 003 | DevTools.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/586 | 12.1s | 0.00 |
| Operator Swap Logical 005 | UseEffectEvent.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/982 | 16.2s | 0.00 |
| Operator Swap Logical 007 | getHookNameForLocation.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/700 | 16.5s | 0.00 |
| Operator Swap Nullish 001 | ElementBadges.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/409 | 9.6s | 0.00 |
| Operator Swap Nullish 003 | ReactComponentStackFrame.js | 1/1 ✅ | 100.0% | 1/1/0 | 5/555 | 15.7s | 0.00 |
| Operator Swap Nullish 005 | ReactLogo.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/758 | 15.0s | 0.00 |
| Operator Swap Nullish 007 | SuspenseBreadcrumbs.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/1,759 | 30.0s | 0.00 |
| Regex Swap Regex Quantifier 001 | SimpleValues.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/423 | 8.2s | 0.00 |
| Regex Swap Regex Quantifier 003 | utils.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/2,982 | 53.7s | 0.00 |
| Regex Swap Regex Quantifier 005 | formatWithStyles.js | 1/1 ✅ | 100.0% | 3/2/0 | 8/1,077 | 19.7s | 0.00 |
| Regex Swap Regex Quantifier 007 | RunReactCompiler.ts | 1/1 ✅ | 100.0% | 2/1/0 | 4/10,739 | 176.2s | 0.00 |
| Structural Delete Statement 001 | useExtensionComponentsPanelVisibility.js | 0/1 ❌ | 100.0% | 2/1/0 | 6/541 | 10.5s | 0.00 |
| Structural Delete Statement 003 | useCanvasInteraction.js | 0/1 ❌ | 100.0% | 2/1/0 | 6/841 | 14.8s | 0.00 |
| Structural Delete Statement 005 | StackTraceView.js | 0/1 ❌ | 100.0% | 4/1/0 | 8/2,832 | 46.5s | 0.00 |
| Structural Delete Statement 007 | ReactDOMFizzStaticBrowser.js | 0/1 ❌ | 100.0% | 2/1/0 | 6/1,195 | 17.6s | 0.00 |
| Structural Remove Early Return 001 | ReactFlightAsyncDispatcher.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/1,298 | 23.3s | 0.00 |
| Structural Remove Early Return 003 | ReactDOMComponentTree.js | 0/1 ❌ | 100.0% | 2/1/0 | 6/4,128 | 67.0s | 0.00 |
| Structural Remove Early Return 005 | TabBar.js | 0/1 ❌ | 100.0% | 4/1/0 | 8/908 | 19.3s | 0.00 |
| Structural Remove Early Return 007 | CommitTreeBuilder.js | 0/1 ❌ | 100.0% | 2/1/0 | 6/820 | 16.2s | 0.00 |
| Structural Swap Adjacent Lines 001 | reactPolling.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/370 | 11.6s | 0.00 |
| Structural Swap Adjacent Lines 003 | OwnersStack.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/494 | 10.5s | 0.00 |
| Structural Swap Adjacent Lines 005 | ReactOwnerStackFrames.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/583 | 13.6s | 0.00 |
| Structural Swap Adjacent Lines 007 | ReactFlightClientConfigBundlerWebpack.js | 0/1 ❌ | 100.0% | 2/1/0 | 6/3,670 | 59.1s | 0.00 |
| Structural Swap If Else 001 | utils.js | 0/1 ❌ | 100.0% | 3/1/0 | 7/4,808 | 70.1s | 0.00 |
| Structural Swap If Else 003 | ReactDOMFloat.js | 0/1 ❌ | 100.0% | 3/1/0 | 7/6,826 | 100.4s | 0.00 |
| Structural Swap If Else 005 | ReactClientConsoleConfigPlain.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/1,078 | 17.8s | 0.00 |
| Structural Swap If Else 007 | index.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/607 | 13.9s | 0.00 |
| Unicode Unicode Hyphen 001 | formatProdErrorMessage.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/399 | 9.4s | 0.00 |
| Unicode Unicode Hyphen 003 | SourceMapConsumer.js | 1/1 ✅ | 100.0% | 3/1/0 | 7/567 | 12.8s | 0.00 |
| Unicode Unicode Hyphen 005 | babel.config.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/411 | 9.2s | 0.00 |
| Unicode Unicode Hyphen 007 | ReactInternalTestUtils.js | 1/1 ✅ | 0.0% | 2/1/1 | 7/5,079 | 81.2s | 0.00 |

## Category Summary

| Category | Runs | Verified | Edit Used | Success | Min/Avg/Max Difficulty |
|----------|------|----------|-----------|---------|------------------------|
| access | 4 | 75.0% (3/4) | 75.0% (3/4) | 75.0% (3/4) | 3 / 7.5 / 10 |
| call | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) | 2 / 7.8 / 14 |
| duplicate | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) | 8 / 11.3 / 17 |
| identifier | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) | 4 / 6.8 / 9 |
| import | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) | 2 / 3.8 / 5 |
| literal | 8 | 100.0% (8/8) | 100.0% (8/8) | 100.0% (8/8) | 3 / 6.9 / 10 |
| operator | 28 | 96.4% (27/28) | 100.0% (28/28) | 96.4% (27/28) | 3 / 6.7 / 10 |
| regex | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) | 2 / 5.8 / 10 |
| structural | 16 | 37.5% (6/16) | 100.0% (16/16) | 37.5% (6/16) | 4 / 8.3 / 13 |
| unicode | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) | 2 / 4.8 / 8 |

## Mutation Summary

| Mutation | Category | Runs | Verified | Edit Used | Success |
|----------|----------|------|----------|-----------|---------|
| delete-statement | structural | 4 | 0.0% (0/4) | 100.0% (4/4) | 0.0% (0/4) |
| duplicate-line-flip | duplicate | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) |
| flip-boolean | literal | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| identifier-multi-edit | identifier | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| off-by-one | literal | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| remove-early-return | structural | 4 | 25.0% (1/4) | 100.0% (4/4) | 25.0% (1/4) |
| remove-negation | operator | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) |
| remove-optional-chain | access | 4 | 75.0% (3/4) | 75.0% (3/4) | 75.0% (3/4) |
| swap-adjacent-lines | structural | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) |
| swap-arithmetic | operator | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| swap-call-args | call | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| swap-comparison | operator | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| swap-equality | operator | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| swap-if-else | structural | 4 | 50.0% (2/4) | 100.0% (4/4) | 50.0% (2/4) |
| swap-increment-decrement | operator | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| swap-logical | operator | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| swap-named-imports | import | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) |
| swap-nullish | operator | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| swap-regex-quantifier | regex | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| unicode-hyphen | unicode | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |

## Difficulty Summary

| Difficulty Score | Runs | Verified | Edit Used | Success |
|------------------|------|----------|-----------|---------|
| 0-2 | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| 3-5 | 24 | 83.3% (20/24) | 100.0% (24/24) | 83.3% (20/24) |
| 6-8 | 27 | 85.2% (23/27) | 100.0% (27/27) | 85.2% (23/27) |
| 9+ | 25 | 76.0% (19/25) | 96.0% (24/25) | 76.0% (19/25) |

## Edit Tool Errors

Failures where the edit tool returned an error or failed to apply the patch.

### Unicode Unicode Hyphen 007 (ReactInternalTestUtils.js)

#### Run 1

##### Attempt 1

- Path: ReactInternalTestUtils.js
- Operation: —

**Tool error**

```
Could not find a close enough match in ReactInternalTestUtils.js.

Closest match (85% similar) at line 9:
  - import { diff } from 'jest–diff';
  + import { diff } from 'jest\u2013diff';
Closest match was below the 95% similarity threshold.
```

**Patch args**

```diff
{
  "path": "ReactInternalTestUtils.js",
  "old_text": "import { diff } from 'jest–diff';",
  "new_text": "import { diff } from 'jest-diff';"
}
```

## Failed Tasks (0% passing)

### Access Remove Optional Chain 007 (index.js) — 0/1

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | — | 0 / 0 | 360.0s |

### Duplicate Duplicate Line Flip 003 (ReactFiberDevToolsHook.js) — 0/1

**All runs failed with same error:** File mismatch for ReactFiberDevToolsHook.js

**Sample agent response (run 1):**
```
Fixed. Line 95 now reads `if (!hasLoggedError) {`, removing the redundant `__DEV__ &&` that was duplicated from the outer `if (__DEV__)` guard at line 90. No other lines were touched.
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
@@ -92 @@
       try {
         injectedHook.onScheduleFiberRoot(rendererID, root, children);
       } catch (err) {
-        if (__DEV__ && !hasLoggedError) {
+        if (!hasLoggedError) {
           hasLoggedError = true;
           console.error('React instrumentation encountered an error: %o', err);
         }
```

### Import Swap Named Imports 003 (index.js) — 0/1

**All runs failed with same error:** File mismatch for index.js

**Sample agent response (run 1):**
```
Fixed. `useDebugValue` and `useState` were swapped on line 11; now restored to `{ useState, Fragment, useDebugValue }`.
```

**Diff (expected vs actual):**
```diff
@@ -8 @@
  */
 
 import * as React from 'react';
-import { Fragment, useDebugValue, useState } from 'react';
+import { useState, Fragment, useDebugValue } from 'react';
 
 const div = document.createElement('div');
 const exampleFunction = () => {};
```

### Operator Remove Negation 005 (ReactDOMContainer.js) — 0/1

**All runs failed with same error:** File mismatch for ReactDOMContainer.js

**Sample agent response (run 1):**
```
Line 16 now reads `!!node &&`. The logic is correct:
- `!!null` → `false`, short-circuits the rest (no `TypeError` on `null.nodeType`)
- `!!validNode` → `true`, evaluates the `nodeType` checks

Only the single `!` token was added; nothing else changed.
```

**Diff (expected vs actual):**
```diff
@@ -12 @@
 import { ELEMENT_NODE, COMMENT_NODE, DOCUMENT_NODE, DOCUMENT_FRAGMENT_NODE } from './HTMLNodeType';
 
 export function isValidContainer(node: any): boolean {
-  return !!(
-    node &&
+  return (
+    !!node &&
     (node.nodeType === ELEMENT_NODE ||
       node.nodeType === DOCUMENT_NODE ||
       node.nodeType === DOCUMENT_FRAGMENT_NODE ||
```

### Structural Delete Statement 001 (useExtensionComponentsPanelVisibility.js) — 0/1

**All runs failed with same error:** File mismatch for useExtensionComponentsPanelVisibility.js

**Sample agent response (run 1):**
```
The missing `useState` initialization. `isVisible` and `setIsVisible` were used but never declared. Restored `const [isVisible, setIsVisible] = useState(true);` before the `useEffect` — initial value `true` matches the comment: *"For other implementations, this hook will just return constant `true` value."*
```

**Diff (expected vs actual):**
```diff
@@ -14 @@
 // For other implementations, this hook will just return constant `true` value.
 export function useExtensionComponentsPanelVisibility(bridge: FrontendBridge): boolean {
   const [isVisible, setIsVisible] = useState(true);
-
   useEffect(() => {
     function onPanelShown() {
       setIsVisible(true);
```

### Structural Delete Statement 003 (useCanvasInteraction.js) — 0/1

**All runs failed with same error:** File mismatch for useCanvasInteraction.js

**Sample agent response (run 1):**
```
Fix applied. `isMouseDownRef.current = true` is now set at the top of `onCanvasMouseDown`, which is the only place it was missing — consistent with the symmetry of `isMouseDownRef.current = false` in `onDocumentMouseUp`.
```

**Diff (expected vs actual):**
```diff
@@ -160 @@
     };
 
     const onCanvasMouseDown: MouseEventHandler = (event) => {
-      didMouseMoveWhileDownRef.current = false;
       isMouseDownRef.current = true;
       isMouseDownRef.current = true;
+      didMouseMoveWhileDownRef.current = false;
 
       interactor({
         type: 'mousedown',
```

### Structural Delete Statement 005 (StackTraceView.js) — 0/1

**All runs failed with same error:** File mismatch for StackTraceView.js

**Sample agent response (run 1):**
```
Restored. `ignored` is now derived from `symbolicatedCallSite.ignored` (the `SourceMappedLocation` type carries that boolean), consistent with the ternary on line 62 that maps it to `styles.IgnoredCallSite`.
```

**Diff (expected vs actual):**
```diff
@@ -49 @@
   );
   const [functionName, url, line, column] =
     symbolicatedCallSite !== null ? symbolicatedCallSite.location : callSite;
-  const ignored = symbolicatedCallSite !== null ? symbolicatedCallSite.ignored : false;
+
   // TODO: Make an option to be able to toggle the display of ignore listed rows.
   // Ideally this UI should be higher than a single Stack Trace so that there's not
   // multiple buttons in a single inspection taking up space.
@@ -55 @@
   // multiple buttons in a single inspection taking up space.
 
   const isBuiltIn = url === '' || url.startsWith('<anonymous>'); // This looks like a fake anonymous through eval.
+  const ignored = symbolicatedCallSite !== null && symbolicatedCallSite.ignored;
   return (
     <div
       className={
```

### Structural Delete Statement 007 (ReactDOMFizzStaticBrowser.js) — 0/1

**All runs failed with same error:** File mismatch for ReactDOMFizzStaticBrowser.js

**Sample agent response (run 1):**
```
The fix is correct. The `ReadableStream` construction (with the same `bytes` type, `pull`/`cancel` handlers, and `{ highWaterMark: 0 }` option) was deleted from `prerender`'s `onAllReady`. It's now restored, matching the identical pattern in `resumeAndPrerender`'s `onAllReady`.
```

**Diff (expected vs actual):**
```diff
@@ -83 @@
         // $FlowFixMe[prop-missing] size() methods are not allowed on byte streams.
         { highWaterMark: 0 },
       );
-
       const result: StaticResult = {
         postponed: getPostponedState(request),
         prelude: stream,
```

### Structural Remove Early Return 003 (ReactDOMComponentTree.js) — 0/1

**All runs failed with same error:** File mismatch for ReactDOMComponentTree.js

**Sample agent response (run 1):**
```
The guard clause is restored. The logic now:

1. For each hydration boundary walked upward from the target node, compute the corresponding `targetFiber`.
2. **If found** → return it immediately (the restored early return).
3. **If not found** → continue to the parent boundary (the existing `getParentHydrationBoundary` call), consistent with the comment "There might still be a parent boundary…".
4. If no boundary has a known fiber, fall through to `return targetInst` at line 202.
```

**Diff (expected vs actual):**
```diff
@@ -185 @@
             ? internalInstanceMap.get(hydrationInstance)
             : // $FlowFixMe[prop-missing]
               hydrationInstance[internalInstanceKey];
+
           if (targetFiber) {
             return targetFiber;
           }
```

### Structural Remove Early Return 005 (TabBar.js) — 0/1

**All runs failed with same error:** File mismatch for TabBar.js

**Sample agent response (run 1):**
```
The guard clause is restored: lines 92–94 now check `if (tab === null) { return null; }` before the destructure, matching the 3-line pattern required.
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
Guard clause restored at the correct location. When `commitIndex` is already within the cached range, the function now returns `commitTrees[commitIndex]` immediately instead of falling through to the loop and returning null.
```

**Diff (expected vs actual):**
```diff
@@ -63 @@
   }
 
   const commitTrees = ((rootToCommitTreeMap.get(rootID): any): Array<CommitTree>);
-  if (commitIndex < commitTrees.length) {
-    return commitTrees[commitIndex];
-  }
 
   const { profilingData } = profilerStore;
   if (profilingData === null) {
@@ -84 @@
     );
   }
 
+  if (commitTrees.length > commitIndex) {
+    return commitTrees[commitIndex];
+  }
+
   let commitTree: CommitTree = ((null: any): CommitTree);
   for (let index = commitTrees.length; index <= commitIndex; index++) {
     // Commits are generated sequentially and cached.
```

### Structural Swap Adjacent Lines 007 (ReactFlightClientConfigBundlerWebpack.js) — 0/1

**All runs failed with same error:** File mismatch for ReactFlightClientConfigBundlerWebpack.js

**Sample agent response (run 1):**
```
The fix is correct. The `// $FlowFixMe[method-unbinding]` comment now suppresses the Flow warning on `thenable.then(resolve, ignoreReject)`, where passing the bound method `resolve` to `.then()` triggers the lint rule. `promises.push(thenable)` follows after, unchanged.
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
+      // $FlowFixMe[method-unbinding]
       thenable.then(resolve, ignoreReject);
       thenable.then(resolve, ignoreReject);
+      promises.push(thenable);
       chunkCache.set(chunkId, thenable);
     } else if (entry !== null) {
       promises.push(entry);
```

### Structural Swap If Else 001 (utils.js) — 0/1

**All runs failed with same error:** File mismatch for utils.js

**Sample agent response (run 1):**
```
The fix is correct. The `else if (sourceURL.includes('://'))` branch now contains the sourceMap URL processing (appropriate for full URLs with a protocol), and the `else` branch now simply assigns `filePath = sourceURL` (appropriate for relative paths with no protocol).
```

**Diff (expected vs actual):**
```diff
@@ -23 @@
     if (sourceURL.startsWith('file:///')) {
       filePath = new URL(sourceURL).pathname;
     } else if (sourceURL.includes('://')) {
-      // $FlowFixMe[cannot-resolve-name]
       if (!__IS_INTERNAL_VERSION__) {
       if (!__IS_INTERNAL_VERSION__) {
-        // In this case, we can't really determine the path to a file, disable a button
-        return { url: null, shouldDisableButton: true };
+        return {
+          url: null,
+          shouldDisableButton: true,
+        };
       } else {
         const endOfSourceMapURLPattern = '.js/';
         const endOfSourceMapURLIndex = sourceURL.lastIndexOf(endOfSourceMapURLPattern);
       } else {
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
```

### Structural Swap If Else 003 (ReactDOMFloat.js) — 0/1

**All runs failed with same error:** File mismatch for ReactDOMFloat.js

**Sample agent response (run 1):**
```
Correct. The fix swaps the two branches:

- `if (encountered)` now logs the generic validation error (with the accumulated `encountered` details), which is what should happen when there are bad arguments.
- `else` now runs the `as`-type switch, which fires only when no basic validation errors were found — producing the specific "only 'script' is supported" error for an unexpected `as` value, and silently breaking for the valid `'script'` case.
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
