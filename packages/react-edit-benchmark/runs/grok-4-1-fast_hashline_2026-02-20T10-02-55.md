# Edit Benchmark Report

## Configuration

| Setting | Value |
|---------|-------|
| Date | 2026-02-20T09:58:58.663Z |
| Model | xai/xai/grok-4-1-fast |
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
| Edit Tool Usage Rate | 100.0% (80/80) |
| **Edit Success Rate** | **97.7%** |
| Timeout Runs | 0 |
| Mutation Intent Match Rate | 78.8% |
| Patch Failure Rate | 2.3% (2/86) |
| Tasks All Passing | 62 |
| Tasks Flaky/Failing | 18 |

### Tool Calls

| Tool | Total | Avg/Run |
|------|-------|---------|
| Read | 167 | 2.1 |
| Edit | 86 | 1.1 |
| Write | 0 | 0.0 |
| **Tool Input Chars** | 21,681 | 271 |

### Tokens & Time

| Metric | Total | Avg/Run |
|--------|-------|---------|
| Input Tokens | 718,186 | 8,977 |
| Output Tokens | 281,317 | 3,516 |
| Total Tokens | 3,481,684 | 43,521 |
| Duration | 2824.0s | 35.3s |
| **Avg Indent Score** | — | **0.03** |

## Task Results

| Task | File | Success | Edit Hit | R/E/W | Tokens (In/Out) | Time | Indent |
|------|------|---------|----------|-------|-----------------|------|--------|
| Access Remove Optional Chain 001 | fallbackEvalContext.js | 1/1 ✅ | 100.0% | 2/1/0 | 14,359/1,323 | 17.1s | 0.00 |
| Access Remove Optional Chain 003 | hookNamesCache.js | 1/1 ✅ | 100.0% | 2/1/0 | 10,033/1,831 | 22.9s | 0.00 |
| Access Remove Optional Chain 005 | registerDevToolsEventLogger.js | 1/1 ✅ | 100.0% | 2/1/0 | 9,946/3,824 | 38.1s | 0.00 |
| Access Remove Optional Chain 007 | index.js | 0/1 ❌ | 100.0% | 3/1/0 | 27,816/13,559 | 118.1s | 0.00 |
| Call Swap Call Args 001 | formatConsoleArguments.js | 1/1 ✅ | 100.0% | 2/1/0 | 0/862 | 9.8s | 0.00 |
| Call Swap Call Args 003 | ReactFlightDOMServerBrowser.js | 1/1 ✅ | 100.0% | 2/1/0 | 0/1,182 | 19.7s | 0.00 |
| Call Swap Call Args 005 | ReactNoopPersistent.js | 1/1 ✅ | 100.0% | 2/1/0 | 8,094/2,357 | 22.1s | 0.00 |
| Call Swap Call Args 007 | parseSourceAndMetadata.js | 0/1 ❌ | 100.0% | 2/1/0 | 23,043/1,657 | 17.8s | 0.00 |
| Duplicate Duplicate Line Flip 001 | isCustomElement.js | 1/1 ✅ | 100.0% | 1/1/0 | 6,409/1,117 | 13.8s | 0.00 |
| Duplicate Duplicate Line Flip 003 | ReactFiberDevToolsHook.js | 0/1 ❌ | 100.0% | 2/1/0 | 14,063/3,412 | 34.1s | 0.00 |
| Duplicate Duplicate Line Flip 005 | shallowEqual.js | 1/1 ✅ | 100.0% | 2/1/0 | 7,858/1,098 | 13.4s | 0.00 |
| Duplicate Duplicate Line Flip 007 | ReactDOMEventReplaying.js | 0/1 ❌ | 100.0% | 1/1/0 | 32,469/18,708 | 160.2s | 0.00 |
| Identifier Identifier Multi Edit 001 | Button.js | 1/1 ✅ | 100.0% | 2/1/0 | 0/1,766 | 19.6s | 0.00 |
| Identifier Identifier Multi Edit 003 | ReactFlightDOMClientBrowser.js | 1/1 ✅ | 100.0% | 2/1/0 | 10,722/2,093 | 22.8s | 0.00 |
| Identifier Identifier Multi Edit 005 | githubAPI.js | 1/1 ✅ | 80.0% | 5/5/0 | 18,010/10,304 | 109.8s | 0.00 |
| Identifier Identifier Multi Edit 007 | ReactFiberComponentStack.js | 1/1 ✅ | 100.0% | 3/1/0 | 0/1,676 | 18.9s | 0.00 |
| Import Swap Named Imports 001 | ListApp.js | 1/1 ✅ | 100.0% | 2/1/0 | 8,334/2,022 | 19.9s | 0.00 |
| Import Swap Named Imports 003 | index.js | 1/1 ✅ | 100.0% | 2/1/0 | 14,035/6,305 | 57.7s | 0.00 |
| Import Swap Named Imports 005 | SuspenseScrubber.js | 1/1 ✅ | 100.0% | 2/1/0 | 0/1,860 | 14.5s | 0.00 |
| Import Swap Named Imports 007 | InspectedElement.js | 0/1 ❌ | 100.0% | 2/1/0 | 13,678/4,339 | 44.1s | 0.00 |
| Literal Flip Boolean 001 | ReactDOMLegacyServerImpl.js | 1/1 ✅ | 100.0% | 3/1/0 | 0/4,990 | 31.4s | 0.00 |
| Literal Flip Boolean 003 | ReactProfilerTimer.js | 1/1 ✅ | 100.0% | 2/1/0 | 21,563/2,476 | 22.5s | 0.00 |
| Literal Flip Boolean 005 | OpenInEditorButton.js | 1/1 ✅ | 100.0% | 2/1/0 | 0/1,623 | 18.2s | 0.00 |
| Literal Flip Boolean 007 | Element.js | 1/1 ✅ | 100.0% | 2/1/0 | 15,219/1,304 | 15.8s | 0.00 |
| Literal Off By One 001 | ReactOwnerStackFrames.js | 1/1 ✅ | 100.0% | 2/1/0 | 0/1,806 | 18.2s | 0.00 |
| Literal Off By One 003 | ReactFlightClientConfigBundlerTurbopack.js | 1/1 ✅ | 100.0% | 1/1/0 | 9,582/1,154 | 14.2s | 0.00 |
| Literal Off By One 005 | ContextMenu.js | 1/1 ✅ | 100.0% | 2/1/0 | 0/1,413 | 17.4s | 0.00 |
| Literal Off By One 007 | index.js | 1/1 ✅ | 100.0% | 2/1/0 | 14,674/1,117 | 15.2s | 0.00 |
| Operator Remove Negation 001 | prepareInjection.js | 1/1 ✅ | 100.0% | 2/1/0 | 13,804/1,551 | 20.4s | 0.00 |
| Operator Remove Negation 003 | ReactDOMSelection.js | 1/1 ✅ | 100.0% | 2/1/0 | 13,150/4,963 | 48.6s | 0.00 |
| Operator Remove Negation 005 | ReactDOMContainer.js | 0/1 ❌ | 100.0% | 2/1/0 | 0/11,181 | 109.9s | 0.00 |
| Operator Remove Negation 007 | SelectEventPlugin.js | 1/1 ✅ | 100.0% | 2/1/0 | 7,482/2,086 | 28.0s | 0.00 |
| Operator Swap Arithmetic 001 | formatConsoleArguments.js | 1/1 ✅ | 100.0% | 2/1/0 | 15,749/1,776 | 19.2s | 0.00 |
| Operator Swap Arithmetic 003 | ReactFlightDOMServerBrowser.js | 1/1 ✅ | 100.0% | 2/1/0 | 0/2,084 | 31.7s | 0.00 |
| Operator Swap Arithmetic 005 | ReactFiberConfigWithNoResources.js | 1/1 ✅ | 100.0% | 2/1/0 | 6,680/1,357 | 16.2s | 0.00 |
| Operator Swap Arithmetic 007 | useCanvasInteraction.js | 1/1 ✅ | 100.0% | 2/1/0 | 9,339/1,721 | 19.8s | 0.00 |
| Operator Swap Comparison 001 | useSmartTooltip.js | 1/1 ✅ | 100.0% | 2/1/0 | 0/1,784 | 22.2s | 0.00 |
| Operator Swap Comparison 003 | ReactFlightDOMServerBrowser.js | 1/1 ✅ | 100.0% | 2/1/0 | 12,724/4,780 | 48.9s | 2.00 |
| Operator Swap Comparison 005 | Rectangle.js | 1/1 ✅ | 100.0% | 2/1/0 | 0/1,156 | 10.8s | 0.00 |
| Operator Swap Comparison 007 | ReactFiberTreeReflection.js | 1/1 ✅ | 100.0% | 2/1/0 | 14,927/2,194 | 24.6s | 0.00 |
| Operator Swap Equality 001 | ReactNoopFlightClient.js | 1/1 ✅ | 100.0% | 2/1/0 | 7,807/1,617 | 20.0s | 0.00 |
| Operator Swap Equality 003 | astUtils.js | 1/1 ✅ | 100.0% | 2/1/0 | 0/2,892 | 33.7s | 0.00 |
| Operator Swap Equality 005 | ReactDOMContainer.js | 1/1 ✅ | 100.0% | 2/1/0 | 8,442/2,431 | 26.1s | 0.00 |
| Operator Swap Equality 007 | ReactFlightDOMServerBrowser.js | 1/1 ✅ | 100.0% | 2/1/0 | 0/6,136 | 67.0s | 0.00 |
| Operator Swap Increment Decrement 001 | index.js | 1/1 ✅ | 100.0% | 2/1/0 | 7,311/1,070 | 15.3s | 0.00 |
| Operator Swap Increment Decrement 003 | ReactFlightClientConfigBundlerESM.js | 1/1 ✅ | 100.0% | 2/1/0 | 0/1,478 | 16.4s | 0.00 |
| Operator Swap Increment Decrement 005 | ReactFiberViewTransitionComponent.js | 1/1 ✅ | 100.0% | 2/1/0 | 14,268/1,693 | 18.0s | 0.00 |
| Operator Swap Increment Decrement 007 | ReactFiberConcurrentUpdates.js | 1/1 ✅ | 100.0% | 2/1/0 | 10,713/1,865 | 19.3s | 0.00 |
| Operator Swap Logical 001 | ErrorView.js | 0/1 ❌ | 100.0% | 3/2/0 | 17,543/5,545 | 51.9s | 0.00 |
| Operator Swap Logical 003 | DevTools.js | 1/1 ✅ | 100.0% | 2/1/0 | 16,218/1,401 | 19.4s | 0.00 |
| Operator Swap Logical 005 | UseEffectEvent.js | 1/1 ✅ | 100.0% | 2/1/0 | 0/2,226 | 31.2s | 0.00 |
| Operator Swap Logical 007 | getHookNameForLocation.js | 1/1 ✅ | 100.0% | 2/1/0 | 0/1,120 | 16.7s | 0.00 |
| Operator Swap Nullish 001 | ElementBadges.js | 1/1 ✅ | 100.0% | 2/1/0 | 10,110/3,578 | 32.6s | 0.00 |
| Operator Swap Nullish 003 | ReactComponentStackFrame.js | 1/1 ✅ | 100.0% | 2/1/0 | 11,599/1,981 | 18.9s | 0.00 |
| Operator Swap Nullish 005 | ReactLogo.js | 0/1 ❌ | 100.0% | 2/1/0 | 9,480/3,350 | 33.5s | 0.00 |
| Operator Swap Nullish 007 | SuspenseBreadcrumbs.js | 1/1 ✅ | 100.0% | 2/1/0 | 4,057/2,630 | 30.6s | 0.00 |
| Regex Swap Regex Quantifier 001 | SimpleValues.js | 1/1 ✅ | 100.0% | 2/1/0 | 5,168/1,066 | 15.1s | 0.00 |
| Regex Swap Regex Quantifier 003 | utils.js | 1/1 ✅ | 100.0% | 2/1/0 | 0/8,102 | 98.5s | 0.00 |
| Regex Swap Regex Quantifier 005 | formatWithStyles.js | 1/1 ✅ | 100.0% | 2/1/0 | 0/3,266 | 40.7s | 0.00 |
| Regex Swap Regex Quantifier 007 | RunReactCompiler.ts | 0/1 ❌ | 100.0% | 2/1/0 | 15,418/7,888 | 63.5s | 0.00 |
| Structural Delete Statement 001 | useExtensionComponentsPanelVisibility.js | 0/1 ❌ | 100.0% | 2/1/0 | 14,916/2,102 | 21.2s | 0.00 |
| Structural Delete Statement 003 | useCanvasInteraction.js | 1/1 ✅ | 100.0% | 2/1/0 | 0/3,051 | 27.0s | 0.00 |
| Structural Delete Statement 005 | StackTraceView.js | 0/1 ❌ | 100.0% | 3/1/0 | 0/5,747 | 75.3s | 0.00 |
| Structural Delete Statement 007 | ReactDOMFizzStaticBrowser.js | 1/1 ✅ | 100.0% | 2/1/0 | 13,080/5,607 | 33.8s | 0.00 |
| Structural Remove Early Return 001 | ReactFlightAsyncDispatcher.js | 0/1 ❌ | 100.0% | 2/1/0 | 0/5,019 | 58.3s | 0.00 |
| Structural Remove Early Return 003 | ReactDOMComponentTree.js | 0/1 ❌ | 50.0% | 3/2/0 | 23,863/13,281 | 106.8s | 0.00 |
| Structural Remove Early Return 005 | TabBar.js | 0/1 ❌ | 100.0% | 3/1/0 | 9,573/2,688 | 30.6s | 0.00 |
| Structural Remove Early Return 007 | CommitTreeBuilder.js | 0/1 ❌ | 100.0% | 2/1/0 | 0/8,330 | 44.5s | 0.00 |
| Structural Swap Adjacent Lines 001 | reactPolling.js | 1/1 ✅ | 100.0% | 2/1/0 | 0/1,368 | 11.7s | 0.00 |
| Structural Swap Adjacent Lines 003 | OwnersStack.js | 1/1 ✅ | 100.0% | 2/1/0 | 10,369/1,086 | 12.8s | 0.00 |
| Structural Swap Adjacent Lines 005 | ReactOwnerStackFrames.js | 1/1 ✅ | 100.0% | 2/1/0 | 7,734/1,415 | 15.4s | 0.00 |
| Structural Swap Adjacent Lines 007 | ReactFlightClientConfigBundlerWebpack.js | 0/1 ❌ | 100.0% | 2/1/0 | 23,047/9,057 | 77.9s | 0.00 |
| Structural Swap If Else 001 | utils.js | 0/1 ❌ | 100.0% | 2/1/0 | 17,350/4,243 | 45.1s | 0.00 |
| Structural Swap If Else 003 | ReactDOMFloat.js | 0/1 ❌ | 100.0% | 2/1/0 | 31,736/10,920 | 103.5s | 0.00 |
| Structural Swap If Else 005 | ReactClientConsoleConfigPlain.js | 1/1 ✅ | 100.0% | 2/1/0 | 8,701/2,998 | 31.7s | 0.00 |
| Structural Swap If Else 007 | index.js | 1/1 ✅ | 100.0% | 2/1/0 | 20,895/3,179 | 31.9s | 0.00 |
| Unicode Unicode Hyphen 001 | formatProdErrorMessage.js | 1/1 ✅ | 100.0% | 2/1/0 | 6,833/1,463 | 19.2s | 0.00 |
| Unicode Unicode Hyphen 003 | SourceMapConsumer.js | 1/1 ✅ | 100.0% | 2/1/0 | 0/1,454 | 22.0s | 0.00 |
| Unicode Unicode Hyphen 005 | babel.config.js | 1/1 ✅ | 100.0% | 2/1/0 | 7,214/1,586 | 18.6s | 0.00 |
| Unicode Unicode Hyphen 007 | ReactInternalTestUtils.js | 1/1 ✅ | 100.0% | 2/1/0 | 10,979/1,577 | 21.1s | 0.00 |

## Category Summary

| Category | Runs | Verified | Edit Used | Success | Min/Avg/Max Difficulty |
|----------|------|----------|-----------|---------|------------------------|
| access | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) | 3 / 7.5 / 10 |
| call | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) | 2 / 7.8 / 14 |
| duplicate | 4 | 50.0% (2/4) | 100.0% (4/4) | 50.0% (2/4) | 8 / 11.3 / 17 |
| identifier | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) | 4 / 6.8 / 9 |
| import | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) | 2 / 3.8 / 5 |
| literal | 8 | 100.0% (8/8) | 100.0% (8/8) | 100.0% (8/8) | 3 / 6.9 / 10 |
| operator | 28 | 89.3% (25/28) | 100.0% (28/28) | 89.3% (25/28) | 3 / 6.7 / 10 |
| regex | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) | 2 / 5.8 / 10 |
| structural | 16 | 43.8% (7/16) | 100.0% (16/16) | 43.8% (7/16) | 4 / 8.3 / 13 |
| unicode | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) | 2 / 4.8 / 8 |

## Mutation Summary

| Mutation | Category | Runs | Verified | Edit Used | Success |
|----------|----------|------|----------|-----------|---------|
| delete-statement | structural | 4 | 50.0% (2/4) | 100.0% (4/4) | 50.0% (2/4) |
| duplicate-line-flip | duplicate | 4 | 50.0% (2/4) | 100.0% (4/4) | 50.0% (2/4) |
| flip-boolean | literal | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| identifier-multi-edit | identifier | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| off-by-one | literal | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| remove-early-return | structural | 4 | 0.0% (0/4) | 100.0% (4/4) | 0.0% (0/4) |
| remove-negation | operator | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) |
| remove-optional-chain | access | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) |
| swap-adjacent-lines | structural | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) |
| swap-arithmetic | operator | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| swap-call-args | call | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) |
| swap-comparison | operator | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| swap-equality | operator | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| swap-if-else | structural | 4 | 50.0% (2/4) | 100.0% (4/4) | 50.0% (2/4) |
| swap-increment-decrement | operator | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| swap-logical | operator | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) |
| swap-named-imports | import | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) |
| swap-nullish | operator | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) |
| swap-regex-quantifier | regex | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) |
| unicode-hyphen | unicode | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |

## Difficulty Summary

| Difficulty Score | Runs | Verified | Edit Used | Success |
|------------------|------|----------|-----------|---------|
| 0-2 | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| 3-5 | 24 | 75.0% (18/24) | 100.0% (24/24) | 75.0% (18/24) |
| 6-8 | 27 | 85.2% (23/27) | 100.0% (27/27) | 85.2% (23/27) |
| 9+ | 25 | 68.0% (17/25) | 100.0% (25/25) | 68.0% (17/25) |

## Edit Tool Errors

Failures where the edit tool returned an error or failed to apply the patch.

### Identifier Identifier Multi Edit 005 (githubAPI.js)

#### Run 1

##### Attempt 1

- Path: githubAPI.js
- Operation: —

**Tool error**

```
1 line has changed since last read. Use the updated LINE#ID references shown below (>>> marks changed lines).

    19#HJ:  message = message.replace(/
    20#ZR:
>>> 21#NB:    'is:issue',
    22#MB:    'is:open',
    23#PQ:    'is:public',
```

**Patch args**

```diff
{
  "path": "githubAPI.js",
  "edits": [
    {
      "op": "replace",
      "first": "19#HJ",
      "last": "21#ZR",
      "content": [
        "  message = message.replace(/",
        ""
      ]
    }
  ]
}
```

### Structural Remove Early Return 003 (ReactDOMComponentTree.js)

#### Run 1

##### Attempt 1

- Path: ReactDOMComponentTree.js
- Operation: —

**Tool error**

```
1 line has changed since last read. Use the updated LINE#ID references shown below (>>> marks changed lines).

    184#YS:          const targetFiber = enableInternalInstanceMap
    185#BV:            ? internalInstanceMap.get(hydrationInstance)
>>> 186#HJ:            : // $FlowFixMe[prop-missing]
    187#XW:              hydrationInstance[internalInstanceKey];
    188#ZR:
```

**Patch args**

```diff
{
  "path": "ReactDOMComponentTree.js",
  "edits": [
    {
      "op": "insert",
      "after": "186#XW",
      "content": [
        "          if (targetFiber) {",
        "            return targetFiber;",
        "          }"
      ]
    }
  ]
}
```

## Failed Tasks (0% passing)

### Access Remove Optional Chain 007 (index.js) — 0/1

**All runs failed with same error:** File mismatch for index.js

**Sample agent response (run 1):**
```
**Fix complete.** Verified lines 251, 254 (`bridge?.emit`), and 295 (`bridge?.send`) now use optional chaining. No other changes.
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
 
@@ -248 @@
       });
 
       createdPanel.onShown.addListener(() => {
-        bridge.emit('extensionComponentsPanelShown');
+        bridge?.emit('extensionComponentsPanelShown');
       });
       createdPanel.onHidden.addListener(() => {
       });
       createdPanel.onHidden.addListener(() => {
-        bridge.emit('extensionComponentsPanelHidden');
+        bridge?.emit('extensionComponentsPanelHidden');
       });
     },
   );
@@ -292 @@
       inspectedElementPortalContainer = portal.container;
       if (inspectedElementPortalContainer != null && render) {
         ensureInitialHTMLIsCleared(inspectedElementPortalContainer);
-        bridge.send('syncSelectionFromBuiltinElementsPanel');
+        bridge?.send('syncSelectionFromBuiltinElementsPanel');
 
         render();
         portal.injectStyles(cloneStyleTags);
```

### Call Swap Call Args 007 (parseSourceAndMetadata.js) — 0/1

**All runs failed with same error:** File mismatch for parseSourceAndMetadata.js

**Sample agent response (run 1):**
```
**Fixed.** Swapped `columnNumber` and `lineNumber` arguments in `sourceMapConsumer.originalPositionFor()` call (lines 249-250).

**Verification** (lines 248-251 post-edit):
```
248#SW:      const { column, line, sourceContent, sourceURL } = sourceMapConsumer.originalPositionFor({
249#ST:        lineNumber,
250#BJ:        columnNumber,
251#NW:      });
```

No other changes.
```

**Diff (expected vs actual):**
```diff
@@ -190 @@
       sourceMapConsumer: null,
     };
 
-    locationKeyToHookParsedMetadata.set(locationKey, hookParsedMetadata);
+    locationKeyToHookParsedMetadata.set(hookParsedMetadata, locationKey);
   });
 
   return locationKeyToHookParsedMetadata;
@@ -246 @@
       originalSourceURL = hookSourceAndMetadata.runtimeSourceURL;
     } else {
       const { column, line, sourceContent, sourceURL } = sourceMapConsumer.originalPositionFor({
-        columnNumber,
         lineNumber,
         lineNumber,
+        columnNumber,
       });
       if (sourceContent === null || sourceURL === null) {
         throw Error(
```

### Duplicate Duplicate Line Flip 003 (ReactFiberDevToolsHook.js) — 0/1

**All runs failed with same error:** File mismatch for ReactFiberDevToolsHook.js

**Sample agent response (run 1):**
```
Fix applied: removed extraneous period from format string in line 77 of `ReactFiberDevToolsHook.js`.

Verified by re-reading lines 70-84: console.error now matches other instances exactly. No other changes.
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

### Duplicate Duplicate Line Flip 007 (ReactDOMEventReplaying.js) — 0/1

**All runs failed with same error:** File mismatch for ReactDOMEventReplaying.js

**Sample agent response (run 1):**
```
Fixed: changed `!= null` to `!== null` at line 573. Verified via re-read: only intended token mutated, structure preserved.
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
@@ -570 @@
   // If there's no ownerDocument, then this is the document.
   const root = unblocked.ownerDocument || unblocked;
   const formReplayingQueue: void | FormReplayingQueue = (root: any).$$reactFormReplay;
-  if (formReplayingQueue != null) {
+  if (formReplayingQueue !== null) {
     for (let i = 0; i < formReplayingQueue.length; i += 3) {
       const form: HTMLFormElement = formReplayingQueue[i];
       const submitterOrAction: null | HTMLInputElement | HTMLButtonElement | FormAction =
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
@@ -17 @@
 import ButtonIcon from '../ButtonIcon';
 import Icon from '../Icon';
 import Toggle from '../Toggle';
-import { ElementTypeSuspense, ElementTypeRoot } from 'react-devtools-shared/src/frontend/types';
+import { ElementTypeRoot, ElementTypeSuspense } from 'react-devtools-shared/src/frontend/types';
 import InspectedElementView from './InspectedElementView';
 import { InspectedElementContext } from './InspectedElementContext';
 import { getAlwaysOpenInEditor } from '../../../utils';
```

### Operator Remove Negation 005 (ReactDOMContainer.js) — 0/1

**All runs failed with same error:** File mismatch for ReactDOMContainer.js

**Sample agent response (run 1):**
```
**Fix complete.** Line 16 updated to `!!node &&`, restoring the accidentally removed negation. Verified: function now returns `true` for valid DOM element/document/documentFragment nodes, and qualifying comment nodes when comments are enabled; `false` otherwise. Only intended line touched; formatting preserved.
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

### Operator Swap Logical 001 (ErrorView.js) — 0/1

**All runs failed with same error:** File mismatch for ErrorView.js

**Sample agent response (run 1):**
```
**Fix verified.**

Line 36 updated from `dismissError !== null` to `!!dismissError`, preserving all formatting and structure. Confirmed via re-read: only intended line changed.
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
+          {!!dismissError && (
             <Button className={styles.CloseButton} onClick={dismissError}>
               Dismiss
               <ButtonIcon className={styles.CloseButtonIcon} type="close" />
```

### Operator Swap Nullish 005 (ReactLogo.js) — 0/1

**All runs failed with same error:** File mismatch for ReactLogo.js

**Sample agent response (run 1):**
```
ReactLogo.js line 22: changed ?? to ||. Verified by re-read. Fix complete.
```

**Diff (expected vs actual):**
```diff
@@ -19 @@
   return (
     <svg
       xmlns="http://www.w3.org/2000/svg"
-      className={`${styles.ReactLogo} ${className || ''}`}
+      className=`${styles.ReactLogo} ${className || ''}`
       viewBox="-11.5 -10.23174 23 20.46348"
     >
       <circle cx="0" cy="0" r="2.05" fill="currentColor" />
```

### Regex Swap Regex Quantifier 007 (RunReactCompiler.ts) — 0/1

**All runs failed with same error:** File mismatch for RunReactCompiler.ts

**Sample agent response (run 1):**
```
**Fix applied.** Changed line 154 in `RunReactCompiler.ts` from `/\$FlowFixMe\[([^\]]+)\]/g` to `/\s*\$FlowFixMe\[([^\]]+)\]/g`. This corrects the failure to match `$FlowFixMe` suppressions preceded by whitespace (common after `// `), restoring proper whitespace matching via optional `\s*`. Verified via re-read: only target line modified, structure preserved.
```

**Diff (expected vs actual):**
```diff
@@ -151 @@
   filename: string;
   userOpts: PluginOptions;
 };
-const FLOW_SUPPRESSION_REGEX = /\$FlowFixMe\[([^\]]*)\]/g;
+const FLOW_SUPPRESSION_REGEX = /\s*\$FlowFixMe\[([^\]]+)\]/g;
 
 function getFlowSuppressions(sourceCode: SourceCode): Array<{ line: number; code: string }> {
   const comments = sourceCode.getAllComments();
```

### Structural Delete Statement 001 (useExtensionComponentsPanelVisibility.js) — 0/1

**All runs failed with same error:** File mismatch for useExtensionComponentsPanelVisibility.js

**Sample agent response (run 1):**
```
Fixed. Restored `const [isVisible, setIsVisible] = useState(false);` before `useEffect`. Verified via re-read; no other changes.
```

**Diff (expected vs actual):**
```diff
@@ -13 @@
 // Events that are prefixed with `extension` will only be emitted for the browser extension implementation.
 // For other implementations, this hook will just return constant `true` value.
 export function useExtensionComponentsPanelVisibility(bridge: FrontendBridge): boolean {
-  const [isVisible, setIsVisible] = useState(true);
-
+  const [isVisible, setIsVisible] = useState(false);
   useEffect(() => {
     function onPanelShown() {
       setIsVisible(true);
```

### Structural Delete Statement 005 (StackTraceView.js) — 0/1

**All runs failed with same error:** File mismatch for StackTraceView.js

**Sample agent response (run 1):**
```
Bug fixed. Inserted `const ignored = false;` after `const isBuiltIn = ...`. Region re-read (52-66); `ignored` defined before ternary usage. No other changes.
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
+  const ignored = false;
   return (
     <div
       className={
```

### Structural Remove Early Return 001 (ReactFlightAsyncDispatcher.js) — 0/1

**All runs failed with same error:** File mismatch for ReactFlightAsyncDispatcher.js

**Sample agent response (run 1):**
```
**Fix applied.** Restored guard clause in `resolveCache` at lines 17-19:

```
  if (!request) {
    return new Map();
  }
```

Updated following return to `getCache(request)` (line 20). Verified: exact 3-line pattern, no extra changes, structure/formatting preserved.
```

**Diff (expected vs actual):**
```diff
@@ -14 @@
 
 function resolveCache(): Map<Function, mixed> {
   const request = resolveRequest();
-  if (request) {
-    return getCache(request);
+  if (!request) {
+    return new Map();
   }
   }
-  return new Map();
+  return getCache(request);
 }
 
 export const DefaultAsyncDispatcher: AsyncDispatcher = ({
```

### Structural Remove Early Return 003 (ReactDOMComponentTree.js) — 0/1

**All runs failed with same error:** File mismatch for ReactDOMComponentTree.js

**Sample agent response (run 1):**
```
Fix applied to `ReactDOMComponentTree.js`: restored guard clause `if (targetFiber) { return targetFiber; }` in `getClosestInstanceFromNode` after computing `targetFiber`.

Verified: inserted lines 188#HK–190#PN; surrounding code unchanged.
```

**Diff (expected vs actual):**
```diff
@@ -188 @@
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
Guard clause restored at lines 92-94:

```
        if (!tab) {
          return null;
        }
```

Destructuring now safe. No other changes. Verified via re-read (tags shifted as expected).
```

**Diff (expected vs actual):**
```diff
@@ -89 @@
   return (
     <Fragment>
       {tabs.map((tab) => {
-        if (tab === null) {
-          return <div key="VRule" className={styles.VRule} />;
+        if (!tab) {
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
Fixed. Verified insertion of guard clause at lines 66-68:

```
  if (commitTrees.length > commitIndex) {
    return commitTrees[commitIndex];
  }
```

No other changes.
```

**Diff (expected vs actual):**
```diff
@@ -63 @@
   }
 
   const commitTrees = ((rootToCommitTreeMap.get(rootID): any): Array<CommitTree>);
-  if (commitIndex < commitTrees.length) {
+  if (commitTrees.length > commitIndex) {
     return commitTrees[commitIndex];
   }
 
```

### Structural Swap Adjacent Lines 007 (ReactFlightClientConfigBundlerWebpack.js) — 0/1

**All runs failed with same error:** File mismatch for ReactFlightClientConfigBundlerWebpack.js

**Sample agent response (run 1):**
```
**Fix applied and verified.** The two adjacent statements at lines 190–191 (previously `thenable.then(resolve, ignoreReject);` followed by `chunkCache.set(chunkId, thenable);`) have been swapped. The changed region now reads:

```
189#YJ:      promises.push(thenable);
190#XW:      chunkCache.set(chunkId, thenable);
191#NS:      thenable.then(resolve, ignoreReject);
192#YR:    } else if (entry !== null) {
```

No other lines or files modified.
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
The bug in `utils.js` is fixed. Only the intended lines (24 and 26) were modified by swapping their contents exactly. Verified by re-reading the file.
```

**Diff (expected vs actual):**
```diff
@@ -21 @@
 
     // Check if sourceURL is a correct URL, which has a protocol specified
     if (sourceURL.startsWith('file:///')) {
-      filePath = new URL(sourceURL).pathname;
+      filePath = sourceURL;
     } else if (sourceURL.includes('://')) {
     } else if (sourceURL.includes('://')) {
-      // $FlowFixMe[cannot-resolve-name]
+      filePath = new URL(sourceURL).pathname;
+    } else {
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
@@ -40 @@
           );
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
Fix applied to `ReactDOMFloat.js`: swapped `if (encountered)` and `else` branches in `preinitModule` dev-time validation (lines ~249-272). Confirmed via re-read: errors now trigger only on invalid inputs.
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
