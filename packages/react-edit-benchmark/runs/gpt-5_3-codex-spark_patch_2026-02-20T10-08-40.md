# Edit Benchmark Report

## Configuration

| Setting | Value |
|---------|-------|
| Date | 2026-02-20T10:07:43.994Z |
| Model | openai-codex/openai-codex/gpt-5.3-codex-spark |
| Thinking Level | low |
| Runs per task | 1 |
| Edit Variant | patch |
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
| **Edit Success Rate** | **92.3%** |
| Timeout Runs | 0 |
| Mutation Intent Match Rate | 83.8% |
| Patch Failure Rate | 7.7% (7/91) |
| Tasks All Passing | 63 |
| Tasks Flaky/Failing | 17 |

### Tool Calls

| Tool | Total | Avg/Run |
|------|-------|---------|
| Read | 242 | 3.0 |
| Edit | 91 | 1.1 |
| Write | 0 | 0.0 |
| **Tool Input Chars** | 44,123 | 552 |

### Tokens & Time

| Metric | Total | Avg/Run |
|--------|-------|---------|
| Input Tokens | 535,479 | 6,693 |
| Output Tokens | 143,804 | 1,798 |
| Total Tokens | 2,924,403 | 36,555 |
| Duration | 488.8s | 6.1s |
| **Avg Indent Score** | — | **0.00** |

## Task Results

| Task | File | Success | Edit Hit | R/E/W | Tokens (In/Out) | Time | Indent |
|------|------|---------|----------|-------|-----------------|------|--------|
| Access Remove Optional Chain 001 | fallbackEvalContext.js | 1/1 ✅ | 100.0% | 4/1/0 | 6,195/987 | 11.6s | 0.00 |
| Access Remove Optional Chain 003 | hookNamesCache.js | 1/1 ✅ | 100.0% | 2/1/0 | 5,212/1,345 | 4.2s | 0.00 |
| Access Remove Optional Chain 005 | registerDevToolsEventLogger.js | 1/1 ✅ | 100.0% | 2/1/0 | 3,013/591 | 3.0s | 0.00 |
| Access Remove Optional Chain 007 | index.js | 0/1 ❌ | 100.0% | 6/1/0 | 15,189/3,504 | 9.8s | 0.00 |
| Call Swap Call Args 001 | formatConsoleArguments.js | 1/1 ✅ | 100.0% | 2/1/0 | 2,397/292 | 5.3s | 0.00 |
| Call Swap Call Args 003 | ReactFlightDOMServerBrowser.js | 0/1 ❌ | 100.0% | 6/1/0 | 14,131/9,629 | 23.5s | 0.00 |
| Call Swap Call Args 005 | ReactNoopPersistent.js | 0/1 ❌ | 100.0% | 4/1/0 | 2,829/610 | 3.9s | 0.00 |
| Call Swap Call Args 007 | parseSourceAndMetadata.js | 1/1 ✅ | 100.0% | 3/1/0 | 9,939/490 | 3.0s | 0.00 |
| Duplicate Duplicate Line Flip 001 | isCustomElement.js | 1/1 ✅ | 50.0% | 2/2/0 | 6,308/884 | 4.0s | 0.00 |
| Duplicate Duplicate Line Flip 003 | ReactFiberDevToolsHook.js | 0/1 ❌ | 100.0% | 4/1/0 | 8,402/1,329 | 6.4s | 0.00 |
| Duplicate Duplicate Line Flip 005 | shallowEqual.js | 1/1 ✅ | 100.0% | 3/1/0 | 2,487/390 | 2.8s | 0.00 |
| Duplicate Duplicate Line Flip 007 | ReactDOMEventReplaying.js | 1/1 ✅ | 100.0% | 5/1/0 | 24,106/7,079 | 13.7s | 0.00 |
| Identifier Identifier Multi Edit 001 | Button.js | 1/1 ✅ | 100.0% | 3/1/0 | 2,402/510 | 4.3s | 0.00 |
| Identifier Identifier Multi Edit 003 | ReactFlightDOMClientBrowser.js | 1/1 ✅ | 100.0% | 3/1/0 | 8,581/824 | 4.8s | 0.00 |
| Identifier Identifier Multi Edit 005 | githubAPI.js | 1/1 ✅ | 100.0% | 2/1/0 | 2,535/530 | 3.0s | 0.00 |
| Identifier Identifier Multi Edit 007 | ReactFiberComponentStack.js | 1/1 ✅ | 100.0% | 3/1/0 | 4,636/696 | 4.4s | 0.00 |
| Import Swap Named Imports 001 | ListApp.js | 1/1 ✅ | 100.0% | 2/1/0 | 5,283/408 | 2.5s | 0.00 |
| Import Swap Named Imports 003 | index.js | 1/1 ✅ | 100.0% | 3/1/0 | 4,752/1,130 | 7.3s | 0.00 |
| Import Swap Named Imports 005 | SuspenseScrubber.js | 1/1 ✅ | 100.0% | 2/1/0 | 3,206/372 | 2.8s | 0.00 |
| Import Swap Named Imports 007 | InspectedElement.js | 1/1 ✅ | 100.0% | 5/1/0 | 10,520/4,891 | 10.4s | 0.00 |
| Literal Flip Boolean 001 | ReactDOMLegacyServerImpl.js | 1/1 ✅ | 100.0% | 3/1/0 | 6,019/507 | 3.0s | 0.00 |
| Literal Flip Boolean 003 | ReactProfilerTimer.js | 0/1 ❌ | 100.0% | 3/1/0 | 21,194/11,682 | 19.6s | 0.00 |
| Literal Flip Boolean 005 | OpenInEditorButton.js | 1/1 ✅ | 100.0% | 3/1/0 | 2,704/465 | 3.2s | 0.00 |
| Literal Flip Boolean 007 | Element.js | 1/1 ✅ | 100.0% | 3/1/0 | 8,024/604 | 3.2s | 0.00 |
| Literal Off By One 001 | ReactOwnerStackFrames.js | 1/1 ✅ | 100.0% | 4/2/0 | 3,137/571 | 3.8s | 0.00 |
| Literal Off By One 003 | ReactFlightClientConfigBundlerTurbopack.js | 1/1 ✅ | 100.0% | 2/1/0 | 4,775/442 | 5.9s | 0.00 |
| Literal Off By One 005 | ContextMenu.js | 1/1 ✅ | 100.0% | 2/1/0 | 3,190/453 | 3.0s | 0.00 |
| Literal Off By One 007 | index.js | 1/1 ✅ | 100.0% | 3/2/0 | 10,758/877 | 6.2s | 0.00 |
| Operator Remove Negation 001 | prepareInjection.js | 1/1 ✅ | 100.0% | 2/1/0 | 2,726/400 | 2.5s | 0.00 |
| Operator Remove Negation 003 | ReactDOMSelection.js | 0/1 ❌ | 100.0% | 6/1/0 | 20,181/13,363 | 19.8s | 0.00 |
| Operator Remove Negation 005 | ReactDOMContainer.js | 0/1 ❌ | 100.0% | 4/1/0 | 9,139/4,133 | 10.5s | 0.00 |
| Operator Remove Negation 007 | SelectEventPlugin.js | 1/1 ✅ | 100.0% | 3/1/0 | 4,389/490 | 3.0s | 0.00 |
| Operator Swap Arithmetic 001 | formatConsoleArguments.js | 1/1 ✅ | 100.0% | 3/1/0 | 2,855/341 | 4.7s | 0.00 |
| Operator Swap Arithmetic 003 | ReactFlightDOMServerBrowser.js | 1/1 ✅ | 100.0% | 3/1/0 | 5,266/997 | 3.3s | 0.00 |
| Operator Swap Arithmetic 005 | ReactFiberConfigWithNoResources.js | 1/1 ✅ | 100.0% | 2/1/0 | 5,205/456 | 3.4s | 0.00 |
| Operator Swap Arithmetic 007 | useCanvasInteraction.js | 1/1 ✅ | 100.0% | 3/1/0 | 4,498/519 | 2.8s | 0.00 |
| Operator Swap Comparison 001 | useSmartTooltip.js | 1/1 ✅ | 100.0% | 3/1/0 | 4,546/1,861 | 5.6s | 0.00 |
| Operator Swap Comparison 003 | ReactFlightDOMServerBrowser.js | 1/1 ✅ | 100.0% | 2/1/0 | 5,353/946 | 3.1s | 0.00 |
| Operator Swap Comparison 005 | Rectangle.js | 1/1 ✅ | 100.0% | 2/1/0 | 5,863/302 | 2.9s | 0.00 |
| Operator Swap Comparison 007 | ReactFiberTreeReflection.js | 1/1 ✅ | 100.0% | 3/1/0 | 9,153/520 | 16.1s | 0.00 |
| Operator Swap Equality 001 | ReactNoopFlightClient.js | 1/1 ✅ | 100.0% | 2/1/0 | 3,173/414 | 4.2s | 0.00 |
| Operator Swap Equality 003 | astUtils.js | 1/1 ✅ | 100.0% | 3/1/0 | 12,953/697 | 4.2s | 0.00 |
| Operator Swap Equality 005 | ReactDOMContainer.js | 1/1 ✅ | 100.0% | 2/1/0 | 2,187/569 | 4.2s | 0.00 |
| Operator Swap Equality 007 | ReactFlightDOMServerBrowser.js | 1/1 ✅ | 100.0% | 6/1/0 | 5,787/834 | 6.0s | 0.00 |
| Operator Swap Increment Decrement 001 | index.js | 1/1 ✅ | 100.0% | 2/1/0 | 4,954/287 | 2.5s | 0.00 |
| Operator Swap Increment Decrement 003 | ReactFlightClientConfigBundlerESM.js | 1/1 ✅ | 100.0% | 2/1/0 | 4,278/369 | 3.1s | 0.00 |
| Operator Swap Increment Decrement 005 | ReactFiberViewTransitionComponent.js | 1/1 ✅ | 100.0% | 2/1/0 | 2,831/312 | 3.2s | 0.00 |
| Operator Swap Increment Decrement 007 | ReactFiberConcurrentUpdates.js | 1/1 ✅ | 100.0% | 4/1/0 | 8,847/415 | 6.2s | 0.00 |
| Operator Swap Logical 001 | ErrorView.js | 0/1 ❌ | 100.0% | 6/1/0 | 17,799/11,916 | 18.5s | 0.00 |
| Operator Swap Logical 003 | DevTools.js | 1/1 ✅ | 100.0% | 3/1/0 | 6,474/438 | 3.7s | 0.00 |
| Operator Swap Logical 005 | UseEffectEvent.js | 1/1 ✅ | 100.0% | 2/1/0 | 2,109/388 | 3.4s | 0.00 |
| Operator Swap Logical 007 | getHookNameForLocation.js | 1/1 ✅ | 100.0% | 2/1/0 | 5,210/526 | 2.6s | 0.00 |
| Operator Swap Nullish 001 | ElementBadges.js | 1/1 ✅ | 100.0% | 2/1/0 | 5,640/792 | 3.3s | 0.00 |
| Operator Swap Nullish 003 | ReactComponentStackFrame.js | 1/1 ✅ | 100.0% | 3/1/0 | 6,070/502 | 3.1s | 0.00 |
| Operator Swap Nullish 005 | ReactLogo.js | 1/1 ✅ | 100.0% | 2/1/0 | 2,124/289 | 2.6s | 0.00 |
| Operator Swap Nullish 007 | SuspenseBreadcrumbs.js | 1/1 ✅ | 100.0% | 2/1/0 | 8,988/1,137 | 5.7s | 0.00 |
| Regex Swap Regex Quantifier 001 | SimpleValues.js | 1/1 ✅ | 100.0% | 3/1/0 | 5,498/502 | 4.2s | 0.00 |
| Regex Swap Regex Quantifier 003 | utils.js | 1/1 ✅ | 100.0% | 4/1/0 | 10,872/3,400 | 7.8s | 0.00 |
| Regex Swap Regex Quantifier 005 | formatWithStyles.js | 1/1 ✅ | 100.0% | 2/1/0 | 3,444/890 | 3.2s | 0.00 |
| Regex Swap Regex Quantifier 007 | RunReactCompiler.ts | 1/1 ✅ | 100.0% | 3/1/0 | 8,608/3,287 | 11.7s | 0.00 |
| Structural Delete Statement 001 | useExtensionComponentsPanelVisibility.js | 1/1 ✅ | 50.0% | 3/2/0 | 3,258/871 | 3.8s | 0.00 |
| Structural Delete Statement 003 | useCanvasInteraction.js | 1/1 ✅ | 100.0% | 2/1/0 | 4,442/388 | 2.4s | 0.00 |
| Structural Delete Statement 005 | StackTraceView.js | 0/1 ❌ | 100.0% | 5/1/0 | 4,805/1,334 | 8.3s | 0.00 |
| Structural Delete Statement 007 | ReactDOMFizzStaticBrowser.js | 0/1 ❌ | 100.0% | 2/1/0 | 4,460/908 | 3.3s | 0.00 |
| Structural Remove Early Return 001 | ReactFlightAsyncDispatcher.js | 0/1 ❌ | 100.0% | 3/1/0 | 2,638/551 | 11.0s | 0.00 |
| Structural Remove Early Return 003 | ReactDOMComponentTree.js | 0/1 ❌ | 100.0% | 2/1/0 | 7,649/1,444 | 5.4s | 0.00 |
| Structural Remove Early Return 005 | TabBar.js | 0/1 ❌ | 100.0% | 5/2/0 | 4,963/1,546 | 9.5s | 0.00 |
| Structural Remove Early Return 007 | CommitTreeBuilder.js | 0/1 ❌ | 100.0% | 3/1/0 | 12,645/2,025 | 6.3s | 0.00 |
| Structural Swap Adjacent Lines 001 | reactPolling.js | 1/1 ✅ | 100.0% | 2/1/0 | 2,945/416 | 2.4s | 0.00 |
| Structural Swap Adjacent Lines 003 | OwnersStack.js | 1/1 ✅ | 50.0% | 4/2/0 | 6,525/712 | 4.7s | 0.00 |
| Structural Swap Adjacent Lines 005 | ReactOwnerStackFrames.js | 1/1 ✅ | 100.0% | 2/1/0 | 2,482/551 | 9.4s | 0.00 |
| Structural Swap Adjacent Lines 007 | ReactFlightClientConfigBundlerWebpack.js | 0/1 ❌ | 100.0% | 4/2/0 | 23,331/12,361 | 20.9s | 0.00 |
| Structural Swap If Else 001 | utils.js | 0/1 ❌ | 100.0% | 3/1/0 | 6,021/3,611 | 6.3s | 0.00 |
| Structural Swap If Else 003 | ReactDOMFloat.js | 0/1 ❌ | 100.0% | 5/1/0 | 15,264/8,535 | 13.7s | 0.00 |
| Structural Swap If Else 005 | ReactClientConsoleConfigPlain.js | 1/1 ✅ | 100.0% | 4/1/0 | 3,137/873 | 3.4s | 0.00 |
| Structural Swap If Else 007 | index.js | 1/1 ✅ | 100.0% | 2/1/0 | 4,926/506 | 2.6s | 0.00 |
| Unicode Unicode Hyphen 001 | formatProdErrorMessage.js | 1/1 ✅ | 100.0% | 2/1/0 | 2,174/389 | 3.1s | 0.00 |
| Unicode Unicode Hyphen 003 | SourceMapConsumer.js | 1/1 ✅ | 33.3% | 2/3/0 | 5,520/1,127 | 5.0s | 0.00 |
| Unicode Unicode Hyphen 005 | babel.config.js | 1/1 ✅ | 50.0% | 2/2/0 | 2,881/579 | 2.8s | 0.00 |
| Unicode Unicode Hyphen 007 | ReactInternalTestUtils.js | 1/1 ✅ | 50.0% | 3/2/0 | 6,469/693 | 4.6s | 0.00 |

## Category Summary

| Category | Runs | Verified | Edit Used | Success | Min/Avg/Max Difficulty |
|----------|------|----------|-----------|---------|------------------------|
| access | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) | 3 / 7.5 / 10 |
| call | 4 | 50.0% (2/4) | 100.0% (4/4) | 50.0% (2/4) | 2 / 7.8 / 14 |
| duplicate | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) | 8 / 11.3 / 17 |
| identifier | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) | 4 / 6.8 / 9 |
| import | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) | 2 / 3.8 / 5 |
| literal | 8 | 87.5% (7/8) | 100.0% (8/8) | 87.5% (7/8) | 3 / 6.9 / 10 |
| operator | 28 | 89.3% (25/28) | 100.0% (28/28) | 89.3% (25/28) | 3 / 6.7 / 10 |
| regex | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) | 2 / 5.8 / 10 |
| structural | 16 | 43.8% (7/16) | 100.0% (16/16) | 43.8% (7/16) | 4 / 8.3 / 13 |
| unicode | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) | 2 / 4.8 / 8 |

## Mutation Summary

| Mutation | Category | Runs | Verified | Edit Used | Success |
|----------|----------|------|----------|-----------|---------|
| delete-statement | structural | 4 | 50.0% (2/4) | 100.0% (4/4) | 50.0% (2/4) |
| duplicate-line-flip | duplicate | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) |
| flip-boolean | literal | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) |
| identifier-multi-edit | identifier | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| off-by-one | literal | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| remove-early-return | structural | 4 | 0.0% (0/4) | 100.0% (4/4) | 0.0% (0/4) |
| remove-negation | operator | 4 | 50.0% (2/4) | 100.0% (4/4) | 50.0% (2/4) |
| remove-optional-chain | access | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) |
| swap-adjacent-lines | structural | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) |
| swap-arithmetic | operator | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| swap-call-args | call | 4 | 50.0% (2/4) | 100.0% (4/4) | 50.0% (2/4) |
| swap-comparison | operator | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| swap-equality | operator | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| swap-if-else | structural | 4 | 50.0% (2/4) | 100.0% (4/4) | 50.0% (2/4) |
| swap-increment-decrement | operator | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| swap-logical | operator | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) |
| swap-named-imports | import | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| swap-nullish | operator | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| swap-regex-quantifier | regex | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| unicode-hyphen | unicode | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |

## Difficulty Summary

| Difficulty Score | Runs | Verified | Edit Used | Success |
|------------------|------|----------|-----------|---------|
| 0-2 | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) |
| 3-5 | 24 | 87.5% (21/24) | 100.0% (24/24) | 87.5% (21/24) |
| 6-8 | 27 | 77.8% (21/27) | 100.0% (27/27) | 77.8% (21/27) |
| 9+ | 25 | 72.0% (18/25) | 100.0% (25/25) | 72.0% (18/25) |

## Edit Tool Errors

Failures where the edit tool returned an error or failed to apply the patch.

### Duplicate Duplicate Line Flip 001 (isCustomElement.js)

#### Run 1

##### Attempt 1

- Path: /tmp/rb-7a589d56-f6ee-4982-b756-fba77ce7902c/b1475ee955ed159a3/isCustomElement.js
- Operation: —

**Tool error**

```
Found 2 occurrences in /tmp/rb-7a589d56-f6ee-4982-b756-fba77ce7902c/b1475ee955ed159a3/isCustomElement.js:

  7 |  * @flow
  8 |  */
  9 | 
  10 | function isCustomElement(tagName: string, props: Object): boolean {
  11 |   if (tagName.indexOf('-') === -1) {
  12 |     return true;
  13 |   }
  14 |   switch (tagName) {
  15 |     // These are reserved SVG and MathML elements.
  16 |     // We don't mind this list too much because we expect it to never grow.
  17 |     // The alternative is to track the namespace in a few places which is convo…
  18 |     // https://html.spec.whatwg.org/multipage/custom-elements.html#custom-eleme…

  24 |     case 'font-face-format':
  25 |     case 'font-face-name':
  26 |     case 'missing-glyph':
  27 |       return false;
  28 |     default:
  29 |       return true;
  30 |   }
  31 | }
  32 | 
  33 | export default isCustomElement;
  34 | 

Add more context lines to disambiguate.
```

**Patch args**

```diff
@@
-    return true;
+    return false;

```

### Structural Delete Statement 001 (useExtensionComponentsPanelVisibility.js)

#### Run 1

##### Attempt 1

- Path: useExtensionComponentsPanelVisibility.js
- Operation: —

**Tool error**

```
Failed to find expected lines in /tmp/rb-7a589d56-f6ee-4982-b756-fba77ce7902c/b1475ee9c65d159c9/useExtensionComponentsPanelVisibility.js:
  const [isVisible, setIsVisible] = useState(true);

Closest match (39% similar) near line 18:
  16 |   useEffect(() => {
  17 |     function onPanelShown() {
  18 |       setIsVisible(true);
  19 |     }
  20 |     function onPanelHidden() {
```

**Patch args**

```diff
@@ export function useExtensionComponentsPanelVisibility(bridge: FrontendBridge): boolean {
   const [isVisible, setIsVisible] = useState(true);
@@
   return isVisible;
 }
```

### Structural Swap Adjacent Lines 003 (OwnersStack.js)

#### Run 1

##### Attempt 1

- Path: OwnersStack.js
- Operation: —

**Tool error**

```
Failed to find expected lines in /tmp/rb-7a589d56-f6ee-4982-b756-fba77ce7902c/b1475ee955f1159bb/OwnersStack.js:
 const isInStore = store.containsElement(owner.id);
  const owner = owners[selectedIndex - 1];
  const isInStore = store.containsElement(owner.id);

Closest match (26% similar) near line 311:
  309 |   return (
  310 |     <Button
  311 |       className={isInStore ? undefined : styles.NotInStore}
  312 |       onClick={() => (isInStore ? selectOwner(owner) : null)}
  313 |       title={`Up to ${owner.displayName || 'owner'}`}
```

**Patch args**

```diff
@@ const owner = owners[selectedIndex - 1];
  const isInStore = store.containsElement(owner.id);
-  const owner = owners[selectedIndex - 1];
-  const isInStore = store.containsElement(owner.id);
+  const owner = owners[selectedIndex - 1];
+  const isInStore = store.containsElement(owner.id);

```

### Unicode Unicode Hyphen 003 (SourceMapConsumer.js)

#### Run 1

##### Attempt 1

- Path: /tmp/rb-7a589d56-f6ee-4982-b756-fba77ce7902c/b1475eeaa07d15a0f/SourceMapConsumer.js
- Operation: —

**Tool error**

```
Failed to find expected lines in /tmp/rb-7a589d56-f6ee-4982-b756-fba77ce7902c/b1475eeaa07d15a0f/SourceMapConsumer.js:
import { decode } from '@jridgewell/sourcemap codec';

Closest match (90% similar) near line 10:
  8 |  */
  9 | import { withSyncPerfMeasurements } from 'react-devtools-shared/src/Performance…
  10 | import { decode } from '@jridgewell/sourcemap\u2013codec';
  11 | 
  12 | import type {
```

**Patch args**

```diff
@@ import { decode } from '@jridgewell/sourcemap codec';
-import { decode } from '@jridgewell/sourcemap codec';
+import { decode } from '@jridgewell/sourcemap-codec';

```

##### Attempt 2

- Path: /tmp/rb-7a589d56-f6ee-4982-b756-fba77ce7902c/b1475eeaa07d15a0f/SourceMapConsumer.js
- Operation: —

**Tool error**

```
Failed to find expected lines in /tmp/rb-7a589d56-f6ee-4982-b756-fba77ce7902c/b1475eeaa07d15a0f/SourceMapConsumer.js:
import { decode } from '@jridgewell/sourcemap–codec';
import type {

Closest match (50% similar) near line 11:
  9 | import { withSyncPerfMeasurements } from 'react-devtools-shared/src/Performance…
  10 | import { decode } from '@jridgewell/sourcemap\u2013codec';
  11 | 
  12 | import type {
  13 |   IndexSourceMap,
```

**Patch args**

```diff
@@ import { withSyncPerfMeasurements } from 'react-devtools-shared/src/PerformanceLoggingUtils';
 import { decode } from '@jridgewell/sourcemap–codec';
 import type {
@@
 import type {
- import { decode } from '@jridgewell/sourcemap codec';
+ import { decode } from '@jridgewell/sourcemap-codec';
  IndexSourceMap,

```

### Unicode Unicode Hyphen 005 (babel.config.js)

#### Run 1

##### Attempt 1

- Path: /tmp/rb-7a589d56-f6ee-4982-b756-fba77ce7902c/b1475ee9b5d9159c3/babel.config.js
- Operation: —

**Tool error**

```
Failed to find expected lines in /tmp/rb-7a589d56-f6ee-4982-b756-fba77ce7902c/b1475ee9b5d9159c3/babel.config.js:
    ['@babel/plugin4-proposal-class-properties', { loose: false }],

Closest match (91% similar) near line 39:
  37 |     ['babel-plugin-syntax-hermes-parser'],
  38 |     ['@babel/plugin-transform-flow-strip-types'],
  39 |     ['@babel/plugin\u2013proposal-class-properties', { loose: false }],
  40 |   ];
  41 |   if (process.env.NODE_ENV !== 'production') {
```

**Patch args**

```diff
@@ ['@babel/plugin proposal-class-properties', { loose: false }],
-    ['@babel/plugin4-proposal-class-properties', { loose: false }],
+    ['@babel/plugin-proposal-class-properties', { loose: false }],

```

### Unicode Unicode Hyphen 007 (ReactInternalTestUtils.js)

#### Run 1

##### Attempt 1

- Path: ReactInternalTestUtils.js
- Operation: —

**Tool error**

```
Failed to find expected lines in /tmp/rb-7a589d56-f6ee-4982-b756-fba77ce7902c/b1475eeb390515a39/ReactInternalTestUtils.js:
import { diff } from 'jestdiff';

Closest match (84% similar) near line 9:
  7 | 
  8 | import * as SchedulerMock from 'scheduler/unstable_mock';
  9 | import { diff } from 'jest\u2013diff';
  10 | import { equals } from '@jest/expect-utils';
  11 | import enqueueTask from './enqueueTask';
```

**Patch args**

```diff
@@ import { diff } from 'jest–diff';
-import { diff } from 'jestdiff';
+import { diff } from 'jest-diff';

```

## Failed Tasks (0% passing)

### Access Remove Optional Chain 007 (index.js) — 0/1

**All runs failed with same error:** File mismatch for index.js

**Sample agent response (run 1):**
```
Fixed `index.js` by removing the optional chain in the listener cleanup:

- Changed `port?.onMessage.removeListener(bridgeListener);` to `port.onMessage.removeListener(bridgeListener);`

No other lines were modified.
```

**Diff (expected vs actual):**
```diff
@@ -58 @@
       lastSubscribedBridgeListener = bridgeListener;
 
       return () => {
-        port?.onMessage.removeListener(bridgeListener);
+        port.onMessage.removeListener(bridgeListener);
         lastSubscribedBridgeListener = null;
       };
     },
@@ -64 @@
     },
 
     send(event: string, payload: any, transferable?: Array<any>) {
-      port?.postMessage({ event, payload }, transferable);
+      port.postMessage({ event, payload }, transferable);
     },
   });
 
```

### Call Swap Call Args 003 (ReactFlightDOMServerBrowser.js) — 0/1

**All runs failed with same error:** File mismatch for ReactFlightDOMServerBrowser.js

**Sample agent response (run 1):**
```
Done. I fixed the swapped arguments in `ReactFlightDOMServerBrowser.js` by swapping the last two arguments in the `createRequest` call:

- `debugChannelReadable !== undefined`
- `__DEV__ && options ? options.filterStackFrame : undefined`
```

**Diff (expected vs actual):**
```diff
@@ -108 @@
     options ? options.temporaryReferences : undefined,
     options ? options.startTime : undefined,
     __DEV__ && options ? options.environmentName : undefined,
-    __DEV__ && options ? options.filterStackFrame : undefined,
     debugChannelReadable !== undefined,
     debugChannelReadable !== undefined,
+    __DEV__ && options ? options.filterStackFrame : undefined,
   );
   if (options && options.signal) {
     const signal = options.signal;
@@ -175 @@
         {
           type: 'bytes',
           pull: (controller): ?Promise<void> => {
-            startFlowing(request, controller);
+            startFlowing(controller, request);
           },
           cancel: (reason): ?Promise<void> => {
             stopFlowing(request);
```

### Call Swap Call Args 005 (ReactNoopPersistent.js) — 0/1

**All runs failed with same error:** File mismatch for ReactNoopPersistent.js

**Sample agent response (run 1):**
```
Done. I made the minimal fix in `ReactNoopPersistent.js` at line 58 by swapping the two `createReactNoop(...)` arguments back to:

```js
} = createReactNoop(
  ReactFiberReconciler, // useMutation
  false, // reconciler
);
```

No other files or lines were changed.
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
Fixed the bug in `ReactFiberDevToolsHook.js` by changing the duplicated log format literal back to the correct specifier:

- `'%o.'` → `'%o'` on the `console.error` call in `injectInternals` catch block.

I made only that token-level edit in the referenced file and then re-read the edited region to confirm only the intended line changed.
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

### Literal Flip Boolean 003 (ReactProfilerTimer.js) — 0/1

**All runs failed with same error:** File mismatch for ReactProfilerTimer.js

**Sample agent response (run 1):**
```
Fixed `ReactProfilerTimer.js` by inverting the boolean literal in the one clearly flagged spot.

Change made:
- In `pushComponentEffectDidSpawnUpdate`, changed:
- `return false;` → `return true;`

I also re-read the modified region to confirm only that intended token line was changed.
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

### Operator Remove Negation 003 (ReactDOMSelection.js) — 0/1

**All runs failed with same error:** File mismatch for ReactDOMSelection.js

**Sample agent response (run 1):**
```
Applied the fix in `ReactDOMSelection.js`:

- Changed:
  - `if (!selection || selection.rangeCount === 0) {`
  - **to**
  - `if (!selection || !selection.rangeCount) {`

Only that line was modified, and I re-read the region to confirm the change is isolated.
```

**Diff (expected vs actual):**
```diff
@@ -17 @@
   const win = (ownerDocument && ownerDocument.defaultView) || window;
   const selection = win.getSelection && win.getSelection();
 
-  if (!selection || selection.rangeCount === 0) {
+  if (!selection || !selection.rangeCount) {
     return null;
   }
 
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
Updated `ReactDOMContainer.js` with the minimal fix: changed line 16 from `!node` to `node` so `isValidContainer` now correctly requires a truthy node before dereferencing `node.nodeType`.

Re-read check confirms only that line changed.
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
Updated `ErrorView.js` with the minimal fix on the specified line, changing the boolean check to:

```js
{dismissError != null && (
```

No other files were modified.
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

### Structural Delete Statement 005 (StackTraceView.js) — 0/1

**All runs failed with same error:** File mismatch for StackTraceView.js

**Sample agent response (run 1):**
```
I restored the missing statement in `StackTraceView.js` by adding `ignored` to the `callSite` destructuring at the call site where `ignored` is used in class selection.

Updated line:
- `const [virtualFunctionName, virtualURL, virtualLine, virtualColumn, ignored] = callSite;`
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
Fixed in `ReactDOMFizzStaticBrowser.js`.

I restored the missing statement inside `prerender()`’s `onAllReady()` so `stream` is defined before being returned in `result`:

- Added:
```js
      const stream = new ReadableStream(
        {
          type: 'bytes',
          pull: (controller): ?Promise<void> => {
            startFlowing(request, controller);
          },
          cancel: (reason): ?Promise<void> => {
            stopFlowing(request);
            abort(request, reason);
      ...
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
Done. I restored the missing guard clause in `ReactFlightAsyncDispatcher.js` at `resolveCache`:

```js
if (request) {
  return request.cache;
}
```

Everything else is unchanged.
```

**Diff (expected vs actual):**
```diff
@@ -15 @@
 function resolveCache(): Map<Function, mixed> {
   const request = resolveRequest();
   if (request) {
-    return getCache(request);
+    return request.cache;
   }
   return new Map();
 }
```

### Structural Remove Early Return 003 (ReactDOMComponentTree.js) — 0/1

**All runs failed with same error:** File mismatch for ReactDOMComponentTree.js

**Sample agent response (run 1):**
```
Implemented the minimal fix in `ReactDOMComponentTree.js` by restoring the missing guard clause in `getClosestInstanceFromNode`:

- Replaced the unconditional direct `return targetInst;` with a tag check.
- Now returns only when `targetInst` is **not** `HostRoot`, `SuspenseComponent`, or `ActivityComponent`.

No other files were changed.
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
Fixed `TabBar.js` by restoring the missing early-return guard inside `tabs.map(...)`:

```js
if (tab === null) {
  return null;
}
```

Re-read the changed region confirms only that block was added at the intended location around line 92.
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
 
         const { icon, id, label, title } = tab;
```

### Structural Remove Early Return 007 (CommitTreeBuilder.js) — 0/1

**All runs failed with same error:** File mismatch for CommitTreeBuilder.js

**Sample agent response (run 1):**
```
Implemented the minimal fix in `CommitTreeBuilder.js` by restoring the missing early-return guard:

- Added:

```js
  if (commitTrees.length > commitIndex) {
    return commitTrees[commitIndex];
  }
```

at `getCommitTree` after commit index validation and before recomputation loop.

This restores the cached-hit fast path that returns an already-built commit tree instead of leaving `commitTree` unset when requesting a previously generated commit index.
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
Fixed `ReactFlightClientConfigBundlerWebpack.js` by reordering the two adjacent statements in `preloadModule`’s inlined-cache branch.

Changed sequence inside `if (entry === undefined)` from:
- `thenable.then(...)`
- `chunkCache.set(...)`
- `promises.push(thenable)`

to:
- `thenable.then(...)`
- `promises.push(thenable)`
- `chunkCache.set(...)`

No other files were modified.
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
Done. I updated `utils.js` and swapped the two top-branch bodies around the `sourceURL` handling logic (line ~25 area) exactly as requested:

- `if (sourceURL.startsWith('file:///'))` now assigns `filePath = sourceURL`
- `else if (sourceURL.includes('://'))` now assigns `filePath = new URL(sourceURL).pathname`

I then re-read the changed region to verify only those lines were touched.
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
Updated `ReactDOMFloat.js` to fix the swapped `if/else` branches in `prefetchDNS`:

- In the `arguments.length > 1` warning block, the crossOrigin-specific warning is now in the `else` branch, and the generic reserved-argument warning is now in the `if` branch.

I only changed that targeted region.
```

**Diff (expected vs actual):**
```diff
@@ -32 @@
       const options = arguments[1];
       if (typeof options === 'object' && options.hasOwnProperty('crossOrigin')) {
         console.error(
-          'ReactDOM.prefetchDNS(): Expected only one argument, `href`, but encountered %s as a second argument instead. This argument is reserved for future options and is currently disallowed. It looks like the you are attempting to set a crossOrigin property for this DNS lookup hint. Browsers do not perform DNS queries using CORS and setting this attribute on the resource hint has no effect. Try calling ReactDOM.prefetchDNS() with just a single string argument, `href`.',
+          'ReactDOM.prefetchDNS(): Expected only one argument, `href`, but encountered %s as a second argument instead. This argument is reserved for future options and is currently disallowed. Try calling ReactDOM.prefetchDNS() with just a single string argument, `href`.',
           getValueDescriptorExpectingEnumForWarning(options),
         );
       } else {
@@ -37 @@
         );
       } else {
         console.error(
-          'ReactDOM.prefetchDNS(): Expected only one argument, `href`, but encountered %s as a second argument instead. This argument is reserved for future options and is currently disallowed. Try calling ReactDOM.prefetchDNS() with just a single string argument, `href`.',
+          'ReactDOM.prefetchDNS(): Expected only one argument, `href`, but encountered %s as a second argument instead. This argument is reserved for future options and is currently disallowed. It looks like the you are attempting to set a crossOrigin property for this DNS lookup hint. Browsers do not perform DNS queries using CORS and setting this attribute on the resource hint has no effect. Try calling ReactDOM.prefetchDNS() with just a single string argument, `href`.',
           getValueDescriptorExpectingEnumForWarning(options),
         );
       }
@@ -247 @@
       )}.`;
     }
     if (encountered) {
-      console.error(
-        'ReactDOM....
```
