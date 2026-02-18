# Edit Benchmark Report

## Configuration

| Setting | Value |
|---------|-------|
| Date | 2026-02-18T03:46:31.592Z |
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
| Edit Tool Usage Rate | 93.8% (75/80) |
| **Edit Success Rate** | **100.0%** |
| Timeout Runs | 0 |
| Mutation Intent Match Rate | 76.6% |
| Patch Failure Rate | 0.0% (0/75) |
| Tasks All Passing | 62 |
| Tasks Flaky/Failing | 18 |

### Tool Calls

| Tool | Total | Avg/Run |
|------|-------|---------|
| Read | 162 | 2.0 |
| Edit | 75 | 0.9 |
| Write | 0 | 0.0 |
| **Tool Input Chars** | 21,103 | 264 |

### Tokens & Time

| Metric | Total | Avg/Run |
|--------|-------|---------|
| Input Tokens | 430,522 | 5,382 |
| Output Tokens | 37,064 | 463 |
| Total Tokens | 2,071,554 | 25,894 |
| Duration | 862.8s | 10.8s |
| **Avg Indent Score** | — | **0.10** |

### Hashline Edit Subtypes

| Operation | Count | % |
|-----------|-------|---|
| set_line | 76 | 88.4% |
| replace_lines | 3 | 3.5% |
| insert_after | 7 | 8.1% |
| replace | 0 | 0.0% |
| **Total** | **86** | 100% |

## Task Results

| Task | File | Success | Edit Hit | R/E/W | Tokens (In/Out) | Time | Indent |
|------|------|---------|----------|-------|-----------------|------|--------|
| Access Remove Optional Chain 001 | fallbackEvalContext.js | 1/1 ✅ | 100.0% | 2/1/0 | 2,798/191 | 5.9s | 0.00 |
| Access Remove Optional Chain 003 | hookNamesCache.js | 1/1 ✅ | 100.0% | 2/1/0 | 11,430/178 | 6.5s | 0.00 |
| Access Remove Optional Chain 005 | registerDevToolsEventLogger.js | 1/1 ✅ | 100.0% | 2/1/0 | 2,804/335 | 8.5s | 0.00 |
| Access Remove Optional Chain 007 | index.js | 1/1 ✅ | 100.0% | 2/1/0 | 9,226/1,179 | 24.7s | 0.00 |
| Call Swap Call Args 001 | formatConsoleArguments.js | 1/1 ✅ | 100.0% | 2/1/0 | 2,203/164 | 4.7s | 0.00 |
| Call Swap Call Args 003 | ReactFlightDOMServerBrowser.js | 1/1 ✅ | 100.0% | 2/1/0 | 4,239/193 | 5.8s | 0.00 |
| Call Swap Call Args 005 | ReactNoopPersistent.js | 0/1 ❌ | 100.0% | 2/1/0 | 3,219/198 | 6.4s | 0.00 |
| Call Swap Call Args 007 | parseSourceAndMetadata.js | 1/1 ✅ | 100.0% | 2/1/0 | 11,504/204 | 5.4s | 0.00 |
| Duplicate Duplicate Line Flip 001 | isCustomElement.js | 1/1 ✅ | 100.0% | 2/1/0 | 4,350/152 | 8.2s | 0.00 |
| Duplicate Duplicate Line Flip 003 | ReactFiberDevToolsHook.js | 0/1 ❌ | 100.0% | 2/1/0 | 6,811/1,456 | 27.8s | 0.00 |
| Duplicate Duplicate Line Flip 005 | shallowEqual.js | 1/1 ✅ | 100.0% | 2/1/0 | 4,291/173 | 5.2s | 0.00 |
| Duplicate Duplicate Line Flip 007 | ReactDOMEventReplaying.js | 1/1 ✅ | 100.0% | 2/1/0 | 10,435/999 | 18.1s | 0.00 |
| Identifier Identifier Multi Edit 001 | Button.js | 1/1 ✅ | 100.0% | 2/1/0 | 1,840/173 | 5.9s | 0.00 |
| Identifier Identifier Multi Edit 003 | ReactFlightDOMClientBrowser.js | 1/1 ✅ | 100.0% | 2/1/0 | 12,651/227 | 5.7s | 0.00 |
| Identifier Identifier Multi Edit 005 | githubAPI.js | 1/1 ✅ | 100.0% | 1/1/0 | 3,044/153 | 4.3s | 0.00 |
| Identifier Identifier Multi Edit 007 | ReactFiberComponentStack.js | 0/1 ❌ | 100.0% | 0/0/0 | 0/0 | 9.4s | 0.00 |
| Import Swap Named Imports 001 | ListApp.js | 1/1 ✅ | 100.0% | 2/1/0 | 8,047/301 | 6.6s | 0.00 |
| Import Swap Named Imports 003 | index.js | 1/1 ✅ | 100.0% | 1/1/0 | 4,744/185 | 4.6s | 0.00 |
| Import Swap Named Imports 005 | SuspenseScrubber.js | 1/1 ✅ | 100.0% | 2/1/0 | 3,155/160 | 5.1s | 0.00 |
| Import Swap Named Imports 007 | InspectedElement.js | 0/1 ❌ | 100.0% | 3/0/0 | 3,531/598 | 20.1s | 0.00 |
| Literal Flip Boolean 001 | ReactDOMLegacyServerImpl.js | 1/1 ✅ | 100.0% | 2/1/0 | 2,488/255 | 7.3s | 0.00 |
| Literal Flip Boolean 003 | ReactProfilerTimer.js | 0/1 ❌ | 100.0% | 0/0/0 | 0/0 | 0ms | 0.00 |
| Literal Flip Boolean 005 | OpenInEditorButton.js | 1/1 ✅ | 100.0% | 2/1/0 | 2,799/221 | 5.6s | 0.00 |
| Literal Flip Boolean 007 | Element.js | 1/1 ✅ | 100.0% | 2/1/0 | 4,964/307 | 10.4s | 0.00 |
| Literal Off By One 001 | ReactOwnerStackFrames.js | 1/1 ✅ | 100.0% | 2/1/0 | 3,907/153 | 8.5s | 0.00 |
| Literal Off By One 003 | ReactFlightClientConfigBundlerTurbopack.js | 1/1 ✅ | 100.0% | 1/1/0 | 4,361/125 | 4.1s | 0.00 |
| Literal Off By One 005 | ContextMenu.js | 1/1 ✅ | 100.0% | 1/1/0 | 2,593/128 | 10.6s | 0.00 |
| Literal Off By One 007 | index.js | 1/1 ✅ | 100.0% | 2/1/0 | 9,364/220 | 5.1s | 0.00 |
| Operator Remove Negation 001 | prepareInjection.js | 1/1 ✅ | 100.0% | 2/1/0 | 3,030/279 | 13.6s | 0.00 |
| Operator Remove Negation 003 | ReactDOMSelection.js | 1/1 ✅ | 100.0% | 3/1/0 | 4,110/579 | 13.3s | 0.00 |
| Operator Remove Negation 005 | ReactDOMContainer.js | 0/1 ❌ | 100.0% | 2/1/0 | 5,004/685 | 12.7s | 3.50 |
| Operator Remove Negation 007 | SelectEventPlugin.js | 1/1 ✅ | 100.0% | 1/1/0 | 3,614/132 | 11.8s | 0.00 |
| Operator Swap Arithmetic 001 | formatConsoleArguments.js | 1/1 ✅ | 100.0% | 2/1/0 | 4,102/156 | 4.7s | 0.00 |
| Operator Swap Arithmetic 003 | ReactFlightDOMServerBrowser.js | 1/1 ✅ | 100.0% | 2/1/0 | 5,525/282 | 7.7s | 0.00 |
| Operator Swap Arithmetic 005 | ReactFiberConfigWithNoResources.js | 1/1 ✅ | 100.0% | 2/1/0 | 1,827/175 | 5.4s | 0.00 |
| Operator Swap Arithmetic 007 | useCanvasInteraction.js | 1/1 ✅ | 100.0% | 2/1/0 | 8,198/243 | 10.1s | 0.00 |
| Operator Swap Comparison 001 | useSmartTooltip.js | 1/1 ✅ | 100.0% | 2/1/0 | 2,843/224 | 6.3s | 0.00 |
| Operator Swap Comparison 003 | ReactFlightDOMServerBrowser.js | 1/1 ✅ | 100.0% | 2/1/0 | 4,960/253 | 6.8s | 0.00 |
| Operator Swap Comparison 005 | Rectangle.js | 1/1 ✅ | 100.0% | 2/1/0 | 6,855/173 | 6.3s | 0.00 |
| Operator Swap Comparison 007 | ReactFiberTreeReflection.js | 1/1 ✅ | 100.0% | 2/1/0 | 8,414/241 | 7.2s | 0.00 |
| Operator Swap Equality 001 | ReactNoopFlightClient.js | 0/1 ❌ | 100.0% | 0/0/0 | 0/0 | 0ms | 0.00 |
| Operator Swap Equality 003 | astUtils.js | 1/1 ✅ | 100.0% | 2/1/0 | 10,253/287 | 6.9s | 0.00 |
| Operator Swap Equality 005 | ReactDOMContainer.js | 1/1 ✅ | 100.0% | 2/1/0 | 2,102/138 | 4.7s | 0.00 |
| Operator Swap Equality 007 | ReactFlightDOMServerBrowser.js | 1/1 ✅ | 100.0% | 4/1/0 | 13,478/674 | 15.3s | 0.00 |
| Operator Swap Increment Decrement 001 | index.js | 1/1 ✅ | 100.0% | 2/1/0 | 2,268/162 | 5.2s | 0.00 |
| Operator Swap Increment Decrement 003 | ReactFlightClientConfigBundlerESM.js | 1/1 ✅ | 100.0% | 2/1/0 | 5,379/193 | 5.6s | 0.00 |
| Operator Swap Increment Decrement 005 | ReactFiberViewTransitionComponent.js | 1/1 ✅ | 100.0% | 2/1/0 | 3,106/176 | 5.2s | 0.00 |
| Operator Swap Increment Decrement 007 | ReactFiberConcurrentUpdates.js | 1/1 ✅ | 100.0% | 2/1/0 | 5,109/213 | 9.1s | 0.00 |
| Operator Swap Logical 001 | ErrorView.js | 0/1 ❌ | 100.0% | 2/1/0 | 4,629/525 | 11.3s | 0.00 |
| Operator Swap Logical 003 | DevTools.js | 1/1 ✅ | 100.0% | 2/1/0 | 12,911/201 | 10.1s | 0.00 |
| Operator Swap Logical 005 | UseEffectEvent.js | 1/1 ✅ | 100.0% | 2/1/0 | 1,662/212 | 5.4s | 0.00 |
| Operator Swap Logical 007 | getHookNameForLocation.js | 1/1 ✅ | 100.0% | 2/1/0 | 4,400/320 | 9.2s | 0.00 |
| Operator Swap Nullish 001 | ElementBadges.js | 1/1 ✅ | 100.0% | 2/1/0 | 4,089/192 | 6.1s | 0.00 |
| Operator Swap Nullish 003 | ReactComponentStackFrame.js | 1/1 ✅ | 100.0% | 4/1/0 | 5,812/283 | 7.8s | 0.00 |
| Operator Swap Nullish 005 | ReactLogo.js | 1/1 ✅ | 100.0% | 2/1/0 | 2,239/191 | 7.0s | 0.00 |
| Operator Swap Nullish 007 | SuspenseBreadcrumbs.js | 1/1 ✅ | 100.0% | 2/1/0 | 6,327/630 | 13.5s | 0.00 |
| Regex Swap Regex Quantifier 001 | SimpleValues.js | 1/1 ✅ | 100.0% | 2/1/0 | 3,382/349 | 10.1s | 0.00 |
| Regex Swap Regex Quantifier 003 | utils.js | 1/1 ✅ | 100.0% | 5/1/0 | 11,592/3,759 | 59.9s | 0.00 |
| Regex Swap Regex Quantifier 005 | formatWithStyles.js | 1/1 ✅ | 100.0% | 2/1/0 | 6,108/288 | 7.0s | 0.00 |
| Regex Swap Regex Quantifier 007 | RunReactCompiler.ts | 1/1 ✅ | 100.0% | 3/1/0 | 5,911/3,316 | 50.9s | 0.00 |
| Structural Delete Statement 001 | useExtensionComponentsPanelVisibility.js | 0/1 ❌ | 100.0% | 2/1/0 | 2,455/311 | 7.2s | 0.00 |
| Structural Delete Statement 003 | useCanvasInteraction.js | 1/1 ✅ | 100.0% | 2/1/0 | 5,184/199 | 6.2s | 0.00 |
| Structural Delete Statement 005 | StackTraceView.js | 0/1 ❌ | 100.0% | 6/1/0 | 6,630/2,513 | 44.7s | 0.00 |
| Structural Delete Statement 007 | ReactDOMFizzStaticBrowser.js | 1/1 ✅ | 100.0% | 2/1/0 | 4,372/513 | 9.5s | 0.00 |
| Structural Remove Early Return 001 | ReactFlightAsyncDispatcher.js | 0/1 ❌ | 100.0% | 4/1/0 | 2,963/1,078 | 21.4s | 0.00 |
| Structural Remove Early Return 003 | ReactDOMComponentTree.js | 0/1 ❌ | 100.0% | 2/1/0 | 7,326/2,190 | 36.5s | 4.40 |
| Structural Remove Early Return 005 | TabBar.js | 0/1 ❌ | 100.0% | 2/1/0 | 7,116/232 | 9.9s | 0.00 |
| Structural Remove Early Return 007 | CommitTreeBuilder.js | 0/1 ❌ | 100.0% | 2/1/0 | 12,038/1,518 | 30.6s | 0.00 |
| Structural Swap Adjacent Lines 001 | reactPolling.js | 1/1 ✅ | 100.0% | 1/1/0 | 2,428/179 | 7.4s | 0.00 |
| Structural Swap Adjacent Lines 003 | OwnersStack.js | 1/1 ✅ | 100.0% | 2/1/0 | 10,040/269 | 6.6s | 0.00 |
| Structural Swap Adjacent Lines 005 | ReactOwnerStackFrames.js | 1/1 ✅ | 100.0% | 2/1/0 | 5,475/348 | 8.0s | 0.00 |
| Structural Swap Adjacent Lines 007 | ReactFlightClientConfigBundlerWebpack.js | 0/1 ❌ | 100.0% | 2/1/0 | 4,810/421 | 9.3s | 0.00 |
| Structural Swap If Else 001 | utils.js | 0/1 ❌ | 100.0% | 2/1/0 | 5,920/1,190 | 17.3s | 0.00 |
| Structural Swap If Else 003 | ReactDOMFloat.js | 0/1 ❌ | 100.0% | 2/1/0 | 17,243/940 | 15.8s | 0.00 |
| Structural Swap If Else 005 | ReactClientConsoleConfigPlain.js | 1/1 ✅ | 100.0% | 2/1/0 | 4,546/214 | 5.2s | 0.00 |
| Structural Swap If Else 007 | index.js | 1/1 ✅ | 100.0% | 1/1/0 | 5,460/251 | 9.0s | 0.00 |
| Unicode Unicode Hyphen 001 | formatProdErrorMessage.js | 1/1 ✅ | 100.0% | 2/1/0 | 4,965/183 | 9.6s | 0.00 |
| Unicode Unicode Hyphen 003 | SourceMapConsumer.js | 0/1 ❌ | 100.0% | 0/0/0 | 0/0 | 0ms | 0.00 |
| Unicode Unicode Hyphen 005 | babel.config.js | 1/1 ✅ | 100.0% | 2/1/0 | 2,416/157 | 6.2s | 0.00 |
| Unicode Unicode Hyphen 007 | ReactInternalTestUtils.js | 1/1 ✅ | 100.0% | 3/1/0 | 9,098/199 | 5.8s | 0.00 |

## Category Summary

| Category | Runs | Verified | Edit Used | Success | Min/Avg/Max Difficulty |
|----------|------|----------|-----------|---------|------------------------|
| access | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) | 3 / 7.5 / 10 |
| call | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) | 2 / 7.8 / 14 |
| duplicate | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) | 8 / 11.3 / 17 |
| identifier | 4 | 75.0% (3/4) | 75.0% (3/4) | 75.0% (3/4) | 4 / 6.8 / 9 |
| import | 4 | 75.0% (3/4) | 75.0% (3/4) | 75.0% (3/4) | 2 / 3.8 / 5 |
| literal | 7 | 100.0% (7/7) | 100.0% (7/7) | 100.0% (7/7) | 3 / 6.7 / 10 |
| operator | 27 | 92.6% (25/27) | 100.0% (27/27) | 92.6% (25/27) | 3 / 6.8 / 10 |
| regex | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) | 2 / 5.8 / 10 |
| structural | 16 | 43.8% (7/16) | 100.0% (16/16) | 43.8% (7/16) | 4 / 8.3 / 13 |
| unicode | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) | 2 / 4.7 / 8 |
| unknown | 3 | 0.0% (0/3) | 0.0% (0/3) | 0.0% (0/3) | — |

## Mutation Summary

| Mutation | Category | Runs | Verified | Edit Used | Success |
|----------|----------|------|----------|-----------|---------|
| delete-statement | structural | 4 | 50.0% (2/4) | 100.0% (4/4) | 50.0% (2/4) |
| duplicate-line-flip | duplicate | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) |
| flip-boolean | literal | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| identifier-multi-edit | identifier | 4 | 75.0% (3/4) | 75.0% (3/4) | 75.0% (3/4) |
| off-by-one | literal | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| remove-early-return | structural | 4 | 0.0% (0/4) | 100.0% (4/4) | 0.0% (0/4) |
| remove-negation | operator | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) |
| remove-optional-chain | access | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| swap-adjacent-lines | structural | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) |
| swap-arithmetic | operator | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| swap-call-args | call | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) |
| swap-comparison | operator | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| swap-equality | operator | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| swap-if-else | structural | 4 | 50.0% (2/4) | 100.0% (4/4) | 50.0% (2/4) |
| swap-increment-decrement | operator | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| swap-logical | operator | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) |
| swap-named-imports | import | 4 | 75.0% (3/4) | 75.0% (3/4) | 75.0% (3/4) |
| swap-nullish | operator | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| swap-regex-quantifier | regex | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| unicode-hyphen | unicode | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| unknown | unknown | 3 | 0.0% (0/3) | 0.0% (0/3) | 0.0% (0/3) |

## Difficulty Summary

| Difficulty Score | Runs | Verified | Edit Used | Success |
|------------------|------|----------|-----------|---------|
| 0-2 | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) |
| 3-5 | 22 | 77.3% (17/22) | 95.5% (21/22) | 77.3% (17/22) |
| 6-8 | 26 | 80.8% (21/26) | 96.2% (25/26) | 80.8% (21/26) |
| 9+ | 25 | 84.0% (21/25) | 100.0% (25/25) | 84.0% (21/25) |
| unknown | 3 | 0.0% (0/3) | 0.0% (0/3) | 0.0% (0/3) |

## Failed Tasks (0% passing)

### Call Swap Call Args 005 (ReactNoopPersistent.js) — 0/1

**All runs failed with same error:** File mismatch for ReactNoopPersistent.js

**Sample agent response (run 1):**
```
Change applied in ReactNoopPersistent.js.
```

**Diff (expected vs actual):**
```diff
@@ -56 @@
   // This should only be used by React internals.
   unstable_runWithPriority,
 } = createReactNoop(
-  ReactFiberReconciler, // reconciler
-  false, // useMutation
+  ReactFiberReconciler, // useMutation
+  false, // reconciler
 );
```

### Duplicate Duplicate Line Flip 003 (ReactFiberDevToolsHook.js) — 0/1

**All runs failed with same error:** File mismatch for ReactFiberDevToolsHook.js

**Sample agent response (run 1):**
```
Fixed the duplicated error log literal in `ReactFiberDevToolsHook.js` by aligning it with the other identical lines.
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

### Identifier Identifier Multi Edit 007 (ReactFiberComponentStack.js) — 0/1

**All runs failed with same error:** File mismatch for ReactFiberComponentStack.js

**Diff (expected vs actual):**
```diff
@@ -80 @@
       if (__DEV__) {
         // Add any Server Component stack frames in reverse order.
         const debugInfo = node._debugInfo;
-        if (debugInfo) {
-          for (let i = debugInfo.length - 1; i >= 0; i--) {
-            const entry = debugInfo[i];
+        if (edbugInfo) {
+          for (let i = edbugInfo.length - 1; i >= 0; i--) {
+            const entry = edbugInfo[i];
             if (typeof entry.name === 'string') {
               info += describeDebugInfoFrame(entry.name, entry.env, entry.debugLocation);
             }
```

### Import Swap Named Imports 007 (InspectedElement.js) — 0/1

**All runs failed with same error:** File mismatch for InspectedElement.js

**Diff (expected vs actual):**
```diff
@@ -10 @@
 import type { SourceMappedLocation } from 'react-devtools-shared/src/symbolicateSource';
 
 import * as React from 'react';
-import { useCallback, useContext, useSyncExternalStore } from 'react';
+import { useSyncExternalStore, useContext, useCallback } from 'react';
 import { TreeStateContext } from './TreeContext';
 import { BridgeContext, StoreContext, OptionsContext } from '../context';
 import Button from '../Button';
```

### Literal Flip Boolean 003 (ReactProfilerTimer.js) — 0/1

**All runs failed with same error:** Timeout waiting for response to set_thinking_level. Stderr: 

### Operator Remove Negation 005 (ReactDOMContainer.js) — 0/1

**All runs failed with same error:** File mismatch for ReactDOMContainer.js

**Sample agent response (run 1):**
```
Changed line 20 and re-read to confirm. No tests run.
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
+      !(
+        disableCommentsAsDOMContainers &&
         node.nodeType === COMMENT_NODE &&
         node.nodeType === COMMENT_NODE &&
-        (node: any).nodeValue === ' react-mount-point-unstable '))
+        (node: any).nodeValue === ' react-mount-point-unstable '
+      ))
   );
 }
```

### Operator Swap Equality 001 (ReactNoopFlightClient.js) — 0/1

**All runs failed with same error:** Timeout waiting for response to set_thinking_level. Stderr: 

### Operator Swap Logical 001 (ErrorView.js) — 0/1

**All runs failed with same error:** File mismatch for ErrorView.js

**Sample agent response (run 1):**
```
Line 36 updated to use `||`.
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

### Structural Delete Statement 001 (useExtensionComponentsPanelVisibility.js) — 0/1

**All runs failed with same error:** File mismatch for useExtensionComponentsPanelVisibility.js

**Sample agent response (run 1):**
```
Applied fix.
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

### Structural Delete Statement 005 (StackTraceView.js) — 0/1

**All runs failed with same error:** File mismatch for StackTraceView.js

**Sample agent response (run 1):**
```
Fixed by restoring the missing `ignored` assignment in `StackTraceView.js`.

Tests not run.
```

**Diff (expected vs actual):**
```diff
@@ -49 @@
   );
   const [functionName, url, line, column] =
     symbolicatedCallSite !== null ? symbolicatedCallSite.location : callSite;
-  const ignored = symbolicatedCallSite !== null ? symbolicatedCallSite.ignored : false;
+  const ignored = callSite[4] === true;
+
   // TODO: Make an option to be able to toggle the display of ignore listed rows.
   // Ideally this UI should be higher than a single Stack Trace so that there's not
   // multiple buttons in a single inspection taking up space.
```

### Structural Remove Early Return 001 (ReactFlightAsyncDispatcher.js) — 0/1

**All runs failed with same error:** File mismatch for ReactFlightAsyncDispatcher.js

**Sample agent response (run 1):**
```
Restored guard clause in `resolveCache`. No tests run.
```

**Diff (expected vs actual):**
```diff
@@ -14 @@
 
 function resolveCache(): Map<Function, mixed> {
   const request = resolveRequest();
-  if (request) {
-    return getCache(request);
+
+  if (!request) {
+    return new Map();
   }
   }
-  return new Map();
+
+  return getCache(request);
 }
 
 export const DefaultAsyncDispatcher: AsyncDispatcher = ({
```

### Structural Remove Early Return 003 (ReactDOMComponentTree.js) — 0/1

**All runs failed with same error:** File mismatch for ReactDOMComponentTree.js

**Diff (expected vs actual):**
```diff
@@ -130 @@
   }
   if (targetInst) {
     // Don't return HostRoot, SuspenseComponent or ActivityComponent here.
+    if (
+      targetInst.tag === HostRoot ||
+      targetInst.tag === SuspenseComponent ||
+      targetInst.tag === ActivityComponent
+    ) {
+      return null;
+    }
     return targetInst;
   }
   // If the direct event target isn't a React owned DOM node, we need to look
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
Guard clause restored in `TabBar.js`.
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
Applied guard clause to return cached commit tree when already built.

Tests not run (not requested).
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
 
+  if (commitIndex < commitTrees.length) {
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
Swap complete and verified in `preloadModule`:

```
chunkCache.set(chunkId, thenable);
thenable.then(resolve, ignoreReject);
```

No other changes.
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
Changed the swapped if/else branch bodies in `utils.js` and verified the region.
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
Changed `if (encountered)` to `if (!encountered)` in `ReactDOMFloat.js` to correct swapped branches. No tests run.
```

**Diff (expected vs actual):**
```diff
@@ -246 @@
         options.as,
       )}.`;
     }
-    if (encountered) {
-      console.error(
-        'ReactDOM.preinitModule(): Expected up to two arguments, a non-empty `href` string and, optionally, an `options` object with a valid `as` property.%s',
-        encountered,
-      );
-    } else {
+    if (!encountered) {
       const as = options && typeof options.as === 'string' ? options.as : 'script';
       switch (as) {
         case 'script': {
@@ -257 @@
         case 'script': {
           break;
         }
-
-        // We have an invalid as type and need to warn
         default: {
           const typeOfAs = getValueDescriptorExpectingEnumForWarning(as);
           console.error(
@@ -271 @@
           );
         }
       }
+    } else {
+      console.error(
+        'ReactDOM.preinitModule(): Expected up to two arguments, a non-empty `href` string and, optionally, an `options` object with a valid `as` property.%s',
+        encountered,
+      );
     }
   }
   if (typeof href === 'string') {
```

### Unicode Unicode Hyphen 003 (SourceMapConsumer.js) — 0/1

**All runs failed with same error:** Timeout waiting for response to set_thinking_level. Stderr: 
