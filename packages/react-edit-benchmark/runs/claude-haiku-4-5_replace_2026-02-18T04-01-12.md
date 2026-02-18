# Edit Benchmark Report

## Configuration

| Setting | Value |
|---------|-------|
| Date | 2026-02-18T03:56:38.227Z |
| Model | p-anthropic/p-anthropic/claude-haiku-4-5 |
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
| Successful Runs | 60 |
| **Task Success Rate** | **75.0% (60/80)** |
| Verified Rate | 75.0% (60/80) |
| Edit Tool Usage Rate | 96.3% (77/80) |
| **Edit Success Rate** | **96.0%** |
| Timeout Runs | 0 |
| Mutation Intent Match Rate | 80.5% |
| Tasks All Passing | 60 |
| Tasks Flaky/Failing | 20 |

### Tool Calls

| Tool | Total | Avg/Run |
|------|-------|---------|
| Read | 183 | 2.3 |
| Edit | 100 | 1.3 |
| Write | 0 | 0.0 |
| **Tool Input Chars** | 45,871 | 573 |

### Tokens & Time

| Metric | Total | Avg/Run |
|--------|-------|---------|
| Input Tokens | 1,568 | 20 |
| Output Tokens | 110,266 | 1,378 |
| Total Tokens | 3,492,044 | 43,651 |
| Duration | 1048.7s | 13.1s |
| **Avg Indent Score** | — | **0.00** |

## Task Results

| Task | File | Success | Edit Hit | R/E/W | Tokens (In/Out) | Time | Indent |
|------|------|---------|----------|-------|-----------------|------|--------|
| Access Remove Optional Chain 001 | fallbackEvalContext.js | 1/1 ✅ | 100.0% | 2/1/0 | 19/478 | 5.6s | 0.00 |
| Access Remove Optional Chain 003 | hookNamesCache.js | 1/1 ✅ | 100.0% | 3/1/0 | 21/895 | 10.6s | 0.00 |
| Access Remove Optional Chain 005 | registerDevToolsEventLogger.js | 0/1 ❌ | 100.0% | 2/1/0 | 19/1,396 | 13.7s | 0.00 |
| Access Remove Optional Chain 007 | index.js | 0/1 ❌ | 100.0% | 2/1/0 | 19/1,193 | 12.0s | 0.00 |
| Call Swap Call Args 001 | formatConsoleArguments.js | 1/1 ✅ | 100.0% | 2/1/0 | 19/423 | 5.2s | 0.00 |
| Call Swap Call Args 003 | ReactFlightDOMServerBrowser.js | 1/1 ✅ | 100.0% | 2/1/0 | 19/595 | 7.5s | 0.00 |
| Call Swap Call Args 005 | ReactNoopPersistent.js | 1/1 ✅ | 100.0% | 2/1/0 | 19/508 | 5.4s | 0.00 |
| Call Swap Call Args 007 | parseSourceAndMetadata.js | 1/1 ✅ | 100.0% | 3/1/0 | 21/695 | 8.5s | 0.00 |
| Duplicate Duplicate Line Flip 001 | isCustomElement.js | 1/1 ✅ | 100.0% | 2/1/0 | 19/509 | 6.0s | 0.00 |
| Duplicate Duplicate Line Flip 003 | ReactFiberDevToolsHook.js | 0/1 ❌ | 100.0% | 6/9/0 | 22/31,715 | 238.2s | 0.00 |
| Duplicate Duplicate Line Flip 005 | shallowEqual.js | 1/1 ✅ | 100.0% | 2/1/0 | 19/503 | 5.8s | 0.00 |
| Duplicate Duplicate Line Flip 007 | ReactDOMEventReplaying.js | 0/1 ❌ | 100.0% | 4/7/0 | 25/12,565 | 100.4s | 0.00 |
| Identifier Identifier Multi Edit 001 | Button.js | 1/1 ✅ | 100.0% | 2/1/0 | 19/626 | 6.2s | 0.00 |
| Identifier Identifier Multi Edit 003 | ReactFlightDOMClientBrowser.js | 1/1 ✅ | 100.0% | 2/3/0 | 22/830 | 7.8s | 0.00 |
| Identifier Identifier Multi Edit 005 | githubAPI.js | 1/1 ✅ | 100.0% | 2/2/0 | 22/578 | 5.7s | 0.00 |
| Identifier Identifier Multi Edit 007 | ReactFiberComponentStack.js | 1/1 ✅ | 100.0% | 2/1/0 | 19/512 | 5.6s | 0.00 |
| Import Swap Named Imports 001 | ListApp.js | 1/1 ✅ | 100.0% | 2/1/0 | 19/594 | 7.0s | 0.00 |
| Import Swap Named Imports 003 | index.js | 1/1 ✅ | 100.0% | 2/1/0 | 19/659 | 8.2s | 0.00 |
| Import Swap Named Imports 005 | SuspenseScrubber.js | 1/1 ✅ | 100.0% | 2/1/0 | 19/570 | 6.9s | 0.00 |
| Import Swap Named Imports 007 | InspectedElement.js | 0/1 ❌ | 100.0% | 0/0/0 | 0/0 | 0ms | 0.00 |
| Literal Flip Boolean 001 | ReactDOMLegacyServerImpl.js | 1/1 ✅ | 100.0% | 2/1/0 | 19/1,274 | 13.8s | 0.00 |
| Literal Flip Boolean 003 | ReactProfilerTimer.js | 1/1 ✅ | 100.0% | 3/1/0 | 21/959 | 10.6s | 0.00 |
| Literal Flip Boolean 005 | OpenInEditorButton.js | 1/1 ✅ | 100.0% | 2/1/0 | 19/688 | 8.5s | 0.00 |
| Literal Flip Boolean 007 | Element.js | 1/1 ✅ | 100.0% | 2/1/0 | 19/558 | 6.6s | 0.00 |
| Literal Off By One 001 | ReactOwnerStackFrames.js | 1/1 ✅ | 100.0% | 2/1/0 | 19/461 | 5.4s | 0.00 |
| Literal Off By One 003 | ReactFlightClientConfigBundlerTurbopack.js | 1/1 ✅ | 100.0% | 3/1/0 | 21/604 | 8.2s | 0.00 |
| Literal Off By One 005 | ContextMenu.js | 1/1 ✅ | 100.0% | 2/1/0 | 19/554 | 6.4s | 0.00 |
| Literal Off By One 007 | index.js | 1/1 ✅ | 100.0% | 2/1/0 | 19/558 | 6.7s | 0.00 |
| Operator Remove Negation 001 | prepareInjection.js | 1/1 ✅ | 100.0% | 2/1/0 | 19/478 | 6.8s | 0.00 |
| Operator Remove Negation 003 | ReactDOMSelection.js | 0/1 ❌ | 100.0% | 3/1/0 | 21/2,567 | 24.9s | 0.00 |
| Operator Remove Negation 005 | ReactDOMContainer.js | 0/1 ❌ | 100.0% | 2/1/0 | 19/1,363 | 13.5s | 0.00 |
| Operator Remove Negation 007 | SelectEventPlugin.js | 1/1 ✅ | 100.0% | 3/1/0 | 21/719 | 8.1s | 0.00 |
| Operator Swap Arithmetic 001 | formatConsoleArguments.js | 1/1 ✅ | 100.0% | 2/1/0 | 19/484 | 5.7s | 0.00 |
| Operator Swap Arithmetic 003 | ReactFlightDOMServerBrowser.js | 1/1 ✅ | 100.0% | 3/1/0 | 21/634 | 7.5s | 0.00 |
| Operator Swap Arithmetic 005 | ReactFiberConfigWithNoResources.js | 1/1 ✅ | 100.0% | 2/1/0 | 19/547 | 6.6s | 0.00 |
| Operator Swap Arithmetic 007 | useCanvasInteraction.js | 0/1 ❌ | 100.0% | 3/1/0 | 21/746 | 8.5s | 0.00 |
| Operator Swap Comparison 001 | useSmartTooltip.js | 1/1 ✅ | 100.0% | 2/1/0 | 19/954 | 9.6s | 0.00 |
| Operator Swap Comparison 003 | ReactFlightDOMServerBrowser.js | 1/1 ✅ | 100.0% | 3/1/0 | 21/1,335 | 14.8s | 0.00 |
| Operator Swap Comparison 005 | Rectangle.js | 1/1 ✅ | 100.0% | 2/1/0 | 19/1,003 | 10.9s | 0.00 |
| Operator Swap Comparison 007 | ReactFiberTreeReflection.js | 1/1 ✅ | 100.0% | 3/1/0 | 21/796 | 8.9s | 0.00 |
| Operator Swap Equality 001 | ReactNoopFlightClient.js | 1/1 ✅ | 100.0% | 2/1/0 | 19/499 | 6.4s | 0.00 |
| Operator Swap Equality 003 | astUtils.js | 1/1 ✅ | 100.0% | 3/1/0 | 21/919 | 10.8s | 0.00 |
| Operator Swap Equality 005 | ReactDOMContainer.js | 1/1 ✅ | 100.0% | 3/1/0 | 25/678 | 11.6s | 0.00 |
| Operator Swap Equality 007 | ReactFlightDOMServerBrowser.js | 1/1 ✅ | 100.0% | 3/1/0 | 21/1,032 | 9.8s | 0.00 |
| Operator Swap Increment Decrement 001 | index.js | 1/1 ✅ | 100.0% | 2/1/0 | 19/450 | 5.4s | 0.00 |
| Operator Swap Increment Decrement 003 | ReactFlightClientConfigBundlerESM.js | 1/1 ✅ | 100.0% | 3/1/0 | 21/536 | 6.8s | 0.00 |
| Operator Swap Increment Decrement 005 | ReactFiberViewTransitionComponent.js | 1/1 ✅ | 100.0% | 2/1/0 | 19/771 | 9.1s | 0.00 |
| Operator Swap Increment Decrement 007 | ReactFiberConcurrentUpdates.js | 1/1 ✅ | 100.0% | 3/1/0 | 21/901 | 10.0s | 0.00 |
| Operator Swap Logical 001 | ErrorView.js | 0/1 ❌ | 100.0% | 2/1/0 | 19/1,015 | 11.9s | 0.00 |
| Operator Swap Logical 003 | DevTools.js | 1/1 ✅ | 100.0% | 3/1/0 | 21/706 | 9.0s | 0.00 |
| Operator Swap Logical 005 | UseEffectEvent.js | 1/1 ✅ | 100.0% | 2/1/0 | 19/799 | 8.7s | 0.00 |
| Operator Swap Logical 007 | getHookNameForLocation.js | 1/1 ✅ | 100.0% | 2/1/0 | 19/683 | 7.5s | 0.00 |
| Operator Swap Nullish 001 | ElementBadges.js | 1/1 ✅ | 100.0% | 2/1/0 | 19/571 | 5.9s | 0.00 |
| Operator Swap Nullish 003 | ReactComponentStackFrame.js | 1/1 ✅ | 100.0% | 3/1/0 | 21/595 | 7.0s | 0.00 |
| Operator Swap Nullish 005 | ReactLogo.js | 1/1 ✅ | 100.0% | 2/1/0 | 19/516 | 5.8s | 0.00 |
| Operator Swap Nullish 007 | SuspenseBreadcrumbs.js | 1/1 ✅ | 100.0% | 3/1/0 | 21/904 | 8.9s | 0.00 |
| Regex Swap Regex Quantifier 001 | SimpleValues.js | 1/1 ✅ | 100.0% | 2/1/0 | 19/611 | 6.4s | 0.00 |
| Regex Swap Regex Quantifier 003 | utils.js | 1/1 ✅ | 100.0% | 2/1/0 | 19/1,195 | 11.6s | 0.00 |
| Regex Swap Regex Quantifier 005 | formatWithStyles.js | 1/1 ✅ | 75.0% | 4/4/0 | 38/1,641 | 17.1s | 0.00 |
| Regex Swap Regex Quantifier 007 | RunReactCompiler.ts | 0/1 ❌ | 100.0% | 2/1/0 | 19/5,810 | 48.2s | 0.00 |
| Structural Delete Statement 001 | useExtensionComponentsPanelVisibility.js | 0/1 ❌ | 100.0% | 2/1/0 | 19/700 | 7.1s | 0.00 |
| Structural Delete Statement 003 | useCanvasInteraction.js | 0/1 ❌ | 100.0% | 2/1/0 | 19/724 | 7.2s | 0.00 |
| Structural Delete Statement 005 | StackTraceView.js | 0/1 ❌ | 100.0% | 2/1/0 | 19/1,179 | 10.8s | 0.00 |
| Structural Delete Statement 007 | ReactDOMFizzStaticBrowser.js | 1/1 ✅ | 100.0% | 2/1/0 | 19/819 | 10.7s | 0.00 |
| Structural Remove Early Return 001 | ReactFlightAsyncDispatcher.js | 1/1 ✅ | 100.0% | 2/1/0 | 19/859 | 8.2s | 0.00 |
| Structural Remove Early Return 003 | ReactDOMComponentTree.js | 0/1 ❌ | 100.0% | 3/1/0 | 21/3,099 | 27.5s | 0.00 |
| Structural Remove Early Return 005 | TabBar.js | 0/1 ❌ | 100.0% | 2/1/0 | 19/617 | 7.1s | 0.00 |
| Structural Remove Early Return 007 | CommitTreeBuilder.js | 0/1 ❌ | 100.0% | 2/1/0 | 19/1,046 | 13.4s | 0.00 |
| Structural Swap Adjacent Lines 001 | reactPolling.js | 1/1 ✅ | 100.0% | 2/1/0 | 19/501 | 6.3s | 0.00 |
| Structural Swap Adjacent Lines 003 | OwnersStack.js | 1/1 ✅ | 100.0% | 2/1/0 | 19/542 | 6.6s | 0.00 |
| Structural Swap Adjacent Lines 005 | ReactOwnerStackFrames.js | 1/1 ✅ | 100.0% | 2/1/0 | 19/783 | 7.7s | 0.00 |
| Structural Swap Adjacent Lines 007 | ReactFlightClientConfigBundlerWebpack.js | 0/1 ❌ | 100.0% | 2/1/0 | 19/1,031 | 9.4s | 0.00 |
| Structural Swap If Else 001 | utils.js | 0/1 ❌ | 100.0% | 0/0/0 | 0/0 | 0ms | 0.00 |
| Structural Swap If Else 003 | ReactDOMFloat.js | 0/1 ❌ | 100.0% | 3/1/0 | 21/1,251 | 12.1s | 0.00 |
| Structural Swap If Else 005 | ReactClientConsoleConfigPlain.js | 0/1 ❌ | 100.0% | 0/0/0 | 0/0 | 0ms | 0.00 |
| Structural Swap If Else 007 | index.js | 1/1 ✅ | 100.0% | 2/1/0 | 19/649 | 9.1s | 0.00 |
| Unicode Unicode Hyphen 001 | formatProdErrorMessage.js | 1/1 ✅ | 100.0% | 2/1/0 | 19/461 | 5.5s | 0.00 |
| Unicode Unicode Hyphen 003 | SourceMapConsumer.js | 1/1 ✅ | 50.0% | 2/2/0 | 26/595 | 6.7s | 0.00 |
| Unicode Unicode Hyphen 005 | babel.config.js | 1/1 ✅ | 50.0% | 2/2/0 | 26/664 | 7.2s | 0.00 |
| Unicode Unicode Hyphen 007 | ReactInternalTestUtils.js | 1/1 ✅ | 50.0% | 3/2/0 | 32/788 | 9.7s | 0.00 |

## Category Summary

| Category | Runs | Verified | Edit Used | Success | Min/Avg/Max Difficulty |
|----------|------|----------|-----------|---------|------------------------|
| access | 4 | 50.0% (2/4) | 100.0% (4/4) | 50.0% (2/4) | 3 / 7.5 / 10 |
| call | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) | 2 / 7.8 / 14 |
| duplicate | 4 | 50.0% (2/4) | 100.0% (4/4) | 50.0% (2/4) | 8 / 11.3 / 17 |
| identifier | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) | 4 / 6.8 / 9 |
| import | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) | 2 / 3.3 / 5 |
| literal | 8 | 100.0% (8/8) | 100.0% (8/8) | 100.0% (8/8) | 3 / 6.9 / 10 |
| operator | 28 | 85.7% (24/28) | 100.0% (28/28) | 85.7% (24/28) | 3 / 6.7 / 10 |
| regex | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) | 2 / 5.8 / 10 |
| structural | 14 | 42.9% (6/14) | 100.0% (14/14) | 42.9% (6/14) | 5 / 8.8 / 13 |
| unicode | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) | 2 / 4.8 / 8 |
| unknown | 3 | 0.0% (0/3) | 0.0% (0/3) | 0.0% (0/3) | — |

## Mutation Summary

| Mutation | Category | Runs | Verified | Edit Used | Success |
|----------|----------|------|----------|-----------|---------|
| delete-statement | structural | 4 | 25.0% (1/4) | 100.0% (4/4) | 25.0% (1/4) |
| duplicate-line-flip | duplicate | 4 | 50.0% (2/4) | 100.0% (4/4) | 50.0% (2/4) |
| flip-boolean | literal | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| identifier-multi-edit | identifier | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| off-by-one | literal | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| remove-early-return | structural | 4 | 25.0% (1/4) | 100.0% (4/4) | 25.0% (1/4) |
| remove-negation | operator | 4 | 50.0% (2/4) | 100.0% (4/4) | 50.0% (2/4) |
| remove-optional-chain | access | 4 | 50.0% (2/4) | 100.0% (4/4) | 50.0% (2/4) |
| swap-adjacent-lines | structural | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) |
| swap-arithmetic | operator | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) |
| swap-call-args | call | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| swap-comparison | operator | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| swap-equality | operator | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| swap-if-else | structural | 2 | 50.0% (1/2) | 100.0% (2/2) | 50.0% (1/2) |
| swap-increment-decrement | operator | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| swap-logical | operator | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) |
| swap-named-imports | import | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| swap-nullish | operator | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| swap-regex-quantifier | regex | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) |
| unicode-hyphen | unicode | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| unknown | unknown | 3 | 0.0% (0/3) | 0.0% (0/3) | 0.0% (0/3) |

## Difficulty Summary

| Difficulty Score | Runs | Verified | Edit Used | Success |
|------------------|------|----------|-----------|---------|
| 0-2 | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| 3-5 | 22 | 81.8% (18/22) | 100.0% (22/22) | 81.8% (18/22) |
| 6-8 | 26 | 76.9% (20/26) | 100.0% (26/26) | 76.9% (20/26) |
| 9+ | 25 | 72.0% (18/25) | 100.0% (25/25) | 72.0% (18/25) |
| unknown | 3 | 0.0% (0/3) | 0.0% (0/3) | 0.0% (0/3) |

## Edit Tool Errors

Failures where the edit tool returned an error or failed to apply the patch.

### Regex Swap Regex Quantifier 005 (formatWithStyles.js)

#### Run 1

##### Attempt 1

- Path: formatWithStyles.js
- Operation: —

**Tool error**

```
No changes made to formatWithStyles.js. The replacement produced identical content. This might indicate an issue with special characters or the text not existing as expected.
The file differs from the original fixture at these lines:
45:b4  -  const REGEXP = /([^%]|^)((%%)+)(%([oOdisf]))/g;
46:68  +  const REGEXP = /([^%]|^)((%%)*)(%([oOdisf]))/g;
```

**Patch args**

```diff
{
  "path": "formatWithStyles.js",
  "old_text": "  const REGEXP = /([^%]|^)((%%)*?)(%([oOdisf]))/g;",
  "new_text": "  const REGEXP = /([^%]|^)((%%)*?)(%([oOdisf]))/g;"
}
```

### Unicode Unicode Hyphen 003 (SourceMapConsumer.js)

#### Run 1

##### Attempt 1

- Path: SourceMapConsumer.js
- Operation: —

**Tool error**

```
Could not find a close enough match in SourceMapConsumer.js.

Closest match (90% similar) at line 10:
  - import { decode } from '@jridgewell/sourcemap–codec';
  + import { decode } from '@jridgewell/sourcemap\u2013codec';
Closest match was below the 95% similarity threshold.
```

**Patch args**

```diff
{
  "path": "SourceMapConsumer.js",
  "old_text": "import { decode } from '@jridgewell/sourcemap–codec';",
  "new_text": "import { decode } from '@jridgewell/sourcemap-codec';"
}
```

### Unicode Unicode Hyphen 005 (babel.config.js)

#### Run 1

##### Attempt 1

- Path: babel.config.js
- Operation: —

**Tool error**

```
Could not find a close enough match in babel.config.js.

Closest match (91% similar) at line 39:
  -     ['@babel/plugin–proposal-class-properties', { loose: false }],
  +     ['@babel/plugin\u2013proposal-class-properties', { loose: false }],
Closest match was below the 95% similarity threshold.
```

**Patch args**

```diff
{
  "path": "babel.config.js",
  "old_text": "    ['@babel/plugin–proposal-class-properties', { loose: false }],",
  "new_text": "    ['@babel/plugin-proposal-class-properties', { loose: false }],"
}
```

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

### Access Remove Optional Chain 005 (registerDevToolsEventLogger.js) — 0/1

**All runs failed with same error:** File mismatch for registerDevToolsEventLogger.js

**Sample agent response (run 1):**
```
Perfect. The optional chaining operator (`?.`) has been restored to `process.env?.DEVTOOLS_VERSION` on line 43. This is the property access that was missing optional chaining, allowing safe access to the `DEVTOOLS_VERSION` property when `process.env` might be undefined or nullish.
```

**Diff (expected vs actual):**
```diff
@@ -31 @@
         const additionalContext: LoggerContext | {} =
           fetchAdditionalContext != null ? await fetchAdditionalContext() : {};
 
-        currentLoggingIFrame?.contentWindow?.postMessage(
+        currentLoggingIFrame?.contentWindow.postMessage(
           {
             source: 'react-devtools-logging',
             event: eventWithoutMetadata,
@@ -40 @@
               metadata: metadata != null ? JSON.stringify(metadata) : '',
               session_id: currentSessionId,
               surface,
-              version: process.env.DEVTOOLS_VERSION,
+              version: process.env?.DEVTOOLS_VERSION,
             },
           },
           '*',
```

### Access Remove Optional Chain 007 (index.js) — 0/1

**All runs failed with same error:** File mismatch for index.js

**Sample agent response (run 1):**
```
Perfect. The bug has been fixed. Line 661 now uses optional chaining `maybeError?.isError` instead of the redundant null check `maybeError && maybeError.isError`. This is the only change made to the file, which is the minimum necessary to fix the bug.
```

**Diff (expected vs actual):**
```diff
@@ -64 @@
     },
 
     send(event: string, payload: any, transferable?: Array<any>) {
-      port?.postMessage({ event, payload }, transferable);
+      port.postMessage({ event, payload }, transferable);
     },
   });
 
@@ -658 @@
         lineNumber - 1,
         columnNumber - 1,
         (maybeError) => {
-          if (maybeError && maybeError.isError) {
+          if (maybeError?.isError) {
             // Not a resource Chrome can open. Fallback to browser default behavior.
             window.open(resource.url);
           }
```

### Duplicate Duplicate Line Flip 003 (ReactFiberDevToolsHook.js) — 0/1

**All runs failed with same error:** File mismatch for ReactFiberDevToolsHook.js

**Sample agent response (run 1):**
```
Good, the change was applied. Now line 413 checks for `markRenderStarted` (hash `47`), and the hash matches line 402's original hash, meaning they're now duplicates.

This matches the problem description: "A duplicated line contains a subtle literal/operator change."

The bug was that line 413 was checking for `markRenderYielded` when it should check for `markRenderStarted` (a duplicate of line 402), and I've fixed it.

The reasoning is that maybe the DevTools only has a `markRenderStarted` h...
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
@@ -410 @@
   if (enableSchedulingProfiler) {
     if (
       injectedProfilingHooks !== null &&
-      typeof injectedProfilingHooks.markRenderYielded === 'function'
+      typeof injectedProfilingHooks.markRenderStarted === 'function'
     ) {
       injectedProfilingHooks.markRenderYielded();
     }
```

### Duplicate Duplicate Line Flip 007 (ReactDOMEventReplaying.js) — 0/1

**All runs failed with same error:** File mismatch for ReactDOMEventReplaying.js

**Sample agent response (run 1):**
```
Good. The change is on line 467, where I removed the `!` operator from `!enableHydrationChangeEvent` to make it `enableHydrationChangeEvent`.

This is the minimal, focused fix that addresses the subtle operator change in the duplicated condition. The two similar conditions (line 451 and line 467) now both check `enableHydrationChangeEvent` positively, which ensures that:

1. When the hydration change event feature is ENABLED, change events are queued (line 451)
2. When the hydration change ev...
```

**Diff (expected vs actual):**
```diff
@@ -250 @@
         targetContainer,
         mouseEvent,
       );
-      return true;
+      return false;
     }
     case 'pointerover': {
       const pointerEvent = ((nativeEvent: any): PointerEventType);
@@ -464 @@
     queuedEvent.blockedOn = null;
     if (!hasScheduledReplayAttempt) {
       hasScheduledReplayAttempt = true;
-      if (!enableHydrationChangeEvent) {
+      if (enableHydrationChangeEvent) {
         // Schedule a callback to attempt replaying as many events as are
         // now unblocked. This first might not actually be unblocked yet.
         // We could check it early to avoid scheduling an unnecessary callback.
```

### Import Swap Named Imports 007 (InspectedElement.js) — 0/1

**All runs failed with same error:** Timeout waiting for response to set_thinking_level. Stderr: 

### Operator Remove Negation 003 (ReactDOMSelection.js) — 0/1

**All runs failed with same error:** File mismatch for ReactDOMSelection.js

**Sample agent response (run 1):**
```
Perfect. The fix has been applied successfully. Line 106 now has the logical negation `!` added back:

```javascript
if (!((next = node.nextSibling) !== null)) {
```

This restores the correct logic: break from the inner loop when there is NO next sibling, which is consistent with the pattern at line 84. This allows the code to properly backtrack up the tree when there are no more siblings to process.
```

**Diff (expected vs actual):**
```diff
@@ -103 @@
       if (parentNode === focusNode && ++indexWithinFocus === focusOffset) {
         end = length;
       }
-      if ((next = node.nextSibling) !== null) {
+      if (!((next = node.nextSibling) !== null)) {
         break;
       }
       node = parentNode;
@@ -156 @@
 
   // IE 11 uses modern selection, but doesn't support the extend method.
   // Flip backward selections, so we can set with a single range.
-  if (!selection.extend && start > end) {
+  if (selection.extend && start > end) {
     const temp = end;
     end = start;
     start = temp;
```

### Operator Remove Negation 005 (ReactDOMContainer.js) — 0/1

**All runs failed with same error:** File mismatch for ReactDOMContainer.js

**Sample agent response (run 1):**
```
Perfect. I've fixed the bug by removing the erroneous `!` negation from line 16 (which was checking `!node &&`). The corrected line now reads `node &&`, which properly validates that the node exists before accessing its properties. This makes the logic consistent with the rest of the validation - we're now checking if the node exists AND has one of the valid node types.
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

### Operator Swap Arithmetic 007 (useCanvasInteraction.js) — 0/1

**All runs failed with same error:** File mismatch for useCanvasInteraction.js

**Sample agent response (run 1):**
```
Done. The bug has been fixed. Line 130 now correctly uses `+` instead of `-` for the `y` coordinate, making both `x` and `y` coordinate conversions consistent: `localCoordinates.y + canvasRect.top` instead of `localCoordinates.y - canvasRect.top`.
```

**Diff (expected vs actual):**
```diff
@@ -126 @@
       // $FlowFixMe[incompatible-call] found when upgrading Flow
       const canvasRect = cacheFirstGetCanvasBoundingRect(canvas);
       return {
-        x: localCoordinates.x - canvasRect.left,
-        y: localCoordinates.y - canvasRect.top,
+        x: localCoordinates.x + canvasRect.left,
+        y: localCoordinates.y + canvasRect.top,
       };
     }
 
```

### Operator Swap Logical 001 (ErrorView.js) — 0/1

**All runs failed with same error:** File mismatch for ErrorView.js

**Sample agent response (run 1):**
```
Perfect. The change has been applied. Line 36 now reads `{dismissError === null && (` instead of `{dismissError !== null && (`. The boolean operator has been changed from `!==` to `===`.
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
+          {dismissError === null && (
             <Button className={styles.CloseButton} onClick={dismissError}>
               Dismiss
               <ButtonIcon className={styles.CloseButtonIcon} type="close" />
```

### Regex Swap Regex Quantifier 007 (RunReactCompiler.ts) — 0/1

**All runs failed with same error:** File mismatch for RunReactCompiler.ts

**Sample agent response (run 1):**
```
Good. The fix has been applied. Line 28 now has the `+` quantifier on the `[A-Z0-9]` character class, which means it now requires one or more uppercase letters or digits after "use" when matching hook names, making the pattern semantically correct for identifying hook functions like `useState`, `useEffect`, etc.
```

**Diff (expected vs actual):**
```diff
@@ -25 @@
 // Pattern for component names: starts with uppercase letter
 const COMPONENT_NAME_PATTERN = /^[A-Z]/;
 // Pattern for hook names: starts with 'use' followed by uppercase letter or digit
-const HOOK_NAME_PATTERN = /^use[A-Z0-9]/;
+const HOOK_NAME_PATTERN = /^use[A-Z0-9]+/;
 
 /**
  * Quick heuristic using ESLint's already-parsed AST to detect if the file
@@ -151 @@
   filename: string;
   userOpts: PluginOptions;
 };
-const FLOW_SUPPRESSION_REGEX = /\$FlowFixMe\[([^\]]*)\]/g;
+const FLOW_SUPPRESSION_REGEX = /\$FlowFixMe\[([^\]]+)\]/g;
 
 function getFlowSuppressions(sourceCode: SourceCode): Array<{ line: number; code: string }> {
   const comments = sourceCode.getAllComments();
```

### Structural Delete Statement 001 (useExtensionComponentsPanelVisibility.js) — 0/1

**All runs failed with same error:** File mismatch for useExtensionComponentsPanelVisibility.js

**Sample agent response (run 1):**
```
Perfect. The fix is complete. The deleted statement `const [isVisible, setIsVisible] = useState(true);` has been restored on line 16, right after the function declaration and before the `useEffect` hook. This:

1. Declares the `isVisible` state variable initialized to `true`
2. Provides the `setIsVisible` function used on lines 19 and 22
3. Enables the function to return `isVisible` on line 34

The code is now syntactically correct and functionally complete.
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
Perfect. The fix is applied correctly. The missing statement `isMouseDownRef.current = true;` has been restored to the `onCanvasMouseDown` handler, right before `didMouseMoveWhileDownRef.current = false;`. 

This establishes the proper state machine:
- When mouse button is pressed down on canvas: `isMouseDownRef.current` becomes `true`
- When mouse moves while down: `didMouseMoveWhileDownRef.current` becomes `true` 
- When mouse is released: `isMouseDownRef.current` becomes `false`
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
Perfect. The fix has been applied successfully. The missing statement has been restored:

```javascript
const ignored = symbolicatedCallSite !== null ? symbolicatedCallSite.ignored : false;
```

This statement was deleted and needed to be restored at line 53 (previously around line 61 based on the original count). The statement:
- Defines the `ignored` variable that's referenced in the className logic on line 63
- Extracts the `ignored` property from `symbolicatedCallSite` when it's not null
...
```

**Diff (expected vs actual):**
```diff
@@ -49 @@
   );
   const [functionName, url, line, column] =
     symbolicatedCallSite !== null ? symbolicatedCallSite.location : callSite;
+
   const ignored = symbolicatedCallSite !== null ? symbolicatedCallSite.ignored : false;
   const ignored = symbolicatedCallSite !== null ? symbolicatedCallSite.ignored : false;
+
   // TODO: Make an option to be able to toggle the display of ignore listed rows.
   // Ideally this UI should be higher than a single Stack Trace so that there's not
   // multiple buttons in a single inspection taking up space.
```

### Structural Remove Early Return 003 (ReactDOMComponentTree.js) — 0/1

**All runs failed with same error:** File mismatch for ReactDOMComponentTree.js

**Sample agent response (run 1):**
```
Perfect! The guard clause has been added. The fix adds a check for `targetFiber` after it's retrieved, and returns it early if it exists. This prevents the code from continuing unnecessarily when a valid fiber has already been found, and ensures that the hydration instance boundary search returns the correct fiber when found.

The change is minimal and surgical:
- Added 3 lines: the `if (targetFiber) {` check, `return targetFiber;`, and the closing `}`
- No other code was modified
- The logic...
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
           if (targetFiber) {
             return targetFiber;
           }
+
           // If we don't find a Fiber on the comment, it might be because
           // we haven't gotten to hydrate it yet. There might still be a
           // parent boundary that hasn't above this one so we need to find
```

### Structural Remove Early Return 005 (TabBar.js) — 0/1

**All runs failed with same error:** File mismatch for TabBar.js

**Sample agent response (run 1):**
```
Perfect. The guard clause has been successfully restored. The fix:
- Adds a 3-line guard clause pattern (if condition, return statement, closing brace) at lines 92-94
- Checks if `tab` is null and returns null early before destructuring
- Preserves all other code structure and formatting
- Only modifies the specific location mentioned in the task

The bug is fixed.
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
Perfect! The guard clause has been added. The `else { continue; }` block now ensures that if the condition `operations != null && index < operations.length` is false during the initial (index === 0) iteration, the code will skip to the next iteration instead of proceeding with an uninitialized `commitTree`. This fixes the bug where the guard clause was removed.
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
@@ -104 @@
         }
 
         commitTrees.push(commitTree);
+      } else {
+        continue;
       }
     } else {
       const previousCommitTree = commitTrees[index - 1];
```

### Structural Swap Adjacent Lines 007 (ReactFlightClientConfigBundlerWebpack.js) — 0/1

**All runs failed with same error:** File mismatch for ReactFlightClientConfigBundlerWebpack.js

**Sample agent response (run 1):**
```
Perfect. The fix is complete. The two adjacent statements at lines 190-191 have been reordered correctly:
- Line 190: `chunkCache.set(chunkId, thenable);` now comes first
- Line 191: `thenable.then(resolve, ignoreReject);` now comes second

This ensures the thenable is cached before any handlers are attached, eliminating the race condition.
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

**All runs failed with same error:** Timeout waiting for response to set_thinking_level. Stderr: 

### Structural Swap If Else 003 (ReactDOMFloat.js) — 0/1

**All runs failed with same error:** File mismatch for ReactDOMFloat.js

**Sample agent response (run 1):**
```
Perfect. The fix is complete. The if and else branches in the `preinitModule` function's __DEV__ block have been swapped correctly:

- **Before**: If `encountered` was truthy, it ran the switch statement; otherwise it showed the error
- **After**: If `encountered` is truthy, it shows the error message; otherwise (when there are no errors), it runs the switch statement validation

This is the correct logic—you only validate the `as` type when there are no other errors in the input arguments.
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

### Structural Swap If Else 005 (ReactClientConsoleConfigPlain.js) — 0/1

**All runs failed with same error:** Timeout waiting for response to set_thinking_level. Stderr: 
