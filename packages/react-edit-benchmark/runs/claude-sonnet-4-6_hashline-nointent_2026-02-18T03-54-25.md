# Edit Benchmark Report

## Configuration

| Setting | Value |
|---------|-------|
| Date | 2026-02-18T03:46:41.944Z |
| Model | p-anthropic/p-anthropic/claude-sonnet-4-6 |
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
| Successful Runs | 65 |
| **Task Success Rate** | **81.3% (65/80)** |
| Verified Rate | 81.3% (65/80) |
| Edit Tool Usage Rate | 96.3% (77/80) |
| **Edit Success Rate** | **97.5%** |
| Timeout Runs | 0 |
| Mutation Intent Match Rate | 77.9% |
| Patch Failure Rate | 2.5% (2/80) |
| Tasks All Passing | 65 |
| Tasks Flaky/Failing | 15 |

### Tool Calls

| Tool | Total | Avg/Run |
|------|-------|---------|
| Read | 167 | 2.1 |
| Edit | 80 | 1.0 |
| Write | 0 | 0.0 |
| **Tool Input Chars** | 21,921 | 274 |

### Tokens & Time

| Metric | Total | Avg/Run |
|--------|-------|---------|
| Input Tokens | 472 | 6 |
| Output Tokens | 134,580 | 1,682 |
| Total Tokens | 3,282,424 | 41,030 |
| Duration | 3241.3s | 40.5s |
| **Avg Indent Score** | — | **0.00** |

### Hashline Edit Subtypes

| Operation | Count | % |
|-----------|-------|---|
| set_line | 78 | 85.7% |
| replace_lines | 4 | 4.4% |
| insert_after | 8 | 8.8% |
| replace | 1 | 1.1% |
| **Total** | **91** | 100% |

## Task Results

| Task | File | Success | Edit Hit | R/E/W | Tokens (In/Out) | Time | Indent |
|------|------|---------|----------|-------|-----------------|------|--------|
| Access Remove Optional Chain 001 | fallbackEvalContext.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/351 | 9.8s | 0.00 |
| Access Remove Optional Chain 003 | hookNamesCache.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/476 | 13.4s | 0.00 |
| Access Remove Optional Chain 005 | registerDevToolsEventLogger.js | 1/1 ✅ | 100.0% | 3/1/0 | 7/4,157 | 65.7s | 0.00 |
| Access Remove Optional Chain 007 | index.js | 0/1 ❌ | 100.0% | 0/0/0 | 0/0 | 360.0s | 0.00 |
| Call Swap Call Args 001 | formatConsoleArguments.js | 1/1 ✅ | 100.0% | 1/1/0 | 5/233 | 5.9s | 0.00 |
| Call Swap Call Args 003 | ReactFlightDOMServerBrowser.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/469 | 10.3s | 0.00 |
| Call Swap Call Args 005 | ReactNoopPersistent.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/711 | 13.2s | 0.00 |
| Call Swap Call Args 007 | parseSourceAndMetadata.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/616 | 12.9s | 0.00 |
| Duplicate Duplicate Line Flip 001 | isCustomElement.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/576 | 14.0s | 0.00 |
| Duplicate Duplicate Line Flip 003 | ReactFiberDevToolsHook.js | 0/1 ❌ | 100.0% | 0/0/0 | 0/0 | 360.0s | 0.00 |
| Duplicate Duplicate Line Flip 005 | shallowEqual.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/374 | 10.8s | 0.00 |
| Duplicate Duplicate Line Flip 007 | ReactDOMEventReplaying.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/5,081 | 76.5s | 0.00 |
| Identifier Identifier Multi Edit 001 | Button.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/860 | 16.7s | 0.00 |
| Identifier Identifier Multi Edit 003 | ReactFlightDOMClientBrowser.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/735 | 14.2s | 0.00 |
| Identifier Identifier Multi Edit 005 | githubAPI.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/507 | 12.4s | 0.00 |
| Identifier Identifier Multi Edit 007 | ReactFiberComponentStack.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/585 | 11.8s | 0.00 |
| Import Swap Named Imports 001 | ListApp.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/708 | 15.2s | 0.00 |
| Import Swap Named Imports 003 | index.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/1,254 | 24.4s | 0.00 |
| Import Swap Named Imports 005 | SuspenseScrubber.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/719 | 16.0s | 0.00 |
| Import Swap Named Imports 007 | InspectedElement.js | 1/1 ✅ | 100.0% | 1/1/0 | 3/15,094 | 252.4s | 0.00 |
| Literal Flip Boolean 001 | ReactDOMLegacyServerImpl.js | 1/1 ✅ | 100.0% | 3/1/0 | 7/5,390 | 78.8s | 0.00 |
| Literal Flip Boolean 003 | ReactProfilerTimer.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/630 | 16.0s | 0.00 |
| Literal Flip Boolean 005 | OpenInEditorButton.js | 1/1 ✅ | 100.0% | 3/1/0 | 7/1,384 | 27.9s | 0.00 |
| Literal Flip Boolean 007 | Element.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/492 | 11.1s | 0.00 |
| Literal Off By One 001 | ReactOwnerStackFrames.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/393 | 10.6s | 0.00 |
| Literal Off By One 003 | ReactFlightClientConfigBundlerTurbopack.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/538 | 13.6s | 0.00 |
| Literal Off By One 005 | ContextMenu.js | 0/1 ❌ | 100.0% | 2/1/0 | 6/425 | 11.2s | 0.00 |
| Literal Off By One 007 | index.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/641 | 13.9s | 0.00 |
| Operator Remove Negation 001 | prepareInjection.js | 1/1 ✅ | 100.0% | 1/1/0 | 5/227 | 5.6s | 0.00 |
| Operator Remove Negation 003 | ReactDOMSelection.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/1,881 | 36.8s | 0.00 |
| Operator Remove Negation 005 | ReactDOMContainer.js | 0/1 ❌ | 100.0% | 2/1/0 | 4/13,896 | 330.0s | 0.00 |
| Operator Remove Negation 007 | SelectEventPlugin.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/483 | 12.5s | 0.00 |
| Operator Swap Arithmetic 001 | formatConsoleArguments.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/420 | 8.4s | 0.00 |
| Operator Swap Arithmetic 003 | ReactFlightDOMServerBrowser.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/686 | 15.6s | 0.00 |
| Operator Swap Arithmetic 005 | ReactFiberConfigWithNoResources.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/339 | 8.6s | 0.00 |
| Operator Swap Arithmetic 007 | useCanvasInteraction.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/642 | 14.0s | 0.00 |
| Operator Swap Comparison 001 | useSmartTooltip.js | 1/1 ✅ | 100.0% | 3/1/0 | 7/2,026 | 37.4s | 0.00 |
| Operator Swap Comparison 003 | ReactFlightDOMServerBrowser.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/949 | 20.6s | 0.00 |
| Operator Swap Comparison 005 | Rectangle.js | 1/1 ✅ | 100.0% | 3/1/0 | 7/1,365 | 27.9s | 0.00 |
| Operator Swap Comparison 007 | ReactFiberTreeReflection.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/783 | 15.5s | 0.00 |
| Operator Swap Equality 001 | ReactNoopFlightClient.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/408 | 8.9s | 0.00 |
| Operator Swap Equality 003 | astUtils.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/749 | 16.9s | 0.00 |
| Operator Swap Equality 005 | ReactDOMContainer.js | 1/1 ✅ | 100.0% | 3/1/0 | 7/463 | 10.5s | 0.00 |
| Operator Swap Equality 007 | ReactFlightDOMServerBrowser.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/1,477 | 31.0s | 0.00 |
| Operator Swap Increment Decrement 001 | index.js | 1/1 ✅ | 100.0% | 1/1/0 | 5/268 | 6.0s | 0.00 |
| Operator Swap Increment Decrement 003 | ReactFlightClientConfigBundlerESM.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/422 | 9.4s | 0.00 |
| Operator Swap Increment Decrement 005 | ReactFiberViewTransitionComponent.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/424 | 9.7s | 0.00 |
| Operator Swap Increment Decrement 007 | ReactFiberConcurrentUpdates.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/441 | 12.0s | 0.00 |
| Operator Swap Logical 001 | ErrorView.js | 0/1 ❌ | 100.0% | 3/1/0 | 7/4,710 | 87.0s | 0.00 |
| Operator Swap Logical 003 | DevTools.js | 0/1 ❌ | 100.0% | 0/0/0 | 0/0 | 0ms | 0.00 |
| Operator Swap Logical 005 | UseEffectEvent.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/971 | 17.9s | 0.00 |
| Operator Swap Logical 007 | getHookNameForLocation.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/1,145 | 23.9s | 0.00 |
| Operator Swap Nullish 001 | ElementBadges.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/480 | 11.3s | 0.00 |
| Operator Swap Nullish 003 | ReactComponentStackFrame.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/702 | 16.7s | 0.00 |
| Operator Swap Nullish 005 | ReactLogo.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/693 | 12.3s | 0.00 |
| Operator Swap Nullish 007 | SuspenseBreadcrumbs.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/3,832 | 64.5s | 0.00 |
| Regex Swap Regex Quantifier 001 | SimpleValues.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/448 | 9.1s | 0.00 |
| Regex Swap Regex Quantifier 003 | utils.js | 1/1 ✅ | 100.0% | 3/1/0 | 7/4,171 | 74.7s | 0.00 |
| Regex Swap Regex Quantifier 005 | formatWithStyles.js | 1/1 ✅ | 50.0% | 3/4/0 | 10/2,938 | 50.9s | 0.00 |
| Regex Swap Regex Quantifier 007 | RunReactCompiler.ts | 1/1 ✅ | 100.0% | 2/1/0 | 4/13,359 | 231.1s | 0.00 |
| Structural Delete Statement 001 | useExtensionComponentsPanelVisibility.js | 0/1 ❌ | 100.0% | 2/1/0 | 6/617 | 13.1s | 0.00 |
| Structural Delete Statement 003 | useCanvasInteraction.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/641 | 14.1s | 0.00 |
| Structural Delete Statement 005 | StackTraceView.js | 0/1 ❌ | 100.0% | 4/1/0 | 8/2,525 | 46.6s | 0.00 |
| Structural Delete Statement 007 | ReactDOMFizzStaticBrowser.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/1,612 | 24.6s | 0.00 |
| Structural Remove Early Return 001 | ReactFlightAsyncDispatcher.js | 0/1 ❌ | 100.0% | 2/1/0 | 6/3,355 | 51.8s | 0.00 |
| Structural Remove Early Return 003 | ReactDOMComponentTree.js | 0/1 ❌ | 100.0% | 3/1/0 | 7/5,632 | 96.4s | 0.00 |
| Structural Remove Early Return 005 | TabBar.js | 0/1 ❌ | 100.0% | 4/1/0 | 8/1,232 | 27.4s | 0.00 |
| Structural Remove Early Return 007 | CommitTreeBuilder.js | 0/1 ❌ | 100.0% | 2/1/0 | 6/895 | 17.7s | 0.00 |
| Structural Swap Adjacent Lines 001 | reactPolling.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/392 | 9.1s | 0.00 |
| Structural Swap Adjacent Lines 003 | OwnersStack.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/471 | 10.3s | 0.00 |
| Structural Swap Adjacent Lines 005 | ReactOwnerStackFrames.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/627 | 11.9s | 0.00 |
| Structural Swap Adjacent Lines 007 | ReactFlightClientConfigBundlerWebpack.js | 0/1 ❌ | 100.0% | 2/1/0 | 6/1,290 | 22.8s | 0.00 |
| Structural Swap If Else 001 | utils.js | 0/1 ❌ | 100.0% | 3/1/0 | 7/2,803 | 36.8s | 0.00 |
| Structural Swap If Else 003 | ReactDOMFloat.js | 0/1 ❌ | 100.0% | 3/1/0 | 7/4,153 | 54.5s | 0.00 |
| Structural Swap If Else 005 | ReactClientConsoleConfigPlain.js | 1/1 ✅ | 100.0% | 3/1/0 | 7/832 | 15.5s | 0.00 |
| Structural Swap If Else 007 | index.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/571 | 12.0s | 0.00 |
| Unicode Unicode Hyphen 001 | formatProdErrorMessage.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/389 | 9.1s | 0.00 |
| Unicode Unicode Hyphen 003 | SourceMapConsumer.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/500 | 13.0s | 0.00 |
| Unicode Unicode Hyphen 005 | babel.config.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/394 | 8.3s | 0.00 |
| Unicode Unicode Hyphen 007 | ReactInternalTestUtils.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/452 | 10.9s | 0.00 |

## Category Summary

| Category | Runs | Verified | Edit Used | Success | Min/Avg/Max Difficulty |
|----------|------|----------|-----------|---------|------------------------|
| access | 4 | 75.0% (3/4) | 75.0% (3/4) | 75.0% (3/4) | 3 / 7.5 / 10 |
| call | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) | 2 / 7.8 / 14 |
| duplicate | 4 | 75.0% (3/4) | 75.0% (3/4) | 75.0% (3/4) | 8 / 11.3 / 17 |
| identifier | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) | 4 / 6.8 / 9 |
| import | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) | 2 / 3.8 / 5 |
| literal | 8 | 87.5% (7/8) | 100.0% (8/8) | 87.5% (7/8) | 3 / 6.9 / 10 |
| operator | 27 | 92.6% (25/27) | 100.0% (27/27) | 92.6% (25/27) | 3 / 6.6 / 10 |
| regex | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) | 2 / 5.8 / 10 |
| structural | 16 | 43.8% (7/16) | 100.0% (16/16) | 43.8% (7/16) | 4 / 8.3 / 13 |
| unicode | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) | 2 / 4.8 / 8 |
| unknown | 1 | 0.0% (0/1) | 0.0% (0/1) | 0.0% (0/1) | — |

## Mutation Summary

| Mutation | Category | Runs | Verified | Edit Used | Success |
|----------|----------|------|----------|-----------|---------|
| delete-statement | structural | 4 | 50.0% (2/4) | 100.0% (4/4) | 50.0% (2/4) |
| duplicate-line-flip | duplicate | 4 | 75.0% (3/4) | 75.0% (3/4) | 75.0% (3/4) |
| flip-boolean | literal | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| identifier-multi-edit | identifier | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| off-by-one | literal | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) |
| remove-early-return | structural | 4 | 0.0% (0/4) | 100.0% (4/4) | 0.0% (0/4) |
| remove-negation | operator | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) |
| remove-optional-chain | access | 4 | 75.0% (3/4) | 75.0% (3/4) | 75.0% (3/4) |
| swap-adjacent-lines | structural | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) |
| swap-arithmetic | operator | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| swap-call-args | call | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| swap-comparison | operator | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| swap-equality | operator | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| swap-if-else | structural | 4 | 50.0% (2/4) | 100.0% (4/4) | 50.0% (2/4) |
| swap-increment-decrement | operator | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| swap-logical | operator | 3 | 66.7% (2/3) | 100.0% (3/3) | 66.7% (2/3) |
| swap-named-imports | import | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| swap-nullish | operator | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| swap-regex-quantifier | regex | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| unicode-hyphen | unicode | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| unknown | unknown | 1 | 0.0% (0/1) | 0.0% (0/1) | 0.0% (0/1) |

## Difficulty Summary

| Difficulty Score | Runs | Verified | Edit Used | Success |
|------------------|------|----------|-----------|---------|
| 0-2 | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| 3-5 | 24 | 79.2% (19/24) | 100.0% (24/24) | 79.2% (19/24) |
| 6-8 | 27 | 85.2% (23/27) | 100.0% (27/27) | 85.2% (23/27) |
| 9+ | 24 | 79.2% (19/24) | 91.7% (22/24) | 79.2% (19/24) |
| unknown | 1 | 0.0% (0/1) | 0.0% (0/1) | 0.0% (0/1) |

## Edit Tool Errors

Failures where the edit tool returned an error or failed to apply the patch.

### Regex Swap Regex Quantifier 005 (formatWithStyles.js)

#### Run 1

##### Attempt 1

- Path: formatWithStyles.js
- Operation: —

**Tool error**

```
No changes made to formatWithStyles.js. The edits produced identical content.
Edit 0: replacement for 45:68 is identical to current content:
  45:68|   const REGEXP = /([^%]|^)((%%)*)(%([ oOdisf]))/g;
Your content must differ from what the file already contains. Re-read the file to see the current state.
The file differs from the original fixture at these lines:
45:b4  -  const REGEXP = /([^%]|^)((%%)+)(%([oOdisf]))/g;
46:68  +  const REGEXP = /([^%]|^)((%%)*)(%([oOdisf]))/g;
```

**Patch args**

```diff
{
  "path": "formatWithStyles.js",
  "edits": [
    {
      "set_line": {
        "anchor": "45:68",
        "new_text": "  const REGEXP = /([^%]|^)((%%)*)(%([ oOdisf]))/g;"
      }
    }
  ]
}
```

##### Attempt 2

- Path: formatWithStyles.js
- Operation: —

**Tool error**

```
No changes made to formatWithStyles.js. The edits produced identical content.
Edit 0: replacement for 45:68 is identical to current content:
  45:68|   const REGEXP = /([^%]|^)((%%)*)(%([ oOdisf]))/g;
Your content must differ from what the file already contains. Re-read the file to see the current state.
The file differs from the original fixture at these lines:
45:b4  -  const REGEXP = /([^%]|^)((%%)+)(%([oOdisf]))/g;
46:68  +  const REGEXP = /([^%]|^)((%%)*)(%([oOdisf]))/g;
```

**Patch args**

```diff
{
  "path": "formatWithStyles.js",
  "edits": [
    {
      "set_line": {
        "anchor": "45:68",
        "new_text": "  const REGEXP = /([^%]|^)((%%)*)(%([ oOdisf]))/g;"
      }
    }
  ]
}
```

## Failed Tasks (0% passing)

### Access Remove Optional Chain 007 (index.js) — 0/1

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | — | 0 / 0 | 360.0s |

### Duplicate Duplicate Line Flip 003 (ReactFiberDevToolsHook.js) — 0/1

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | — | 0 / 0 | 360.0s |

### Literal Off By One 005 (ContextMenu.js) — 0/1

**All runs failed with same error:** File mismatch for ContextMenu.js

**Sample agent response (run 1):**
```
Changed `> 1` to `>= 0` on line 37. The original condition incorrectly excluded position 1 (and 0) from valid left-edge placement; the correct boundary is whether the shifted position is non-negative.
```

**Diff (expected vs actual):**
```diff
@@ -34 @@
   }
 
   if (x + element.offsetWidth >= ownerWindow.innerWidth) {
-    if (x - element.offsetWidth > 0) {
+    if (x - element.offsetWidth >= 0) {
       element.style.left = `${x - element.offsetWidth}px`;
     } else {
       element.style.left = '0px';
```

### Operator Remove Negation 005 (ReactDOMContainer.js) — 0/1

**All runs failed with same error:** File mismatch for ReactDOMContainer.js

**Sample agent response (run 1):**
```
The change is correct. `node &&` now properly guards — the function returns `true` when `node` is truthy and its `nodeType` is one of the valid container types. Previously, `!node &&` inverted the guard, making the function always return `false` for valid containers and throw for `null`.
```

**Diff (expected vs actual):**
```diff
@@ -12 @@
 import { ELEMENT_NODE, COMMENT_NODE, DOCUMENT_NODE, DOCUMENT_FRAGMENT_NODE } from './HTMLNodeType';
 
 export function isValidContainer(node: any): boolean {
-  return !!(
+  return (
     node &&
     (node.nodeType === ELEMENT_NODE ||
       node.nodeType === DOCUMENT_NODE ||
```

### Operator Swap Logical 001 (ErrorView.js) — 0/1

**All runs failed with same error:** File mismatch for ErrorView.js

**Sample agent response (run 1):**
```
Line 36 now uses `!=` (loose inequality) instead of `!==` (strict inequality). The loose check `dismissError != null` correctly guards against both `null` and `undefined`, matching the intended behavior.
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
+          {dismissError != null && (
             <Button className={styles.CloseButton} onClick={dismissError}>
               Dismiss
               <ButtonIcon className={styles.CloseButtonIcon} type="close" />
```

### Operator Swap Logical 003 (DevTools.js) — 0/1

**All runs failed with same error:** Timeout waiting for response to set_thinking_level. Stderr: 

### Structural Delete Statement 001 (useExtensionComponentsPanelVisibility.js) — 0/1

**All runs failed with same error:** File mismatch for useExtensionComponentsPanelVisibility.js

**Sample agent response (run 1):**
```
The missing `useState` declaration is restored. `setIsVisible` and `isVisible` are now defined — the hook initializes visibility to `true` (matching the comment that non-extension implementations return a constant `true`) and updates it via the bridge event listeners.
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
The restored statement matches the pattern established at line 51 — same conditional shape, same `symbolicatedCallSite !== null` guard, with `false` as the fallback when no symbolic data is available. `ignored` is now in scope for line 62's ternary.
```

**Diff (expected vs actual):**
```diff
@@ -50 @@
   const [functionName, url, line, column] =
     symbolicatedCallSite !== null ? symbolicatedCallSite.location : callSite;
   const ignored = symbolicatedCallSite !== null ? symbolicatedCallSite.ignored : false;
+
   // TODO: Make an option to be able to toggle the display of ignore listed rows.
   // Ideally this UI should be higher than a single Stack Trace so that there's not
   // multiple buttons in a single inspection taking up space.
```

### Structural Remove Early Return 001 (ReactFlightAsyncDispatcher.js) — 0/1

**All runs failed with same error:** File mismatch for ReactFlightAsyncDispatcher.js

**Sample agent response (run 1):**
```
The guard clause is restored. Lines 18–20 are the inserted 3-line pattern (`if (request) {` / `return getCache(request);` / `}`), and the existing `return new Map()` remains as the fallback when there is no active request.
```

**Diff (expected vs actual):**
```diff
@@ -14 @@
 
 function resolveCache(): Map<Function, mixed> {
   const request = resolveRequest();
+
   if (request) {
     return getCache(request);
   }
```

### Structural Remove Early Return 003 (ReactDOMComponentTree.js) — 0/1

**All runs failed with same error:** File mismatch for ReactDOMComponentTree.js

**Sample agent response (run 1):**
```
Correct. The restored guard clause:

- **Finds** `targetFiber` from the hydration boundary's fiber map/key (lines 184–187)  
- **Returns it immediately** if found (lines 189–191) — this was the removed early return  
- **Falls through** to walk up to the parent boundary (line 196) only when no fiber is registered yet, which is the path the existing comment describes
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
Guard clause restored at lines 92–94. The null check precedes the destructuring of `tab`, preventing a crash when the `tabs` array contains `null` entries.
```

**Diff (expected vs actual):**
```diff
@@ -89 @@
   return (
     <Fragment>
       {tabs.map((tab) => {
-        if (tab === null) {
-          return <div key="VRule" className={styles.VRule} />;
+        if (tab == null) {
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
Guard clause restored exactly where it belongs — before the `let commitTree` declaration and the generation loop. When `commitIndex` is already within the cached range, it returns early with the cached result instead of returning the null-cast sentinel.
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
Correct. `chunkCache.set(chunkId, thenable)` now precedes `thenable.then(resolve, ignoreReject)`, so if the thenable resolves synchronously the cache entry is already `null` (set by `resolve`) when the loop moves on — rather than being overwritten back to the pending thenable.
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
The fix is correct. The branches are now in the right order:

- `if (!__IS_INTERNAL_VERSION__)` → does the `endOfSourceMapURLPattern` extraction (the complex path logic for non-internal builds)
- `else` → returns `{ url: null, shouldDisableButton: true }` (the early-exit for internal builds that don't need this processing)
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
The fix is correct. Now:
- `if (encountered)` → emits the generic "expected up to two arguments" error (with the accumulated `encountered` details)
- `else` → runs the `switch` on `as` to check for unsupported module types (only reached when basic validation passed)
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
