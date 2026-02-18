# Edit Benchmark Report

## Configuration

| Setting | Value |
|---------|-------|
| Date | 2026-02-18T03:46:29.756Z |
| Model | openrouter/openrouter/z-ai/glm-5 |
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
| Edit Tool Usage Rate | 95.0% (76/80) |
| **Edit Success Rate** | **96.5%** |
| Timeout Runs | 0 |
| Mutation Intent Match Rate | 80.3% |
| Patch Failure Rate | 3.5% (3/86) |
| Tasks All Passing | 63 |
| Tasks Flaky/Failing | 17 |

### Tool Calls

| Tool | Total | Avg/Run |
|------|-------|---------|
| Read | 173 | 2.2 |
| Edit | 86 | 1.1 |
| Write | 0 | 0.0 |
| **Tool Input Chars** | 25,432 | 318 |

### Tokens & Time

| Metric | Total | Avg/Run |
|--------|-------|---------|
| Input Tokens | 765,790 | 9,572 |
| Output Tokens | 254,887 | 3,186 |
| Total Tokens | 3,263,045 | 40,788 |
| Duration | 3994.6s | 49.9s |
| **Avg Indent Score** | — | **0.06** |

### Hashline Edit Subtypes

| Operation | Count | % |
|-----------|-------|---|
| set_line | 96 | 89.7% |
| replace_lines | 7 | 6.5% |
| insert_after | 3 | 2.8% |
| replace | 1 | 0.9% |
| **Total** | **107** | 100% |

## Task Results

| Task | File | Success | Edit Hit | R/E/W | Tokens (In/Out) | Time | Indent |
|------|------|---------|----------|-------|-----------------|------|--------|
| Access Remove Optional Chain 001 | fallbackEvalContext.js | 1/1 ✅ | 100.0% | 2/1/0 | 4,477/787 | 22.0s | 0.00 |
| Access Remove Optional Chain 003 | hookNamesCache.js | 1/1 ✅ | 100.0% | 2/1/0 | 7,853/935 | 15.6s | 0.00 |
| Access Remove Optional Chain 005 | registerDevToolsEventLogger.js | 1/1 ✅ | 66.7% | 7/3/0 | 38,860/16,045 | 413.1s | 0.00 |
| Access Remove Optional Chain 007 | index.js | 1/1 ✅ | 100.0% | 2/1/0 | 19,208/1,785 | 35.7s | 0.00 |
| Call Swap Call Args 001 | formatConsoleArguments.js | 1/1 ✅ | 100.0% | 2/1/0 | 3,861/661 | 20.3s | 0.00 |
| Call Swap Call Args 003 | ReactFlightDOMServerBrowser.js | 1/1 ✅ | 100.0% | 2/1/0 | 7,784/1,036 | 25.6s | 0.00 |
| Call Swap Call Args 005 | ReactNoopPersistent.js | 1/1 ✅ | 100.0% | 2/1/0 | 5,490/1,775 | 24.4s | 0.00 |
| Call Swap Call Args 007 | parseSourceAndMetadata.js | 1/1 ✅ | 100.0% | 3/1/0 | 19,321/1,469 | 33.9s | 0.00 |
| Duplicate Duplicate Line Flip 001 | isCustomElement.js | 1/1 ✅ | 100.0% | 2/1/0 | 4,126/1,378 | 21.0s | 0.00 |
| Duplicate Duplicate Line Flip 003 | ReactFiberDevToolsHook.js | 0/1 ❌ | 100.0% | 1/1/0 | 20,312/17,557 | 178.7s | 0.00 |
| Duplicate Duplicate Line Flip 005 | shallowEqual.js | 1/1 ✅ | 100.0% | 2/1/0 | 4,999/1,648 | 27.2s | 0.00 |
| Duplicate Duplicate Line Flip 007 | ReactDOMEventReplaying.js | 1/1 ✅ | 100.0% | 3/1/0 | 22,805/3,506 | 43.7s | 0.00 |
| Identifier Identifier Multi Edit 001 | Button.js | 1/1 ✅ | 100.0% | 2/1/0 | 1,756/628 | 13.1s | 0.00 |
| Identifier Identifier Multi Edit 003 | ReactFlightDOMClientBrowser.js | 1/1 ✅ | 100.0% | 2/1/0 | 8,024/1,043 | 17.4s | 0.00 |
| Identifier Identifier Multi Edit 005 | githubAPI.js | 1/1 ✅ | 100.0% | 2/1/0 | 3,758/853 | 23.9s | 0.00 |
| Identifier Identifier Multi Edit 007 | ReactFiberComponentStack.js | 1/1 ✅ | 100.0% | 2/1/0 | 7,663/839 | 18.3s | 0.00 |
| Import Swap Named Imports 001 | ListApp.js | 1/1 ✅ | 100.0% | 2/1/0 | 3,825/1,125 | 21.5s | 0.00 |
| Import Swap Named Imports 003 | index.js | 1/1 ✅ | 100.0% | 2/1/0 | 9,750/2,775 | 37.0s | 0.00 |
| Import Swap Named Imports 005 | SuspenseScrubber.js | 1/1 ✅ | 100.0% | 3/3/0 | 9,505/1,368 | 58.7s | 0.00 |
| Import Swap Named Imports 007 | InspectedElement.js | 0/1 ❌ | 100.0% | 0/0/0 | 0/0 | 360.0s | 0.00 |
| Literal Flip Boolean 001 | ReactDOMLegacyServerImpl.js | 1/1 ✅ | 100.0% | 2/1/0 | 9,390/4,989 | 60.2s | 0.00 |
| Literal Flip Boolean 003 | ReactProfilerTimer.js | 1/1 ✅ | 100.0% | 2/1/0 | 11,235/1,765 | 49.2s | 0.00 |
| Literal Flip Boolean 005 | OpenInEditorButton.js | 1/1 ✅ | 100.0% | 2/1/0 | 3,062/2,834 | 30.4s | 0.00 |
| Literal Flip Boolean 007 | Element.js | 1/1 ✅ | 100.0% | 2/1/0 | 12,251/878 | 16.4s | 0.00 |
| Literal Off By One 001 | ReactOwnerStackFrames.js | 1/1 ✅ | 100.0% | 2/1/0 | 4,002/851 | 18.6s | 0.00 |
| Literal Off By One 003 | ReactFlightClientConfigBundlerTurbopack.js | 1/1 ✅ | 100.0% | 2/1/0 | 8,479/1,134 | 22.7s | 0.00 |
| Literal Off By One 005 | ContextMenu.js | 1/1 ✅ | 100.0% | 2/1/0 | 3,429/864 | 41.0s | 0.00 |
| Literal Off By One 007 | index.js | 1/1 ✅ | 100.0% | 2/1/0 | 28,649/1,202 | 31.5s | 0.00 |
| Operator Remove Negation 001 | prepareInjection.js | 1/1 ✅ | 100.0% | 2/1/0 | 5,131/914 | 19.9s | 0.00 |
| Operator Remove Negation 003 | ReactDOMSelection.js | 1/1 ✅ | 100.0% | 2/1/0 | 7,911/3,201 | 57.4s | 0.00 |
| Operator Remove Negation 005 | ReactDOMContainer.js | 0/1 ❌ | 100.0% | 2/1/0 | 8,995/6,836 | 65.3s | 0.00 |
| Operator Remove Negation 007 | SelectEventPlugin.js | 1/1 ✅ | 100.0% | 2/1/0 | 8,083/1,884 | 26.4s | 0.00 |
| Operator Swap Arithmetic 001 | formatConsoleArguments.js | 1/1 ✅ | 100.0% | 2/1/0 | 4,600/637 | 15.0s | 0.00 |
| Operator Swap Arithmetic 003 | ReactFlightDOMServerBrowser.js | 1/1 ✅ | 100.0% | 2/1/0 | 9,532/1,415 | 21.8s | 0.00 |
| Operator Swap Arithmetic 005 | ReactFiberConfigWithNoResources.js | 1/1 ✅ | 100.0% | 2/1/0 | 4,523/673 | 19.6s | 0.00 |
| Operator Swap Arithmetic 007 | useCanvasInteraction.js | 0/1 ❌ | 100.0% | 0/0/0 | 0/0 | 0ms | 0.00 |
| Operator Swap Comparison 001 | useSmartTooltip.js | 1/1 ✅ | 100.0% | 2/1/0 | 5,128/6,260 | 58.1s | 0.00 |
| Operator Swap Comparison 003 | ReactFlightDOMServerBrowser.js | 1/1 ✅ | 100.0% | 2/1/0 | 15,918/4,342 | 56.2s | 0.00 |
| Operator Swap Comparison 005 | Rectangle.js | 1/1 ✅ | 100.0% | 2/1/0 | 3,299/1,780 | 24.2s | 0.00 |
| Operator Swap Comparison 007 | ReactFiberTreeReflection.js | 1/1 ✅ | 100.0% | 2/1/0 | 19,146/2,342 | 35.3s | 0.00 |
| Operator Swap Equality 001 | ReactNoopFlightClient.js | 1/1 ✅ | 100.0% | 2/1/0 | 7,375/1,004 | 23.9s | 0.00 |
| Operator Swap Equality 003 | astUtils.js | 1/1 ✅ | 100.0% | 2/1/0 | 10,544/2,705 | 33.8s | 0.00 |
| Operator Swap Equality 005 | ReactDOMContainer.js | 1/1 ✅ | 100.0% | 4/1/0 | 7,351/3,493 | 51.9s | 0.00 |
| Operator Swap Equality 007 | ReactFlightDOMServerBrowser.js | 1/1 ✅ | 100.0% | 2/1/0 | 14,044/3,390 | 44.2s | 0.00 |
| Operator Swap Increment Decrement 001 | index.js | 1/1 ✅ | 100.0% | 2/1/0 | 1,669/595 | 12.3s | 0.00 |
| Operator Swap Increment Decrement 003 | ReactFlightClientConfigBundlerESM.js | 1/1 ✅ | 100.0% | 2/1/0 | 10,587/775 | 16.9s | 0.00 |
| Operator Swap Increment Decrement 005 | ReactFiberViewTransitionComponent.js | 1/1 ✅ | 100.0% | 2/1/0 | 7,227/1,360 | 20.1s | 0.00 |
| Operator Swap Increment Decrement 007 | ReactFiberConcurrentUpdates.js | 1/1 ✅ | 100.0% | 2/1/0 | 9,978/771 | 14.6s | 0.00 |
| Operator Swap Logical 001 | ErrorView.js | 0/1 ❌ | 100.0% | 3/1/0 | 13,116/22,429 | 201.1s | 0.00 |
| Operator Swap Logical 003 | DevTools.js | 1/1 ✅ | 100.0% | 2/1/0 | 6,046/1,060 | 21.6s | 0.00 |
| Operator Swap Logical 005 | UseEffectEvent.js | 0/1 ❌ | 100.0% | 4/2/0 | 7,614/2,267 | 37.8s | 0.00 |
| Operator Swap Logical 007 | getHookNameForLocation.js | 1/1 ✅ | 100.0% | 2/1/0 | 10,508/1,555 | 25.6s | 0.00 |
| Operator Swap Nullish 001 | ElementBadges.js | 1/1 ✅ | 100.0% | 2/1/0 | 2,840/1,144 | 18.0s | 0.00 |
| Operator Swap Nullish 003 | ReactComponentStackFrame.js | 1/1 ✅ | 100.0% | 2/1/0 | 10,487/894 | 29.4s | 0.00 |
| Operator Swap Nullish 005 | ReactLogo.js | 1/1 ✅ | 100.0% | 2/1/0 | 4,194/876 | 21.0s | 0.00 |
| Operator Swap Nullish 007 | SuspenseBreadcrumbs.js | 1/1 ✅ | 100.0% | 2/1/0 | 11,094/2,331 | 27.0s | 0.00 |
| Regex Swap Regex Quantifier 001 | SimpleValues.js | 1/1 ✅ | 100.0% | 2/1/0 | 4,987/2,546 | 36.4s | 0.00 |
| Regex Swap Regex Quantifier 003 | utils.js | 1/1 ✅ | 100.0% | 1/1/0 | 15,645/16,028 | 176.9s | 0.00 |
| Regex Swap Regex Quantifier 005 | formatWithStyles.js | 1/1 ✅ | 100.0% | 2/1/0 | 13,989/7,629 | 100.2s | 0.00 |
| Regex Swap Regex Quantifier 007 | RunReactCompiler.ts | 1/1 ✅ | 100.0% | 1/1/0 | 27,929/40,831 | 351.0s | 0.00 |
| Structural Delete Statement 001 | useExtensionComponentsPanelVisibility.js | 0/1 ❌ | 100.0% | 2/1/0 | 5,326/1,360 | 20.6s | 0.00 |
| Structural Delete Statement 003 | useCanvasInteraction.js | 0/1 ❌ | 100.0% | 2/1/0 | 8,466/1,700 | 26.1s | 0.00 |
| Structural Delete Statement 005 | StackTraceView.js | 0/1 ❌ | 100.0% | 0/0/0 | 0/0 | 0ms | 0.00 |
| Structural Delete Statement 007 | ReactDOMFizzStaticBrowser.js | 0/1 ❌ | 100.0% | 0/0/0 | 0/0 | 0ms | 0.00 |
| Structural Remove Early Return 001 | ReactFlightAsyncDispatcher.js | 0/1 ❌ | 100.0% | 2/1/0 | 4,805/2,115 | 27.3s | 0.00 |
| Structural Remove Early Return 003 | ReactDOMComponentTree.js | 0/1 ❌ | 100.0% | 4/1/0 | 29,381/7,567 | 91.8s | 4.40 |
| Structural Remove Early Return 005 | TabBar.js | 0/1 ❌ | 100.0% | 3/1/0 | 6,902/1,311 | 50.5s | 0.00 |
| Structural Remove Early Return 007 | CommitTreeBuilder.js | 0/1 ❌ | 100.0% | 6/3/0 | 29,297/5,069 | 76.4s | 0.00 |
| Structural Swap Adjacent Lines 001 | reactPolling.js | 1/1 ✅ | 100.0% | 2/1/0 | 4,420/908 | 18.1s | 0.00 |
| Structural Swap Adjacent Lines 003 | OwnersStack.js | 1/1 ✅ | 100.0% | 2/1/0 | 9,092/733 | 22.7s | 0.00 |
| Structural Swap Adjacent Lines 005 | ReactOwnerStackFrames.js | 1/1 ✅ | 100.0% | 2/1/0 | 4,732/1,343 | 18.5s | 0.00 |
| Structural Swap Adjacent Lines 007 | ReactFlightClientConfigBundlerWebpack.js | 0/1 ❌ | 66.7% | 6/3/0 | 24,055/6,123 | 81.8s | 0.00 |
| Structural Swap If Else 001 | utils.js | 0/1 ❌ | 100.0% | 2/1/0 | 8,356/3,024 | 37.1s | 0.00 |
| Structural Swap If Else 003 | ReactDOMFloat.js | 0/1 ❌ | 100.0% | 2/1/0 | 12,818/1,895 | 30.9s | 0.00 |
| Structural Swap If Else 005 | ReactClientConsoleConfigPlain.js | 1/1 ✅ | 100.0% | 2/1/0 | 3,179/1,638 | 25.0s | 0.00 |
| Structural Swap If Else 007 | index.js | 1/1 ✅ | 100.0% | 2/1/0 | 8,689/1,312 | 24.6s | 0.00 |
| Unicode Unicode Hyphen 001 | formatProdErrorMessage.js | 1/1 ✅ | 50.0% | 2/2/0 | 4,829/837 | 36.0s | 0.00 |
| Unicode Unicode Hyphen 003 | SourceMapConsumer.js | 1/1 ✅ | 100.0% | 2/1/0 | 8,320/737 | 19.1s | 0.00 |
| Unicode Unicode Hyphen 005 | babel.config.js | 1/1 ✅ | 100.0% | 2/1/0 | 4,432/783 | 18.1s | 0.00 |
| Unicode Unicode Hyphen 007 | ReactInternalTestUtils.js | 1/1 ✅ | 100.0% | 2/1/0 | 15,327/735 | 25.6s | 0.00 |

## Category Summary

| Category | Runs | Verified | Edit Used | Success | Min/Avg/Max Difficulty |
|----------|------|----------|-----------|---------|------------------------|
| access | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) | 3 / 7.5 / 10 |
| call | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) | 2 / 7.8 / 14 |
| duplicate | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) | 8 / 11.3 / 17 |
| identifier | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) | 4 / 6.8 / 9 |
| import | 4 | 75.0% (3/4) | 75.0% (3/4) | 75.0% (3/4) | 2 / 3.8 / 5 |
| literal | 8 | 100.0% (8/8) | 100.0% (8/8) | 100.0% (8/8) | 3 / 6.9 / 10 |
| operator | 27 | 88.9% (24/27) | 100.0% (27/27) | 88.9% (24/27) | 3 / 6.7 / 10 |
| regex | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) | 2 / 5.8 / 10 |
| structural | 14 | 35.7% (5/14) | 100.0% (14/14) | 35.7% (5/14) | 4 / 8.3 / 13 |
| unicode | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) | 2 / 4.8 / 8 |
| unknown | 3 | 0.0% (0/3) | 0.0% (0/3) | 0.0% (0/3) | — |

## Mutation Summary

| Mutation | Category | Runs | Verified | Edit Used | Success |
|----------|----------|------|----------|-----------|---------|
| delete-statement | structural | 2 | 0.0% (0/2) | 100.0% (2/2) | 0.0% (0/2) |
| duplicate-line-flip | duplicate | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) |
| flip-boolean | literal | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| identifier-multi-edit | identifier | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| off-by-one | literal | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| remove-early-return | structural | 4 | 0.0% (0/4) | 100.0% (4/4) | 0.0% (0/4) |
| remove-negation | operator | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) |
| remove-optional-chain | access | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| swap-adjacent-lines | structural | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) |
| swap-arithmetic | operator | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| swap-call-args | call | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| swap-comparison | operator | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| swap-equality | operator | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| swap-if-else | structural | 4 | 50.0% (2/4) | 100.0% (4/4) | 50.0% (2/4) |
| swap-increment-decrement | operator | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| swap-logical | operator | 4 | 50.0% (2/4) | 100.0% (4/4) | 50.0% (2/4) |
| swap-named-imports | import | 4 | 75.0% (3/4) | 75.0% (3/4) | 75.0% (3/4) |
| swap-nullish | operator | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| swap-regex-quantifier | regex | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| unicode-hyphen | unicode | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| unknown | unknown | 3 | 0.0% (0/3) | 0.0% (0/3) | 0.0% (0/3) |

## Difficulty Summary

| Difficulty Score | Runs | Verified | Edit Used | Success |
|------------------|------|----------|-----------|---------|
| 0-2 | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| 3-5 | 23 | 78.3% (18/23) | 95.7% (22/23) | 78.3% (18/23) |
| 6-8 | 26 | 80.8% (21/26) | 100.0% (26/26) | 80.8% (21/26) |
| 9+ | 24 | 83.3% (20/24) | 100.0% (24/24) | 83.3% (20/24) |
| unknown | 3 | 0.0% (0/3) | 0.0% (0/3) | 0.0% (0/3) |

## Edit Tool Errors

Failures where the edit tool returned an error or failed to apply the patch.

### Access Remove Optional Chain 005 (registerDevToolsEventLogger.js)

#### Run 1

##### Attempt 1

- Path: registerDevToolsEventLogger.js
- Operation: —

**Tool error**

```
No changes made to registerDevToolsEventLogger.js. The edits produced identical content.
Edit 0: replacement for 34:a3 is identical to current content:
  34:a3|         currentLoggingIFrame?.contentWindow?.postMessage(
Your content must differ from what the file already contains. Re-read the file to see the current state.
The file differs from the original fixture at these lines:
34:ea  -        currentLoggingIFrame?.contentWindow.postMessage(
35:a3  +        currentLoggingIFrame?.contentWindow?.postMessage(
```

**Patch args**

```diff
{
  "path": "registerDevToolsEventLogger.js",
  "edits": [
    {
      "set_line": {
        "anchor": "34:a3",
        "new_text": "        currentLoggingIFrame?.contentWindow?.postMessage("
      }
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
1 line has changed since last read. Use the updated LINE:HASH references shown below (>>> marks changed lines).

    189:ec|      promises.push(thenable);
    190:87|      thenable.then(resolve, ignoreReject);
>>> 191:b6|      chunkCache.set(chunkId, thenable);
    192:e5|    } else if (entry !== null) {
    193:73|      promises.push(entry);
```

**Patch args**

```diff
{
  "path": "ReactFlightClientConfigBundlerWebpack.js",
  "edits": [
    {
      "set_line": {
        "anchor": "186:9a",
        "new_text": "      const thenable = loadChunk(chunkId, chunkFilename);"
      }
    },
    {
      "set_line": {
        "anchor": "187:ff",
        "new_text": "      chunkCache.set(chunkId, thenable);"
      }
    },
    {
      "set_line": {
        "anchor": "189:ec",
        "new_text": "      const resolve = chunkCache.set.bind(chunkCache, chunkId, null);"
      }
    },
    {
      "set_line": {
        "anchor": "190:b6",
        "new_text": "      // $FlowFixMe[method-unbinding]"
      }
    },
    {
      "set_line": {
        "anchor": "191:e5",
        "new_text": "      promises.push(thenable);"
      }
    },
    {
      "set_line": {
        "anchor": "192:73",
        "new_text": "      thenable.then(resolve, ignoreReject);"
      }
    }
  ]
}
```

### Unicode Unicode Hyphen 001 (formatProdErrorMessage.js)

#### Run 1

##### Attempt 1

- Path: formatProdErrorMessage.js
- Operation: —

**Tool error**

```
No changes made to formatProdErrorMessage.js. The edits produced identical content.
Edit 0: replacement for 24:73 is identical to current content:
  24:73|     'use the non-minified dev environment for full errors and additional ' +
Your content must differ from what the file already contains. Re-read the file to see the current state.
The file differs from the original fixture at these lines:
24:1f  -    'use the non\u2013minified dev environment for full errors and additional ' +
25:73  +    'use the non-minified dev environment for full errors and additional ' +
```

**Patch args**

```diff
{
  "path": "formatProdErrorMessage.js",
  "edits": [
    {
      "set_line": {
        "anchor": "24:73",
        "new_text": "    'use the non-minified dev environment for full errors and additional ' +"
      }
    }
  ]
}
```

## Failed Tasks (0% passing)

### Duplicate Duplicate Line Flip 003 (ReactFiberDevToolsHook.js) — 0/1

**All runs failed with same error:** File mismatch for ReactFiberDevToolsHook.js

**Sample agent response (run 1):**
```
Fixed. Line 77 had `'React instrumentation encountered an error: %o.'` with an extra period inside the string literal. Changed to `'React instrumentation encountered an error: %o'` to match all other identical error logging lines (97, 135, 150, 165, 187). The hash now matches (`78`) confirming the lines are identical.
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

### Import Swap Named Imports 007 (InspectedElement.js) — 0/1

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | — | 0 / 0 | 360.0s |

### Operator Remove Negation 005 (ReactDOMContainer.js) — 0/1

**All runs failed with same error:** File mismatch for ReactDOMContainer.js

**Sample agent response (run 1):**
```
Fixed. Line 16 now correctly reads `!!node &&` — the double negation ensures the node is truthy before checking its `nodeType`. Only that single token was changed.
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

### Operator Swap Arithmetic 007 (useCanvasInteraction.js) — 0/1

**All runs failed with same error:** Timeout waiting for response to set_thinking_level. Stderr: 

### Operator Swap Logical 001 (ErrorView.js) — 0/1

**All runs failed with same error:** File mismatch for ErrorView.js

**Sample agent response (run 1):**
```
Confirmed the change. Line 36 now uses `===` instead of `!==`.
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

### Operator Swap Logical 005 (UseEffectEvent.js) — 0/1

**All runs failed with same error:** File mismatch for UseEffectEvent.js

**Sample agent response (run 1):**
```
Fixed. Line 4 now has `||` instead of `&&` - the correct boolean operator for a fallback pattern.
```

**Diff (expected vs actual):**
```diff
@@ -2 @@
 
 const { useState, useEffect } = React;
 const useEffectEvent = React.useEffectEvent || React.experimental_useEffectEvent;
-
 export default function UseEffectEvent(): React.Node {
   return (
     <>
```

### Structural Delete Statement 001 (useExtensionComponentsPanelVisibility.js) — 0/1

**All runs failed with same error:** File mismatch for useExtensionComponentsPanelVisibility.js

**Sample agent response (run 1):**
```
Fixed. The missing `useState` hook declaration was restored at line 16. The initial value `true` matches the documented behavior in the comment on line 14 ("will just return constant `true` value" for non-extension implementations).
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
The fix is complete. The missing statement `isMouseDownRef.current = true;` has been restored to `onCanvasMouseDown`. This ensures the mouse-down state is properly tracked:
- On mousedown: `isMouseDownRef.current = true` (restored)
- On mousemove: checks `isMouseDownRef.current` to detect drag
- On mouseup: `isMouseDownRef.current = false`
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

**All runs failed with same error:** Timeout waiting for response to set_thinking_level. Stderr: 

### Structural Delete Statement 007 (ReactDOMFizzStaticBrowser.js) — 0/1

**All runs failed with same error:** Timeout waiting for response to set_thinking_level. Stderr: 

### Structural Remove Early Return 001 (ReactFlightAsyncDispatcher.js) — 0/1

**All runs failed with same error:** File mismatch for ReactFlightAsyncDispatcher.js

**Sample agent response (run 1):**
```
Fixed. The guard clause has been restored at lines 17-19:

```javascript
if (!request) {
  return new Map();
}
```

This 3-line pattern (if condition, return statement, closing brace) now properly guards against null/undefined `request` values before proceeding.
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
Fix verified. The guard clause was restored in `getClosestInstanceFromNode` - the function now correctly checks that `targetInst.tag` is NOT `HostRoot`, `SuspenseComponent`, or `ActivityComponent` before returning early. If it is one of those types, execution falls through to the loop which handles hydrated/dehydrated boundary cases appropriately.
```

**Diff (expected vs actual):**
```diff
@@ -130 @@
   }
   if (targetInst) {
     // Don't return HostRoot, SuspenseComponent or ActivityComponent here.
-    return targetInst;
+    const tag = targetInst.tag;
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
Fix applied. The guard clause `if (tab === null) { return null; }` is now in place at lines 92-94, protecting the destructuring on line 95 from null values in the `tabs` array.
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
Fixed. The guard clause `if (node == null) { return; }` was restored in `recursivelyInitializeTree` at lines 127-129.
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
@@ -127 @@
   dataForRoot: ProfilingDataForRootFrontend,
 ): void {
   const node = dataForRoot.snapshots.get(id);
-  if (node != null) {
-    nodes.set(id, {
-      id,
-      children: node.children,
-      displayName: node.displayName,
-      hocDisplayNames: node.hocDisplayNames,
-      key: node.key,
-      parentID,
-      treeBaseDuration: ((dataForRoot.initialTreeBaseDurations.get(id): any): number),
-      type: node.type,
-      compiledWithForget: node.compiledWithForget,
-    });
-
-    node.children.forEach((childID) => recursivelyInitializeTree(childID, id, nodes, dataForRoot));
+  if (node == null) {
+    return;
   }
   }
+  nodes.set(id, {
+    id,
+    children: node.children,
+    displayName: node.displayName,
+    hocDisplayNames: node.hocDisplayNames,
+    key: node.key,
+    parentID,
+    treeBaseDuration: ((dataForRoot.initialTreeBaseDurations.get(id): any): number),
+    type: node.type,
+    compiledWithForget: node.compiledWithForget,
+  });
+  node.children.forEach((childID) => recursivelyInitializeTree(childID, id, nodes, dataForRoot));
 }
 
 function updateTree(commitTree: CommitTree, operations: Array<number>): CommitTree {
```

### Structural Swap Adjacent Lines 007 (ReactFlightClientConfigBundlerWebpack.js) — 0/1

**All runs failed with same error:** File mismatch for ReactFlightClientConfigBundlerWebpack.js

**Sample agent response (run 1):**
```
Fixed. The sequence is now correct:
1. `const thenable = loadChunk(...)` - create the thenable
2. `chunkCache.set(chunkId, thenable)` - **immediately cache it** (was incorrectly at the end)
3. `const resolve = ...` - create resolve handler
4. `promises.push(thenable)` - track the promise
5. `thenable.then(resolve, ignoreReject)` - attach handlers

The bug was that `chunkCache.set(chunkId, thenable)` happened after `thenable.then(...)`. If the thenable resolved synchronously, the resolve handl...
```

**Diff (expected vs actual):**
```diff
@@ -184 @@
     const entry = chunkCache.get(chunkId);
     if (entry === undefined) {
       const thenable = loadChunk(chunkId, chunkFilename);
-      promises.push(thenable);
-      // $FlowFixMe[method-unbinding]
+      chunkCache.set(chunkId, thenable);
       const resolve = chunkCache.set.bind(chunkCache, chunkId, null);
       const resolve = chunkCache.set.bind(chunkCache, chunkId, null);
+      // $FlowFixMe[method-unbinding]
+      promises.push(thenable);
       thenable.then(resolve, ignoreReject);
       thenable.then(resolve, ignoreReject);
-      chunkCache.set(chunkId, thenable);
     } else if (entry !== null) {
       promises.push(entry);
     }
```

### Structural Swap If Else 001 (utils.js) — 0/1

**All runs failed with same error:** File mismatch for utils.js

**Sample agent response (run 1):**
```
Fixed. The change swaps the if/else bodies:
- Removed `!` from the condition on line 28
- The processing logic (lines 29-41) is now in the `if` branch for internal versions
- The early return (lines 43-46) is now in the `else` branch for non-internal versions
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
Fixed. Changed `if (encountered)` to `if (!encountered)` on line 249, which effectively swaps the if/else branches:
- When `encountered` is empty (no validation errors), the switch checks if `as` type is valid
- When `encountered` has content (validation errors exist), the error message logs the problem with the arguments
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
