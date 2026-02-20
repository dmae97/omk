# Edit Benchmark Report

## Configuration

| Setting | Value |
|---------|-------|
| Date | 2026-02-20T09:59:17.063Z |
| Model | openrouter/openrouter/minimax/minimax-m2.1 |
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
| Successful Runs | 52 |
| **Task Success Rate** | **65.0% (52/80)** |
| Verified Rate | 65.0% (52/80) |
| Edit Tool Usage Rate | 95.0% (76/80) |
| **Edit Success Rate** | **86.2%** |
| Timeout Runs | 0 |
| Mutation Intent Match Rate | 76.3% |
| Patch Failure Rate | 13.8% (12/87) |
| Tasks All Passing | 52 |
| Tasks Flaky/Failing | 28 |

### Tool Calls

| Tool | Total | Avg/Run |
|------|-------|---------|
| Read | 178 | 2.2 |
| Edit | 87 | 1.1 |
| Write | 1 | 0.0 |
| **Tool Input Chars** | 35,496 | 444 |

### Tokens & Time

| Metric | Total | Avg/Run |
|--------|-------|---------|
| Input Tokens | 3,292,213 | 41,153 |
| Output Tokens | 346,532 | 4,332 |
| Total Tokens | 3,781,209 | 47,265 |
| Duration | 7092.9s | 88.7s |
| **Avg Indent Score** | — | **0.45** |

## Task Results

| Task | File | Success | Edit Hit | R/E/W | Tokens (In/Out) | Time | Indent |
|------|------|---------|----------|-------|-----------------|------|--------|
| Access Remove Optional Chain 001 | fallbackEvalContext.js | 1/1 ✅ | 100.0% | 2/1/0 | 28,055/1,092 | 14.0s | 0.00 |
| Access Remove Optional Chain 003 | hookNamesCache.js | 1/1 ✅ | 33.3% | 6/3/0 | 97,019/2,183 | 60.4s | 8.00 |
| Access Remove Optional Chain 005 | registerDevToolsEventLogger.js | 0/1 ❌ | 100.0% | 1/1/0 | 29,780/9,233 | 215.7s | 0.00 |
| Access Remove Optional Chain 007 | index.js | 1/1 ✅ | 100.0% | 2/1/0 | 51,588/2,470 | 47.2s | 0.00 |
| Call Swap Call Args 001 | formatConsoleArguments.js | 1/1 ✅ | 100.0% | 3/1/0 | 36,711/1,016 | 17.2s | 0.00 |
| Call Swap Call Args 003 | ReactFlightDOMServerBrowser.js | 1/1 ✅ | 100.0% | 2/1/0 | 34,940/1,261 | 15.7s | 0.00 |
| Call Swap Call Args 005 | ReactNoopPersistent.js | 1/1 ✅ | 100.0% | 2/1/0 | 29,308/1,840 | 26.9s | 0.00 |
| Call Swap Call Args 007 | parseSourceAndMetadata.js | 1/1 ✅ | 50.0% | 3/2/0 | 65,451/1,563 | 68.2s | 0.00 |
| Duplicate Duplicate Line Flip 001 | isCustomElement.js | 1/1 ✅ | 100.0% | 2/1/0 | 28,001/1,094 | 26.6s | 0.00 |
| Duplicate Duplicate Line Flip 003 | ReactFiberDevToolsHook.js | 0/1 ❌ | 100.0% | 0/0/0 | 0/0 | 360.0s | 0.00 |
| Duplicate Duplicate Line Flip 005 | shallowEqual.js | 1/1 ✅ | 100.0% | 2/1/0 | 28,785/1,505 | 30.7s | 0.00 |
| Duplicate Duplicate Line Flip 007 | ReactDOMEventReplaying.js | 1/1 ✅ | 100.0% | 3/1/0 | 66,273/1,883 | 31.9s | 0.00 |
| Identifier Identifier Multi Edit 001 | Button.js | 0/1 ❌ | 100.0% | 2/1/0 | 27,832/893 | 43.1s | 0.00 |
| Identifier Identifier Multi Edit 003 | ReactFlightDOMClientBrowser.js | 1/1 ✅ | 100.0% | 2/1/0 | 34,816/1,106 | 17.1s | 0.00 |
| Identifier Identifier Multi Edit 005 | githubAPI.js | 1/1 ✅ | 100.0% | 2/1/0 | 20,350/988 | 17.3s | 0.00 |
| Identifier Identifier Multi Edit 007 | ReactFiberComponentStack.js | 1/1 ✅ | 100.0% | 2/1/0 | 34,233/1,150 | 22.4s | 0.00 |
| Import Swap Named Imports 001 | ListApp.js | 1/1 ✅ | 100.0% | 2/1/0 | 28,946/1,337 | 27.3s | 0.00 |
| Import Swap Named Imports 003 | index.js | 1/1 ✅ | 100.0% | 2/1/0 | 35,299/3,354 | 55.3s | 0.00 |
| Import Swap Named Imports 005 | SuspenseScrubber.js | 1/1 ✅ | 100.0% | 2/1/0 | 31,763/1,873 | 22.9s | 0.00 |
| Import Swap Named Imports 007 | InspectedElement.js | 0/1 ❌ | 100.0% | 1/1/0 | 30,309/43,408 | 316.8s | 0.00 |
| Literal Flip Boolean 001 | ReactDOMLegacyServerImpl.js | 0/1 ❌ | 100.0% | 6/1/0 | 122,150/20,077 | 199.4s | 0.00 |
| Literal Flip Boolean 003 | ReactProfilerTimer.js | 0/1 ❌ | 100.0% | 1/1/0 | 53,121/11,412 | 237.4s | 0.00 |
| Literal Flip Boolean 005 | OpenInEditorButton.js | 1/1 ✅ | 100.0% | 2/1/0 | 34,815/8,211 | 87.2s | 0.00 |
| Literal Flip Boolean 007 | Element.js | 1/1 ✅ | 100.0% | 2/1/0 | 36,214/1,680 | 17.5s | 0.00 |
| Literal Off By One 001 | ReactOwnerStackFrames.js | 1/1 ✅ | 100.0% | 2/1/0 | 28,364/942 | 25.2s | 0.00 |
| Literal Off By One 003 | ReactFlightClientConfigBundlerTurbopack.js | 1/1 ✅ | 100.0% | 2/1/0 | 36,201/1,386 | 16.2s | 0.00 |
| Literal Off By One 005 | ContextMenu.js | 1/1 ✅ | 100.0% | 2/1/0 | 31,038/1,729 | 57.6s | 0.00 |
| Literal Off By One 007 | index.js | 1/1 ✅ | 100.0% | 2/1/0 | 50,511/1,539 | 46.7s | 0.00 |
| Operator Remove Negation 001 | prepareInjection.js | 1/1 ✅ | 100.0% | 2/1/0 | 29,550/2,128 | 22.8s | 0.00 |
| Operator Remove Negation 003 | ReactDOMSelection.js | 1/1 ✅ | 50.0% | 2/2/0 | 63,565/11,884 | 237.2s | 0.00 |
| Operator Remove Negation 005 | ReactDOMContainer.js | 0/1 ❌ | 100.0% | 1/1/0 | 37,340/6,216 | 318.5s | 0.00 |
| Operator Remove Negation 007 | SelectEventPlugin.js | 1/1 ✅ | 100.0% | 2/1/0 | 39,581/9,215 | 80.8s | 0.00 |
| Operator Swap Arithmetic 001 | formatConsoleArguments.js | 1/1 ✅ | 100.0% | 2/1/0 | 28,907/1,264 | 27.4s | 0.00 |
| Operator Swap Arithmetic 003 | ReactFlightDOMServerBrowser.js | 1/1 ✅ | 100.0% | 2/1/0 | 36,520/3,248 | 54.2s | 0.00 |
| Operator Swap Arithmetic 005 | ReactFiberConfigWithNoResources.js | 1/1 ✅ | 50.0% | 2/2/0 | 36,643/2,203 | 83.5s | 0.00 |
| Operator Swap Arithmetic 007 | useCanvasInteraction.js | 1/1 ✅ | 100.0% | 2/1/0 | 36,662/4,503 | 52.3s | 0.00 |
| Operator Swap Comparison 001 | useSmartTooltip.js | 0/1 ❌ | 100.0% | 0/0/0 | 0/0 | 360.0s | 0.00 |
| Operator Swap Comparison 003 | ReactFlightDOMServerBrowser.js | 0/1 ❌ | 100.0% | 1/1/0 | 38,765/12,851 | 256.1s | 2.00 |
| Operator Swap Comparison 005 | Rectangle.js | 1/1 ✅ | 100.0% | 2/1/0 | 32,614/3,257 | 34.4s | 0.00 |
| Operator Swap Comparison 007 | ReactFiberTreeReflection.js | 1/1 ✅ | 100.0% | 2/1/0 | 48,831/2,560 | 97.6s | 0.00 |
| Operator Swap Equality 001 | ReactNoopFlightClient.js | 1/1 ✅ | 100.0% | 2/1/0 | 32,240/3,256 | 90.9s | 0.00 |
| Operator Swap Equality 003 | astUtils.js | 1/1 ✅ | 50.0% | 5/2/0 | 128,344/8,399 | 65.8s | 0.00 |
| Operator Swap Equality 005 | ReactDOMContainer.js | 1/1 ✅ | 100.0% | 2/1/0 | 28,954/2,611 | 47.9s | 0.00 |
| Operator Swap Equality 007 | ReactFlightDOMServerBrowser.js | 1/1 ✅ | 100.0% | 2/1/0 | 36,073/3,011 | 48.4s | 0.00 |
| Operator Swap Increment Decrement 001 | index.js | 1/1 ✅ | 100.0% | 2/1/0 | 28,047/961 | 46.8s | 0.00 |
| Operator Swap Increment Decrement 003 | ReactFlightClientConfigBundlerESM.js | 1/1 ✅ | 100.0% | 2/1/0 | 33,679/876 | 14.3s | 6.00 |
| Operator Swap Increment Decrement 005 | ReactFiberViewTransitionComponent.js | 1/1 ✅ | 100.0% | 2/1/0 | 31,226/2,168 | 21.0s | 2.00 |
| Operator Swap Increment Decrement 007 | ReactFiberConcurrentUpdates.js | 1/1 ✅ | 100.0% | 2/1/0 | 38,682/2,831 | 27.0s | 0.00 |
| Operator Swap Logical 001 | ErrorView.js | 0/1 ❌ | 100.0% | 2/1/0 | 30,069/3,040 | 52.8s | 0.00 |
| Operator Swap Logical 003 | DevTools.js | 1/1 ✅ | 100.0% | 2/1/0 | 40,372/1,708 | 24.9s | 6.00 |
| Operator Swap Logical 005 | UseEffectEvent.js | 0/1 ❌ | 100.0% | 2/1/0 | 27,927/4,637 | 70.4s | 0.00 |
| Operator Swap Logical 007 | getHookNameForLocation.js | 0/1 ❌ | 100.0% | 2/1/0 | 38,074/3,181 | 91.0s | 0.00 |
| Operator Swap Nullish 001 | ElementBadges.js | 0/1 ❌ | 100.0% | 2/1/0 | 6,892/953 | 13.5s | 0.00 |
| Operator Swap Nullish 003 | ReactComponentStackFrame.js | 1/1 ✅ | 100.0% | 2/1/0 | 38,192/1,478 | 17.4s | 0.00 |
| Operator Swap Nullish 005 | ReactLogo.js | 1/1 ✅ | 100.0% | 2/1/0 | 29,929/3,430 | 53.5s | 0.00 |
| Operator Swap Nullish 007 | SuspenseBreadcrumbs.js | 0/1 ❌ | 50.0% | 6/2/0 | 151,668/17,633 | 301.7s | 0.00 |
| Regex Swap Regex Quantifier 001 | SimpleValues.js | 1/1 ✅ | 100.0% | 2/1/0 | 28,208/1,308 | 35.5s | 8.00 |
| Regex Swap Regex Quantifier 003 | utils.js | 1/1 ✅ | 100.0% | 2/1/0 | 72,092/23,542 | 213.1s | 0.00 |
| Regex Swap Regex Quantifier 005 | formatWithStyles.js | 1/1 ✅ | 100.0% | 2/1/0 | 31,341/3,170 | 31.6s | 0.00 |
| Regex Swap Regex Quantifier 007 | RunReactCompiler.ts | 0/1 ❌ | 0.0% | 2/2/0 | 40,970/11,900 | 319.3s | 0.00 |
| Structural Delete Statement 001 | useExtensionComponentsPanelVisibility.js | 1/1 ✅ | 100.0% | 2/1/0 | 28,380/1,414 | 36.7s | 0.00 |
| Structural Delete Statement 003 | useCanvasInteraction.js | 1/1 ✅ | 50.0% | 3/2/0 | 55,366/1,905 | 25.3s | 0.00 |
| Structural Delete Statement 005 | StackTraceView.js | 0/1 ❌ | 100.0% | 0/0/0 | 0/0 | 360.0s | 0.00 |
| Structural Delete Statement 007 | ReactDOMFizzStaticBrowser.js | 0/1 ❌ | 100.0% | 0/0/0 | 0/0 | 360.0s | 0.00 |
| Structural Remove Early Return 001 | ReactFlightAsyncDispatcher.js | 0/1 ❌ | 100.0% | 2/1/0 | 29,064/1,748 | 33.9s | 2.00 |
| Structural Remove Early Return 003 | ReactDOMComponentTree.js | 0/1 ❌ | 50.0% | 5/2/0 | 97,621/4,223 | 49.3s | 0.00 |
| Structural Remove Early Return 005 | TabBar.js | 0/1 ❌ | 100.0% | 2/1/0 | 34,574/5,578 | 53.3s | 0.00 |
| Structural Remove Early Return 007 | CommitTreeBuilder.js | 0/1 ❌ | 100.0% | 2/1/0 | 46,220/4,134 | 93.8s | 0.00 |
| Structural Swap Adjacent Lines 001 | reactPolling.js | 0/1 ❌ | 100.0% | 2/1/0 | 30,286/1,488 | 49.6s | 0.00 |
| Structural Swap Adjacent Lines 003 | OwnersStack.js | 1/1 ✅ | 100.0% | 2/1/0 | 17,046/1,077 | 12.5s | 0.00 |
| Structural Swap Adjacent Lines 005 | ReactOwnerStackFrames.js | 0/1 ❌ | 100.0% | 8/1/0 | 109,655/16,344 | 222.0s | 0.00 |
| Structural Swap Adjacent Lines 007 | ReactFlightClientConfigBundlerWebpack.js | 0/1 ❌ | 50.0% | 5/2/0 | 89,563/4,736 | 97.6s | 0.00 |
| Structural Swap If Else 001 | utils.js | 0/1 ❌ | 100.0% | 2/1/1 | 63,020/6,067 | 204.8s | 0.00 |
| Structural Swap If Else 003 | ReactDOMFloat.js | 0/1 ❌ | 100.0% | 2/1/0 | 43,659/4,768 | 41.7s | 0.00 |
| Structural Swap If Else 005 | ReactClientConsoleConfigPlain.js | 1/1 ✅ | 100.0% | 2/1/0 | 29,338/1,780 | 31.7s | 0.00 |
| Structural Swap If Else 007 | index.js | 1/1 ✅ | 100.0% | 2/1/0 | 36,438/1,865 | 19.8s | 0.00 |
| Unicode Unicode Hyphen 001 | formatProdErrorMessage.js | 0/1 ❌ | 100.0% | 2/1/0 | 27,692/958 | 27.9s | 0.00 |
| Unicode Unicode Hyphen 003 | SourceMapConsumer.js | 1/1 ✅ | 100.0% | 2/1/0 | 33,970/1,044 | 14.4s | 0.00 |
| Unicode Unicode Hyphen 005 | babel.config.js | 1/1 ✅ | 100.0% | 2/1/0 | 28,350/978 | 11.5s | 0.00 |
| Unicode Unicode Hyphen 007 | ReactInternalTestUtils.js | 0/1 ❌ | 100.0% | 2/1/0 | 38,141/778 | 11.8s | 0.00 |

## Category Summary

| Category | Runs | Verified | Edit Used | Success | Min/Avg/Max Difficulty |
|----------|------|----------|-----------|---------|------------------------|
| access | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) | 3 / 7.5 / 10 |
| call | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) | 2 / 7.8 / 14 |
| duplicate | 4 | 75.0% (3/4) | 75.0% (3/4) | 75.0% (3/4) | 8 / 11.3 / 17 |
| identifier | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) | 4 / 6.8 / 9 |
| import | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) | 2 / 3.8 / 5 |
| literal | 8 | 75.0% (6/8) | 100.0% (8/8) | 75.0% (6/8) | 3 / 6.9 / 10 |
| operator | 28 | 71.4% (20/28) | 96.4% (27/28) | 71.4% (20/28) | 3 / 6.7 / 10 |
| regex | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) | 2 / 5.8 / 10 |
| structural | 16 | 31.3% (5/16) | 87.5% (14/16) | 31.3% (5/16) | 4 / 8.3 / 13 |
| unicode | 4 | 50.0% (2/4) | 100.0% (4/4) | 50.0% (2/4) | 2 / 4.8 / 8 |

## Mutation Summary

| Mutation | Category | Runs | Verified | Edit Used | Success |
|----------|----------|------|----------|-----------|---------|
| delete-statement | structural | 4 | 50.0% (2/4) | 50.0% (2/4) | 50.0% (2/4) |
| duplicate-line-flip | duplicate | 4 | 75.0% (3/4) | 75.0% (3/4) | 75.0% (3/4) |
| flip-boolean | literal | 4 | 50.0% (2/4) | 100.0% (4/4) | 50.0% (2/4) |
| identifier-multi-edit | identifier | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) |
| off-by-one | literal | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| remove-early-return | structural | 4 | 0.0% (0/4) | 100.0% (4/4) | 0.0% (0/4) |
| remove-negation | operator | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) |
| remove-optional-chain | access | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) |
| swap-adjacent-lines | structural | 4 | 25.0% (1/4) | 100.0% (4/4) | 25.0% (1/4) |
| swap-arithmetic | operator | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| swap-call-args | call | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| swap-comparison | operator | 4 | 50.0% (2/4) | 75.0% (3/4) | 50.0% (2/4) |
| swap-equality | operator | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| swap-if-else | structural | 4 | 50.0% (2/4) | 100.0% (4/4) | 50.0% (2/4) |
| swap-increment-decrement | operator | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| swap-logical | operator | 4 | 25.0% (1/4) | 100.0% (4/4) | 25.0% (1/4) |
| swap-named-imports | import | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) |
| swap-nullish | operator | 4 | 50.0% (2/4) | 100.0% (4/4) | 50.0% (2/4) |
| swap-regex-quantifier | regex | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) |
| unicode-hyphen | unicode | 4 | 50.0% (2/4) | 100.0% (4/4) | 50.0% (2/4) |

## Difficulty Summary

| Difficulty Score | Runs | Verified | Edit Used | Success |
|------------------|------|----------|-----------|---------|
| 0-2 | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| 3-5 | 24 | 62.5% (15/24) | 91.7% (22/24) | 62.5% (15/24) |
| 6-8 | 27 | 59.3% (16/27) | 100.0% (27/27) | 59.3% (16/27) |
| 9+ | 25 | 68.0% (17/25) | 92.0% (23/25) | 68.0% (17/25) |

## Edit Tool Errors

Failures where the edit tool returned an error or failed to apply the patch.

### Access Remove Optional Chain 003 (hookNamesCache.js)

#### Run 1

##### Attempt 1

- Path: /tmp/rb-f3f09572-601c-439c-8ab5-eeb3a7f73908/b1475edf04ca152ae/hookNamesCache.js
- Operation: —

**Tool error**

```
1 line has changed since last read. Use the updated LINE#ID references shown below (>>> marks changed lines).

    130#TB:        duration_ms: durationMs,
    131#JY:        inspected_element_display_name: element.displayName,
>>> 132#YY:        inspected_element_number_of_hooks: resolvedHookNames.size ?? null,
    133#NW:      });
    134#TK:    };
```

**Patch args**

```diff
{
  "path": "/tmp/rb-f3f09572-601c-439c-8ab5-eeb3a7f73908/b1475edf04ca152ae/hookNamesCache.js",
  "edits": [
    {
      "op": "set",
      "tag": "132#NW",
      "content": [
        "inspected_element_number_of_hooks: resolvedHookNames?.size ?? null,"
      ]
    }
  ]
}
```

##### Attempt 2

- Path: /tmp/rb-f3f09572-601c-439c-8ab5-eeb3a7f73908/b1475edf04ca152ae/hookNamesCache.js
- Operation: —

**Tool error**

```
1 line has changed since last read. Use the updated LINE#ID references shown below (>>> marks changed lines).

    130#TB:        duration_ms: durationMs,
    131#JY:        inspected_element_display_name: element.displayName,
>>> 132#TP:inspected_element_number_of_hooks: resolvedHookNames?.size ?? null,
    133#NW:      });
    134#TK:    };
```

**Patch args**

```diff
{
  "path": "/tmp/rb-f3f09572-601c-439c-8ab5-eeb3a7f73908/b1475edf04ca152ae/hookNamesCache.js",
  "edits": [
    {
      "op": "set",
      "tag": "132#YY",
      "content": [
        "inspected_element_number_of_hooks: resolvedHookNames?.size ?? null,"
      ]
    }
  ]
}
```

### Call Swap Call Args 007 (parseSourceAndMetadata.js)

#### Run 1

##### Attempt 1

- Path: parseSourceAndMetadata.js
- Operation: —

**Tool error**

```
1 line has changed since last read. Use the updated LINE#ID references shown below (>>> marks changed lines).

    191#TK:    };
    192#ZR:
>>> 193#WY:    locationKeyToHookParsedMetadata.set(hookParsedMetadata, locationKey);
    194#NW:  });
    195#ZR:
```

**Patch args**

```diff
{
  "path": "parseSourceAndMetadata.js",
  "edits": [
    {
      "op": "set",
      "tag": "193#NW",
      "content": [
        "    locationKeyToHookParsedMetadata.set(locationKey, hookParsedMetadata);"
      ]
    }
  ]
}
```

### Operator Remove Negation 003 (ReactDOMSelection.js)

#### Run 1

##### Attempt 1

- Path: /tmp/rb-f3f09572-601c-439c-8ab5-eeb3a7f73908/b1475ecc62c615262/ReactDOMSelection.js
- Operation: —

**Tool error**

```
1 line has changed since last read. Use the updated LINE#ID references shown below (>>> marks changed lines).

    157#XW:  // IE 11 uses modern selection, but doesn't support the extend method.
    158#VS:  // Flip backward selections, so we can set with a single range.
>>> 159#VT:  if (selection.extend && start > end) {
    160#HM:    const temp = end;
    161#MP:    end = start;
```

**Patch args**

```diff
{
  "path": "/tmp/rb-f3f09572-601c-439c-8ab5-eeb3a7f73908/b1475ecc62c615262/ReactDOMSelection.js",
  "edits": [
    {
      "op": "set",
      "tag": "159#HM",
      "content": "  if (!selection.extend && start > end) {"
    }
  ]
}
```

### Operator Swap Arithmetic 005 (ReactFiberConfigWithNoResources.js)

#### Run 1

##### Attempt 1

- Path: ReactFiberConfigWithNoResources.js
- Operation: —

**Tool error**

```
Invalid line reference "RN". Expected format "LINE#ID" (e.g. "5#aa").
```

**Patch args**

```diff
{
  "path": "ReactFiberConfigWithNoResources.js",
  "edits": [
    {
      "op": "set",
      "tag": "RN",
      "content": "      'This error is likely caused by a bug in React. ' +"
    }
  ]
}
```

### Operator Swap Equality 003 (astUtils.js)

#### Run 1

##### Attempt 1

- Path: astUtils.js
- Operation: —

**Tool error**

```
1 line has changed since last read. Use the updated LINE#ID references shown below (>>> marks changed lines).

    481#KT:// We consider hooks to be a hook name identifier or a member expression containing a hook name.
    482#TW:function isHook(node: Node): boolean {
>>> 483#HJ:  if (node.type !== AST_NODE_TYPES.IDENTIFIER) {
    484#JS:    return isHookName(node.name);
    485#YY:  } else if (
```

**Patch args**

```diff
{
  "path": "astUtils.js",
  "edits": [
    {
      "op": "set",
      "tag": "483#JS",
      "content": "  if (node.type === AST_NODE_TYPES.IDENTIFIER) {"
    }
  ]
}
```

### Operator Swap Nullish 007 (SuspenseBreadcrumbs.js)

#### Run 1

##### Attempt 1

- Path: SuspenseBreadcrumbs.js
- Operation: —

**Tool error**

```
1 line has changed since last read. Use the updated LINE#ID references shown below (>>> marks changed lines).

    147#QT:            selectElement={onItemClick}
    148#NY:          />
>>> 149#BV:          {selectedSuspenseNode != null && (
    150#JJ:            <button
    151#KP:              className={styles.SuspenseBreadcrumbsButton}
```

**Patch args**

```diff
{
  "path": "SuspenseBreadcrumbs.js",
  "edits": [
    {
      "op": "set",
      "tag": "149#JJ",
      "content": [
        "            {selectedSuspenseNode != null ? 'Unknown' : selectedSuspenseNode.name ?? 'Unknown'}"
      ]
    }
  ]
}
```

### Regex Swap Regex Quantifier 007 (RunReactCompiler.ts)

#### Run 1

##### Attempt 1

- Path: /tmp/rb-f3f09572-601c-439c-8ab5-eeb3a7f73908/b1475ed1ed4a1527c/RunReactCompiler.ts
- Operation: —

**Tool error**

```
No changes made to /tmp/rb-f3f09572-601c-439c-8ab5-eeb3a7f73908/b1475ed1ed4a1527c/RunReactCompiler.ts. The edits produced identical content.
Edit 0: replacement for 154#RS is identical to current content:
  154#RS| const FLOW_SUPPRESSION_REGEX = /\$FlowFixMe\[([^\]]+)\]/g;
Your content must differ from what the file already contains. Re-read the file to see the current state.
```

**Patch args**

```diff
{
  "path": "/tmp/rb-f3f09572-601c-439c-8ab5-eeb3a7f73908/b1475ed1ed4a1527c/RunReactCompiler.ts",
  "edits": [
    {
      "op": "set",
      "tag": "154#RS",
      "content": "const FLOW_SUPPRESSION_REGEX = /\\$FlowFixMe\\[([^\\]]+)\\]/g;"
    }
  ]
}
```

##### Attempt 2

- Path: /tmp/rb-f3f09572-601c-439c-8ab5-eeb3a7f73908/b1475ed1ed4a1527c/RunReactCompiler.ts
- Operation: —

**Tool error**

```
No changes made to /tmp/rb-f3f09572-601c-439c-8ab5-eeb3a7f73908/b1475ed1ed4a1527c/RunReactCompiler.ts. The edits produced identical content.
Edit 0: replacement for 154#RS is identical to current content:
  154#RS| const FLOW_SUPPRESSION_REGEX = /\$FlowFixMe\[([^\]]+)\]/g;
Your content must differ from what the file already contains. Re-read the file to see the current state.
```

**Patch args**

```diff
{
  "path": "/tmp/rb-f3f09572-601c-439c-8ab5-eeb3a7f73908/b1475ed1ed4a1527c/RunReactCompiler.ts",
  "edits": [
    {
      "content": "const FLOW_SUPPRESSION_REGEX = /\\$FlowFixMe\\[([^\\]]+)\\]/g;",
      "op": "set",
      "tag": "154#RS"
    }
  ]
}
```

### Structural Delete Statement 003 (useCanvasInteraction.js)

#### Run 1

##### Attempt 1

- Path: /tmp/rb-f3f09572-601c-439c-8ab5-eeb3a7f73908/b1475ee3c9de152d8/useCanvasInteraction.js
- Operation: —

**Tool error**

```
No changes made to /tmp/rb-f3f09572-601c-439c-8ab5-eeb3a7f73908/b1475ee3c9de152d8/useCanvasInteraction.js. The edits produced identical content.
Edit 0: replacement for 162#VY is identical to current content:
  162#VY|     const onCanvasMouseDown: MouseEventHandler = (event) => {
Your content must differ from what the file already contains. Re-read the file to see the current state.
The file differs from the original fixture at these lines:
164#PQ|+      isMouseDownRef.current = true;
```

**Patch args**

```diff
{
  "path": "/tmp/rb-f3f09572-601c-439c-8ab5-eeb3a7f73908/b1475ee3c9de152d8/useCanvasInteraction.js",
  "edits": [
    {
      "op": "set",
      "tag": "162#VY",
      "content": "    const onCanvasMouseDown: MouseEventHandler = (event) => {\n      didMouseMoveWhileDownRef.current = false;\n      isMouseDownRef.current = true;"
    }
  ]
}
```

### Structural Remove Early Return 003 (ReactDOMComponentTree.js)

#### Run 1

##### Attempt 1

- Path: /tmp/rb-f3f09572-601c-439c-8ab5-eeb3a7f73908/b1475ed5db6a15286/ReactDOMComponentTree.js
- Operation: —

**Tool error**

```
1 line has changed since last read. Use the updated LINE#ID references shown below (>>> marks changed lines).

    213#KY:  if (enableInternalInstanceMap) {
    214#MB:    inst =
>>> 215#ZQ:      internalInstanceMap.get(((node: any): InstanceUnion)) ||
    216#VJ:      (node: any)[internalContainerInstanceKey];
    217#QM:  } else {
```

**Patch args**

```diff
{
  "path": "/tmp/rb-f3f09572-601c-439c-8ab5-eeb3a7f73908/b1475ed5db6a15286/ReactDOMComponentTree.js",
  "edits": [
    {
      "op": "set",
      "tag": "215#MB",
      "content": [
        "    inst =",
        "      internalInstanceMap.get(((node: any): InstanceUnion)) ||",
        "      (node: any)[internalContainerInstanceKey];",
        "    return;"
      ]
    }
  ]
}
```

### Structural Swap Adjacent Lines 007 (ReactFlightClientConfigBundlerWebpack.js)

#### Run 1

##### Attempt 1

- Path: /tmp/rb-f3f09572-601c-439c-8ab5-eeb3a7f73908/b1475ed900de15292/ReactFlightClientConfigBundlerWebpack.js
- Operation: —

**Tool error**

```
1 line has changed since last read. Use the updated LINE#ID references shown below (>>> marks changed lines).

    189#YJ:      promises.push(thenable);
    190#NS:      thenable.then(resolve, ignoreReject);
>>> 191#XW:      chunkCache.set(chunkId, thenable);
    192#YR:    } else if (entry !== null) {
    193#SQ:      promises.push(entry);
```

**Patch args**

```diff
{
  "path": "/tmp/rb-f3f09572-601c-439c-8ab5-eeb3a7f73908/b1475ed900de15292/ReactFlightClientConfigBundlerWebpack.js",
  "edits": [
    {
      "op": "replace",
      "first": "189#YJ",
      "last": "191#YR",
      "content": [
        "      promises.push(thenable);",
        "      thenable.then(resolve, ignoreReject);",
        "      chunkCache.set(chunkId, thenable);"
      ]
    }
  ]
}
```

## Failed Tasks (0% passing)

### Access Remove Optional Chain 005 (registerDevToolsEventLogger.js) — 0/1

**All runs failed with same error:** File mismatch for registerDevToolsEventLogger.js

**Sample agent response (run 1):**
```
The fix has been applied. I restored the optional chaining operator (`?.`) on the property access `process.env?.DEVTOOLS_VERSION` (line 43).

The change is minimal and targeted: I only added `?` after `process.env` to prevent potential errors if `process.env` is null or undefined when accessing the `DEVTOOLS_VERSION` property.
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

### Duplicate Duplicate Line Flip 003 (ReactFiberDevToolsHook.js) — 0/1

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | — | 0 / 0 | 360.0s |

### Identifier Identifier Multi Edit 001 (Button.js) — 0/1

**All runs failed with same error:** File mismatch for Button.js

**Sample agent response (run 1):**
```
Fixed. Both occurrences of `ubtton` were corrected to `button`:
- Line 40: `{ubtton}` → `{button}`
- Line 43: `return ubtton;` → `return button;`
```

**Diff (expected vs actual):**
```diff
@@ -37 @@
   );
 
   if (title) {
-    button = <Tooltip label={title}>{button}</Tooltip>;
+    <Tooltip label={title}>{button}</Tooltip>;
   }
 
   return button;
```

### Import Swap Named Imports 007 (InspectedElement.js) — 0/1

**All runs failed with same error:** File mismatch for InspectedElement.js

**Sample agent response (run 1):**
```
I made the edit to swap `useSyncExternalStore` and `useContext` in the destructuring import on line 13. The change was:

**Before:**
```javascript
import { useSyncExternalStore, useContext, useCallback } from 'react';
```

**After:**
```javascript
import { useContext, useSyncExternalStore, useCallback } from 'react';
```

This fixes the swapped imports by placing them in the correct order. All usages of `useContext`, `useSyncExternalStore`, and `useCallback` throughout the file remain valid s...
```

**Diff (expected vs actual):**
```diff
@@ -10 @@
 import type { SourceMappedLocation } from 'react-devtools-shared/src/symbolicateSource';
 
 import * as React from 'react';
-import { useCallback, useContext, useSyncExternalStore } from 'react';
+import { useContext, useSyncExternalStore, useCallback } from 'react';
 import { TreeStateContext } from './TreeContext';
 import { BridgeContext, StoreContext, OptionsContext } from '../context';
 import Button from '../Button';
```

### Literal Flip Boolean 001 (ReactDOMLegacyServerImpl.js) — 0/1

**All runs failed with same error:** File mismatch for ReactDOMLegacyServerImpl.js

**Sample agent response (run 1):**
```
The fix has been applied. I changed `return true;` to `return false;` on line 45 (the `return` statement in the `push` method).

**Verification:**
- Line 45 now shows: `return false;` (tag `45#NQ:`)
- All other code remains unchanged
- Only the boolean literal was flipped from `true` to `false`
```

**Diff (expected vs actual):**
```diff
@@ -33 @@
   generateStaticMarkup: boolean,
   abortReason: string,
 ): string {
-  let didFatal = false;
+  let didFatal = true;
   let fatalError = null;
   let result = '';
   const destination = {
@@ -42 @@
       if (chunk !== null) {
         result += chunk;
       }
-      return true;
+      return false;
     },
     // $FlowFixMe[missing-local-annot]
     destroy(error) {
```

### Literal Flip Boolean 003 (ReactProfilerTimer.js) — 0/1

**All runs failed with same error:** File mismatch for ReactProfilerTimer.js

**Sample agent response (run 1):**
```
Fixed. Changed `return false;` to `return true;` in the guard clause of `pushComponentEffectDidSpawnUpdate()` at line 476.

The original code returned `false` when profiler hooks were disabled, but the semantic intent is to indicate "no spawned update occurred" when tracking is disabled - hence the boolean should be `true` (no spawned update happened).
```

**Diff (expected vs actual):**
```diff
@@ -473 @@
 
 export function pushComponentEffectDidSpawnUpdate(): boolean {
   if (!enableProfilerTimer || !enableProfilerCommitHooks) {
-    return false;
+    return true;
   }
 
   const prev = componentEffectSpawnedUpdate;
   }
 
   const prev = componentEffectSpawnedUpdate;
-  componentEffectSpawnedUpdate = false; // Reset.
+  componentEffectSpawnedUpdate = true; // Reset.
   return prev;
 }
 
```

### Operator Remove Negation 005 (ReactDOMContainer.js) — 0/1

**All runs failed with same error:** File mismatch for ReactDOMContainer.js

**Sample agent response (run 1):**
```
Looking at this again, I realize I may have applied the wrong fix. The task explicitly states "The issue is on line 20" and to add back the missing `!`. 

Let me re-examine line 20. Currently it shows `(!disableCommentsAsDOMContainers &&` which has the `!`. But the task says a `!` was removed and needs to be added back.

Wait - I think I misread the task. It says the negation was "removed" and I need to "add back" the missing one. If I look at line 16, it had `!node &&` which I've now changed...
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

### Operator Swap Comparison 001 (useSmartTooltip.js) — 0/1

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | — | 0 / 0 | 360.0s |

### Operator Swap Comparison 003 (ReactFlightDOMServerBrowser.js) — 0/1

**All runs failed with same error:** File mismatch for ReactFlightDOMServerBrowser.js

**Sample agent response (run 1):**
```
The fix has been applied. 

**Change made:**
- Line 77: `i <= messages.length - 1` → `i < messages.length`

**Why this was the bug:**
The original condition `i <= messages.length - 1` is a convoluted way to express "i is less than the length". While functionally equivalent in most cases, it:
1. Performs unnecessary computation (`- 1`)
2. Creates a potential off-by-one confusion point for maintainers
3. Is non-idiomatic

The standard form `i < messages.length` is clearer and avoids any edge-ca...
```

**Diff (expected vs actual):**
```diff
@@ -74 @@
       ? readFinalStringChunk(stringDecoder, new Uint8Array(0))
       : readPartialStringChunk(stringDecoder, buffer);
     const messages = stringBuffer.split('\n');
-    for (let i = 0; i < messages.length - 1; i++) {
+    for (let i = 0; i < messages.length; i++) {
       resolveDebugMessage(request, messages[i]);
     }
     stringBuffer = messages[messages.length - 1];
```

### Operator Swap Logical 001 (ErrorView.js) — 0/1

**All runs failed with same error:** File mismatch for ErrorView.js

**Sample agent response (run 1):**
```
Done. Changed `!==` to `!=` on line 36.
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

### Operator Swap Logical 005 (UseEffectEvent.js) — 0/1

**All runs failed with same error:** File mismatch for UseEffectEvent.js

**Sample agent response (run 1):**
```
The fix has been applied. Line 5 now uses `||` instead of `&&` for the intended fallback behavior.

With `&&`: If `React.useEffectEvent` is truthy, it returns `React.experimental_useEffectEvent` (not the intended value).

With `||`: If `React.useEffectEvent` is truthy, it returns `React.useEffectEvent`. If falsy, it falls back to `React.experimental_useEffectEvent`. This is the correct fallback pattern.
```

**Diff (expected vs actual):**
```diff
 import * as React from 'react';
 
 const { useState, useEffect } = React;
+const useEffectEvent = React.useEffectEvent && React.experimental_useEffectEvent;
 const useEffectEvent = React.useEffectEvent || React.experimental_useEffectEvent;
 const useEffectEvent = React.useEffectEvent || React.experimental_useEffectEvent;
-
 export default function UseEffectEvent(): React.Node {
   return (
     <>
```

### Operator Swap Logical 007 (getHookNameForLocation.js) — 0/1

**All runs failed with same error:** File mismatch for getHookNameForLocation.js

**Sample agent response (run 1):**
```
Fixed. The boolean operator on line 165 was changed from `&&` to `||`.

**The bug:** `location.line > endLine && end == null` - This condition requires both being at the end of mappings AND the target line being beyond the current line. But when `end == null`, `endLine == startLine`, so if `location.line > startLine`, the condition would incorrectly fail.

**The fix:** `location.line > endLine || end == null` - If we're at the end of mappings (`end == null`), the final line should cover the t...
```

**Diff (expected vs actual):**
```diff
@@ -162 @@
   // If we're at the end of the mappings, and the target line is greater
   // than the current line, then this final line must cover the
   // target location, so we return it.
-  if (location.line > endLine && end == null) {
+  if (location.line > endLine || end == null) {
     return { index: endIndex, direction: 0 };
   }
 
@@ -221 @@
   // If we're at the end of the entries for this line, and the target
   // column is greater than the current column, then this final entry
   // must cover the target location, so we return it.
-  if (location.column > endColumn && end == null) {
+  if (location.column > endColumn || end == null) {
     return { index: endIndex, direction: 0 };
   }
 
```

### Operator Swap Nullish 001 (ElementBadges.js) — 0/1

**All runs failed with same error:** File mismatch for ElementBadges.js

**Sample agent response (run 1):**
```
Fixed. Changed `??` to `||` on line 32. The nullish coalescing operator was incorrectly used where a logical OR was intended for the boolean condition.
```

**Diff (expected vs actual):**
```diff
@@ -29 @@
 }: Props): React.Node {
   if (
     !compiledWithForget &&
-    (hocDisplayNames == null || hocDisplayNames.length === 0) &&
+    (hocDisplayNames == null || hocDisplayNames.length === 0)
     environmentName == null
   ) {
     return null;
```

### Operator Swap Nullish 007 (SuspenseBreadcrumbs.js) — 0/1

**All runs failed with same error:** File mismatch for SuspenseBreadcrumbs.js

**Sample agent response (run 1):**
```
The fix has been applied. Line 157 now correctly uses the nullish coalescing operator `??` instead of the logical OR operator `||`:

```javascript
{selectedSuspenseNode === null ? 'Unknown' : selectedSuspenseNode.name ?? 'Unknown'}
```

**Summary of the fix:**
- Changed `||` to `??` on line 157
- This restores the nullish coalescing operator that was incorrectly swapped
- The `??` operator only falls back when the left side is `null` or `undefined`, whereas `||` would also fall back for falsy...
```

**Diff (expected vs actual):**
```diff
@@ -154 @@
               onPointerLeave={onItemPointerLeave}
               type="button"
             >
-              {selectedSuspenseNode === null ? 'Unknown' : selectedSuspenseNode.name || 'Unknown'}
+              {selectedSuspenseNode === null ? 'Unknown' : (selectedSuspenseNode.name ?? 'Unknown')}
             </button>
           )}
         </>
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

### Regex Swap Regex Quantifier 007 (RunReactCompiler.ts) — 0/1

**All runs failed with same error:** File mismatch for RunReactCompiler.ts

**Sample agent response (run 1):**
```
The regex on line 154 is `const FLOW_SUPPRESSION_REGEX = /\$FlowFixMe\[([^\]]+)\]/g;`

This has the `+` quantifier in `[^\]]+`, which is correct. The bug was that a quantifier was swapped - the `+` (one or more) ensures at least one character is matched between the brackets, preventing empty matches like `$FlowFixMe[]` from being captured.

The character class `[^\]]` matches any character except `]`, which includes whitespace. The `+` quantifier ensures the match requires at least one such c...
```

**Diff (expected vs actual):**
```diff
@@ -151 @@
   filename: string;
   userOpts: PluginOptions;
 };
-const FLOW_SUPPRESSION_REGEX = /\$FlowFixMe\[([^\]]*)\]/g;
+const FLOW_SUPPRESSION_REGEX = /\$FlowFixMe\[([^\]]+)\]/g;
 
 function getFlowSuppressions(sourceCode: SourceCode): Array<{ line: number; code: string }> {
   const comments = sourceCode.getAllComments();
```

### Structural Delete Statement 005 (StackTraceView.js) — 0/1

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | — | 0 / 0 | 360.0s |

### Structural Delete Statement 007 (ReactDOMFizzStaticBrowser.js) — 0/1

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | — | 0 / 0 | 360.0s |

### Structural Remove Early Return 001 (ReactFlightAsyncDispatcher.js) — 0/1

**All runs failed with same error:** File mismatch for ReactFlightAsyncDispatcher.js

**Sample agent response (run 1):**
```
The guard clause has been restored. The `resolveCache()` function now contains the 3-line pattern:
- Line 18: `if (!request) {`
- Line 19: `return new Map();`
- Line 20: `}`

This matches the guard pattern used in the `cacheSignal()` function (lines 34-39), which checks if `request` exists and returns early if it doesn't.
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
 }
 
 export const DefaultAsyncDispatcher: AsyncDispatcher = ({
```

### Structural Remove Early Return 003 (ReactDOMComponentTree.js) — 0/1

**All runs failed with same error:** File mismatch for ReactDOMComponentTree.js

**Sample agent response (run 1):**
```
The fix has been applied. Line 217 now has `return;` which restores the guard clause.

**Summary of the change:**
- In `getInstanceFromNode` function, added `return;` after assigning `inst` in the `enableInternalInstanceMap` branch (line 217)
- This matches the pattern used in other functions like `precacheFiberNode`, `updateFiberProps`, and `getFiberCurrentPropsFromNode` where an early return prevents falling through to the shared `if (inst)` logic
```

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
@@ -216 @@
     inst =
       internalInstanceMap.get(((node: any): InstanceUnion)) ||
       (node: any)[internalContainerInstanceKey];
+    return;
   } else {
     inst = (node: any)[internalInstanceKey] || (node: any)[internalContainerInstanceKey];
   }
```

### Structural Remove Early Return 005 (TabBar.js) — 0/1

**All runs failed with same error:** File mismatch for TabBar.js

**Sample agent response (run 1):**
```
The fix is applied correctly. The 3-line guard clause pattern has been restored:

```javascript
if (!tab) {
  return null;
}
```

This guard clause is placed right before the destructuring (line 96) and handles the case where `tab` is null, returning early before attempting to destructure null values.
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
 
         const { icon, id, label, title } = tab;
```

### Structural Remove Early Return 007 (CommitTreeBuilder.js) — 0/1

**All runs failed with same error:** File mismatch for CommitTreeBuilder.js

**Sample agent response (run 1):**
```
The fix has been applied correctly. The guard clause (early return) at line 281 has been restored:

- **Before (buggy):** Empty if-block with `// No-op` comment
- **After (fixed):** `return;` statement - the proper guard clause

The change restores the intended behavior: when removing a node whose parent doesn't exist in the tree, the function now returns early instead of attempting to process a non-existent parent.
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
@@ -281 @@
           nodes.delete(id);
 
           if (!nodes.has(parentID)) {
-            // No-op
+            return;
           } else {
             const parentNode = getClonedNode(parentID);
 
```

### Structural Swap Adjacent Lines 001 (reactPolling.js) — 0/1

**All runs failed with same error:** File mismatch for reactPolling.js

**Sample agent response (run 1):**
```
The fix is complete. The two adjacent lines have been swapped back to their correct order:

- **Before**: `return;` was on line 55, `onSuccess();` was on line 56
- **After**: `onSuccess();` is on line 55, `return;` is on line 56

Now when `pageHasReact` is true, `onSuccess()` will be called before the function returns.
```

**Diff (expected vs actual):**
```diff
@@ -55 @@
           onSuccess();
           return;
         }
+        }
 
         onError(new CouldNotFindReactOnThePageError());
       },
```

### Structural Swap Adjacent Lines 005 (ReactOwnerStackFrames.js) — 0/1

**All runs failed with same error:** File mismatch for ReactOwnerStackFrames.js

**Sample agent response (run 1):**
```
The fix has been applied. The two adjacent lines have been swapped:

**Before (buggy order):**
- Line 15: `Error.prepareStackTrace = prevPrepareStackTrace;`
- Line 16: `Error.prepareStackTrace = DefaultPrepareStackTrace;`

**After (correct order):**
- Line 15: `Error.prepareStackTrace = DefaultPrepareStackTrace;`
- Line 16: `Error.prepareStackTrace = prevPrepareStackTrace;`

Only the two specified lines were swapped - no other changes were made.
```

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
The fix has been applied. The order is now correct:

**Before (buggy):**
```javascript
promises.push(thenable);
thenable.then(resolve, ignoreReject);
chunkCache.set(chunkId, thenable);
```

**After (fixed):**
```javascript
chunkCache.set(chunkId, thenable);
thenable.then(resolve, ignoreReject);
promises.push(thenable);
```

The `chunkCache.set(chunkId, thenable)` now executes immediately after creating the thenable, ensuring the cache is populated before any subsequent code can check it. This...
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
       chunkCache.set(chunkId, thenable);
       chunkCache.set(chunkId, thenable);
+      thenable.then(resolve, ignoreReject);
+      promises.push(thenable);
     } else if (entry !== null) {
       promises.push(entry);
     }
```

### Structural Swap If Else 001 (utils.js) — 0/1

**All runs failed with same error:** File mismatch for utils.js

**Sample agent response (run 1):**
```
The fix is complete. The if and else branches have been swapped:

**Before (buggy):**
- `if (!__IS_INTERNAL_VERSION__)` → returned disabled button
- `else` → internal version logic

**After (fixed):**
- `if (__IS_INTERNAL_VERSION__)` → internal version logic (source map URL processing)
- `else` → returns disabled button for non-internal versions

The structure is now correct - when it's NOT an internal version, the function immediately returns with `shouldDisableButton: true`. When it IS an i...
```

**Diff (expected vs actual):**
```diff
@@ -23 @@
     if (sourceURL.startsWith('file:///')) {
       filePath = new URL(sourceURL).pathname;
     } else if (sourceURL.includes('://')) {
-      // $FlowFixMe[cannot-resolve-name]
-      if (!__IS_INTERNAL_VERSION__) {
-        // In this case, we can't really determine the path to a file, disable a button
-        return { url: null, shouldDisableButton: true };
-      } else {
+      filePath = sourceURL;
+    } else {
+      if (__IS_INTERNAL_VERSION__) {
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
-      }
-    } else {
-      filePath = sourceURL;
+      } else {
+        return {
+          url: null,
+          shouldDisableButton: true,
+        };
     }
 
     const lineNumberAsString = String(line);
```

### Structural Swap If Else 003 (ReactDOMFloat.js) — 0/1

**All runs failed with same error:** File mismatch for ReactDOMFloat.js

**Sample agent response (run 1):**
```
The fix has been applied correctly. The if/else branches are now in the proper order:

- **Lines 249-266**: `if (encountered)` - shows specific type warnings when validation errors are found (invalid 'as' value)
- **Lines 267-272**: `else` - shows the generic "wrong arguments" error when no validation errors exist

The bug was that these branches were swapped: the generic error was being shown when there *were* validation errors, and the type-specific warnings were being attempted when there ...
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
-      const as = options && typeof options.as === 'string' ? options.as : 'script';
-      switch (as) {
-        case 'script': {
-          break;
-        }
-
-        // We have an invalid as type and need to warn
-        default: {
-          const typeOfAs = getValueDescriptorExpectingEnumForWarning(as);
-          console.error(
-            'ReactDOM.preinitModule(): Currently the only supported "as" type for this function is "script"' +
-              ' but received "%s" instead. This warning was generated for `href` "%s". In the future other' +
-              ' module types will be supported, aligning with the import-attributes proposal. Learn more here:' +
-              ' (https://github.com/tc39/proposal-import-attributes)',
-            typeOfAs,
-            href,
-          );
-        }
-      }
-    }
-  }
+NP:    if (encountered) {
+HQ:      const as = options && typeof options.as === 'string' ? options.as : 'script';
+TX:      switch (as) {
+QH:        case 'script': {
+PB:          break;
+PN:        }
+WS:        default: {
+RB:          const typeOfAs = getValueDescriptorExpectingEnumForWarning(as);
+NK:            console.error(
+MY:              'ReactDOM.preinitModule(): Currently the only supported "as" type for this function is "script"' +
+ZB:                ' but received "%s" instead. This warning was generated for `href` "%s". In the future other' +
+XX:                ' module types will be supported, aligning with the import-attributes proposal. Learn more here:' +
+JQ:                ' (https://github.com/tc39/proposal-import-attributes)',
+KV:            typeOfAs,
+TY:            href,
+MJ:            );
+PN:        }
+PN:    ...
```

### Unicode Unicode Hyphen 001 (formatProdErrorMessage.js) — 0/1

**All runs failed with same error:** File mismatch for formatProdErrorMessage.js

**Sample agent response (run 1):**
```
Fixed. Line 24 now uses a plain ASCII hyphen `-` instead of the unicode en-dash `\u2013`.
```

**Diff (expected vs actual):**
```diff
@@ -21 @@
 
   return (
     `Minified React error #${code}; visit ${url} for the full message or ` +
-    'use the non-minified dev environment for full errors and additional ' +
+    'use the non-minified dev environment for full errors and additional '
     'helpful warnings.'
   );
 }
```

### Unicode Unicode Hyphen 007 (ReactInternalTestUtils.js) — 0/1

**All runs failed with same error:** File mismatch for ReactInternalTestUtils.js

**Sample agent response (run 1):**
```
Fixed. Line 9 now uses a regular hyphen (`-`) instead of the Unicode EN DASH (`–`) in the import path `'scheduler–diff'` → `'scheduler-diff'`.
```

**Diff (expected vs actual):**
```diff
@@ -6 @@
  */
 
 import * as SchedulerMock from 'scheduler/unstable_mock';
-import { diff } from 'jest-diff';
+import { diff } from 'scheduler-diff';
 import { equals } from '@jest/expect-utils';
 import enqueueTask from './enqueueTask';
 import simulateBrowserEventDispatch from './simulateBrowserEventDispatch';
```
