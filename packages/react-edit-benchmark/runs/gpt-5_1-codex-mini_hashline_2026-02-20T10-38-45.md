# Edit Benchmark Report

## Configuration

| Setting | Value |
|---------|-------|
| Date | 2026-02-20T10:31:51.601Z |
| Model | openai-codex/openai-codex/gpt-5.1-codex-mini |
| Thinking Level | low |
| Runs per task | 1 |
| Edit Variant | hashline |
| Edit Fuzzy | auto |
| Edit Fuzzy Threshold | auto |
| Guided Mode | no |
| Max Attempts | 1 |
| Max Turns | unset |
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
| Edit Tool Usage Rate | 97.5% (78/80) |
| **Edit Success Rate** | **86.0%** |
| Timeout Runs | 0 |
| Mutation Intent Match Rate | 76.9% |
| Patch Failure Rate | 14.0% (13/93) |
| Tasks All Passing | 62 |
| Tasks Flaky/Failing | 18 |

### Tool Calls

| Tool | Total | Avg/Run |
|------|-------|---------|
| Read | 277 | 3.5 |
| Edit | 93 | 1.2 |
| Write | 0 | 0.0 |
| **Tool Input Chars** | 30,698 | 384 |

### Tokens & Time

| Metric | Total | Avg/Run |
|--------|-------|---------|
| Input Tokens | 972,543 | 12,157 |
| Output Tokens | 161,070 | 2,013 |
| Total Tokens | 4,960,301 | 62,004 |
| Duration | 2658.5s | 33.2s |
| **Avg Indent Score** | — | **0.17** |

## Task Results

| Task | File | Success | Edit Hit | R/E/W | Tokens (In/Out) | Time | Indent |
|------|------|---------|----------|-------|-----------------|------|--------|
| Access Remove Optional Chain 001 | fallbackEvalContext.js | 1/1 ✅ | 100.0% | 2/1/0 | 2,387/685 | 8.3s | 0.00 |
| Access Remove Optional Chain 003 | hookNamesCache.js | 1/1 ✅ | 50.0% | 8/2/0 | 16,595/1,032 | 22.3s | 0.00 |
| Access Remove Optional Chain 005 | registerDevToolsEventLogger.js | 1/1 ✅ | 100.0% | 4/1/0 | 3,668/1,189 | 15.0s | 0.00 |
| Access Remove Optional Chain 007 | index.js | 0/1 ❌ | 100.0% | 3/1/0 | 18,434/7,207 | 54.5s | 2.00 |
| Call Swap Call Args 001 | formatConsoleArguments.js | 1/1 ✅ | 100.0% | 2/1/0 | 4,477/402 | 8.7s | 0.00 |
| Call Swap Call Args 003 | ReactFlightDOMServerBrowser.js | 1/1 ✅ | 100.0% | 6/1/0 | 12,204/562 | 8.3s | 2.00 |
| Call Swap Call Args 005 | ReactNoopPersistent.js | 1/1 ✅ | 100.0% | 2/1/0 | 4,605/980 | 11.1s | 0.00 |
| Call Swap Call Args 007 | parseSourceAndMetadata.js | 1/1 ✅ | 100.0% | 2/1/0 | 18,071/757 | 7.9s | 0.00 |
| Duplicate Duplicate Line Flip 001 | isCustomElement.js | 1/1 ✅ | 100.0% | 2/1/0 | 5,647/237 | 6.8s | 0.00 |
| Duplicate Duplicate Line Flip 003 | ReactFiberDevToolsHook.js | 0/1 ❌ | 100.0% | 0/0/0 | 0/0 | 360.0s | 0.00 |
| Duplicate Duplicate Line Flip 005 | shallowEqual.js | 1/1 ✅ | 100.0% | 2/1/0 | 4,794/284 | 7.7s | 0.00 |
| Duplicate Duplicate Line Flip 007 | ReactDOMEventReplaying.js | 1/1 ✅ | 100.0% | 18/1/0 | 43,260/5,050 | 62.2s | 0.00 |
| Identifier Identifier Multi Edit 001 | Button.js | 1/1 ✅ | 100.0% | 2/1/0 | 6,204/359 | 9.7s | 0.00 |
| Identifier Identifier Multi Edit 003 | ReactFlightDOMClientBrowser.js | 1/1 ✅ | 100.0% | 3/1/0 | 15,180/618 | 9.3s | 0.00 |
| Identifier Identifier Multi Edit 005 | githubAPI.js | 1/1 ✅ | 100.0% | 2/1/0 | 2,709/485 | 5.7s | 0.00 |
| Identifier Identifier Multi Edit 007 | ReactFiberComponentStack.js | 1/1 ✅ | 100.0% | 4/1/0 | 11,678/801 | 12.3s | 0.00 |
| Import Swap Named Imports 001 | ListApp.js | 1/1 ✅ | 100.0% | 2/1/0 | 6,477/670 | 6.7s | 0.00 |
| Import Swap Named Imports 003 | index.js | 1/1 ✅ | 100.0% | 3/1/0 | 16,943/7,604 | 49.1s | 0.00 |
| Import Swap Named Imports 005 | SuspenseScrubber.js | 1/1 ✅ | 100.0% | 2/1/0 | 4,229/340 | 8.9s | 0.00 |
| Import Swap Named Imports 007 | InspectedElement.js | 0/1 ❌ | 100.0% | 9/1/0 | 11,013/11,557 | 93.5s | 0.00 |
| Literal Flip Boolean 001 | ReactDOMLegacyServerImpl.js | 0/1 ❌ | 100.0% | 2/1/0 | 10,039/335 | 5.3s | 0.00 |
| Literal Flip Boolean 003 | ReactProfilerTimer.js | 1/1 ✅ | 100.0% | 6/1/0 | 36,904/2,641 | 22.5s | 0.00 |
| Literal Flip Boolean 005 | OpenInEditorButton.js | 1/1 ✅ | 100.0% | 2/1/0 | 13,902/468 | 12.1s | 0.00 |
| Literal Flip Boolean 007 | Element.js | 1/1 ✅ | 100.0% | 2/1/0 | 14,800/366 | 9.3s | 0.00 |
| Literal Off By One 001 | ReactOwnerStackFrames.js | 1/1 ✅ | 100.0% | 2/1/0 | 3,942/249 | 4.1s | 0.00 |
| Literal Off By One 003 | ReactFlightClientConfigBundlerTurbopack.js | 1/1 ✅ | 100.0% | 2/1/0 | 6,257/284 | 6.3s | 0.00 |
| Literal Off By One 005 | ContextMenu.js | 1/1 ✅ | 100.0% | 2/1/0 | 19,001/429 | 8.6s | 0.00 |
| Literal Off By One 007 | index.js | 1/1 ✅ | 100.0% | 2/1/0 | 11,146/399 | 9.5s | 0.00 |
| Operator Remove Negation 001 | prepareInjection.js | 1/1 ✅ | 100.0% | 2/1/0 | 8,115/408 | 4.9s | 0.00 |
| Operator Remove Negation 003 | ReactDOMSelection.js | 1/1 ✅ | 100.0% | 5/1/0 | 8,824/1,982 | 24.7s | 0.00 |
| Operator Remove Negation 005 | ReactDOMContainer.js | 0/1 ❌ | 0.0% | 0/1/0 | 644/11,688 | 287.1s | 0.00 |
| Operator Remove Negation 007 | SelectEventPlugin.js | 1/1 ✅ | 100.0% | 3/1/0 | 9,125/829 | 11.1s | 0.00 |
| Operator Swap Arithmetic 001 | formatConsoleArguments.js | 1/1 ✅ | 100.0% | 3/1/0 | 3,089/342 | 7.9s | 0.00 |
| Operator Swap Arithmetic 003 | ReactFlightDOMServerBrowser.js | 1/1 ✅ | 100.0% | 6/1/0 | 18,098/1,087 | 18.9s | 0.00 |
| Operator Swap Arithmetic 005 | ReactFiberConfigWithNoResources.js | 1/1 ✅ | 100.0% | 2/1/0 | 8,292/275 | 8.4s | 0.00 |
| Operator Swap Arithmetic 007 | useCanvasInteraction.js | 1/1 ✅ | 50.0% | 3/2/0 | 6,207/596 | 7.7s | 0.00 |
| Operator Swap Comparison 001 | useSmartTooltip.js | 1/1 ✅ | 100.0% | 2/1/0 | 4,033/771 | 8.3s | 0.00 |
| Operator Swap Comparison 003 | ReactFlightDOMServerBrowser.js | 1/1 ✅ | 100.0% | 2/1/0 | 8,952/670 | 6.8s | 0.00 |
| Operator Swap Comparison 005 | Rectangle.js | 1/1 ✅ | 100.0% | 2/1/0 | 4,518/360 | 7.2s | 0.00 |
| Operator Swap Comparison 007 | ReactFiberTreeReflection.js | 1/1 ✅ | 100.0% | 2/1/0 | 25,612/460 | 7.4s | 0.00 |
| Operator Swap Equality 001 | ReactNoopFlightClient.js | 1/1 ✅ | 100.0% | 2/1/0 | 8,297/351 | 14.3s | 0.00 |
| Operator Swap Equality 003 | astUtils.js | 1/1 ✅ | 100.0% | 2/1/0 | 11,590/678 | 8.4s | 0.00 |
| Operator Swap Equality 005 | ReactDOMContainer.js | 1/1 ✅ | 100.0% | 2/1/0 | 7,419/580 | 8.4s | 0.00 |
| Operator Swap Equality 007 | ReactFlightDOMServerBrowser.js | 1/1 ✅ | 100.0% | 7/1/0 | 36,506/2,073 | 32.1s | 0.00 |
| Operator Swap Increment Decrement 001 | index.js | 1/1 ✅ | 100.0% | 2/1/0 | 8,395/221 | 4.1s | 0.00 |
| Operator Swap Increment Decrement 003 | ReactFlightClientConfigBundlerESM.js | 1/1 ✅ | 100.0% | 7/1/0 | 30,007/2,858 | 25.3s | 0.00 |
| Operator Swap Increment Decrement 005 | ReactFiberViewTransitionComponent.js | 1/1 ✅ | 100.0% | 2/1/0 | 3,766/302 | 5.8s | 0.00 |
| Operator Swap Increment Decrement 007 | ReactFiberConcurrentUpdates.js | 1/1 ✅ | 100.0% | 5/1/0 | 18,636/559 | 21.5s | 0.00 |
| Operator Swap Logical 001 | ErrorView.js | 0/1 ❌ | 100.0% | 2/1/0 | 7,110/1,163 | 18.2s | 0.00 |
| Operator Swap Logical 003 | DevTools.js | 1/1 ✅ | 100.0% | 2/1/0 | 11,830/589 | 10.1s | 0.00 |
| Operator Swap Logical 005 | UseEffectEvent.js | 1/1 ✅ | 100.0% | 2/1/0 | 3,276/384 | 4.9s | 0.00 |
| Operator Swap Logical 007 | getHookNameForLocation.js | 1/1 ✅ | 100.0% | 5/1/0 | 11,804/772 | 14.3s | 0.00 |
| Operator Swap Nullish 001 | ElementBadges.js | 1/1 ✅ | 100.0% | 2/1/0 | 7,673/838 | 7.3s | 0.00 |
| Operator Swap Nullish 003 | ReactComponentStackFrame.js | 1/1 ✅ | 100.0% | 2/1/0 | 10,776/327 | 5.8s | 0.00 |
| Operator Swap Nullish 005 | ReactLogo.js | 0/1 ❌ | 100.0% | 1/1/0 | 12,854/660 | 8.8s | 0.00 |
| Operator Swap Nullish 007 | SuspenseBreadcrumbs.js | 1/1 ✅ | 50.0% | 7/4/0 | 46,561/4,887 | 41.3s | 0.00 |
| Regex Swap Regex Quantifier 001 | SimpleValues.js | 1/1 ✅ | 100.0% | 2/1/0 | 11,087/799 | 12.8s | 0.00 |
| Regex Swap Regex Quantifier 003 | utils.js | 0/1 ❌ | 100.0% | 2/0/0 | 8,186/10,205 | 411.7s | 0.00 |
| Regex Swap Regex Quantifier 005 | formatWithStyles.js | 1/1 ✅ | 100.0% | 2/1/0 | 2,771/616 | 6.8s | 2.00 |
| Regex Swap Regex Quantifier 007 | RunReactCompiler.ts | 1/1 ✅ | 100.0% | 9/1/0 | 32,266/9,888 | 86.9s | 0.00 |
| Structural Delete Statement 001 | useExtensionComponentsPanelVisibility.js | 0/1 ❌ | 100.0% | 4/1/0 | 4,641/858 | 10.7s | 0.00 |
| Structural Delete Statement 003 | useCanvasInteraction.js | 1/1 ✅ | 100.0% | 4/1/0 | 9,385/439 | 6.7s | 0.00 |
| Structural Delete Statement 005 | StackTraceView.js | 0/1 ❌ | 100.0% | 12/1/0 | 9,122/5,674 | 51.5s | 0.00 |
| Structural Delete Statement 007 | ReactDOMFizzStaticBrowser.js | 1/1 ✅ | 100.0% | 6/1/0 | 26,347/1,912 | 21.1s | 0.00 |
| Structural Remove Early Return 001 | ReactFlightAsyncDispatcher.js | 0/1 ❌ | 100.0% | 3/2/0 | 3,468/4,522 | 44.8s | 0.00 |
| Structural Remove Early Return 003 | ReactDOMComponentTree.js | 0/1 ❌ | 50.0% | 9/2/0 | 14,173/7,677 | 74.1s | 4.40 |
| Structural Remove Early Return 005 | TabBar.js | 0/1 ❌ | 100.0% | 3/1/0 | 12,603/869 | 11.7s | 0.00 |
| Structural Remove Early Return 007 | CommitTreeBuilder.js | 0/1 ❌ | 100.0% | 7/2/0 | 22,348/6,026 | 46.1s | 0.00 |
| Structural Swap Adjacent Lines 001 | reactPolling.js | 1/1 ✅ | 100.0% | 2/1/0 | 17,272/631 | 10.9s | 0.00 |
| Structural Swap Adjacent Lines 003 | OwnersStack.js | 1/1 ✅ | 100.0% | 3/1/0 | 10,860/486 | 8.3s | 0.00 |
| Structural Swap Adjacent Lines 005 | ReactOwnerStackFrames.js | 1/1 ✅ | 50.0% | 2/2/0 | 5,652/1,066 | 17.7s | 0.00 |
| Structural Swap Adjacent Lines 007 | ReactFlightClientConfigBundlerWebpack.js | 0/1 ❌ | 50.0% | 1/2/0 | 21,716/6,492 | 171.8s | 0.00 |
| Structural Swap If Else 001 | utils.js | 0/1 ❌ | 50.0% | 4/2/0 | 17,896/4,109 | 35.2s | 0.00 |
| Structural Swap If Else 003 | ReactDOMFloat.js | 0/1 ❌ | 100.0% | 5/1/0 | 11,936/10,828 | 80.4s | 0.00 |
| Structural Swap If Else 005 | ReactClientConsoleConfigPlain.js | 1/1 ✅ | 50.0% | 3/2/0 | 6,244/1,210 | 11.2s | 0.00 |
| Structural Swap If Else 007 | index.js | 0/1 ❌ | 33.3% | 4/3/0 | 22,186/2,762 | 29.0s | 2.50 |
| Unicode Unicode Hyphen 001 | formatProdErrorMessage.js | 1/1 ✅ | 100.0% | 2/1/0 | 2,355/287 | 7.5s | 0.00 |
| Unicode Unicode Hyphen 003 | SourceMapConsumer.js | 1/1 ✅ | 100.0% | 2/1/0 | 11,930/341 | 9.0s | 0.00 |
| Unicode Unicode Hyphen 005 | babel.config.js | 1/1 ✅ | 50.0% | 2/2/0 | 8,501/385 | 9.8s | 0.00 |
| Unicode Unicode Hyphen 007 | ReactInternalTestUtils.js | 1/1 ✅ | 100.0% | 2/1/0 | 13,023/288 | 6.1s | 0.00 |

## Category Summary

| Category | Runs | Verified | Edit Used | Success | Min/Avg/Max Difficulty |
|----------|------|----------|-----------|---------|------------------------|
| access | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) | 3 / 7.5 / 10 |
| call | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) | 2 / 7.8 / 14 |
| duplicate | 4 | 75.0% (3/4) | 75.0% (3/4) | 75.0% (3/4) | 8 / 11.3 / 17 |
| identifier | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) | 4 / 6.8 / 9 |
| import | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) | 2 / 3.8 / 5 |
| literal | 8 | 87.5% (7/8) | 100.0% (8/8) | 87.5% (7/8) | 3 / 6.9 / 10 |
| operator | 28 | 89.3% (25/28) | 100.0% (28/28) | 89.3% (25/28) | 3 / 6.7 / 10 |
| regex | 4 | 75.0% (3/4) | 75.0% (3/4) | 75.0% (3/4) | 2 / 5.8 / 10 |
| structural | 16 | 37.5% (6/16) | 100.0% (16/16) | 37.5% (6/16) | 4 / 8.3 / 13 |
| unicode | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) | 2 / 4.8 / 8 |

## Mutation Summary

| Mutation | Category | Runs | Verified | Edit Used | Success |
|----------|----------|------|----------|-----------|---------|
| delete-statement | structural | 4 | 50.0% (2/4) | 100.0% (4/4) | 50.0% (2/4) |
| duplicate-line-flip | duplicate | 4 | 75.0% (3/4) | 75.0% (3/4) | 75.0% (3/4) |
| flip-boolean | literal | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) |
| identifier-multi-edit | identifier | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| off-by-one | literal | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| remove-early-return | structural | 4 | 0.0% (0/4) | 100.0% (4/4) | 0.0% (0/4) |
| remove-negation | operator | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) |
| remove-optional-chain | access | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) |
| swap-adjacent-lines | structural | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) |
| swap-arithmetic | operator | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| swap-call-args | call | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| swap-comparison | operator | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| swap-equality | operator | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| swap-if-else | structural | 4 | 25.0% (1/4) | 100.0% (4/4) | 25.0% (1/4) |
| swap-increment-decrement | operator | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| swap-logical | operator | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) |
| swap-named-imports | import | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) |
| swap-nullish | operator | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) |
| swap-regex-quantifier | regex | 4 | 75.0% (3/4) | 75.0% (3/4) | 75.0% (3/4) |
| unicode-hyphen | unicode | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |

## Difficulty Summary

| Difficulty Score | Runs | Verified | Edit Used | Success |
|------------------|------|----------|-----------|---------|
| 0-2 | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| 3-5 | 24 | 75.0% (18/24) | 100.0% (24/24) | 75.0% (18/24) |
| 6-8 | 27 | 77.8% (21/27) | 96.3% (26/27) | 77.8% (21/27) |
| 9+ | 25 | 76.0% (19/25) | 96.0% (24/25) | 76.0% (19/25) |

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

    131#JY:        inspected_element_display_name: element.displayName,
    132#YY:        inspected_element_number_of_hooks: resolvedHookNames.size ?? null,
>>> 133#NW:      });
    134#TK:    };
    135#ZR:
```

**Patch args**

```diff
{
  "path": "hookNamesCache.js",
  "edits": [
    {
      "op": "set",
      "tag": "133#YY",
      "content": [
        "        inspected_element_number_of_hooks: resolvedHookNames?.size ?? null,"
      ]
    }
  ]
}
```

### Operator Remove Negation 005 (ReactDOMContainer.js)

#### Run 1

##### Attempt 1

- Path: ReactDOMContainer.js
- Operation: —

**Tool error**

```
No changes made to ReactDOMContainer.js. The request resolved to identical content.
Likely causes: target text is already correct, the tag/anchor/context points to the wrong location, or your assumption is stale.
Edit 0: replacement for 20#KY is identical to current content:
  20#KY|       (!disableCommentsAsDOMContainers &&
Next steps: re-read the targeted range, verify your tags/anchors against current file content, then submit a replacement that is not identical to existing text.
```

**Patch args**

```diff
{
  "path": "ReactDOMContainer.js",
  "edits": [
    {
      "op": "set",
      "tag": "20#KY",
      "content": [
        "      (!disableCommentsAsDOMContainers &&"
      ]
    }
  ]
}
```

### Operator Swap Arithmetic 007 (useCanvasInteraction.js)

#### Run 1

##### Attempt 1

- Path: useCanvasInteraction.js
- Operation: —

**Tool error**

```
Validation failed for tool "edit":
  - edits: must have required property 'edits'

Received arguments:
{
  "path": "useCanvasInteraction.js"
}
```

**Patch args**

```diff
{
  "path": "useCanvasInteraction.js"
}
```

### Operator Swap Nullish 007 (SuspenseBreadcrumbs.js)

#### Run 1

##### Attempt 1

- Path: SuspenseBreadcrumbs.js
- Operation: —

**Tool error**

```
No changes made to SuspenseBreadcrumbs.js. The request resolved to identical content.
Likely causes: target text is already correct, the tag/anchor/context points to the wrong location, or your assumption is stale.
The file currently contains these lines:
228#RN:      title={`Up to ${parent === null ? 'Unknown' : (parent.name || 'Unknown')}`}`],
229#JH:agent__intent
Your edits were normalized back to the original content (whitespace-only differences are preserved as-is). Next steps: re-read this range, choose the correct anchor/location, and submit a non-identical replacement.
The file differs from the original fixture at these lines:
228#JR|-      title={`Up to ${parent === null ? 'Unknown' : (parent.name ?? 'Unknown')}`}
229#MX|+      title={`Up to ${parent === null ? 'Unknown' : (parent.name || 'Unknown')}`}
```

**Patch args**

```diff
{
  "path": "SuspenseBreadcrumbs.js",
  "edits": [
    {
      "op": "replace",
      "first": "228#RN",
      "last": "229#JH",
      "content": [
        "      title={`Up to ${parent === null ? 'Unknown' : (parent.name || 'Unknown')}`}`],",
        "agent__intent"
      ]
    }
  ]
}
```

##### Attempt 2

- Path: SuspenseBreadcrumbs.js
- Operation: —

**Tool error**

```
Validation failed for tool "edit":
  - edits/0: must have required property 'tag'
  - edits/0: must NOT have additional properties
  - edits/0: must NOT have additional properties
  - edits/0: must NOT have additional properties
  - edits/0/op: must be equal to constant
  - edits/0: must NOT have additional properties
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
  - edits/0/op: must be equal to constant
  - edits/0: must match a schema in anyOf

Received arguments:
{
  "path": "SuspenseBreadcrumbs.js",
  "edits": [
    {
      "op": "replace",
      "first": "228#RN",
      "last": "230#XJ",
      "content": [
        "      title={`Up to ${parent === null ? 'Unknown' : (parent.name || 'Unknown')}`}",
        "    >"
      ],
      "agent__intent": "Replacing messed up title and removing stray text"
    }
  ]
}
```

**Patch args**

```diff
{
  "path": "SuspenseBreadcrumbs.js",
  "edits": [
    {
      "op": "replace",
      "first": "228#RN",
      "last": "230#XJ",
      "content": [
        "      title={`Up to ${parent === null ? 'Unknown' : (parent.name || 'Unknown')}`}",
        "    >"
      ],
      "agent__intent": "Replacing messed up title and removing stray text"
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
Validation failed for tool "edit":
  - edits/0: must have required property 'tag'
  - edits/0: must NOT have additional properties
  - edits/0: must NOT have additional properties
  - edits/0: must NOT have additional properties
  - edits/0/op: must be equal to constant
  - edits/0: must NOT have additional properties
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
  - edits/0/op: must be equal to constant
  - edits/0: must match a schema in anyOf

Received arguments:
{
  "path": "ReactDOMComponentTree.js",
  "edits": [
    {
      "op": "replace",
      "first": "131#SH",
      "last": "134#PN",
      "content": [
        "  if (targetInst) {",
        "    const tag = targetInst.tag;",
        "    // Don't return HostRoot, SuspenseComponent or ActivityComponent here.",
        "    if (",
        "      tag !== HostRoot &&",
        "      tag !== SuspenseComponent &&",
        "      tag !== ActivityComponent",
        "    ) {",
        "      return targetInst;",
        "    }",
        "  }"
      ],
      "agent__intent": "Reintroducing guard clause to skip HostRoot/Suspense/Activity before returning instance"
    }
  ]
}
```

**Patch args**

```diff
{
  "path": "ReactDOMComponentTree.js",
  "edits": [
    {
      "op": "replace",
      "first": "131#SH",
      "last": "134#PN",
      "content": [
        "  if (targetInst) {",
        "    const tag = targetInst.tag;",
        "    // Don't return HostRoot, SuspenseComponent or ActivityComponent here.",
        "    if (",
        "      tag !== HostRoot &&",
        "      tag !== SuspenseComponent &&",
        "      tag !== ActivityComponent",
        "    ) {",
        "      return targetInst;",
        "    }",
        "  }"
      ],
      "agent__intent": "Reintroducing guard clause to skip HostRoot/Suspense/Activity before returning instance"
    }
  ]
}
```

### Structural Swap Adjacent Lines 005 (ReactOwnerStackFrames.js)

#### Run 1

##### Attempt 1

- Path: ReactOwnerStackFrames.js
- Operation: —

**Tool error**

```
Validation failed for tool "edit":
  - edits/0: must have required property 'tag'
  - edits/0: must NOT have additional properties
  - edits/0: must NOT have additional properties
  - edits/0: must NOT have additional properties
  - edits/0/op: must be equal to constant
  - edits/0: must NOT have additional properties
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
  - edits/0/op: must be equal to constant
  - edits/0: must match a schema in anyOf

Received arguments:
{
  "path": "ReactOwnerStackFrames.js",
  "edits": [
    {
      "op": "replace",
      "first": "14#BP",
      "last": "15#QY",
      "content": [
        "  Error.prepareStackTrace = DefaultPrepareStackTrace;",
        "  let stack = error.stack;"
      ],
      "agent__intent": "Swapping the adjacent statements to restore the original order"
    }
  ]
}
```

**Patch args**

```diff
{
  "path": "ReactOwnerStackFrames.js",
  "edits": [
    {
      "op": "replace",
      "first": "14#BP",
      "last": "15#QY",
      "content": [
        "  Error.prepareStackTrace = DefaultPrepareStackTrace;",
        "  let stack = error.stack;"
      ],
      "agent__intent": "Swapping the adjacent statements to restore the original order"
    }
  ]
}
```

### Structural Swap Adjacent Lines 007 (ReactFlightClientConfigBundlerWebpack.js)

#### Run 1

##### Attempt 1

- Path: ReactFlightClientConfigBundlerWebpack.js
- Operation: —

**Tool error**

```
Validation failed for tool "edit":
  - edits/0: must have required property 'tag'
  - edits/0: must NOT have additional properties
  - edits/0: must NOT have additional properties
  - edits/0: must NOT have additional properties
  - edits/0/op: must be equal to constant
  - edits/0: must NOT have additional properties
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
  - edits/0/op: must be equal to constant
  - edits/0: must match a schema in anyOf

Received arguments:
{
  "path": "ReactFlightClientConfigBundlerWebpack.js",
  "edits": [
    {
      "op": "replace",
      "first": "190#NS",
      "last": "191#XW",
      "content": [
        "      chunkCache.set(chunkId, thenable);",
        "      thenable.then(resolve, ignoreReject);"
      ],
      "agent__intent": "Swapping chunk cache set and then handler order to prevent races"
    }
  ]
}
```

**Patch args**

```diff
{
  "path": "ReactFlightClientConfigBundlerWebpack.js",
  "edits": [
    {
      "op": "replace",
      "first": "190#NS",
      "last": "191#XW",
      "content": [
        "      chunkCache.set(chunkId, thenable);",
        "      thenable.then(resolve, ignoreReject);"
      ],
      "agent__intent": "Swapping chunk cache set and then handler order to prevent races"
    }
  ]
}
```

### Structural Swap If Else 001 (utils.js)

#### Run 1

##### Attempt 1

- Path: utils.js
- Operation: —

**Tool error**

```
Validation failed for tool "edit":
  - edits/0: must have required property 'tag'
  - edits/0: must NOT have additional properties
  - edits/0: must NOT have additional properties
  - edits/0: must NOT have additional properties
  - edits/0/op: must be equal to constant
  - edits/0: must NOT have additional properties
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
  - edits/0/op: must be equal to constant
  - edits/0: must match a schema in anyOf

Received arguments:
{
  "path": "utils.js",
  "edits": [
    {
      "op": "replace",
      "first": "28#HK",
      "last": "47#PN",
      "content": [
        "      if (!__IS_INTERNAL_VERSION__) {",
        "        const endOfSourceMapURLPattern = '.js/';",
        "        const endOfSourceMapURLIndex = sourceURL.lastIndexOf(endOfSourceMapURLPattern);",
        "        if (endOfSourceMapURLIndex === -1) {",
        "          return {",
        "            url: null,",
        "            shouldDisableButton: true,",
        "          };",
        "        } else {",
        "          filePath = sourceURL.slice(",
        "            endOfSourceMapURLIndex + endOfSourceMapURLPattern.length,",
        "            sourceURL.length,",
        "          );",
        "        }",
        "      } else {",
        "        return {",
        "          url: null,",
        "          shouldDisableButton: true,",
        "        };",
        "      }"
      ],
      "agent__intent": "Swapping if and else branch bodies to fix bug"
    }
  ]
}
```

**Patch args**

```diff
{
  "path": "utils.js",
  "edits": [
    {
      "op": "replace",
      "first": "28#HK",
      "last": "47#PN",
      "content": [
        "      if (!__IS_INTERNAL_VERSION__) {",
        "        const endOfSourceMapURLPattern = '.js/';",
        "        const endOfSourceMapURLIndex = sourceURL.lastIndexOf(endOfSourceMapURLPattern);",
        "        if (endOfSourceMapURLIndex === -1) {",
        "          return {",
        "            url: null,",
        "            shouldDisableButton: true,",
        "          };",
        "        } else {",
        "          filePath = sourceURL.slice(",
        "            endOfSourceMapURLIndex + endOfSourceMapURLPattern.length,",
        "            sourceURL.length,",
        "          );",
        "        }",
        "      } else {",
        "        return {",
        "          url: null,",
        "          shouldDisableButton: true,",
        "        };",
        "      }"
      ],
      "agent__intent": "Swapping if and else branch bodies to fix bug"
    }
  ]
}
```

### Structural Swap If Else 005 (ReactClientConsoleConfigPlain.js)

#### Run 1

##### Attempt 1

- Path: ReactClientConsoleConfigPlain.js
- Operation: —

**Tool error**

```
1 line has changed since last read. Use the updated LINE#ID references shown below (>>> marks changed lines).

    31#PN:  }
    32#ZR:
>>> 33#YS:  const newArgs = args.slice(0);
    34#JJ:  if (typeof newArgs[offset] === 'string') {
    35#VK:    newArgs.splice(offset, 0, badgeFormat, pad + badgeName + pad);
```

**Patch args**

```diff
{
  "path": "ReactClientConsoleConfigPlain.js",
  "edits": [
    {
      "op": "replace",
      "first": "33#ZR",
      "last": "38#PN",
      "content": [
        "",
        "  const newArgs = args.slice(0);",
        "  if (typeof newArgs[offset] === 'string') {",
        "    newArgs.splice(offset, 1, badgeFormat + ' ' + newArgs[offset], pad + badgeName + pad);",
        "  } else {",
        "    newArgs.splice(offset, 0, badgeFormat, pad + badgeName + pad);",
        "  }",
        ""
      ]
    }
  ]
}
```

### Structural Swap If Else 007 (index.js)

#### Run 1

##### Attempt 1

- Path: index.js
- Operation: —

**Tool error**

```
Validation failed for tool "edit":
  - edits/0: must have required property 'tag'
  - edits/0: must NOT have additional properties
  - edits/0: must NOT have additional properties
  - edits/0: must NOT have additional properties
  - edits/0/op: must be equal to constant
  - edits/0: must NOT have additional properties
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
  - edits/0/op: must be equal to constant
  - edits/0: must match a schema in anyOf

Received arguments:
{
  "path": "index.js",
  "edits": [
    {
      "op": "replace",
      "first": "85#YT",
      "last": "87#PN",
      "content": [
        "    if (isArray(updated)) {",
        "      updated.splice(((oldKey: any): number), 1);",
        "    } else {",
        "      delete updated[oldKey];",
        "    }"
      ],
      "agent__intent": "Correcting branch logic for array vs object rename cleanup"
    }
  ]
}
```

**Patch args**

```diff
{
  "path": "index.js",
  "edits": [
    {
      "op": "replace",
      "first": "85#YT",
      "last": "87#PN",
      "content": [
        "    if (isArray(updated)) {",
        "      updated.splice(((oldKey: any): number), 1);",
        "    } else {",
        "      delete updated[oldKey];",
        "    }"
      ],
      "agent__intent": "Correcting branch logic for array vs object rename cleanup"
    }
  ]
}
```

##### Attempt 2

- Path: index.js
- Operation: —

**Tool error**

```
Validation failed for tool "edit":
  - edits/0: must have required property 'tag'
  - edits/0: must NOT have additional properties
  - edits/0: must NOT have additional properties
  - edits/0: must NOT have additional properties
  - edits/0/op: must be equal to constant
  - edits/0: must NOT have additional properties
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
  - edits/0/op: must be equal to constant
  - edits/0: must match a schema in anyOf

Received arguments:
{
  "path": "index.js",
  "edits": [
    {
      "op": "replace",
      "first": "83#JP",
      "last": "86#TH",
      "content": [
        "    if (isArray(updated)) {",
        "      updated.splice(((oldKey: any): number), 1);",
        "    } else {",
        "      delete updated[oldKey];",
        "    }"
      ],
      "agent__intent": "Correcting array/object cleanup order in copyWithRename"
    }
  ]
}
```

**Patch args**

```diff
{
  "path": "index.js",
  "edits": [
    {
      "op": "replace",
      "first": "83#JP",
      "last": "86#TH",
      "content": [
        "    if (isArray(updated)) {",
        "      updated.splice(((oldKey: any): number), 1);",
        "    } else {",
        "      delete updated[oldKey];",
        "    }"
      ],
      "agent__intent": "Correcting array/object cleanup order in copyWithRename"
    }
  ]
}
```

### Unicode Unicode Hyphen 005 (babel.config.js)

#### Run 1

##### Attempt 1

- Path: babel.config.js
- Operation: —

**Tool error**

```
Validation failed for tool "edit":
  - edits: must have required property 'edits'

Received arguments:
{
  "path": "babel.config.js"
}
```

**Patch args**

```diff
{
  "path": "babel.config.js"
}
```

## Failed Tasks (0% passing)

### Access Remove Optional Chain 007 (index.js) — 0/1

**All runs failed with same error:** File mismatch for index.js

**Sample agent response (run 1):**
```
Reintroduced the optional chaining guard around `chrome.devtools.panels.elements.onSelectionChanged`, so both the listener registration and cleanup now safely handle environments where that API surface is missing. No tests were run (not requested).
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
 
@@ -113 @@
     }
   };
   const onBridgeShutdown = () => {
-    chrome.devtools.panels.elements.onSelectionChanged.removeListener(
+    chrome.devtools.panels.elements?.onSelectionChanged?.removeListener(
       onBrowserElementSelectionChanged,
     );
     if (sourcesPanel && sourcesPanel.onSelectionChanged) {
@@ -124 @@
 
   bridge.addListener('shutdown', onBridgeShutdown);
 
-  chrome.devtools.panels.elements.onSelectionChanged.addListener(onBrowserElementSelectionChanged);
+  chrome.devtools.panels.elements?.onSelectionChanged?.addListener(
+    onBrowserElementSelectionChanged,
+  );
   if (sourcesPanel && sourcesPanel.onSelectionChanged) {
     sourcesPanel.onSelectionChanged.addListener(onBrowserSourceSelectionChanged);
   }
```

### Duplicate Duplicate Line Flip 003 (ReactFiberDevToolsHook.js) — 0/1

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | — | 0 / 0 | 360.0s |

### Import Swap Named Imports 007 (InspectedElement.js) — 0/1

**All runs failed with same error:** File mismatch for InspectedElement.js

**Sample agent response (run 1):**
```
Swapped the two element-type imports so the destructuring aligns with the expected order (`ElementTypeRoot` first, then `ElementTypeSuspense`). No tests were run (not requested).
```

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

### Literal Flip Boolean 001 (ReactDOMLegacyServerImpl.js) — 0/1

**All runs failed with same error:** File mismatch for ReactDOMLegacyServerImpl.js

**Sample agent response (run 1):**
```
Flipped destination.push’s return value from `true` to `false`, ensuring the intended boolean behavior on line 41.
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

### Operator Remove Negation 005 (ReactDOMContainer.js) — 0/1

**All runs failed with same error:** File mismatch for ReactDOMContainer.js

**Sample agent response (run 1):**
```
Reviewed `ReactDOMContainer.js`. Line 20 already contains `(!disableCommentsAsDOMContainers && …)`, so the requested logical negation is already present; running the edit to insert it resulted in “No changes made…identical content.” No code edits were necessary.
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
```

### Operator Swap Logical 001 (ErrorView.js) — 0/1

**All runs failed with same error:** File mismatch for ErrorView.js

**Sample agent response (run 1):**
```
Changed the null-check on `dismissError` to use loose inequality so the dismiss button only renders when a callback is actually provided (`dismissError != null`), matching the intended guard. Not run (not requested).
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

### Operator Swap Nullish 005 (ReactLogo.js) — 0/1

**All runs failed with same error:** File mismatch for ReactLogo.js

**Sample agent response (run 1):**
```
Replaced the nullish coalescing operator with logical OR on the className expression to restore the intended fallback behavior (`className || ''`).
```

**Diff (expected vs actual):**
```diff
@@ -19 @@
   return (
     <svg
       xmlns="http://www.w3.org/2000/svg"
-      className={`${styles.ReactLogo} ${className || ''}`}
+      className={`${styles.ReactLogo} ${className || ''}`
       viewBox="-11.5 -10.23174 23 20.46348"
     >
       <circle cx="0" cy="0" r="2.05" fill="currentColor" />
```

### Regex Swap Regex Quantifier 003 (utils.js) — 0/1

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | — | 8,186 / 10,205 | 411.7s |

**Sample agent response (run 1):**
```
Which regex in `utils.js` is supposed to match whitespace? The file only contains the pluralization regexes (none touch whitespace) and the `createRegExp` builder that doesn’t include `\s` quantifiers. Point me to the relevant line or pattern so I can fix the swapped quantifier.
```

### Structural Delete Statement 001 (useExtensionComponentsPanelVisibility.js) — 0/1

**All runs failed with same error:** File mismatch for useExtensionComponentsPanelVisibility.js

**Sample agent response (run 1):**
```
Restored the `useState` initialization that tracks the components panel visibility so `setIsVisible` has the state to update. No automated tests were run; please execute the relevant suite if needed.
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
Restored the `ignored` flag extraction so `CallSiteView` can safely use it in the className logic. No tests were run (not requested).
```

**Diff (expected vs actual):**
```diff
@@ -35 @@
   const fetchFileWithCaching = useContext(FetchFileWithCachingContext);
 
   const [virtualFunctionName, virtualURL, virtualLine, virtualColumn] = callSite;
+  const ignored = callSite[4];
 
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
Reinserted the missing guard in `resolveCache`: if `resolveRequest()` returns a falsy value, we now early-return a new `Map` before continuing, preserving the original protective logic. Tests not run; please execute relevant suites if needed.
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
+
   return new Map();
 }
 
```

### Structural Remove Early Return 003 (ReactDOMComponentTree.js) — 0/1

**All runs failed with same error:** File mismatch for ReactDOMComponentTree.js

**Sample agent response (run 1):**
```
Added the missing guard in `getClosestInstanceFromNode` so the direct match now checks `targetInst.tag` and only returns when it isn‘t a HostRoot/SuspenseComponent/ActivityComponent, allowing traversal to continue for those boundary nodes. Tests not run (not requested).
```

**Diff (expected vs actual):**
```diff
@@ -129 @@
     targetInst = (targetNode: any)[internalInstanceKey];
   }
   if (targetInst) {
+    const tag = targetInst.tag;
     // Don't return HostRoot, SuspenseComponent or ActivityComponent here.
     // Don't return HostRoot, SuspenseComponent or ActivityComponent here.
-    return targetInst;
+    if (tag !== HostRoot && tag !== SuspenseComponent && tag !== ActivityComponent) {
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
Restored the missing null guard inside `tabs.map`, so we short-circuit before destructuring when a tab is `null` and keep the surrounding structure untouched. No automated tests were run; run the relevant suite (e.g., unit/batcher) if needed.
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
Added the cached-commit guard in `getCommitTree()` so when the requested commit already exists in `commitTrees` we return it immediately. Tests not run (not provided).
```

**Diff (expected vs actual):**
```diff
@@ -63 @@
   }
 
   const commitTrees = ((rootToCommitTreeMap.get(rootID): any): Array<CommitTree>);
-  if (commitIndex < commitTrees.length) {
+
+  if (commitTrees[commitIndex] != null) {
     return commitTrees[commitIndex];
   }
 
```

### Structural Swap Adjacent Lines 007 (ReactFlightClientConfigBundlerWebpack.js) — 0/1

**All runs failed with same error:** File mismatch for ReactFlightClientConfigBundlerWebpack.js

**Sample agent response (run 1):**
```
Swapped the two statements that register chunk loading and attach the then-handler so the cache is updated before the handler can run. This keeps fully resolved entries from being overwritten with stale `thenable`s when `loadChunk` resolves synchronously.

Tests not run (not requested).
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
- Swapped the bodies of the internal-version guard so `!__IS_INTERNAL_VERSION__` now runs the source-map fallback logic and the `else` branch simply disables the button when the internal build flag is set. 
- Verified no other lines were touched. 

Tests not run; please execute relevant suite if needed.
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
Swapped the `__DEV__` `preinitModule` error handling so the general “expected arguments” warning now runs only when `encountered` is non-empty, then emits the existing “only script as” diagnostic afterward. Tests not run (not requested).
```

**Diff (expected vs actual):**
```diff
@@ -251 @@
         'ReactDOM.preinitModule(): Expected up to two arguments, a non-empty `href` string and, optionally, an `options` object with a valid `as` property.%s',
         encountered,
       );
-    } else {
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
```

### Structural Swap If Else 007 (index.js) — 0/1

**All runs failed with same error:** File mismatch for index.js

**Sample agent response (run 1):**
```
Swapped the cleanup branch inside `copyWithRename` so arrays still splice their element while objects delete the old key, matching the intended behavior. No tests run; manual verification only.
```

**Diff (expected vs actual):**
```diff
@@ -85 @@
     } else {
       delete updated[oldKey];
     }
+    }
   } else {
     // $FlowFixMe[incompatible-use] number or string is fine here
     updated[oldKey] = copyWithRename(obj[oldKey], oldPath, newPath, index + 1);
@@ -123 @@
       effectDuration = stateNode.effectDuration != null ? stateNode.effectDuration : null;
       passiveEffectDuration =
         stateNode.passiveEffectDuration != null ? stateNode.passiveEffectDuration : null;
-    }
   }
   }
+  }
   return { effectDuration, passiveEffectDuration };
 }
 
@@ -167 @@
       return '[object Object]';
     }
     throw err;
-  }
 }
 }
+}
 
 // based on https://github.com/tmpfs/format-util/blob/0e62d430efb0a1c51448709abd3e2406c14d8401/format.js#L1
 // based on https://developer.mozilla.org/en-US/docs/Web/API/console#Using_string_substitutions
@@ -208 @@
         args.unshift(arg);
         return match;
       });
-    }
   }
   }
+  }
 
   // Arguments that remain after formatting.
   if (args.length) {
@@ -215 @@
   if (args.length) {
     for (let i = 0; i < args.length; i++) {
       formatted += ' ' + safeToString(args[i]);
-    }
   }
   }
+  }
 
   // Update escaped %% values.
   formatted = formatted.replace(/%{2,2}/g, '%');
```
