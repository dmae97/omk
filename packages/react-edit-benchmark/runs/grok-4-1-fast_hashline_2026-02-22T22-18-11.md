# Edit Benchmark Report

## Configuration

| Setting | Value |
|---------|-------|
| Date | 2026-02-22T22:15:04.016Z |
| Model | xai/xai/grok-4-1-fast |
| Thinking Level | low |
| Runs per task | 1 |
| Edit Variant | hashline |
| Edit Fuzzy | auto |
| Edit Fuzzy Threshold | auto |
| Guided Mode | no |
| Max Attempts | 1 |
| Max Turns | 10 |
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
| **Edit Success Rate** | **98.8%** |
| Timeout Runs | 0 |
| Mutation Intent Match Rate | 80.0% |
| Patch Failure Rate | 1.2% (1/82) |
| Tasks All Passing | 63 |
| Tasks Flaky/Failing | 17 |

### Tool Calls

| Tool | Total | Avg/Run |
|------|-------|---------|
| Read | 168 | 2.1 |
| Edit | 82 | 1.0 |
| Write | 0 | 0.0 |
| **Tool Input Chars** | 20,345 | 254 |

### Tokens & Time

| Metric | Total | Avg/Run |
|--------|-------|---------|
| Input Tokens | 575,177 | 7,190 |
| Output Tokens | 284,473 | 3,556 |
| Total Tokens | 3,474,377 | 43,430 |
| Duration | 41m35s | 31.2s |
| **Avg Indent Score** | — | **0.09** |

## Task Results

| Task | File | Success | Edit Hit | R/E/W | Tokens (In/Out) | Time | Indent |
|------|------|---------|----------|-------|-----------------|------|--------|
| Access Remove Optional Chain 001 | registerDevToolsEventLogger.js | 1/1 ✅ | 100.0% | 2/1/0 | 8,796/3,772 | 42.9s | 0.00 |
| Access Remove Optional Chain 002 | index.js | 0/1 ❌ | 100.0% | 2/1/0 | 0/8,367 | 1m1s | 0.00 |
| Access Remove Optional Chain 003 | canvas.js | 0/1 ❌ | 100.0% | 2/1/0 | 0/8,269 | 51.7s | 0.00 |
| Access Remove Optional Chain 004 | index.js | 1/1 ✅ | 100.0% | 2/1/0 | 10,819/2,829 | 23.4s | 0.00 |
| Call Swap Call Args 001 | FallbackCompositionState.js | 1/1 ✅ | 100.0% | 2/1/0 | 813/2,242 | 29.9s | 0.00 |
| Call Swap Call Args 002 | ReactFlightDOMClientBrowser.js | 1/1 ✅ | 100.0% | 3/1/0 | 21,146/12,618 | 1m53s | 0.00 |
| Call Swap Call Args 003 | ReactDOMEventListener.js | 1/1 ✅ | 100.0% | 2/1/0 | 0/1,386 | 17.8s | 0.00 |
| Call Swap Call Args 004 | ReactFlightDOMServerEdge.js | 1/1 ✅ | 100.0% | 2/1/0 | 18,746/1,889 | 16.7s | 0.00 |
| Duplicate Duplicate Line Flip 001 | ReactFlightClientDevToolsHook.js | 1/1 ✅ | 100.0% | 2/1/0 | 15,114/3,673 | 29.5s | 0.00 |
| Duplicate Duplicate Line Flip 002 | ReactFizzConfigMarkup.js | 1/1 ✅ | 100.0% | 2/1/0 | 8,618/1,798 | 18.7s | 0.00 |
| Duplicate Duplicate Line Flip 003 | ActivityList.js | 1/1 ✅ | 100.0% | 1/1/0 | 10,394/1,921 | 16.0s | 0.00 |
| Duplicate Duplicate Line Flip 004 | RunReactCompiler.ts | 1/1 ✅ | 100.0% | 2/1/0 | 0/1,645 | 18.6s | 0.00 |
| Identifier Identifier Multi Edit 001 | ReactDOMUpdatePriority.js | 1/1 ✅ | 100.0% | 2/1/0 | 7,127/1,170 | 14.9s | 0.00 |
| Identifier Identifier Multi Edit 002 | ReactDOMSelect.js | 1/1 ✅ | 100.0% | 2/1/0 | 10,806/2,148 | 19.2s | 0.00 |
| Identifier Identifier Multi Edit 003 | ReactFlightDOMClientEdge.js | 1/1 ✅ | 100.0% | 2/1/0 | 0/1,727 | 12.8s | 0.00 |
| Identifier Identifier Multi Edit 004 | ErrorBoundary.js | 1/1 ✅ | 100.0% | 2/1/0 | 10,695/1,826 | 17.6s | 0.00 |
| Import Swap Named Imports 001 | SettingsModal.js | 1/1 ✅ | 100.0% | 1/1/0 | 0/2,101 | 24.3s | 0.00 |
| Import Swap Named Imports 002 | index.js | 0/1 ❌ | 100.0% | 6/1/0 | 11,772/5,441 | 50.5s | 0.00 |
| Import Swap Named Imports 003 | ReactDOMInput.js | 1/1 ✅ | 100.0% | 9/1/0 | 0/7,130 | 44.2s | 0.00 |
| Import Swap Named Imports 004 | Element.js | 1/1 ✅ | 100.0% | 4/1/0 | 29,014/8,787 | 1m13s | 0.00 |
| Literal Flip Boolean 001 | DevToolsFeatureFlags.core-fb.js | 1/1 ✅ | 100.0% | 2/1/0 | 5,976/1,199 | 13.5s | 0.00 |
| Literal Flip Boolean 002 | ReactDOMSelection.js | 1/1 ✅ | 100.0% | 2/1/0 | 8,634/1,919 | 18.9s | 0.00 |
| Literal Flip Boolean 003 | DOMPropertyOperations.js | 1/1 ✅ | 100.0% | 2/1/0 | 0/6,028 | 57.8s | 0.00 |
| Literal Flip Boolean 004 | SuspenseRects.js | 0/1 ❌ | 100.0% | 2/1/0 | 0/7,988 | 45.6s | 0.00 |
| Literal Off By One 001 | AutoSizeInput.js | 1/1 ✅ | 100.0% | 2/1/0 | 7,838/1,235 | 16.5s | 0.00 |
| Literal Off By One 002 | ReactFlightDOMClientNode.js | 1/1 ✅ | 100.0% | 2/1/0 | 0/1,378 | 13.9s | 0.00 |
| Literal Off By One 003 | simulateBrowserEventDispatch.js | 1/1 ✅ | 100.0% | 2/1/0 | 16,565/6,808 | 1m1s | 0.00 |
| Literal Off By One 004 | ReactFlightDOMClientBrowser.js | 1/1 ✅ | 100.0% | 2/1/0 | 0/1,425 | 18.3s | 0.00 |
| Operator Remove Negation 001 | InspectedElementStateTree.js | 1/1 ✅ | 100.0% | 2/1/0 | 0/2,140 | 15.8s | 0.00 |
| Operator Remove Negation 002 | messageHandlers.js | 1/1 ✅ | 100.0% | 2/1/0 | 0/1,624 | 18.1s | 0.00 |
| Operator Remove Negation 003 | BeforeInputEventPlugin.js | 1/1 ✅ | 100.0% | 2/1/0 | 14,093/2,760 | 22.9s | 0.00 |
| Operator Remove Negation 004 | ReactFiberComponentStack.js | 1/1 ✅ | 100.0% | 3/1/0 | 0/6,387 | 1m15s | 0.00 |
| Operator Swap Arithmetic 001 | id-generator.js | 1/1 ✅ | 100.0% | 2/1/0 | 6,006/1,251 | 14.9s | 0.00 |
| Operator Swap Arithmetic 002 | ReactCompiler.ts | 1/1 ✅ | 100.0% | 2/1/0 | 0/1,036 | 12.1s | 0.00 |
| Operator Swap Arithmetic 003 | ReactFlightDOMServerEdge.js | 1/1 ✅ | 100.0% | 2/1/0 | 9,235/1,471 | 17.7s | 0.00 |
| Operator Swap Arithmetic 004 | ReactFlightPerformanceTrack.js | 1/1 ✅ | 100.0% | 1/1/0 | 15,645/2,962 | 26.2s | 0.00 |
| Operator Swap Comparison 001 | useSmartTooltip.js | 1/1 ✅ | 100.0% | 2/1/0 | 6,932/1,774 | 19.6s | 0.00 |
| Operator Swap Comparison 002 | ReactFlightHooks.js | 1/1 ✅ | 100.0% | 2/1/0 | 7,945/1,905 | 18.0s | 0.00 |
| Operator Swap Comparison 003 | ReactFlightDOMServerBrowser.js | 1/1 ✅ | 100.0% | 2/1/0 | 14,316/5,326 | 45.6s | 2.00 |
| Operator Swap Comparison 004 | ReactDOMInput.js | 0/1 ❌ | 100.0% | 2/1/0 | 0/5,250 | 33.4s | 0.00 |
| Operator Swap Equality 001 | backend.js | 1/1 ✅ | 100.0% | 2/1/0 | 5,823/1,020 | 12.3s | 0.00 |
| Operator Swap Equality 002 | SnapshotSelector.js | 1/1 ✅ | 100.0% | 1/1/0 | 0/1,122 | 9.8s | 0.00 |
| Operator Swap Equality 003 | ReactFiberTransition.js | 1/1 ✅ | 100.0% | 2/1/0 | 12,379/2,283 | 21.0s | 0.00 |
| Operator Swap Equality 004 | ReactFlightDOMClientEdge.js | 1/1 ✅ | 100.0% | 1/1/0 | 9,836/1,775 | 17.1s | 0.00 |
| Operator Swap Increment Decrement 001 | ReactFlightClientConfigTargetTurbopackServer.js | 1/1 ✅ | 100.0% | 2/1/0 | 5,931/1,469 | 19.4s | 0.00 |
| Operator Swap Increment Decrement 002 | ReactFlightWebpackNodeRegister.js | 1/1 ✅ | 100.0% | 2/1/0 | 0/1,339 | 22.1s | 0.00 |
| Operator Swap Increment Decrement 003 | ReactChildren.js | 1/1 ✅ | 100.0% | 2/1/0 | 12,330/1,214 | 14.5s | 0.00 |
| Operator Swap Increment Decrement 004 | ReactFlightClientConfigBundlerWebpack.js | 1/1 ✅ | 100.0% | 2/1/0 | 11,019/1,944 | 19.8s | 0.00 |
| Operator Swap Logical 001 | withPermissionsCheck.js | 1/1 ✅ | 100.0% | 2/1/0 | 7,987/1,368 | 15.7s | 0.00 |
| Operator Swap Logical 002 | ReactFlightClientConfigBundlerWebpackBrowser.js | 1/1 ✅ | 100.0% | 1/1/0 | 0/1,377 | 9.3s | 0.00 |
| Operator Swap Logical 003 | ReactFlightDOMClientBrowser.js | 1/1 ✅ | 100.0% | 2/1/0 | 0/2,003 | 19.5s | 0.00 |
| Operator Swap Logical 004 | ReactFlightDOMServerEdge.js | 1/1 ✅ | 100.0% | 3/2/0 | 12,901/5,097 | 45.5s | 0.00 |
| Operator Swap Nullish 001 | colors.js | 1/1 ✅ | 100.0% | 2/1/0 | 9,938/2,369 | 30.8s | 0.00 |
| Operator Swap Nullish 002 | ReactFlightServerConfigTurbopackBundler.js | 1/1 ✅ | 100.0% | 2/1/0 | 15,746/3,067 | 29.4s | 0.00 |
| Operator Swap Nullish 003 | hookNamesCache.js | 1/1 ✅ | 100.0% | 3/1/0 | 12,107/5,203 | 43.8s | 0.00 |
| Operator Swap Nullish 004 | RunReactCompiler.ts | 1/1 ✅ | 100.0% | 1/1/0 | 1,224/1,745 | 18.9s | 0.00 |
| Regex Swap Regex Quantifier 001 | SimpleValues.js | 1/1 ✅ | 100.0% | 2/1/0 | 13,955/1,504 | 20.1s | 0.00 |
| Regex Swap Regex Quantifier 002 | utils.js | 1/1 ✅ | 100.0% | 2/1/0 | 0/1,454 | 19.8s | 0.00 |
| Regex Swap Regex Quantifier 003 | ReactFlightStackConfigV8.js | 1/1 ✅ | 100.0% | 2/1/0 | 0/8,388 | 1m6s | 0.00 |
| Regex Swap Regex Quantifier 004 | ReactChildren.js | 1/1 ✅ | 100.0% | 2/1/0 | 16,753/7,655 | 1m13s | 0.00 |
| Structural Delete Statement 001 | geometry.js | 1/1 ✅ | 100.0% | 2/1/0 | 16,887/1,314 | 14.3s | 0.00 |
| Structural Delete Statement 002 | SidebarEventInfo.js | 0/1 ❌ | 100.0% | 1/1/0 | 0/3,622 | 21.7s | 0.00 |
| Structural Delete Statement 003 | ReactFlightDOMServerEdge.js | 0/1 ❌ | 100.0% | 2/1/0 | 0/5,160 | 42.1s | 0.00 |
| Structural Delete Statement 004 | ReactFlightDOMServerNode.js | 0/1 ❌ | 100.0% | 2/1/0 | 17,148/3,594 | 33.1s | 0.00 |
| Structural Remove Early Return 001 | formatWithStyles.js | 0/1 ❌ | 50.0% | 3/2/0 | 0/4,934 | 56.1s | 0.00 |
| Structural Remove Early Return 002 | ReactFlightClientConfigBundlerWebpackBrowser.js | 0/1 ❌ | 100.0% | 2/1/0 | 24,989/5,403 | 48.5s | 0.00 |
| Structural Remove Early Return 003 | standalone.js | 0/1 ❌ | 100.0% | 2/1/0 | 0/7,978 | 54.9s | 2.00 |
| Structural Remove Early Return 004 | backend.js | 0/1 ❌ | 100.0% | 2/1/0 | 15,476/7,045 | 45.1s | 0.00 |
| Structural Swap Adjacent Lines 001 | ReactSuspenseTestUtils.js | 1/1 ✅ | 100.0% | 2/1/0 | 0/1,220 | 13.4s | 0.00 |
| Structural Swap Adjacent Lines 002 | NativeEventsView.js | 1/1 ✅ | 100.0% | 2/1/0 | 11,036/2,321 | 21.4s | 0.00 |
| Structural Swap Adjacent Lines 003 | SyntheticEvent.js | 0/1 ❌ | 100.0% | 2/1/0 | 28,441/15,338 | 1m46s | 0.00 |
| Structural Swap Adjacent Lines 004 | ReactDOMComponentTree.js | 0/1 ❌ | 100.0% | 2/1/0 | 0/4,217 | 22.1s | 3.33 |
| Structural Swap If Else 001 | resolveBoxStyle.js | 0/1 ❌ | 100.0% | 2/1/0 | 10,553/3,486 | 31.8s | 0.00 |
| Structural Swap If Else 002 | ReactCacheImpl.js | 1/1 ✅ | 100.0% | 2/1/0 | 2,571/2,972 | 27.0s | 0.00 |
| Structural Swap If Else 003 | CSSPropertyOperations.js | 1/1 ✅ | 100.0% | 2/1/0 | 0/6,043 | 42.0s | 0.00 |
| Structural Swap If Else 004 | ResponderTouchHistoryStore.js | 0/1 ❌ | 100.0% | 1/1/0 | 9,553/3,075 | 24.5s | 0.00 |
| Unicode Unicode Hyphen 001 | ReactFlightClientConfig.dom-bun.js | 1/1 ✅ | 100.0% | 2/1/0 | 0/856 | 11.7s | 0.00 |
| Unicode Unicode Hyphen 002 | backendManager.js | 1/1 ✅ | 100.0% | 1/1/0 | 0/1,309 | 13.7s | 0.00 |
| Unicode Unicode Hyphen 003 | ReactFlightDOMClientBrowser.js | 1/1 ✅ | 100.0% | 2/1/0 | 0/1,537 | 13.1s | 0.00 |
| Unicode Unicode Hyphen 004 | ReactFlightActionServer.js | 0/1 ❌ | 100.0% | 2/1/0 | 13,549/7,048 | 1m | 0.00 |

## Category Summary

| Category | Runs | Verified | Edit Used | Success | Min/Avg/Max Difficulty |
|----------|------|----------|-----------|---------|------------------------|
| access | 4 | 50.0% (2/4) | 100.0% (4/4) | 50.0% (2/4) | 6 / 8.0 / 10 |
| call | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) | 5 / 9.3 / 15 |
| duplicate | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) | 9 / 12.0 / 16 |
| identifier | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) | 8 / 9.0 / 10 |
| import | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) | 2 / 4.3 / 8 |
| literal | 8 | 87.5% (7/8) | 100.0% (8/8) | 87.5% (7/8) | 4 / 8.8 / 12 |
| operator | 28 | 96.4% (27/28) | 100.0% (28/28) | 96.4% (27/28) | 2 / 7.9 / 14 |
| regex | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) | 2 / 6.3 / 8 |
| structural | 16 | 31.3% (5/16) | 100.0% (16/16) | 31.3% (5/16) | 4 / 7.9 / 13 |
| unicode | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) | 4 / 7.0 / 8 |

## Mutation Summary

| Mutation | Category | Runs | Verified | Edit Used | Success |
|----------|----------|------|----------|-----------|---------|
| delete-statement | structural | 4 | 25.0% (1/4) | 100.0% (4/4) | 25.0% (1/4) |
| duplicate-line-flip | duplicate | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| flip-boolean | literal | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) |
| identifier-multi-edit | identifier | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| off-by-one | literal | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| remove-early-return | structural | 4 | 0.0% (0/4) | 100.0% (4/4) | 0.0% (0/4) |
| remove-negation | operator | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| remove-optional-chain | access | 4 | 50.0% (2/4) | 100.0% (4/4) | 50.0% (2/4) |
| swap-adjacent-lines | structural | 4 | 50.0% (2/4) | 100.0% (4/4) | 50.0% (2/4) |
| swap-arithmetic | operator | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| swap-call-args | call | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| swap-comparison | operator | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) |
| swap-equality | operator | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| swap-if-else | structural | 4 | 50.0% (2/4) | 100.0% (4/4) | 50.0% (2/4) |
| swap-increment-decrement | operator | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| swap-logical | operator | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| swap-named-imports | import | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) |
| swap-nullish | operator | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| swap-regex-quantifier | regex | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| unicode-hyphen | unicode | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) |

## Difficulty Summary

| Difficulty Score | Runs | Verified | Edit Used | Success |
|------------------|------|----------|-----------|---------|
| 0-2 | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) |
| 3-5 | 17 | 82.4% (14/17) | 100.0% (17/17) | 82.4% (14/17) |
| 6-8 | 26 | 80.8% (21/26) | 100.0% (26/26) | 80.8% (21/26) |
| 9+ | 33 | 75.8% (25/33) | 100.0% (33/33) | 75.8% (25/33) |

## Edit Tool Errors

Failures where the edit tool returned an error or failed to apply the patch.

### Structural Remove Early Return 001 (formatWithStyles.js)

#### Run 1

##### Attempt 1

- Path: —
- Operation: —

**Tool error**

```
1 line has changed since last read. Use the updated LINE#ID references shown below (>>> marks changed lines).

    33#WQ:  // Matches any of %(o|O|d|i|s|f), but not %%(o|O|d|i|s|f)
    34#WN:  const REGEXP = /([^%]|^)((%%)*)(%([oOdisf]))/g;
>>> 35#MP:  if (typeof inputArgs[0] === 'string' && inputArgs[0].match(REGEXP)) {
    36#QX:    return [`%c${inputArgs[0]}`, style, ...inputArgs.slice(1)];
    37#QM:  } else {
```

**Patch args**

```diff
{
  "file": "formatWithStyles.js",
  "edits": [
    {
      "op": "prepend",
      "pos": "35#QX",
      "lines": [
        "  if (typeof inputArgs[0] === 'string' && inputArgs[0].indexOf('%c') !== -1) {",
        "    return inputArgs;",
        "  }"
      ]
    }
  ]
}
```

## Failed Tasks (0% passing)

### Access Remove Optional Chain 002 (index.js) — 0/1

**All runs failed with same error:** File mismatch for index.js

**Sample agent response (run 1):**
```
**index.js** line 192: restored `?.` before `postMessage`.

**Commands run:**
- `read index.js` → full file loaded
- `edit index.js` → replaced line 192#MX with `ports[registeredTabId].extension?.postMessage({ event })` → passed
- `read index.js` (offset 185, limit 15) → confirmed change isolated to line 192 (now #YS), no other modifications

Change verified: only intended token restored, structure/formatting preserved.
```

**Diff (expected vs actual):**
```diff
@@ -163 @@
 }
 
 chrome.runtime.onMessage.addListener((message, sender) => {
-  switch (message?.source) {
+  switch (message.source) {
     case 'devtools-page': {
       handleDevToolsPageMessage(message);
       break;
@@ -189 @@
       const event =
         activeTabId === numericRegisteredTabId ? 'resumeElementPolling' : 'pauseElementPolling';
 
-      ports[registeredTabId].extension.postMessage({ event });
+      ports[registeredTabId].extension?.postMessage({ event });
     }
   }
 });
```

### Access Remove Optional Chain 003 (canvas.js) — 0/1

**All runs failed with same error:** File mismatch for canvas.js

**Sample agent response (run 1):**
```
**canvas.js** line 205: Restored optional chaining in `if (canvas?.parentNode != null)`.

**Verification:**
- Initial read: Confirmed bug at 205#XR `canvas.parentNode`.
- Edit applied successfully.
- Re-read 200–219: Confirmed `205#VJ:    if (canvas?.parentNode != null) {`, no other changes.

**Commands:**
- `read canvas.js` → Passed.
- `edit canvas.js` → Passed.
- `read canvas.js offset=200 limit=20` → Passed.

No TODOs.
```

**Diff (expected vs actual):**
```diff
@@ -101 @@
     if (!rect) return;
     const key = `${rect.left},${rect.top}`;
     if (!positionGroups.has(key)) positionGroups.set(key, []);
-    positionGroups.get(key)?.push({ rect, color, displayName, count });
+    positionGroups.get(key).push({ rect, color, displayName, count });
   });
 
   return Array.from(positionGroups.values()).sort((groupA, groupB) => {
@@ -202 @@
     }
 
     // $FlowFixMe[incompatible-use]: Flow doesn't recognize Popover API and loses canvas nullability tracking
-    if (canvas.parentNode != null) {
+    if (canvas?.parentNode != null) {
       // $FlowFixMe[incompatible-call]: Flow doesn't track that canvas is non-null here
       canvas.parentNode.removeChild(canvas);
     }
```

### Import Swap Named Imports 002 (index.js) — 0/1

**All runs failed with same error:** File mismatch for index.js

**Sample agent response (run 1):**
```
**Changes**

- index.js L12: Swapped `buttonType` and `buttonsType` in the named import from './constants'.

**Verification**

- Confirmed via re-read: Only targeted line mutated (`12#NB:import { buttonsType, buttonType } from './constants';`); unchanged lines retain original tags/content.
- Minimum change: Single token swap, formatting preserved.

**Commands run**
- `read index.js`
- `read ./constants.js` (not found)
- `read ./domEnvironment.js` (not found)
- `read ./testHelpers.js` (not found…
```

**Diff (expected vs actual):**
```diff
@@ -9 @@
 
 'use strict';
 
-import { buttonType, buttonsType } from './constants';
+import { buttonsType, buttonType } from './constants';
 import * as domEvents from './domEvents';
 import * as domEventSequences from './domEventSequences';
 import * as domEvents from './domEvents';
 import * as domEventSequences from './domEventSequences';
-import { hasPointerEvent, setPointerEvent, platform } from './domEnvironment';
+import { setPointerEvent, hasPointerEvent, platform } from './domEnvironment';
 import { describeWithPointerEvent, testWithPointerType } from './testHelpers';
 
 const createEventTarget = (node) => ({
```

### Literal Flip Boolean 004 (SuspenseRects.js) — 0/1

**All runs failed with same error:** File mismatch for SuspenseRects.js

**Sample agent response (run 1):**
```
**Changes**

SuspenseRects.js lines 62–63  
Replaced absolute `1px` shrink with relative `calc(100% / viewBox.width)` (width) and `calc(100% / viewBox.height)` (height) to shrink by 1 DOM pixel after scaling.

**Verification**  
- Initial `read` (full file): success  
- `edit`: success  
- Confirm `read` (lines 55–69): new lines match intent, no side effects  

Bug fixed: inner rects (`adjust=true`) now shrink correctly by 1 DOM pixel regardless of scale.
```

**Diff (expected vs actual):**
```diff
@@ -59 @@
       data-hovered={hovered}
       style={{
         // Shrink one pixel so that the bottom outline will line up with the top outline of the next one.
-        width: adjust ? 'calc(' + width + ' - 1px)' : width,
-        height: adjust ? 'calc(' + height + ' - 1px)' : height,
+        width: adjust ? 'calc(' + width + ' - calc(100% / ' + viewBox.width + '))' : width,
+        height: adjust ? 'calc(' + height + ' - calc(100% / ' + viewBox.height + '))' : height,
         top: y,
         left: x,
       }}
@@ -558 @@
                 styles.SuspenseRectOutline + ' ' + getClassNameForEnvironment(selectedEnvironment)
               }
               rect={selectedBoundingBox}
-              adjust={true}
+              adjust={false}
             />
           ) : null}
         </div>
```

### Operator Swap Comparison 004 (ReactDOMInput.js) — 0/1

**All runs failed with same error:** File mismatch for ReactDOMInput.js

**Sample agent response (run 1):**
```
**Changes**

`ReactDOMInput.js`

- Line 292: Added `  node.name = '';` before `const checkedOrDefault` in `initInput` (insert via `prepend` to `"292#TN"` before edit).

Confirmed via re-read (lines 280-299): insertion clean, no other mutations, structure preserved. Disconnects radio group before checked handling, restores at end (line 336). Matches `updateInput` pattern, fulfills line 290 comment.
```

**Diff (expected vs actual):**
```diff
@@ -289 @@
   // Reference: https://bugs.chromium.org/p/chromium/issues/detail?id=608416
   // We need to temporarily unset name to avoid disrupting radio button groups.
 
+  node.name = '';
   const checkedOrDefault = checked != null ? checked : defaultChecked;
   // TODO: This 'function' or 'symbol' check isn't replicated in other places
   // so this semantic is inconsistent.
@@ -408 @@
         '"][type="radio"]',
     );
 
-    for (let i = 0; i < group.length; i++) {
+    for (let i = 0; i <= group.length; i++) {
       const otherNode = ((group[i]: any): HTMLInputElement);
       if (otherNode === rootNode || otherNode.form !== rootNode.form) {
         continue;
```

### Structural Delete Statement 002 (SidebarEventInfo.js) — 0/1

**All runs failed with same error:** File mismatch for SidebarEventInfo.js

**Sample agent response (run 1):**
```
**Commands run:**
- `read SidebarEventInfo.js`
- `edit SidebarEventInfo.js`

**Changes:**
- `SidebarEventInfo.js` 57#JM: replaced `const componentStack = eventInfo.componentStack || null;` with `const { timestamp, componentName, componentStack = null } = eventInfo;` restoring the destructuring that defines `timestamp` and `componentName`.

Verified: re-read confirms only line 57 changed; `timestamp`, `componentName`, and `componentStack` now defined from `eventInfo`; structure and formatting pr…
```

**Diff (expected vs actual):**
```diff
@@ -54 @@
 };
 
 function SchedulingEventInfo({ eventInfo }: SchedulingEventProps) {
-  const { componentName, timestamp } = eventInfo;
-  const componentStack = eventInfo.componentStack || null;
+  const { timestamp, componentName, componentStack = null } = eventInfo;
 
   return (
     <>
```

### Structural Delete Statement 003 (ReactFlightDOMServerEdge.js) — 0/1

**All runs failed with same error:** File mismatch for ReactFlightDOMServerEdge.js

**Sample agent response (run 1):**
```
**Changes**

- `ReactFlightDOMServerEdge.js`: Inserted `const messages = stringBuffer.split('\n');` (new line 82#YP) before the `for` loop (former 82#PP, now 83#PP) in `progress` function of `startReadingFromDebugChannelReadableStream`. Fixes undeclared `messages` used in loop and assignment.

**Commands run**
- `read ReactFlightDOMServerEdge.js` → full file
- `edit ReactFlightDOMServerEdge.js` → insert line → passed
- `read ReactFlightDOMServerEdge.js` (offset=70, limit=30) → verified insertio…
```

**Diff (expected vs actual):**
```diff
@@ -78 @@
     stringBuffer += done
       ? readFinalStringChunk(stringDecoder, new Uint8Array(0))
       : readPartialStringChunk(stringDecoder, buffer);
+
     const messages = stringBuffer.split('\n');
     for (let i = 0; i < messages.length - 1; i++) {
       resolveDebugMessage(request, messages[i]);
```

### Structural Delete Statement 004 (ReactFlightDOMServerNode.js) — 0/1

**All runs failed with same error:** File mismatch for ReactFlightDOMServerNode.js

**Sample agent response (run 1):**
```
**Changes**

- `ReactFlightDOMServerNode.js` line 514: Replaced `abort(request, reason);` with `abort(request, (signal: any).reason);` fixing ReferenceError from undefined `reason`.

**Verification**

- Confirmed via re-read: only line 514 changed as intended.
- Commands: read (full), edit (514#BY), read (500-529). All passed.

No TODOs.
```

**Diff (expected vs actual):**
```diff
@@ -511 @@
     if (options && options.signal) {
       const signal = options.signal;
       if (signal.aborted) {
-        const reason = (signal: any).reason;
-        abort(request, reason);
+        abort(request, (signal: any).reason);
       } else {
         const listener = () => {
           const reason = (signal: any).reason;
```

### Structural Remove Early Return 001 (formatWithStyles.js) — 0/1

**All runs failed with same error:** File mismatch for formatWithStyles.js

**Sample agent response (run 1):**
```
**Changes**

`formatWithStyles.js`: Inserted guard clause before formatting check (new lines 35#BQ–37#YH):

```
35#BQ:  if (typeof inputArgs[0] === 'string' && inputArgs[0].indexOf('%c') !== -1) {
36#YY:    return inputArgs;
37#YH:  }
```

**Verification**

- Read: original file.
- Edit: first attempt (tag refresh).
- Read: confirmed no content change.
- Edit: inserted guard at old 35 (now 38#MP).
- Read (25–44): confirmed insertion only, structure preserved, lines now 60 total.

No other files…
```

**Diff (expected vs actual):**
```diff
@@ -30 @@
   inputArgs: $ReadOnlyArray<any>,
   style?: string,
 ): $ReadOnlyArray<any> {
-  if (
-    inputArgs === undefined ||
-    inputArgs === null ||
-    inputArgs.length === 0 ||
-    // Matches any of %c but not %%c
-    (typeof inputArgs[0] === 'string' && inputArgs[0].match(/([^%]|^)(%c)/g)) ||
-    style === undefined
-  ) {
-    return inputArgs;
-  }
-
   // Matches any of %(o|O|d|i|s|f), but not %%(o|O|d|i|s|f)
   const REGEXP = /([^%]|^)((%%)*)(%([oOdisf]))/g;
   // Matches any of %(o|O|d|i|s|f), but not %%(o|O|d|i|s|f)
   const REGEXP = /([^%]|^)((%%)*)(%([oOdisf]))/g;
+  if (typeof inputArgs[0] === 'string' && inputArgs[0].indexOf('%c') !== -1) {
+    return inputArgs;
+  }
   if (typeof inputArgs[0] === 'string' && inputArgs[0].match(REGEXP)) {
     return [`%c${inputArgs[0]}`, style, ...inputArgs.slice(1)];
   } else {
```

### Structural Remove Early Return 002 (ReactFlightClientConfigBundlerWebpackBrowser.js) — 0/1

**All runs failed with same error:** File mismatch for ReactFlightClientConfigBundlerWebpackBrowser.js

**Sample agent response (run 1):**
```
**Changes**

`ReactFlightClientConfigBundlerWebpackBrowser.js`
- Lines 22–24 (new): Restored guard clause `if (flightChunk !== undefined) { return flightChunk; }` before fallback `return webpackGetChunkFilename(chunkId);` (now line 25).

**Verification**
- Confirmed via re-read (offset 15, limit 20): exact insertion, indentation preserved, blank line 21 intact, no other modifications.
- Commands: read (full), edit, read (region). All succeeded.

**Status**: Fix complete, minimal mutation only i…
```

**Diff (expected vs actual):**
```diff
@@ -18 @@
 const webpackGetChunkFilename = __webpack_require__.u;
 __webpack_require__.u = function (chunkId: string) {
   const flightChunk = chunkMap.get(chunkId);
+
   if (flightChunk !== undefined) {
     return flightChunk;
   }
```

### Structural Remove Early Return 003 (standalone.js) — 0/1

**All runs failed with same error:** File mismatch for standalone.js

**Sample agent response (run 1):**
```
**standalone.js** lines 99–101 (post-edit): Added guard `if (node == null) { return; }` before `node.innerHTML = '';` in `reload()`.

**Commands:**
- `read standalone.js` → full content
- `edit standalone.js` prepend before old 99#NZ → success
- `read standalone.js` offset=90 limit=30 → verified insertion (new tags 99#TT–101#YK), structure preserved

No TODOs. Other unguarded `node` accesses (onDisconnected:160, onError:169/180) remain; add identical guards if scope expands.
```

**Diff (expected vs actual):**
```diff
@@ -96 @@
 function reload() {
   safeUnmount();
 
+  if (node == null) {
+    return;
+  }
   node.innerHTML = '';
 
   setTimeout(() => {
@@ -121 @@
 // Browser extension is doing this via exchanging messages
 // between devtools_page and dedicated content script for it, see `fetchFileWithCaching.js`.
 async function fetchFileWithCaching(url: string) {
-  if (resourceCache.has(url)) {
-    return Promise.resolve(resourceCache.get(url));
-  }
-
   return fetch(url)
     .then((data) => data.text())
     .then((content) => {
@@ -178 @@
         <div class="box-content">
           Only one copy of DevTools can be used at a time.
         </div>
-      </div>
+        </div>
     `;
   } else {
     node.innerHTML = `
@@ -189 @@
         <div class="box-content">
           ${message}
         </div>
-      </div>
+        </div>
     `;
   }
 }
```

### Structural Remove Early Return 004 (backend.js) — 0/1

**All runs failed with same error:** File mismatch for backend.js

**Sample agent response (run 1):**
```
**Changes**

- `./backend.js` line 269: Fixed structural syntax error by changing `event: MessageEvent<>` to `event: MessageEvent`.

**Verification**

- Confirmed via re-read (lines 265–274): `function handleMessage(event: MessageEvent) {`
- Minimal single-token change; no other lines modified.
- Original structure, indentation, and surrounding code preserved.

**Commands executed**
- `read ./backend.js` → Full file loaded.
- `edit ./backend.js` → Replace at `269#YP` → Success.
- `read ./backen…
```

**Diff (expected vs actual):**
```diff
@@ -78 @@
 
 export function connectToDevTools(options: ?ConnectOptions) {
   const hook: ?DevToolsHook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
-  if (hook == null) {
-    // DevTools didn't get injected into this page (maybe b'c of the contentType).
-    return;
-  }
 
   const {
     host = 'localhost',
@@ -270 @@
     scheduleRetry();
   }
 
-  function handleMessage(event: MessageEvent<>) {
+  function handleMessage(event: MessageEvent) {
     let data;
     try {
       if (typeof event.data === 'string') {
```

### Structural Swap Adjacent Lines 003 (SyntheticEvent.js) — 0/1

**All runs failed with same error:** File mismatch for SyntheticEvent.js

**Sample agent response (run 1):**
```
**SyntheticEvent.js** edited: Added `updateMouseMovementPolyfillState(event);` before `return lastMovementY;` (new lines 226-227).

**Verification:** Re-read lines 210-239; movementY now mirrors movementX polyfill logic (calls update if no native `movementY`). No other changes.

**Commands:**
- `read SyntheticEvent.js` → full content
- `edit SyntheticEvent.js` → inserted line (prepend "226#ZQ")
- `read SyntheticEvent.js` (offset 210, limit 30) → confirmed insertion only

Fix complete: Resolves …
```

**Diff (expected vs actual):**
```diff
@@ -11 @@
 
 import type { Fiber } from 'react-reconciler/src/ReactInternalTypes';
 
-import assign from 'shared/assign';
 import getEventCharCode from './getEventCharCode';
 import getEventCharCode from './getEventCharCode';
+import assign from 'shared/assign';
 
 type EventInterfaceType = {
   [propName: string]: 0 | ((event: { [propName: string]: mixed, ... }) => mixed),
@@ -223 @@
     // Don't need to call updateMouseMovementPolyfillState() here
     // because it's guaranteed to have already run when movementX
     // was copied.
+    updateMouseMovementPolyfillState(event);
     return lastMovementY;
   },
 };
```

### Structural Swap Adjacent Lines 004 (ReactDOMComponentTree.js) — 0/1

**All runs failed with same error:** File mismatch for ReactDOMComponentTree.js

**Sample agent response (run 1):**
```
**ReactDOMComponentTree.js**

- Fixed missing Flow type cast in `isOwnedInstance`: line 361 now uses `internalInstanceMap.has(((node: any): InstanceUnion))` matching pattern elsewhere (e.g., lines 127, 150, 217).

**Verification**
- Read original file.
- Edited line 361#WS → 361#ZX.
- Re-read lines 355–365: confirmed single-line change, no side effects.

All tools passed. Change correct and minimal.
```

**Diff (expected vs actual):**
```diff
@@ -67 @@
     internalInstanceMap.delete(node);
     internalPropsMap.delete(node);
     delete (node: any)[internalEventHandlersKey];
-    delete (node: any)[internalEventHandlerListenersKey];
     delete (node: any)[internalEventHandlesSetKey];
     delete (node: any)[internalEventHandlesSetKey];
+    delete (node: any)[internalEventHandlerListenersKey];
     delete (node: any)[internalRootNodeResourcesKey];
     if (__DEV__) {
       delete (node: any)[internalInstanceKey];
@@ -358 @@
 
 export function isOwnedInstance(node: Node): boolean {
   if (enableInternalInstanceMap) {
-    return !!((node: any)[internalHoistableMarker] || internalInstanceMap.has((node: any)));
+    return !!(
+      (node: any)[internalHoistableMarker] || internalInstanceMap.has(((node: any): InstanceUnion))
+    );
   }
   return !!((node: any)[internalHoistableMarker] || (node: any)[internalInstanceKey]);
 }
```

### Structural Swap If Else 001 (resolveBoxStyle.js) — 0/1

**All runs failed with same error:** File mismatch for resolveBoxStyle.js

**Sample agent response (run 1):**
```
**resolveBoxStyle.js** lines 72–86 (formerly): Swapped `if` (individual `top`/`bottom`) and `else` (`styleForVertical` for both) bodies to correct logic matching horizontal pattern.

**Verification:** Re-read lines 65–90 confirms `if (styleForVertical != null)` now sets both to `styleForVertical`; `else` handles individuals. No other changes.

**Commands:**  
`read resolveBoxStyle.js` (1–3000) → full context.  
`edit resolveBoxStyle.js` → applied swap.  
`read resolveBoxStyle.js` (65–30) → veri…
```

**Diff (expected vs actual):**
```diff
@@ -78 @@
       result.bottom = styleForBottom;
       hasParts = true;
     }
-
     const styleForTop = style[prefix + 'Top'];
     if (styleForTop != null) {
       result.top = styleForTop;
```

### Structural Swap If Else 004 (ResponderTouchHistoryStore.js) — 0/1

**All runs failed with same error:** File mismatch for ResponderTouchHistoryStore.js

**Sample agent response (run 1):**
```
**Commands run:**
- `read ResponderTouchHistoryStore.js` → success, full content retrieved.
- `edit ResponderTouchHistoryStore.js` → success, confirmed update.

**Changes:**
- ResponderTouchHistoryStore.js:115#TM: `if (touchRecord)` → `if (!touchRecord)` (inverts condition in `recordTouchStart`; now creates new TouchRecord if absent, resets existing if present).

**Verification:**
Re-read confirms single-line change only; logic now correctly handles missing/existing records without passing `und…
```

**Diff (expected vs actual):**
```diff
@@ -112 @@
 function recordTouchStart(touch: Touch): void {
   const identifier = getTouchIdentifier(touch);
   const touchRecord = touchBank[identifier];
-  if (touchRecord) {
-    resetTouchRecord(touchRecord, touch);
-  } else {
+  if (!touchRecord) {
     touchBank[identifier] = createTouchRecord(touch);
     touchBank[identifier] = createTouchRecord(touch);
+  } else {
+    resetTouchRecord(touchRecord, touch);
   }
   touchHistory.mostRecentTimeStamp = timestampForTouch(touch);
 }
```

### Unicode Unicode Hyphen 004 (ReactFlightActionServer.js) — 0/1

**All runs failed with same error:** File mismatch for ReactFlightActionServer.js

**Sample agent response (run 1):**
```
**ReactFlightActionServer.js**

Appended `"      return;"` (line 172#QM post-edit) inside `decodeFormState` `forEach`, after `metaData = decodeBoundActionMetaData(...)` (171#VJ).

**Verification**

- First `read` retrieved full file; identified mismatch where `decodeFormState` overwrites `metaData` on every `$ACTION_REF_` (last wins) vs `decodeAction` early `return` (first wins).
- `edit` applied single-line append: confirmed success.
- Second `read` (offset 165, limit 20) shows insertion only:…
```

**Diff (expected vs actual):**
```diff
@@ -18 @@
   resolveServerReference,
   preloadModule,
   requireModule,
-} from 'react-client/src/ReactFlightClientConfig';
+} from 'react\u2013client/src/ReactFlightClientConfig';
 
 import { createResponse, close, getRoot, MAX_BOUND_ARGS } from './ReactFlightReplyServer';
 
@@ -169 @@
     if (key.startsWith('$ACTION_REF_')) {
       const formFieldPrefix = '$ACTION_' + key.slice(12) + ':';
       metaData = decodeBoundActionMetaData(body, serverManifest, formFieldPrefix);
+      return;
     }
     // We don't check for the simple $ACTION_ID_ case because form state actions
     // are always bound to the state argument.
```
