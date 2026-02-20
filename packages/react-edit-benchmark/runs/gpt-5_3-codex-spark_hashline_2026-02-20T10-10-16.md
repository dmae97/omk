# Edit Benchmark Report

## Configuration

| Setting | Value |
|---------|-------|
| Date | 2026-02-20T10:06:20.836Z |
| Model | openai-codex/openai-codex/gpt-5.3-codex-spark |
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
| Successful Runs | 63 |
| **Task Success Rate** | **78.8% (63/80)** |
| Verified Rate | 78.8% (63/80) |
| Edit Tool Usage Rate | 100.0% (80/80) |
| **Edit Success Rate** | **86.0%** |
| Timeout Runs | 0 |
| Mutation Intent Match Rate | 82.5% |
| Patch Failure Rate | 14.0% (14/100) |
| Tasks All Passing | 63 |
| Tasks Flaky/Failing | 17 |

### Tool Calls

| Tool | Total | Avg/Run |
|------|-------|---------|
| Read | 240 | 3.0 |
| Edit | 100 | 1.3 |
| Write | 0 | 0.0 |
| **Tool Input Chars** | 37,690 | 471 |

### Tokens & Time

| Metric | Total | Avg/Run |
|--------|-------|---------|
| Input Tokens | 568,433 | 7,105 |
| Output Tokens | 255,078 | 3,188 |
| Total Tokens | 3,639,255 | 45,491 |
| Duration | 721.9s | 9.0s |
| **Avg Indent Score** | — | **0.05** |

## Task Results

| Task | File | Success | Edit Hit | R/E/W | Tokens (In/Out) | Time | Indent |
|------|------|---------|----------|-------|-----------------|------|--------|
| Access Remove Optional Chain 001 | fallbackEvalContext.js | 1/1 ✅ | 100.0% | 2/1/0 | 2,177/427 | 4.7s | 0.00 |
| Access Remove Optional Chain 003 | hookNamesCache.js | 1/1 ✅ | 50.0% | 3/2/0 | 9,439/745 | 5.3s | 0.00 |
| Access Remove Optional Chain 005 | registerDevToolsEventLogger.js | 1/1 ✅ | 100.0% | 6/1/0 | 9,447/6,833 | 14.4s | 0.00 |
| Access Remove Optional Chain 007 | index.js | 1/1 ✅ | 100.0% | 3/1/0 | 12,696/3,267 | 15.9s | 0.00 |
| Call Swap Call Args 001 | formatConsoleArguments.js | 1/1 ✅ | 100.0% | 3/1/0 | 6,980/407 | 5.0s | 0.00 |
| Call Swap Call Args 003 | ReactFlightDOMServerBrowser.js | 1/1 ✅ | 100.0% | 7/1/0 | 13,743/3,270 | 9.5s | 0.00 |
| Call Swap Call Args 005 | ReactNoopPersistent.js | 0/1 ❌ | 100.0% | 2/1/0 | 3,176/561 | 2.6s | 0.00 |
| Call Swap Call Args 007 | parseSourceAndMetadata.js | 1/1 ✅ | 100.0% | 3/1/0 | 11,194/434 | 5.0s | 0.00 |
| Duplicate Duplicate Line Flip 001 | isCustomElement.js | 1/1 ✅ | 100.0% | 2/1/0 | 2,573/556 | 2.8s | 0.00 |
| Duplicate Duplicate Line Flip 003 | ReactFiberDevToolsHook.js | 0/1 ❌ | 100.0% | 2/1/0 | 9,223/2,712 | 6.4s | 0.00 |
| Duplicate Duplicate Line Flip 005 | shallowEqual.js | 1/1 ✅ | 100.0% | 2/1/0 | 6,609/318 | 3.0s | 0.00 |
| Duplicate Duplicate Line Flip 007 | ReactDOMEventReplaying.js | 1/1 ✅ | 100.0% | 2/1/0 | 24,294/15,683 | 34.0s | 0.00 |
| Identifier Identifier Multi Edit 001 | Button.js | 1/1 ✅ | 100.0% | 3/1/0 | 2,382/387 | 4.9s | 0.00 |
| Identifier Identifier Multi Edit 003 | ReactFlightDOMClientBrowser.js | 0/1 ❌ | 100.0% | 2/1/0 | 9,159/614 | 3.1s | 0.00 |
| Identifier Identifier Multi Edit 005 | githubAPI.js | 1/1 ✅ | 100.0% | 2/1/0 | 2,497/493 | 2.8s | 0.00 |
| Identifier Identifier Multi Edit 007 | ReactFiberComponentStack.js | 1/1 ✅ | 100.0% | 5/2/0 | 9,235/1,815 | 5.8s | 0.00 |
| Import Swap Named Imports 001 | ListApp.js | 1/1 ✅ | 100.0% | 2/1/0 | 2,334/439 | 3.0s | 0.00 |
| Import Swap Named Imports 003 | index.js | 1/1 ✅ | 100.0% | 3/1/0 | 5,359/1,504 | 4.5s | 0.00 |
| Import Swap Named Imports 005 | SuspenseScrubber.js | 1/1 ✅ | 100.0% | 3/1/0 | 3,635/576 | 4.9s | 0.00 |
| Import Swap Named Imports 007 | InspectedElement.js | 1/1 ✅ | 100.0% | 5/1/0 | 10,244/4,721 | 11.3s | 0.00 |
| Literal Flip Boolean 001 | ReactDOMLegacyServerImpl.js | 1/1 ✅ | 100.0% | 2/1/0 | 7,439/636 | 4.4s | 0.00 |
| Literal Flip Boolean 003 | ReactProfilerTimer.js | 1/1 ✅ | 100.0% | 3/1/0 | 22,829/8,790 | 13.0s | 0.00 |
| Literal Flip Boolean 005 | OpenInEditorButton.js | 1/1 ✅ | 100.0% | 3/1/0 | 2,557/411 | 3.8s | 0.00 |
| Literal Flip Boolean 007 | Element.js | 1/1 ✅ | 50.0% | 5/2/0 | 7,267/1,580 | 7.6s | 0.00 |
| Literal Off By One 001 | ReactOwnerStackFrames.js | 1/1 ✅ | 100.0% | 2/1/0 | 2,475/460 | 3.1s | 0.00 |
| Literal Off By One 003 | ReactFlightClientConfigBundlerTurbopack.js | 1/1 ✅ | 100.0% | 2/1/0 | 4,646/326 | 2.8s | 0.00 |
| Literal Off By One 005 | ContextMenu.js | 1/1 ✅ | 100.0% | 2/1/0 | 3,099/441 | 3.0s | 0.00 |
| Literal Off By One 007 | index.js | 1/1 ✅ | 100.0% | 2/1/0 | 14,312/575 | 3.4s | 0.00 |
| Operator Remove Negation 001 | prepareInjection.js | 1/1 ✅ | 100.0% | 3/1/0 | 2,497/351 | 7.9s | 0.00 |
| Operator Remove Negation 003 | ReactDOMSelection.js | 1/1 ✅ | 100.0% | 4/1/0 | 13,715/5,495 | 8.5s | 2.00 |
| Operator Remove Negation 005 | ReactDOMContainer.js | 0/1 ❌ | 100.0% | 3/1/0 | 2,877/963 | 3.5s | 0.00 |
| Operator Remove Negation 007 | SelectEventPlugin.js | 1/1 ✅ | 100.0% | 3/1/0 | 4,527/624 | 4.6s | 0.00 |
| Operator Swap Arithmetic 001 | formatConsoleArguments.js | 1/1 ✅ | 100.0% | 2/1/0 | 2,523/384 | 2.7s | 0.00 |
| Operator Swap Arithmetic 003 | ReactFlightDOMServerBrowser.js | 1/1 ✅ | 50.0% | 2/2/0 | 9,795/957 | 5.0s | 0.00 |
| Operator Swap Arithmetic 005 | ReactFiberConfigWithNoResources.js | 1/1 ✅ | 100.0% | 2/1/0 | 2,132/418 | 2.4s | 0.00 |
| Operator Swap Arithmetic 007 | useCanvasInteraction.js | 1/1 ✅ | 100.0% | 3/1/0 | 4,596/449 | 3.9s | 0.00 |
| Operator Swap Comparison 001 | useSmartTooltip.js | 0/1 ❌ | 100.0% | 2/1/0 | 4,180/1,738 | 4.5s | 0.00 |
| Operator Swap Comparison 003 | ReactFlightDOMServerBrowser.js | 1/1 ✅ | 50.0% | 3/2/0 | 6,149/1,134 | 10.5s | 0.00 |
| Operator Swap Comparison 005 | Rectangle.js | 1/1 ✅ | 100.0% | 2/1/0 | 3,283/557 | 6.9s | 0.00 |
| Operator Swap Comparison 007 | ReactFiberTreeReflection.js | 1/1 ✅ | 100.0% | 3/1/0 | 9,167/569 | 3.8s | 0.00 |
| Operator Swap Equality 001 | ReactNoopFlightClient.js | 1/1 ✅ | 100.0% | 2/1/0 | 3,049/319 | 6.2s | 0.00 |
| Operator Swap Equality 003 | astUtils.js | 1/1 ✅ | 100.0% | 3/1/0 | 14,202/569 | 7.0s | 0.00 |
| Operator Swap Equality 005 | ReactDOMContainer.js | 1/1 ✅ | 100.0% | 2/1/0 | 6,739/536 | 5.1s | 0.00 |
| Operator Swap Equality 007 | ReactFlightDOMServerBrowser.js | 1/1 ✅ | 100.0% | 5/1/0 | 8,728/1,194 | 4.9s | 0.00 |
| Operator Swap Increment Decrement 001 | index.js | 1/1 ✅ | 100.0% | 2/1/0 | 2,008/290 | 2.0s | 0.00 |
| Operator Swap Increment Decrement 003 | ReactFlightClientConfigBundlerESM.js | 1/1 ✅ | 50.0% | 2/2/0 | 4,846/653 | 4.8s | 0.00 |
| Operator Swap Increment Decrement 005 | ReactFiberViewTransitionComponent.js | 1/1 ✅ | 100.0% | 3/1/0 | 2,959/414 | 3.0s | 0.00 |
| Operator Swap Increment Decrement 007 | ReactFiberConcurrentUpdates.js | 1/1 ✅ | 100.0% | 2/1/0 | 5,442/388 | 2.6s | 0.00 |
| Operator Swap Logical 001 | ErrorView.js | 0/1 ❌ | 100.0% | 3/1/0 | 4,447/2,251 | 5.5s | 0.00 |
| Operator Swap Logical 003 | DevTools.js | 1/1 ✅ | 50.0% | 3/2/0 | 15,392/782 | 5.6s | 0.00 |
| Operator Swap Logical 005 | UseEffectEvent.js | 1/1 ✅ | 100.0% | 3/1/0 | 2,328/470 | 3.1s | 0.00 |
| Operator Swap Logical 007 | getHookNameForLocation.js | 1/1 ✅ | 100.0% | 3/1/0 | 9,693/452 | 6.4s | 0.00 |
| Operator Swap Nullish 001 | ElementBadges.js | 1/1 ✅ | 100.0% | 2/1/0 | 2,441/524 | 2.6s | 0.00 |
| Operator Swap Nullish 003 | ReactComponentStackFrame.js | 1/1 ✅ | 100.0% | 2/1/0 | 5,810/497 | 5.1s | 0.00 |
| Operator Swap Nullish 005 | ReactLogo.js | 0/1 ❌ | 100.0% | 0/1/0 | 594/124,923 | 226.0s | 0.00 |
| Operator Swap Nullish 007 | SuspenseBreadcrumbs.js | 1/1 ✅ | 66.7% | 4/3/0 | 11,498/1,126 | 7.8s | 0.00 |
| Regex Swap Regex Quantifier 001 | SimpleValues.js | 1/1 ✅ | 100.0% | 2/1/0 | 6,430/326 | 4.7s | 0.00 |
| Regex Swap Regex Quantifier 003 | utils.js | 1/1 ✅ | 100.0% | 5/1/0 | 8,339/3,622 | 18.4s | 0.00 |
| Regex Swap Regex Quantifier 005 | formatWithStyles.js | 1/1 ✅ | 100.0% | 3/2/0 | 3,960/1,008 | 6.2s | 0.00 |
| Regex Swap Regex Quantifier 007 | RunReactCompiler.ts | 1/1 ✅ | 100.0% | 6/1/0 | 12,171/2,557 | 10.6s | 0.00 |
| Structural Delete Statement 001 | useExtensionComponentsPanelVisibility.js | 1/1 ✅ | 50.0% | 7/2/0 | 5,352/1,124 | 8.5s | 0.00 |
| Structural Delete Statement 003 | useCanvasInteraction.js | 0/1 ❌ | 100.0% | 2/1/0 | 8,755/373 | 2.7s | 0.00 |
| Structural Delete Statement 005 | StackTraceView.js | 0/1 ❌ | 50.0% | 6/2/0 | 10,286/2,674 | 6.8s | 0.00 |
| Structural Delete Statement 007 | ReactDOMFizzStaticBrowser.js | 0/1 ❌ | 50.0% | 4/2/0 | 6,602/2,291 | 5.5s | 0.00 |
| Structural Remove Early Return 001 | ReactFlightAsyncDispatcher.js | 0/1 ❌ | 50.0% | 6/2/0 | 9,919/4,528 | 10.5s | 0.00 |
| Structural Remove Early Return 003 | ReactDOMComponentTree.js | 0/1 ❌ | 50.0% | 4/2/0 | 13,658/2,169 | 12.3s | 0.00 |
| Structural Remove Early Return 005 | TabBar.js | 0/1 ❌ | 100.0% | 2/1/0 | 3,534/673 | 2.5s | 0.00 |
| Structural Remove Early Return 007 | CommitTreeBuilder.js | 0/1 ❌ | 50.0% | 4/2/0 | 15,386/2,303 | 7.5s | 0.00 |
| Structural Swap Adjacent Lines 001 | reactPolling.js | 1/1 ✅ | 100.0% | 4/2/0 | 4,372/1,222 | 5.8s | 0.00 |
| Structural Swap Adjacent Lines 003 | OwnersStack.js | 1/1 ✅ | 100.0% | 2/1/0 | 5,440/489 | 4.0s | 0.00 |
| Structural Swap Adjacent Lines 005 | ReactOwnerStackFrames.js | 1/1 ✅ | 100.0% | 2/1/0 | 2,564/589 | 2.8s | 0.00 |
| Structural Swap Adjacent Lines 007 | ReactFlightClientConfigBundlerWebpack.js | 0/1 ❌ | 100.0% | 6/3/0 | 13,742/7,535 | 17.3s | 0.00 |
| Structural Swap If Else 001 | utils.js | 0/1 ❌ | 100.0% | 2/1/0 | 2,757/574 | 3.0s | 0.00 |
| Structural Swap If Else 003 | ReactDOMFloat.js | 0/1 ❌ | 100.0% | 3/1/0 | 20,179/9,384 | 16.4s | 2.00 |
| Structural Swap If Else 005 | ReactClientConsoleConfigPlain.js | 1/1 ✅ | 100.0% | 3/1/0 | 3,082/934 | 3.1s | 0.00 |
| Structural Swap If Else 007 | index.js | 1/1 ✅ | 50.0% | 3/2/0 | 6,102/963 | 4.2s | 0.00 |
| Unicode Unicode Hyphen 001 | formatProdErrorMessage.js | 1/1 ✅ | 100.0% | 2/1/0 | 2,162/417 | 5.5s | 0.00 |
| Unicode Unicode Hyphen 003 | SourceMapConsumer.js | 1/1 ✅ | 100.0% | 2/1/0 | 4,521/507 | 4.0s | 0.00 |
| Unicode Unicode Hyphen 005 | babel.config.js | 1/1 ✅ | 100.0% | 2/1/0 | 6,726/409 | 3.0s | 0.00 |
| Unicode Unicode Hyphen 007 | ReactInternalTestUtils.js | 1/1 ✅ | 100.0% | 2/1/0 | 5,757/399 | 4.9s | 0.00 |

## Category Summary

| Category | Runs | Verified | Edit Used | Success | Min/Avg/Max Difficulty |
|----------|------|----------|-----------|---------|------------------------|
| access | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) | 3 / 7.5 / 10 |
| call | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) | 2 / 7.8 / 14 |
| duplicate | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) | 8 / 11.3 / 17 |
| identifier | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) | 4 / 6.8 / 9 |
| import | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) | 2 / 3.8 / 5 |
| literal | 8 | 100.0% (8/8) | 100.0% (8/8) | 100.0% (8/8) | 3 / 6.9 / 10 |
| operator | 28 | 85.7% (24/28) | 100.0% (28/28) | 85.7% (24/28) | 3 / 6.7 / 10 |
| regex | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) | 2 / 5.8 / 10 |
| structural | 16 | 37.5% (6/16) | 100.0% (16/16) | 37.5% (6/16) | 4 / 8.3 / 13 |
| unicode | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) | 2 / 4.8 / 8 |

## Mutation Summary

| Mutation | Category | Runs | Verified | Edit Used | Success |
|----------|----------|------|----------|-----------|---------|
| delete-statement | structural | 4 | 25.0% (1/4) | 100.0% (4/4) | 25.0% (1/4) |
| duplicate-line-flip | duplicate | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) |
| flip-boolean | literal | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| identifier-multi-edit | identifier | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) |
| off-by-one | literal | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| remove-early-return | structural | 4 | 0.0% (0/4) | 100.0% (4/4) | 0.0% (0/4) |
| remove-negation | operator | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) |
| remove-optional-chain | access | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| swap-adjacent-lines | structural | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) |
| swap-arithmetic | operator | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| swap-call-args | call | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) |
| swap-comparison | operator | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) |
| swap-equality | operator | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| swap-if-else | structural | 4 | 50.0% (2/4) | 100.0% (4/4) | 50.0% (2/4) |
| swap-increment-decrement | operator | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| swap-logical | operator | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) |
| swap-named-imports | import | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| swap-nullish | operator | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) |
| swap-regex-quantifier | regex | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| unicode-hyphen | unicode | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |

## Difficulty Summary

| Difficulty Score | Runs | Verified | Edit Used | Success |
|------------------|------|----------|-----------|---------|
| 0-2 | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) |
| 3-5 | 24 | 79.2% (19/24) | 100.0% (24/24) | 79.2% (19/24) |
| 6-8 | 27 | 81.5% (22/27) | 100.0% (27/27) | 81.5% (22/27) |
| 9+ | 25 | 76.0% (19/25) | 100.0% (25/25) | 76.0% (19/25) |

## Edit Tool Errors

Failures where the edit tool returned an error or failed to apply the patch.

### Access Remove Optional Chain 003 (hookNamesCache.js)

#### Run 1

##### Attempt 1

- Path: hookNamesCache.js
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
  "path": "hookNamesCache.js",
  "edits": [
    {
      "op": "set",
      "tag": "132#NW",
      "content": "        inspected_element_number_of_hooks: resolvedHookNames?.size ?? null,"
    }
  ]
}
```

### Literal Flip Boolean 007 (Element.js)

#### Run 1

##### Attempt 1

- Path: /tmp/rb-3a961118-5207-4596-86d8-707429cf651a/b1475ee643510876f/Element.js
- Operation: —

**Tool error**

```
1 line has changed since last read. Use the updated LINE#ID references shown below (>>> marks changed lines).

    43#HP:  const element = ownerFlatTree !== null ? ownerFlatTree[index] : store.getElementAtIndex(index);
    44#ZR:
>>> 45#JP:  const [isHovered, setIsHovered] = useState(true);
    46#ZR:
    47#ZM:  const errorsAndWarningsSubscription = useMemo(
```

**Patch args**

```diff
{
  "path": "/tmp/rb-3a961118-5207-4596-86d8-707429cf651a/b1475ee643510876f/Element.js",
  "edits": [
    {
      "op": "set",
      "tag": "45#KM",
      "content": [
        "  const [isHovered, setIsHovered] = useState(false);"
      ]
    }
  ]
}
```

### Operator Swap Arithmetic 003 (ReactFlightDOMServerBrowser.js)

#### Run 1

##### Attempt 1

- Path: /tmp/rb-3a961118-5207-4596-86d8-707429cf651a/b1475ee5abb508747/ReactFlightDOMServerBrowser.js
- Operation: —

**Tool error**

```
1 line has changed since last read. Use the updated LINE#ID references shown below (>>> marks changed lines).

    71#PR:      : readPartialStringChunk(stringDecoder, buffer);
    72#YP:    const messages = stringBuffer.split('\n');
>>> 73#YW:    for (let i = 0; i < messages.length + 1; i++) {
    74#WR:      resolveDebugMessage(request, messages[i]);
    75#PN:    }
```

**Patch args**

```diff
{
  "path": "/tmp/rb-3a961118-5207-4596-86d8-707429cf651a/b1475ee5abb508747/ReactFlightDOMServerBrowser.js",
  "edits": [
    {
      "op": "set",
      "tag": "73#WR",
      "content": [
        "    for (let i = 0; i < messages.length - 1; i++) {"
      ]
    }
  ]
}
```

### Operator Swap Comparison 003 (ReactFlightDOMServerBrowser.js)

#### Run 1

##### Attempt 1

- Path: /tmp/rb-3a961118-5207-4596-86d8-707429cf651a/b1475ee63e7508767/ReactFlightDOMServerBrowser.js
- Operation: —

**Tool error**

```
1 line has changed since last read. Use the updated LINE#ID references shown below (>>> marks changed lines).

    75#PR:      : readPartialStringChunk(stringDecoder, buffer);
    76#YP:    const messages = stringBuffer.split('\n');
>>> 77#SW:    for (let i = 0; i <= messages.length - 1; i++) {
    78#WR:      resolveDebugMessage(request, messages[i]);
    79#PN:    }
```

**Patch args**

```diff
{
  "path": "/tmp/rb-3a961118-5207-4596-86d8-707429cf651a/b1475ee63e7508767/ReactFlightDOMServerBrowser.js",
  "edits": [
    {
      "op": "set",
      "tag": "77#WR",
      "content": [
        "    for (let i = 0; i < messages.length - 1; i++) {"
      ]
    }
  ]
}
```

### Operator Swap Increment Decrement 003 (ReactFlightClientConfigBundlerESM.js)

#### Run 1

##### Attempt 1

- Path: /tmp/rb-3a961118-5207-4596-86d8-707429cf651a/b1475ee4fc3d0871b/ReactFlightClientConfigBundlerESM.js
- Operation: —

**Tool error**

```
1 line has changed since last read. Use the updated LINE#ID references shown below (>>> marks changed lines).

    143#KJ:      // We may be able to collect the start and end time of this resource from Performance Observer.
    144#VW:      const resourceEntries = performance.getEntriesByType('resource');
>>> 145#PJ:      for (let i = 0; i < resourceEntries.length; i--) {
    146#VW:        const resourceEntry = resourceEntries[i];
    147#JY:        if (resourceEntry.name === href) {
```

**Patch args**

```diff
{
  "path": "/tmp/rb-3a961118-5207-4596-86d8-707429cf651a/b1475ee4fc3d0871b/ReactFlightClientConfigBundlerESM.js",
  "edits": [
    {
      "op": "set",
      "tag": "145#VW",
      "content": [
        "      for (let i = 0; i < resourceEntries.length; i++) {"
      ]
    }
  ]
}
```

### Operator Swap Logical 003 (DevTools.js)

#### Run 1

##### Attempt 1

- Path: DevTools.js
- Operation: —

**Tool error**

```
1 line has changed since last read. Use the updated LINE#ID references shown below (>>> marks changed lines).

    207#YQ:  const viewElementSource = useMemo(
    208#SW:    () => ({
>>> 209#TS:      canViewElementSourceFunction: canViewElementSourceFunction && null,
    210#KZ:      viewElementSourceFunction: viewElementSourceFunction || null,
    211#MJ:    }),
```

**Patch args**

```diff
{
  "path": "DevTools.js",
  "edits": [
    {
      "op": "set",
      "tag": "209#KZ",
      "content": "      canViewElementSourceFunction: canViewElementSourceFunction || null,"
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

    227#WY:      onClick={parent !== null ? selectElement.bind(null, parentID) : null}
    228#JR:      title={`Up to ${parent === null ? 'Unknown' : (parent.name ?? 'Unknown')}`}
>>> 229#XJ:    >
    230#TP:      <ButtonIcon type="previous" />
    231#YN:    </Button>
```

**Patch args**

```diff
{
  "path": "SuspenseBreadcrumbs.js",
  "edits": [
    {
      "op": "set",
      "tag": "229#JR",
      "content": [
        "      title={`Up to ${parent === null ? 'Unknown' : (parent.name || 'Unknown')}` }"
      ]
    }
  ]
}
```

### Structural Delete Statement 001 (useExtensionComponentsPanelVisibility.js)

#### Run 1

##### Attempt 1

- Path: useExtensionComponentsPanelVisibility.js
- Operation: —

**Tool error**

```
1 line has changed since last read. Use the updated LINE#ID references shown below (>>> marks changed lines).

    13#KW:// Events that are prefixed with `extension` will only be emitted for the browser extension implementation.
    14#VN:// For other implementations, this hook will just return constant `true` value.
>>> 15#JP:export function useExtensionComponentsPanelVisibility(bridge: FrontendBridge): boolean {
    16#NK:  useEffect(() => {
    17#YT:    function onPanelShown() {
```

**Patch args**

```diff
{
  "path": "useExtensionComponentsPanelVisibility.js",
  "edits": [
    {
      "op": "insert",
      "after": "15#NK",
      "content": [
        "  const [isVisible, setIsVisible] = useState(true);",
        ""
      ]
    }
  ]
}
```

### Structural Delete Statement 005 (StackTraceView.js)

#### Run 1

##### Attempt 1

- Path: /tmp/rb-3a961118-5207-4596-86d8-707429cf651a/b1475ee4d78108715/StackTraceView.js
- Operation: —

**Tool error**

```
1 line has changed since last read. Use the updated LINE#ID references shown below (>>> marks changed lines).

    35#QT:  const fetchFileWithCaching = useContext(FetchFileWithCachingContext);
    36#ZR:
>>> 37#KW:  const [virtualFunctionName, virtualURL, virtualLine, virtualColumn] = callSite;
    38#ZR:
    39#YQ:  const symbolicatedCallSite: null | SourceMappedLocation =
```

**Patch args**

```diff
{
  "path": "/tmp/rb-3a961118-5207-4596-86d8-707429cf651a/b1475ee4d78108715/StackTraceView.js",
  "edits": [
    {
      "op": "set",
      "tag": "37#QY",
      "content": [
        "  const [virtualFunctionName, virtualURL, virtualLine, virtualColumn, ignored] = callSite;"
      ]
    }
  ]
}
```

### Structural Delete Statement 007 (ReactDOMFizzStaticBrowser.js)

#### Run 1

##### Attempt 1

- Path: /tmp/rb-3a961118-5207-4596-86d8-707429cf651a/b1475ee593310873f/ReactDOMFizzStaticBrowser.js
- Operation: —

**Tool error**

```
1 line has changed since last read. Use the updated LINE#ID references shown below (>>> marks changed lines).

    70#ZR:
    71#NV:    function onAllReady() {
>>> 72#WH:      const result: StaticResult = {
    73#YQ:        postponed: getPostponedState(request),
    74#TK:        prelude: stream,
```

**Patch args**

```diff
{
  "path": "/tmp/rb-3a961118-5207-4596-86d8-707429cf651a/b1475ee593310873f/ReactDOMFizzStaticBrowser.js",
  "edits": [
    {
      "op": "replace",
      "first": "72#YQ",
      "last": "76#YB",
      "content": [
        "      const stream = new ReadableStream(",
        "        {",
        "          type: 'bytes',",
        "          pull: (controller): ?Promise<void> => {",
        "            startFlowing(request, controller);",
        "          },",
        "          cancel: (reason): ?Promise<void> => {",
        "            stopFlowing(request);",
        "            abort(request, reason);",
        "          },",
        "        },",
        "        // $FlowFixMe[prop-missing] size() methods are not allowed on byte streams.",
        "        { highWaterMark: 0 },",
        "      );",
        "      const result: StaticResult = {",
        "        postponed: getPostponedState(request),",
        "        prelude: stream,",
        "      };",
        "      resolve(result);"
      ]
    }
  ]
}
```

### Structural Remove Early Return 001 (ReactFlightAsyncDispatcher.js)

#### Run 1

##### Attempt 1

- Path: ReactFlightAsyncDispatcher.js
- Operation: —

**Tool error**

```
Validation failed for tool "edit":
  - edits/0: must NOT have additional properties
  - edits/0: must NOT have additional properties
  - edits/0/op: must be equal to constant
  - edits/0: must have required property 'first'
  - edits/0: must have required property 'last'
  - edits/0: must NOT have additional properties
  - edits/0: must NOT have additional properties
  - edits/0: must NOT have additional properties
  - edits/0/op: must be equal to constant
  - edits/0: must NOT have additional properties
  - edits/0: must NOT have additional properties
  - edits/0: must NOT have additional properties
  - edits/0/op: must be equal to constant
  - edits/0: must NOT have additional properties
  - edits/0: must NOT have additional properties
  - edits/0: must NOT have additional properties
  - edits/0: must NOT have additional properties
  - edits/0/op: must be equal to constant
  - edits/0: must match a schema in anyOf

Received arguments:
{
  "path": "ReactFlightAsyncDispatcher.js",
  "edits": [
    {
      "op": "prepend",
      "before": "18#YZ",
      "content": [
        "  return request.cache;"
      ],
      "},{ ": "set",
      "tag": "18#YZ"
    }
  ]
}
```

**Patch args**

```diff
{
  "path": "ReactFlightAsyncDispatcher.js",
  "edits": [
    {
      "op": "prepend",
      "before": "18#YZ",
      "content": [
        "  return request.cache;"
      ],
      "},{ ": "set",
      "tag": "18#YZ"
    }
  ]
}
```

### Structural Remove Early Return 003 (ReactDOMComponentTree.js)

#### Run 1

##### Attempt 1

- Path: /tmp/rb-3a961118-5207-4596-86d8-707429cf651a/b1475ee44295086eb/ReactDOMComponentTree.js
- Operation: —

**Tool error**

```
1 line has changed since last read. Use the updated LINE#ID references shown below (>>> marks changed lines).

    129#ZS:    targetInst = (targetNode: any)[internalInstanceKey];
    130#PN:  }
>>> 131#SH:  if (targetInst) {
    132#XQ:    // Don't return HostRoot, SuspenseComponent or ActivityComponent here.
    133#ZB:    return targetInst;
```

**Patch args**

```diff
{
  "path": "/tmp/rb-3a961118-5207-4596-86d8-707429cf651a/b1475ee44295086eb/ReactDOMComponentTree.js",
  "edits": [
    {
      "op": "replace",
      "first": "131#KY",
      "last": "134#PN",
      "content": [
        "  if (targetInst) {",
        "    // Don't return HostRoot, SuspenseComponent or ActivityComponent here.",
        "    if (",
        "      targetInst.tag !== HostRoot &&",
        "      targetInst.tag !== SuspenseComponent &&",
        "      targetInst.tag !== ActivityComponent",
        "    ) {",
        "      return targetInst;",
        "    }",
        "  }"
      ]
    }
  ]
}
```

### Structural Remove Early Return 007 (CommitTreeBuilder.js)

#### Run 1

##### Attempt 1

- Path: CommitTreeBuilder.js
- Operation: —

**Tool error**

```
No changes made to CommitTreeBuilder.js. The edits produced identical content.
The file differs from the original fixture at these lines:
67#YS|+  if (commitTrees.length > commitIndex) {
67#RV|+    return commitTrees[commitIndex];
67#PN|+  }
67#ZR|+
```

**Patch args**

```diff
{
  "path": "CommitTreeBuilder.js",
  "edits": []
}
```

### Structural Swap If Else 007 (index.js)

#### Run 1

##### Attempt 1

- Path: index.js
- Operation: —

**Tool error**

```
2 lines have changed since last read. Use the updated LINE#ID references shown below (>>> marks changed lines).

    81#MQ:    // $FlowFixMe[incompatible-use] number or string is fine here
    82#KX:    updated[newKey] = updated[oldKey];
>>> 83#JP:    if (isArray(updated)) {
    84#YT:      delete updated[oldKey];
    85#QM:    } else {
    86#TH:      updated.splice(((oldKey: any): number), 1);
>>> 87#PN:    }
    88#QM:  } else {
    89#MQ:    // $FlowFixMe[incompatible-use] number or string is fine here
```

**Patch args**

```diff
{
  "path": "index.js",
  "edits": [
    {
      "op": "set",
      "tag": "83#YT",
      "content": "      updated.splice(((oldKey: any): number), 1);"
    },
    {
      "op": "set",
      "tag": "87#TH",
      "content": "      delete updated[oldKey];"
    }
  ]
}
```

## Failed Tasks (0% passing)

### Call Swap Call Args 005 (ReactNoopPersistent.js) — 0/1

**All runs failed with same error:** File mismatch for ReactNoopPersistent.js

**Sample agent response (run 1):**
```
Done.  
I made the single requested change in `ReactNoopPersistent.js` at lines 58–60: the two arguments passed to `createReactNoop` are now in their original order.
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
Fixed in `ReactFiberDevToolsHook.js`:

- Corrected the duplicated `console.error` message format string by changing `%o.` to `%o` (line with `tag 77#SN`).

Only that single token changed; no other code or formatting was modified.
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

### Identifier Identifier Multi Edit 003 (ReactFlightDOMClientBrowser.js) — 0/1

**All runs failed with same error:** File mismatch for ReactFlightDOMClientBrowser.js

**Sample agent response (run 1):**
```
Fixed all misspelled identifiers in `ReactFlightDOMClientBrowser.js`:

- `ersponse` → `response` in:
  - `close(ersponse)` → `close(response)`
  - `startReadingFromUniversalStream(ersponse, ...)` → `startReadingFromUniversalStream(response, ...)`
  - `startReadingFromStream(ersponse, ...)` → `startReadingFromStream(response, ...)`

No other files were modified.
```

**Diff (expected vs actual):**
```diff
@@ -169 @@
     startReadingFromUniversalStream(response, options.debugChannel.readable, handleDone);
     startReadingFromStream(response, stream, handleDone, stream);
   } else {
-    startReadingFromStream(response, stream, close.bind(null, response), stream);
+    startReadingFromStream(response, stream, close.bind(null, response));
   }
   return getRoot(response);
 }
```

### Operator Remove Negation 005 (ReactDOMContainer.js) — 0/1

**All runs failed with same error:** File mismatch for ReactDOMContainer.js

**Sample agent response (run 1):**
```
Fixed.

I restored the missing logical negation in `ReactDOMContainer.js` by changing:

- `!node &&`

to:

- `!!node &&`

Only that line was modified, and all other code/formatting is unchanged.
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

### Operator Swap Comparison 001 (useSmartTooltip.js) — 0/1

**All runs failed with same error:** File mismatch for useSmartTooltip.js

**Sample agent response (run 1):**
```
Applied minimal fix in `useSmartTooltip.js`:

- Changed one comparison operator:
  - `if (mouseX - TOOLTIP_OFFSET_TOP - element.offsetWidth > 0)` → `if (mouseX - TOOLTIP_OFFSET_TOP - element.offsetWidth >= 0)`

Only that single token was changed and confirmed via re-read of the target region.
```

**Diff (expected vs actual):**
```diff
@@ -54 @@
       }
 
       // Now let's check the horizontal position.
-      if (mouseX + TOOLTIP_OFFSET_BOTTOM + element.offsetWidth >= width) {
+      if (mouseX + TOOLTIP_OFFSET_BOTTOM + element.offsetWidth > width) {
         // The tooltip doesn't fit at the right of the mouse cursor (which is
         // our default strategy). Therefore we try to position it either at the
         // left of the mouse cursor or finally aligned with the window's left
@@ -59 @@
         // our default strategy). Therefore we try to position it either at the
         // left of the mouse cursor or finally aligned with the window's left
         // edge.
-        if (mouseX - TOOLTIP_OFFSET_TOP - element.offsetWidth > 0) {
+        if (mouseX - TOOLTIP_OFFSET_TOP - element.offsetWidth >= 0) {
           // We position the tooltip at the left of the mouse cursor if it fits
           // there.
           element.style.left = `${mouseX - element.offsetWidth - TOOLTIP_OFFSET_TOP}px`;
```

### Operator Swap Logical 001 (ErrorView.js) — 0/1

**All runs failed with same error:** File mismatch for ErrorView.js

**Sample agent response (run 1):**
```
Updated `ErrorView.js` with the minimal targeted fix on line 36:

- Changed `{dismissError !== null && (...)` to `{dismissError && (...)`

No other files or lines were modified.
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
+          {dismissError && (
             <Button className={styles.CloseButton} onClick={dismissError}>
               Dismiss
               <ButtonIcon className={styles.CloseButtonIcon} type="close" />
```

### Operator Swap Nullish 005 (ReactLogo.js) — 0/1

**All runs failed with same error:** File mismatch for ReactLogo.js

**Diff (expected vs actual):**
```diff
@@ -19 @@
   return (
     <svg
       xmlns="http://www.w3.org/2000/svg"
-      className={`${styles.ReactLogo} ${className || ''}`}
+      className={`${styles.ReactLogo} ${className || ''}` ]}],
       viewBox="-11.5 -10.23174 23 20.46348"
     >
       <circle cx="0" cy="0" r="2.05" fill="currentColor" />
```

### Structural Delete Statement 003 (useCanvasInteraction.js) — 0/1

**All runs failed with same error:** File mismatch for useCanvasInteraction.js

**Sample agent response (run 1):**
```
Fixed `useCanvasInteraction.js` by restoring the missing statement in `onCanvasMouseDown`:

- Added `isMouseDownRef.current = true;` before resetting `didMouseMoveWhileDownRef.current`.

This restores correct mouse-down tracking for `mousemove` behavior; no other files or statements were changed.
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
Done. I restored the missing statement by extending the `callSite` destructuring to include the `ignored` flag:

- Changed:
`const [virtualFunctionName, virtualURL, virtualLine, virtualColumn] = callSite;`
- To:
`const [virtualFunctionName, virtualURL, virtualLine, virtualColumn, ignored] = callSite;`

This restores the variable used at the className line (`ignored ? ...`) and keeps all formatting/structure otherwise unchanged.
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

### Structural Delete Statement 007 (ReactDOMFizzStaticBrowser.js) — 0/1

**All runs failed with same error:** File mismatch for ReactDOMFizzStaticBrowser.js

**Sample agent response (run 1):**
```
Done. I restored the missing `ReadableStream` initialization in `ReactDOMFizzStaticBrowser.js` inside `prerender`’s `onAllReady` callback.

Now the function defines `stream` as a byte stream with `startFlowing`/`stopFlowing`/`abort` handlers and then resolves with `{ postponed, prelude: stream }`, matching the sibling `resumeAndPrerender` pattern and fixing the undefined `stream` bug.
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

### Structural Remove Early Return 001 (ReactFlightAsyncDispatcher.js) — 0/1

**All runs failed with same error:** File mismatch for ReactFlightAsyncDispatcher.js

**Sample agent response (run 1):**
```
Fixed.

I restored the removed guard clause in `ReactFlightAsyncDispatcher.js` and kept the change minimal:

- Added back the 3-line early-return pattern:
  - `if (request === null) {`
  - `  return new Map();`
  - `}`

- Kept the function return for the active request as:
  - `return request.cache;`

Verified by re-reading the changed region (lines 15–22).
```

**Diff (expected vs actual):**
```diff
@@ -14 @@
 
 function resolveCache(): Map<Function, mixed> {
   const request = resolveRequest();
-  if (request) {
-    return getCache(request);
+
+  if (request === null) {
+    return new Map();
   }
   }
-  return new Map();
+  return request.cache;
 }
 
 export const DefaultAsyncDispatcher: AsyncDispatcher = ({
```

### Structural Remove Early Return 003 (ReactDOMComponentTree.js) — 0/1

**All runs failed with same error:** File mismatch for ReactDOMComponentTree.js

**Sample agent response (run 1):**
```
I restored the missing guard clause in `ReactDOMComponentTree.js` inside `getClosestInstanceFromNode`:

- Kept the `targetInst` check.
- Added an early return only when `targetInst.tag` is **not** `HostRoot`, `SuspenseComponent`, or `ActivityComponent`.

Only the intended block was changed.
```

**Diff (expected vs actual):**
```diff
@@ -130 @@
   }
   if (targetInst) {
     // Don't return HostRoot, SuspenseComponent or ActivityComponent here.
-    return targetInst;
+    if (
+      targetInst.tag !== HostRoot &&
+      targetInst.tag !== SuspenseComponent &&
+      targetInst.tag !== ActivityComponent
+    ) {
+      return targetInst;
+    }
   }
   // If the direct event target isn't a React owned DOM node, we need to look
   // to see if one of its parents is a React owned DOM node.
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
Done. I restored the missing guard clause in `TabBar.js` at the `tabs.map` callback:

```js
        if (tab === null) {
          return null;
        }
```

Re-read confirms only this 3-line pattern was added at the intended location (around line 92) and no other files were changed.
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
Done. I restored the missing guard clause in `CommitTreeBuilder.js`:

- Added an early return in `getCommitTree`:
  - `if (commitTrees.length > commitIndex) { return commitTrees[commitIndex]; }`

This prevents returning an uninitialized `commitTree` when the requested commit was already built and cached.
```

**Diff (expected vs actual):**
```diff
@@ -63 @@
   }
 
   const commitTrees = ((rootToCommitTreeMap.get(rootID): any): Array<CommitTree>);
-  if (commitIndex < commitTrees.length) {
+
+  if (commitTrees.length > commitIndex) {
     return commitTrees[commitIndex];
   }
 
```

### Structural Swap Adjacent Lines 007 (ReactFlightClientConfigBundlerWebpack.js) — 0/1

**All runs failed with same error:** File mismatch for ReactFlightClientConfigBundlerWebpack.js

**Sample agent response (run 1):**
```
Fixed.

In `ReactFlightClientConfigBundlerWebpack.js`, the `preloadModule` cache/write ordering was corrected in the `if (entry === undefined)` block so the module is recorded in `chunkCache` before the thenable is subscribed and queued, preventing the cache from being overwritten later.

I re-read the changed region to verify only that block was touched and the fix is limited to the intended statements.
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
+      promises.push(thenable);
+      thenable.then(resolve, ignoreReject);
     } else if (entry !== null) {
       promises.push(entry);
     }
```

### Structural Swap If Else 001 (utils.js) — 0/1

**All runs failed with same error:** File mismatch for utils.js

**Sample agent response (run 1):**
```
Updated `utils.js` so the `if`/`else if` bodies at the branch handling `sourceURL` are restored to their original positions (only that swap was changed):

- `file:///` branch now sets `filePath = sourceURL`
- `://` branch now sets `filePath = new URL(sourceURL).pathname`

I re-read the changed region to confirm only those lines were touched.
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
Updated `ReactDOMFloat.js` with the minimal fix: in the `preinitModule` dev-only validation block, the `if` condition was flipped so the `if` and `else` branches are correctly ordered.

Changed:
- `if (encountered) {` → `if (!encountered) {`

This swaps the branch behavior as requested, with no other file edits.
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
