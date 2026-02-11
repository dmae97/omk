# Edit Benchmark Report

## Configuration

| Setting | Value |
|---------|-------|
| Date | 2026-02-11T08:38:38.789Z |
| Model | openrouter/openrouter/google/gemini-3-flash |
| Thinking Level | default |
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
| Total Tasks | 60 |
| Total Runs | 60 |
| Successful Runs | 47 |
| **Task Success Rate** | **78.3% (47/60)** |
| Verified Rate | 78.3% (47/60) |
| Edit Tool Usage Rate | 98.3% (59/60) |
| **Edit Success Rate** | **74.1%** |
| Timeout Runs | 0 |
| Mutation Intent Match Rate | 80.0% |
| Patch Failure Rate | 25.9% (30/116) |
| Tasks All Passing | 47 |
| Tasks Flaky/Failing | 13 |

### Tool Calls

| Tool | Total | Avg/Run |
|------|-------|---------|
| Read | 259 | 4.3 |
| Edit | 116 | 1.9 |
| Write | 1 | 0.0 |
| **Tool Input Chars** | 48,369 | 806 |

### Tokens & Time

| Metric | Total | Avg/Run |
|--------|-------|---------|
| Input Tokens | 3,225,878 | 53,765 |
| Output Tokens | 453,721 | 7,562 |
| Total Tokens | 16,620,152 | 277,003 |
| Duration | 3421.4s | 57.0s |
| **Avg Indent Score** | — | **2.23** |

### Hashline Edit Subtypes

| Operation | Count | % |
|-----------|-------|---|
| set_line | 107 | 74.3% |
| replace_lines | 19 | 13.2% |
| insert_after | 6 | 4.2% |
| replace | 12 | 8.3% |
| **Total** | **144** | 100% |

## Task Results

| Task | File | Success | Edit Hit | R/E/W | Tokens (In/Out) | Time | Indent |
|------|------|---------|----------|-------|-----------------|------|--------|
| Access Remove Optional Chain 001 | registerDevToolsEventLogger.js | 1/1 ✅ | 50.0% | 5/2/0 | 67,608/19,218 | 73.5s | 1.00 |
| Access Remove Optional Chain 002 | TimelineContext.js | 1/1 ✅ | 100.0% | 1/1/0 | 23,007/4,874 | 22.7s | 1.29 |
| Access Remove Optional Chain 003 | astUtils.js | 1/1 ✅ | 100.0% | 1/1/0 | 28,166/16,905 | 55.3s | 4.85 |
| Call Swap Call Args 001 | testHelpers.js | 1/1 ✅ | 100.0% | 1/1/0 | 12,179/2,692 | 13.0s | 1.33 |
| Call Swap Call Args 002 | FlamegraphChartBuilder.js | 1/1 ✅ | 100.0% | 2/1/0 | 26,596/8,940 | 33.6s | 3.79 |
| Call Swap Call Args 003 | SyntheticEvent.js | 1/1 ✅ | 100.0% | 4/3/0 | 78,572/14,171 | 76.8s | 3.76 |
| Duplicate Duplicate Line Flip 001 | index.js | 1/1 ✅ | 100.0% | 1/1/0 | 18,499/1,194 | 10.8s | 0.00 |
| Duplicate Duplicate Line Flip 002 | ActivityList.js | 1/1 ✅ | 100.0% | 2/1/0 | 26,397/2,681 | 15.8s | 3.61 |
| Duplicate Duplicate Line Flip 003 | SyntheticEvent.js | 0/1 ❌ | 0.0% | 2/1/0 | 19,567/5,720 | 32.2s | 1.02 |
| Identifier Identifier Multi Edit 001 | TabBar.js | 1/1 ✅ | 100.0% | 2/1/0 | 36,099/5,676 | 24.8s | 3.33 |
| Identifier Identifier Multi Edit 002 | EventPluginRegistry.js | 1/1 ✅ | 100.0% | 3/1/0 | 45,849/7,705 | 30.8s | 3.94 |
| Identifier Identifier Multi Edit 003 | ReactPerformanceTrackProperties.js | 1/1 ✅ | 100.0% | 2/1/0 | 50,816/318 | 7.5s | 9.95 |
| Import Swap Named Imports 001 | CommitFlamegraphListItem.js | 1/1 ✅ | 100.0% | 1/1/0 | 20,789/1,650 | 12.5s | 2.86 |
| Import Swap Named Imports 002 | ReactDOMTextarea.js | 1/1 ✅ | 100.0% | 3/1/0 | 48,047/9,683 | 39.5s | 2.41 |
| Import Swap Named Imports 003 | StyleEditor.js | 1/1 ✅ | 100.0% | 9/1/0 | 68,717/5,694 | 158.6s | 1.31 |
| Literal Flip Boolean 001 | testHelpers.js | 1/1 ✅ | 100.0% | 1/1/0 | 4,894/201 | 4.9s | 1.33 |
| Literal Flip Boolean 002 | ReactNoopFlightServer.js | 1/1 ✅ | 100.0% | 6/1/0 | 63,681/10,874 | 53.2s | 1.11 |
| Literal Flip Boolean 003 | ReactFlightDOMClientEdge.js | 1/1 ✅ | 50.0% | 3/2/0 | 51,074/9,220 | 41.7s | 3.58 |
| Literal Off By One 001 | githubAPI.js | 1/1 ✅ | 100.0% | 1/1/0 | 18,157/1,160 | 9.3s | 0.67 |
| Literal Off By One 002 | code-path.js | 1/1 ✅ | 50.0% | 3/2/0 | 53,606/16,459 | 61.7s | 3.50 |
| Literal Off By One 003 | InspectedElement.js | 1/1 ✅ | 100.0% | 7/1/0 | 69,491/12,898 | 59.4s | 3.60 |
| Operator Remove Negation 001 | ReactDOMClient.js | 0/1 ❌ | 100.0% | 3/1/0 | 28,552/1,342 | 132.9s | 1.08 |
| Operator Remove Negation 002 | NativeEventsView.js | 0/1 ❌ | 100.0% | 20/6/0 | 121,767/10,058 | 210.9s | 3.03 |
| Operator Remove Negation 003 | ReactFlightUnbundledReferences.js | 0/1 ❌ | 30.8% | 15/13/0 | 157,443/7,772 | 210.3s | 3.00 |
| Operator Swap Arithmetic 001 | fallbackEvalContext.js | 1/1 ✅ | 100.0% | 2/1/0 | 20,227/1,317 | 10.3s | 0.00 |
| Operator Swap Arithmetic 002 | CSSShorthandProperty.js | 1/1 ✅ | 50.0% | 2/2/0 | 54,527/4,345 | 22.2s | 2.84 |
| Operator Swap Arithmetic 003 | hooks.js | 1/1 ✅ | 0.0% | 0/1/0 | 8,968/3,229 | 124.3s | 2.21 |
| Operator Swap Comparison 001 | index.js | 1/1 ✅ | 100.0% | 2/1/0 | 30,684/3,783 | 23.1s | 0.00 |
| Operator Swap Comparison 002 | ReactFlightDOMServerBrowser.js | 1/1 ✅ | 50.0% | 6/2/0 | 66,845/13,164 | 57.8s | 1.57 |
| Operator Swap Comparison 003 | ReactFlightDOMServerNode.js | 1/1 ✅ | 100.0% | 2/1/0 | 26,150/11,778 | 43.1s | 1.95 |
| Operator Swap Equality 001 | readInputData.js | 1/1 ✅ | 100.0% | 1/1/0 | 4,879/216 | 5.1s | 0.00 |
| Operator Swap Equality 002 | editor.js | 1/1 ✅ | 50.0% | 2/2/0 | 48,944/2,287 | 16.7s | 0.00 |
| Operator Swap Equality 003 | hooks.js | 1/1 ✅ | 100.0% | 2/1/0 | 31,764/4,432 | 23.0s | 2.25 |
| Operator Swap Increment Decrement 001 | ReactFlightDOMClientNode.js | 1/1 ✅ | 100.0% | 2/1/0 | 21,790/1,022 | 11.5s | 1.52 |
| Operator Swap Increment Decrement 002 | ReactFlightDOMClientNode.js | 1/1 ✅ | 100.0% | 3/1/0 | 34,960/2,262 | 14.6s | 1.92 |
| Operator Swap Increment Decrement 003 | loadSourceAndMetadata.js | 1/1 ✅ | 100.0% | 2/1/0 | 34,392/1,172 | 10.6s | 3.72 |
| Operator Swap Logical 001 | profiling.js | 1/1 ✅ | 100.0% | 1/1/0 | 11,806/1,316 | 12.1s | 0.00 |
| Operator Swap Logical 002 | SourceMapMetadataConsumer.js | 1/1 ✅ | 100.0% | 1/1/0 | 24,275/3,461 | 15.0s | 3.14 |
| Operator Swap Logical 003 | DevToolsFiberComponentStack.js | 1/1 ✅ | 100.0% | 1/1/0 | 26,688/7,502 | 27.9s | 4.13 |
| Operator Swap Nullish 001 | getBatchRange.js | 1/1 ✅ | 50.0% | 2/2/0 | 37,389/1,867 | 15.2s | 1.33 |
| Operator Swap Nullish 002 | EnterLeaveEventPlugin.js | 0/1 ❌ | 100.0% | 19/4/0 | 170,112/20,238 | 91.9s | 1.54 |
| Operator Swap Nullish 003 | backend.js | 0/1 ❌ | 75.0% | 4/4/0 | 102,824/26,732 | 109.1s | 3.15 |
| Regex Swap Regex Quantifier 001 | githubAPI.js | 1/1 ✅ | 100.0% | 1/1/0 | 18,427/1,834 | 11.9s | 0.67 |
| Regex Swap Regex Quantifier 002 | ReactFlightStackConfigV8.js | 0/1 ❌ | 100.0% | 28/0/0 | 125,140/4,558 | 199.6s | 3.06 |
| Regex Swap Regex Quantifier 003 | utils.js | 1/1 ✅ | 75.0% | 21/4/0 | 194,212/18,115 | 117.0s | 2.00 |
| Structural Delete Statement 001 | UnsupportedVersionDialog.js | 1/1 ✅ | 100.0% | 2/1/0 | 29,181/1,592 | 14.1s | 6.22 |
| Structural Delete Statement 002 | getComponentNameFromFiber.js | 0/1 ❌ | 100.0% | 2/1/0 | 36,198/3,441 | 18.8s | 0.62 |
| Structural Delete Statement 003 | simulateBrowserEventDispatch.js | 0/1 ❌ | 100.0% | 3/1/0 | 45,108/14,735 | 54.4s | 4.46 |
| Structural Remove Early Return 001 | InspectedElementStateTree.js | 1/1 ✅ | 66.7% | 8/9/0 | 138,433/21,130 | 90.5s | 0.33 |
| Structural Remove Early Return 002 | useCommitFilteringAndNavigation.js | 1/1 ✅ | 100.0% | 9/4/0 | 98,010/19,049 | 121.0s | 3.73 |
| Structural Remove Early Return 003 | ReactFiberAsyncAction.js | 0/1 ❌ | 100.0% | 3/1/0 | 41,524/17,671 | 66.0s | 1.46 |
| Structural Swap Adjacent Lines 001 | ReactServerConsoleConfigPlain.js | 1/1 ✅ | 100.0% | 2/1/0 | 27,080/238 | 8.8s | 1.00 |
| Structural Swap Adjacent Lines 002 | ReactNoopFlightServer.js | 1/1 ✅ | 100.0% | 3/1/0 | 35,684/4,226 | 21.3s | 1.11 |
| Structural Swap Adjacent Lines 003 | backend.js | 0/1 ❌ | 40.0% | 9/10/1 | 284,793/10,492 | 325.4s | 3.15 |
| Structural Swap If Else 001 | importFile.js | 0/1 ❌ | 100.0% | 1/1/0 | 7,311/3,626 | 136.8s | 0.00 |
| Structural Swap If Else 002 | ReactNativeFiberInspector.js | 1/1 ✅ | 100.0% | 4/1/0 | 61,805/25,385 | 85.4s | 3.18 |
| Structural Swap If Else 003 | ReactDOMFizzStaticNode.js | 1/1 ✅ | 100.0% | 4/1/0 | 51,689/15,146 | 55.4s | 1.88 |
| Unicode Unicode Hyphen 001 | Rectangle.js | 1/1 ✅ | 100.0% | 2/1/0 | 31,963/581 | 34.3s | 3.00 |
| Unicode Unicode Hyphen 002 | UnsupportedBridgeProtocolDialog.js | 0/1 ❌ | 100.0% | 2/2/0 | 42,478/1,763 | 15.4s | 0.00 |
| Unicode Unicode Hyphen 003 | ReactTypes.js | 1/1 ✅ | 50.0% | 3/2/0 | 60,045/2,911 | 20.5s | 1.24 |

## Category Summary

| Category | Runs | Verified | Edit Used | Success | Min/Avg/Max Difficulty |
|----------|------|----------|-----------|---------|------------------------|
| access | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) | 7 / 8.7 / 10 |
| call | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) | 6 / 7.7 / 10 |
| duplicate | 3 | 66.7% (2/3) | 100.0% (3/3) | 66.7% (2/3) | 7 / 9.7 / 12 |
| identifier | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) | 6 / 9.3 / 14 |
| import | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) | 2 / 4.7 / 6 |
| literal | 6 | 100.0% (6/6) | 100.0% (6/6) | 100.0% (6/6) | 4 / 6.2 / 9 |
| operator | 21 | 76.2% (16/21) | 100.0% (21/21) | 76.2% (16/21) | 1 / 6.5 / 13 |
| regex | 3 | 66.7% (2/3) | 66.7% (2/3) | 66.7% (2/3) | 6 / 7.3 / 8 |
| structural | 12 | 58.3% (7/12) | 100.0% (12/12) | 58.3% (7/12) | 4 / 7.6 / 15 |
| unicode | 3 | 66.7% (2/3) | 100.0% (3/3) | 66.7% (2/3) | 1 / 3.0 / 6 |

## Mutation Summary

| Mutation | Category | Runs | Verified | Edit Used | Success |
|----------|----------|------|----------|-----------|---------|
| delete-statement | structural | 3 | 33.3% (1/3) | 100.0% (3/3) | 33.3% (1/3) |
| duplicate-line-flip | duplicate | 3 | 66.7% (2/3) | 100.0% (3/3) | 66.7% (2/3) |
| flip-boolean | literal | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| identifier-multi-edit | identifier | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| off-by-one | literal | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| remove-early-return | structural | 3 | 66.7% (2/3) | 100.0% (3/3) | 66.7% (2/3) |
| remove-negation | operator | 3 | 0.0% (0/3) | 100.0% (3/3) | 0.0% (0/3) |
| remove-optional-chain | access | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| swap-adjacent-lines | structural | 3 | 66.7% (2/3) | 100.0% (3/3) | 66.7% (2/3) |
| swap-arithmetic | operator | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| swap-call-args | call | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| swap-comparison | operator | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| swap-equality | operator | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| swap-if-else | structural | 3 | 66.7% (2/3) | 100.0% (3/3) | 66.7% (2/3) |
| swap-increment-decrement | operator | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| swap-logical | operator | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| swap-named-imports | import | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| swap-nullish | operator | 3 | 33.3% (1/3) | 100.0% (3/3) | 33.3% (1/3) |
| swap-regex-quantifier | regex | 3 | 66.7% (2/3) | 66.7% (2/3) | 66.7% (2/3) |
| unicode-hyphen | unicode | 3 | 66.7% (2/3) | 100.0% (3/3) | 66.7% (2/3) |

## Difficulty Summary

| Difficulty Score | Runs | Verified | Edit Used | Success |
|------------------|------|----------|-----------|---------|
| 0-2 | 6 | 66.7% (4/6) | 100.0% (6/6) | 66.7% (4/6) |
| 3-5 | 12 | 75.0% (9/12) | 100.0% (12/12) | 75.0% (9/12) |
| 6-8 | 24 | 91.7% (22/24) | 95.8% (23/24) | 91.7% (22/24) |
| 9+ | 18 | 66.7% (12/18) | 100.0% (18/18) | 66.7% (12/18) |

## Edit Tool Errors

Failures where the edit tool returned an error or failed to apply the patch.

### Access Remove Optional Chain 001 (registerDevToolsEventLogger.js)

#### Run 1

##### Attempt 1

- Path: registerDevToolsEventLogger.js
- Operation: —

**Tool error**

```
No changes made to registerDevToolsEventLogger.js. The edits produced identical content.
Edit 0: replacement for 36:a3 is identical to current content:
  36:a3|         currentLoggingIFrame?.contentWindow?.postMessage(
Your content must differ from what the file already contains. Re-read the file to see the current state.
The file differs from the original fixture at these lines:
36:d0| -        currentLoggingIFrame.contentWindow?.postMessage(
37:a3| +        currentLoggingIFrame?.contentWindow?.postMessage(
```

**Patch args**

```diff
{
  "edits": [
    {
      "set_line": {
        "new_text": "        currentLoggingIFrame?.contentWindow?.postMessage(",
        "anchor": "36:a3"
      }
    }
  ],
  "path": "registerDevToolsEventLogger.js"
}
```

### Duplicate Duplicate Line Flip 003 (SyntheticEvent.js)

#### Run 1

##### Attempt 1

- Path: SyntheticEvent.js
- Operation: —

**Tool error**

```
No changes made to SyntheticEvent.js. The edits produced identical content.
Edit 0: replacement for 480:46 is identical to current content:
  480:46|     if (event.type === 'keydown' || event.type === 'keyup') {
Your content must differ from what the file already contains. Re-read the file to see the current state.
```

**Patch args**

```diff
{
  "edits": [
    {
      "set_line": {
        "anchor": "480:46|     if (event.type === 'keydown' || event.type === 'keyup') {",
        "new_text": "    if (event.type === 'keydown' || event.type === 'keyup') {"
      }
    }
  ],
  "path": "SyntheticEvent.js"
}
```

### Literal Flip Boolean 003 (ReactFlightDOMClientEdge.js)

#### Run 1

##### Attempt 1

- Path: ReactFlightDOMClientEdge.js
- Operation: —

**Tool error**

```
No changes made to ReactFlightDOMClientEdge.js. The edits produced identical content.
Edit 0: replacement for 110:ce is identical to current content:
  110:ce|     __DEV__ && options ? options.replayConsoleLogs === true : false, // defaults to false
Your content must differ from what the file already contains. Re-read the file to see the current state.
The file differs from the original fixture at these lines:
110:2d| -    __DEV__ && options ? options.replayConsoleLogs === false : false, // defaults to false
111:ce| +    __DEV__ && options ? options.replayConsoleLogs === true : false, // defaults to false
```

**Patch args**

```diff
{
  "path": "ReactFlightDOMClientEdge.js",
  "edits": [
    {
      "set_line": {
        "anchor": "110:ce",
        "new_text": "    __DEV__ && options ? options.replayConsoleLogs === true : false, // defaults to false"
      }
    }
  ]
}
```

### Literal Off By One 002 (code-path.js)

#### Run 1

##### Attempt 1

- Path: code-path.js
- Operation: —

**Tool error**

```
1 line has changed since last read. Use the updated LINE:HASH references shown below (>>> marks changed lines).

    229:03|       } else if (index === end) {
    230:59|         item[0] = segment.nextSegments[index];
>>> 231:10|         item[1] = 0;
    232:32|       } else {
    233:80|         stack.pop();

Quick fix — replace stale refs:
	231:d2 → 231:10
```

**Patch args**

```diff
{
  "edits": [
    {
      "set_line": {
        "new_text": "        item[1] = 0;",
        "anchor": "231:d2|         item[1] = 1;"
      }
    }
  ],
  "path": "code-path.js"
}
```

### Operator Remove Negation 003 (ReactFlightUnbundledReferences.js)

#### Run 1

##### Attempt 1

- Path: ReactFlightUnbundledReferences.js
- Operation: —

**Tool error**

```
No changes made to ReactFlightUnbundledReferences.js. The edits produced identical content.
The file differs from the original fixture at these lines:
32:05| -
296:1e| -  if (!cachedReference) {
297:bc| -    const reference: ClientReference<any> = registerClientReferenceImpl(
298:b3| +  if (cachedReference) {
298:3a| +    return cachedReference;
298:18| +  }
298:bc| +  const reference: ClientReference<any> = registerClientReferenceImpl(
```

**Patch args**

```diff
{
  "path": "ReactFlightUnbundledReferences.js",
  "edits": [
    {
      "replace": {
        "old_text": "export function isClientReference(reference: Object): boolean {\n  return !reference.$$typeof === CLIENT_REFERENCE_TAG;\n}",
        "new_text": "export function isClientReference(reference: Object): boolean {\n  return reference.$$typeof === CLIENT_REFERENCE_TAG;\n}"
      }
    }
  ]
}
```

##### Attempt 2

- Path: ReactFlightUnbundledReferences.js
- Operation: —

**Tool error**

```
No changes made to ReactFlightUnbundledReferences.js. The edits produced identical content.
The file differs from the original fixture at these lines:
32:05| -
296:1e| -  if (!cachedReference) {
297:bc| -    const reference: ClientReference<any> = registerClientReferenceImpl(
298:b3| +  if (cachedReference) {
298:3a| +    return cachedReference;
298:18| +  }
298:bc| +  const reference: ClientReference<any> = registerClientReferenceImpl(
```

**Patch args**

```diff
{
  "path": "ReactFlightUnbundledReferences.js",
  "edits": [
    {
      "replace": {
        "new_text": "export function isClientReference(reference: Object): boolean {\n  return reference.$$typeof === CLIENT_REFERENCE_TAG;\n}",
        "old_text": "export function isClientReference(reference: Object): boolean {\n  return !reference.$$typeof === CLIENT_REFERENCE_TAG;\n}"
      }
    }
  ]
}
```

##### Attempt 3

- Path: ReactFlightUnbundledReferences.js
- Operation: —

**Tool error**

```
No changes made to ReactFlightUnbundledReferences.js. The edits produced identical content.
The file differs from the original fixture at these lines:
32:05| -
296:1e| -  if (!cachedReference) {
297:bc| -    const reference: ClientReference<any> = registerClientReferenceImpl(
298:b3| +  if (cachedReference) {
298:3a| +    return cachedReference;
298:18| +  }
298:bc| +  const reference: ClientReference<any> = registerClientReferenceImpl(
```

**Patch args**

```diff
{
  "path": "ReactFlightUnbundledReferences.js",
  "edits": [
    {
      "replace": {
        "old_text": "    !target.$$async,\n",
        "new_text": "    target.$$async,\n"
      }
    }
  ]
}
```

##### Attempt 4

- Path: ReactFlightUnbundledReferences.js
- Operation: —

**Tool error**

```
No changes made to ReactFlightUnbundledReferences.js. The edits produced identical content.
The file differs from the original fixture at these lines:
32:05| -
296:1e| -  if (!cachedReference) {
297:bc| -    const reference: ClientReference<any> = registerClientReferenceImpl(
298:b3| +  if (cachedReference) {
298:3a| +    return cachedReference;
298:18| +  }
298:bc| +  const reference: ClientReference<any> = registerClientReferenceImpl(
```

**Patch args**

```diff
{
  "edits": [
    {
      "replace": {
        "old_text": "      if (!target.then) {\n",
        "new_text": "      if (target.then) {\n"
      }
    }
  ],
  "path": "ReactFlightUnbundledReferences.js"
}
```

##### Attempt 5

- Path: ReactFlightUnbundledReferences.js
- Operation: —

**Tool error**

```
No changes made to ReactFlightUnbundledReferences.js. The edits produced identical content.
The file differs from the original fixture at these lines:
32:05| -
296:1e| -  if (!cachedReference) {
297:bc| -    const reference: ClientReference<any> = registerClientReferenceImpl(
298:b3| +  if (cachedReference) {
298:3a| +    return cachedReference;
298:18| +  }
298:bc| +  const reference: ClientReference<any> = registerClientReferenceImpl(
```

**Patch args**

```diff
{
  "edits": [
    {
      "replace": {
        "old_text": "  if (!this.$$typeof === SERVER_REFERENCE_TAG) {\n",
        "new_text": "  if (this.$$typeof === SERVER_REFERENCE_TAG) {\n"
      }
    }
  ],
  "path": "ReactFlightUnbundledReferences.js"
}
```

##### Attempt 6

- Path: ReactFlightUnbundledReferences.js
- Operation: —

**Tool error**

```
No changes made to ReactFlightUnbundledReferences.js. The edits produced identical content.
The file differs from the original fixture at these lines:
32:05| -
296:1e| -  if (!cachedReference) {
297:bc| -    const reference: ClientReference<any> = registerClientReferenceImpl(
298:b3| +  if (cachedReference) {
298:3a| +    return cachedReference;
298:18| +  }
298:bc| +  const reference: ClientReference<any> = registerClientReferenceImpl(
```

**Patch args**

```diff
{
  "path": "ReactFlightUnbundledReferences.js",
  "edits": [
    {
      "replace": {
        "old_text": "export function isServerReference(reference: Object): boolean {\n  return !reference.$$typeof === SERVER_REFERENCE_TAG;\n}",
        "new_text": "export function isServerReference(reference: Object): boolean {\n  return reference.$$typeof === SERVER_REFERENCE_TAG;\n}"
      }
    }
  ]
}
```

##### Attempt 7

- Path: ReactFlightUnbundledReferences.js
- Operation: —

**Tool error**

```
No changes made to ReactFlightUnbundledReferences.js. The edits produced identical content.
The file differs from the original fixture at these lines:
32:05| -
296:1e| -  if (!cachedReference) {
297:bc| -    const reference: ClientReference<any> = registerClientReferenceImpl(
298:b3| +  if (cachedReference) {
298:3a| +    return cachedReference;
298:18| +  }
298:bc| +  const reference: ClientReference<any> = registerClientReferenceImpl(
```

**Patch args**

```diff
{
  "edits": [
    {
      "replace": {
        "old_text": "    $$async: {value: !async},\n",
        "new_text": "    $$async: {value: async},\n"
      }
    }
  ],
  "path": "ReactFlightUnbundledReferences.js"
}
```

##### Attempt 8

- Path: ReactFlightUnbundledReferences.js
- Operation: —

**Tool error**

```
No changes made to ReactFlightUnbundledReferences.js. The edits produced identical content.
The file differs from the original fixture at these lines:
32:05| -
296:1e| -  if (!cachedReference) {
297:bc| -    const reference: ClientReference<any> = registerClientReferenceImpl(
298:b3| +  if (cachedReference) {
298:3a| +    return cachedReference;
298:18| +  }
298:bc| +  const reference: ClientReference<any> = registerClientReferenceImpl(
```

**Patch args**

```diff
{
  "path": "ReactFlightUnbundledReferences.js",
  "edits": [
    {
      "replace": {
        "new_text": "    const $$bound = {value: this.$$bound ? this.$$bound.concat(args) : args};\n",
        "old_text": "    const $$bound = {value: !this.$$bound ? this.$$bound.concat(args) : args};\n"
      }
    }
  ]
}
```

##### Attempt 9

- Path: ReactFlightUnbundledReferences.js
- Operation: —

**Tool error**

```
No changes made to ReactFlightUnbundledReferences.js. The edits produced identical content.
The file differs from the original fixture at these lines:
32:05| -
296:1e| -  if (!cachedReference) {
297:bc| -    const reference: ClientReference<any> = registerClientReferenceImpl(
298:b3| +  if (cachedReference) {
298:3a| +    return cachedReference;
298:18| +  }
298:bc| +  const reference: ClientReference<any> = registerClientReferenceImpl(
```

**Patch args**

```diff
{
  "edits": [
    {
      "replace": {
        "new_text": "    false,\n",
        "old_text": "    !false,\n"
      }
    }
  ],
  "path": "ReactFlightUnbundledReferences.js"
}
```

### Operator Swap Arithmetic 002 (CSSShorthandProperty.js)

#### Run 1

##### Attempt 1

- Path: CSSShorthandProperty.js
- Operation: —

**Tool error**

```
1 line has changed since last read. Use the updated LINE:HASH references shown below (>>> marks changed lines).

    3:5f|  *
    4:80|  * This source code is licensed under the MIT license found in the
>>> 5:d7|   * LICENSE file in the root directory of this source tree.
    6:34|  */
    7:05| 

Quick fix — replace stale refs:
	5:95 → 5:d7
```

**Patch args**

```diff
{
  "edits": [
    {
      "set_line": {
        "new_text": "  * LICENSE file in the root directory of this source tree.",
        "anchor": "5:95"
      }
    }
  ],
  "path": "CSSShorthandProperty.js"
}
```

### Operator Swap Arithmetic 003 (hooks.js)

#### Run 1

##### Attempt 1

- Path: hooks.js
- Operation: —

**Tool error**

```
1 line has changed since last read. Use the updated LINE:HASH references shown below (>>> marks changed lines).

    3:5f|  *
    4:80|  * This source code is licensed under the MIT license found in the
>>> 5:d7|   * LICENSE file in the root directory of this source tree.
    6:5f|  *
    7:8e|  * @flow

Quick fix — replace stale refs:
	5:95 → 5:d7
```

**Patch args**

```diff
{
  "path": "hooks.js",
  "edits": [
    {
      "set_line": {
        "anchor": "5:95",
        "new_text": "  * LICENSE file in the root directory of this source tree."
      }
    }
  ]
}
```

### Operator Swap Comparison 002 (ReactFlightDOMServerBrowser.js)

#### Run 1

##### Attempt 1

- Path: ReactFlightDOMServerBrowser.js
- Operation: —

**Tool error**

```
No changes made to ReactFlightDOMServerBrowser.js. The edits produced identical content.
Edit 0: replacement for 89:11 is identical to current content:
  89:11|     for (let i = 0; i < messages.length - 1; i++) {
Your content must differ from what the file already contains. Re-read the file to see the current state.
The file differs from the original fixture at these lines:
89:76| -    for (let i = 0; i <= messages.length - 1; i++) {
90:11| +    for (let i = 0; i < messages.length - 1; i++) {
```

**Patch args**

```diff
{
  "path": "ReactFlightDOMServerBrowser.js",
  "edits": [
    {
      "set_line": {
        "anchor": "89:11|     for (let i = 0; i < messages.length - 1; i++) {",
        "new_text": "    for (let i = 0; i < messages.length - 1; i++) {"
      }
    }
  ]
}
```

### Operator Swap Equality 002 (editor.js)

#### Run 1

##### Attempt 1

- Path: editor.js
- Operation: —

**Tool error**

```
1 line has changed since last read. Use the updated LINE:HASH references shown below (>>> marks changed lines).

    89:ce|       for (let i = 0; i < processNames.length; i++) {
    90:ef|         const processName = processNames[i];
>>> 91:78|         if (output.indexOf(processName) !== -1) {
    92:f0|           return [COMMON_EDITORS[processName]];
    93:18|         }

Quick fix — replace stale refs:
	91:8d → 91:78
```

**Patch args**

```diff
{
  "path": "editor.js",
  "edits": [
    {
      "set_line": {
        "anchor": "91:8d|        if (output.indexOf(processName) === -1) {",
        "new_text": "        if (output.indexOf(processName) !== -1) {"
      }
    }
  ]
}
```

### Operator Swap Nullish 001 (getBatchRange.js)

#### Run 1

##### Attempt 1

- Path: getBatchRange.js
- Operation: —

**Tool error**

```
1 line has changed since last read. Use the updated LINE:HASH references shown below (>>> marks changed lines).

    23:43| ): [Milliseconds, Milliseconds] {
    24:a4|   const measures = data.batchUIDToMeasuresMap.get(batchUID);
>>> 25:ec|   if (measures == null || measures.length === 0) {
    26:97|     throw Error(`Could not find measures with batch UID "${batchUID}"`);
    27:18|   }

Quick fix — replace stale refs:
	25:85 → 25:ec
```

**Patch args**

```diff
{
  "path": "getBatchRange.js",
  "edits": [
    {
      "set_line": {
        "anchor": "25:85",
        "new_text": "  if (measures == null || measures.length === 0) {"
      }
    }
  ]
}
```

### Operator Swap Nullish 003 (backend.js)

#### Run 1

##### Attempt 1

- Path: backend.js
- Operation: —

**Tool error**

```
1 line has changed since last read. Use the updated LINE:HASH references shown below (>>> marks changed lines).

    216:50|         bridge,
    217:41|         agent,
>>> 218:94|         ((hook.resolveRNStyle ?? resolveRNStyle: any): ResolveNativeStyle),
    219:fd|         nativeStyleEditorValidAttributes ||
    220:33|           hook.nativeStyleEditorValidAttributes ||

Quick fix — replace stale refs:
	218:56 → 218:94
```

**Patch args**

```diff
{
  "path": "backend.js",
  "edits": [
    {
      "set_line": {
        "anchor": "218:56|         ((resolveRNStyle ?? hook.resolveRNStyle: any): ResolveNativeStyle),",
        "new_text": "        ((hook.resolveRNStyle ?? resolveRNStyle: any): ResolveNativeStyle),"
      }
    }
  ]
}
```

### Regex Swap Regex Quantifier 003 (utils.js)

#### Run 1

##### Attempt 1

- Path: utils.js
- Operation: —

**Tool error**

```
1 line has changed since last read. Use the updated LINE:HASH references shown below (>>> marks changed lines).

    201:05| 
    202:fc| export function pluralize(word: string): string {
>>> 203:d0|   if (!/^[a-z]+$/i.test(word)) {
    204:26|     // If it's not a single a-z word, give up.
    205:6b|     return word;

Quick fix — replace stale refs:
	203:20 → 203:d0
```

**Patch args**

```diff
{
  "path": "utils.js",
  "edits": [
    {
      "set_line": {
        "anchor": "203:20|   if (!/^[a-z]*$/i.test(word)) {",
        "new_text": "  if (!/^[a-z]+$/i.test(word)) {"
      }
    }
  ]
}
```

### Structural Remove Early Return 001 (InspectedElementStateTree.js)

#### Run 1

##### Attempt 1

- Path: InspectedElementStateTree.js
- Operation: —

**Tool error**

```
No changes made to InspectedElementStateTree.js. The edits produced identical content.
Edit 0: replacement for 43:05 is identical to current content:
  43:05| 
Your content must differ from what the file already contains. Re-read the file to see the current state.
The file differs from the original fixture at these lines:
39:12| +  if (state == null) {
39:56| +    return null;
39:18| +  }
40:05| +
```

**Patch args**

```diff
{
  "edits": [
    {
      "set_line": {
        "anchor": "43:05|",
        "new_text": ""
      }
    }
  ],
  "path": "InspectedElementStateTree.js"
}
```

##### Attempt 2

- Path: InspectedElementStateTree.js
- Operation: —

**Tool error**

```
No changes made to InspectedElementStateTree.js. The edits produced identical content.
Edit 0: replacement for 43:05 is identical to current content:
  43:05| 
Your content must differ from what the file already contains. Re-read the file to see the current state.
The file differs from the original fixture at these lines:
39:12| +  if (state == null) {
39:56| +    return null;
39:18| +  }
40:05| +
```

**Patch args**

```diff
{
  "path": "InspectedElementStateTree.js",
  "edits": [
    {
      "replace_lines": {
        "new_text": "",
        "end_anchor": "43:05|",
        "start_anchor": "43:05|"
      }
    }
  ]
}
```

##### Attempt 3

- Path: InspectedElementStateTree.js
- Operation: —

**Tool error**

```
No changes made to InspectedElementStateTree.js. The edits produced identical content.
Edit 0: replacement for 42:05 is identical to current content:
  42:05| 

Your content must differ from what the file already contains. Re-read the file to see the current state.
The file differs from the original fixture at these lines:
39:12| +  if (state == null) {
39:56| +    return null;
39:18| +  }
40:05| +
```

**Patch args**

```diff
{
  "path": "InspectedElementStateTree.js",
  "edits": [
    {
      "replace_lines": {
        "new_text": "\n",
        "end_anchor": "43:05|",
        "start_anchor": "42:05|"
      }
    }
  ]
}
```

### Structural Swap Adjacent Lines 003 (backend.js)

#### Run 1

##### Attempt 1

- Path: backend.js
- Operation: —

**Tool error**

```
2 lines have changed since last read. Use the updated LINE:HASH references shown below (>>> marks changed lines).

    128:3e|   // See D6251744.
    129:3c|   const ws = websocket ? websocket : new window.WebSocket(uri);
>>> 130:20|   ws.onmessage = handleMessage;
    131:01|   ws.onerror = handleFailed;
>>> 132:cc|   ws.onclose = handleClose;
    133:85|   ws.onopen = function () {
    134:b1|     bridge = new Bridge({

Quick fix — replace stale refs:
	130:cc → 130:20
	132:20 → 132:cc
```

**Patch args**

```diff
{
  "path": "backend.js",
  "edits": [
    {
      "set_line": {
        "new_text": "  ws.onmessage = handleMessage;",
        "anchor": "130:cc"
      }
    },
    {
      "set_line": {
        "new_text": "  ws.onclose = handleClose;",
        "anchor": "132:20"
      }
    }
  ]
}
```

##### Attempt 2

- Path: backend.js
- Operation: —

**Tool error**

```
No changes made to backend.js. The edits produced identical content.
Edit 1: replacement for 132:cc is identical to current content:
  132:cc|   ws.onclose = handleClose;
Edit 0: replacement for 130:20 is identical to current content:
  130:20|   ws.onmessage = handleMessage;
Your content must differ from what the file already contains. Re-read the file to see the current state.
The file differs from the original fixture at these lines:
192:0a| -    const agent = new Agent(bridge, isProfiling, onReloadAndProfile);
196:0a| +    const agent = new Agent(bridge, isProfiling, onReloadAndProfile);
```

**Patch args**

```diff
{
  "edits": [
    {
      "set_line": {
        "new_text": "  ws.onmessage = handleMessage;",
        "anchor": "130:20"
      }
    },
    {
      "set_line": {
        "new_text": "  ws.onclose = handleClose;",
        "anchor": "132:cc"
      }
    }
  ],
  "path": "backend.js"
}
```

##### Attempt 3

- Path: backend.js
- Operation: —

**Tool error**

```
2 lines have changed since last read. Use the updated LINE:HASH references shown below (>>> marks changed lines).

    191:fa|     // $FlowFixMe[incompatible-call] found when upgrading Flow
    192:6b|     if (typeof onReloadAndProfileFlagsReset === 'function') {
>>> 193:89|       onReloadAndProfileFlagsReset();
    194:18|     }
>>> 195:0a|     const agent = new Agent(bridge, isProfiling, onReloadAndProfile);
    196:05| 
    197:92|     if (onSettingsUpdated != null) {

Quick fix — replace stale refs:
	193:6b → 193:89
	195:18 → 195:0a
```

**Patch args**

```diff
{
  "edits": [
    {
      "insert_after": {
        "anchor": "191:fa",
        "text": "    if (typeof onReloadAndProfileFlagsReset === 'function') {\n      onReloadAndProfileFlagsReset();\n    }"
      }
    },
    {
      "replace_lines": {
        "new_text": "",
        "end_anchor": "195:18",
        "start_anchor": "193:6b"
      }
    },
    {
      "set_line": {
        "new_text": "  const agent = new Agent(bridge, isProfiling, onReloadAndProfile);",
        "anchor": "388:6b"
      }
    },
    {
      "set_line": {
        "new_text": "  if (typeof onReloadAndProfileFlagsReset === 'function') {\n    onReloadAndProfileFlagsReset();\n  }",
        "anchor": "391:0a"
      }
    }
  ],
  "path": "backend.js"
}
```

##### Attempt 4

- Path: backend.js
- Operation: —

**Tool error**

```
1 line has changed since last read. Use the updated LINE:HASH references shown below (>>> marks changed lines).

    190:d6|     // TODO (npm-packages) Warn if "isBackendStorageAPISupported"
    191:fa|     // $FlowFixMe[incompatible-call] found when upgrading Flow
>>> 192:6b|     if (typeof onReloadAndProfileFlagsReset === 'function') {
    193:89|       onReloadAndProfileFlagsReset();
    194:18|     }

Quick fix — replace stale refs:
	192:0a → 192:6b
```

**Patch args**

```diff
{
  "path": "backend.js",
  "edits": [
    {
      "set_line": {
        "anchor": "192:0a",
        "new_text": "    const agent = new Agent(bridge, isProfiling, onReloadAndProfile);\n    if (typeof onReloadAndProfileFlagsReset === 'function') {\n      onReloadAndProfileFlagsReset();\n    }"
      }
    },
    {
      "set_line": {
        "new_text": "  if (typeof onReloadAndProfileFlagsReset === 'function') {\n    onReloadAndProfileFlagsReset();\n  }\n  const agent = new Agent(bridge, isProfiling, onReloadAndProfile);",
        "anchor": "388:6b"
      }
    },
    {
      "replace_lines": {
        "start_anchor": "390:18",
        "end_anchor": "391:0a",
        "new_text": ""
      }
    }
  ]
}
```

##### Attempt 5

- Path: backend.js
- Operation: —

**Tool error**

```
3 lines have changed since last read. Use the updated LINE:HASH references shown below (>>> marks changed lines).

    190:d6|     // TODO (npm-packages) Warn if "isBackendStorageAPISupported"
    191:fa|     // $FlowFixMe[incompatible-call] found when upgrading Flow
>>> 192:6b|     if (typeof onReloadAndProfileFlagsReset === 'function') {
>>> 193:89|       onReloadAndProfileFlagsReset();
    194:18|     }
>>> 195:0a|     const agent = new Agent(bridge, isProfiling, onReloadAndProfile);
    196:05| 
    197:92|     if (onSettingsUpdated != null) {

Quick fix — replace stale refs:
	192:0a → 192:6b
	193:6b → 193:89
	195:18 → 195:0a
```

**Patch args**

```diff
{
  "path": "backend.js",
  "edits": [
    {
      "set_line": {
        "anchor": "192:0a",
        "new_text": "    if (typeof onReloadAndProfileFlagsReset === 'function') {\n      onReloadAndProfileFlagsReset();\n    }\n    const agent = new Agent(bridge, isProfiling, onReloadAndProfile);"
      }
    },
    {
      "replace_lines": {
        "start_anchor": "193:6b",
        "end_anchor": "195:18",
        "new_text": ""
      }
    }
  ]
}
```

##### Attempt 6

- Path: backend.js
- Operation: —

**Tool error**

```
3 lines have changed since last read. Use the updated LINE:HASH references shown below (>>> marks changed lines).

    190:d6|     // TODO (npm-packages) Warn if "isBackendStorageAPISupported"
    191:fa|     // $FlowFixMe[incompatible-call] found when upgrading Flow
>>> 192:0a|     const agent = new Agent(bridge, isProfiling, onReloadAndProfile);
>>> 193:6b|     if (typeof onReloadAndProfileFlagsReset === 'function') {
    194:89|       onReloadAndProfileFlagsReset();
>>> 195:18|     }
    196:05| 
    197:92|     if (onSettingsUpdated != null) {

Quick fix — replace stale refs:
	192:6b → 192:0a
	193:89 → 193:6b
	195:0a → 195:18
```

**Patch args**

```diff
{
  "path": "backend.js",
  "edits": [
    {
      "set_line": {
        "anchor": "192:6b",
        "new_text": "    const agent = new Agent(bridge, isProfiling, onReloadAndProfile);\n    if (typeof onReloadAndProfileFlagsReset === 'function') {\n      onReloadAndProfileFlagsReset();\n    }"
      }
    },
    {
      "replace_lines": {
        "end_anchor": "195:0a",
        "start_anchor": "193:89",
        "new_text": ""
      }
    }
  ]
}
```

### Unicode Unicode Hyphen 003 (ReactTypes.js)

#### Run 1

##### Attempt 1

- Path: ReactTypes.js
- Operation: —

**Tool error**

```
1 line has changed since last read. Use the updated LINE:HASH references shown below (>>> marks changed lines).

    345:14|   // It does not allow a single element child.
    346:d6|   children?: Iterable<SuspenseListRow> | AsyncIterable<SuspenseListRow>, // Note: AsyncIterable is experimental.
>>> 347:ed|   revealOrder: 'forwards' | 'backwards' | 'unstable_legacy-backwards',
    348:9a|   tail?: SuspenseListTailMode,
    349:a9| };

Quick fix — replace stale refs:
	347:cb → 347:ed
```

**Patch args**

```diff
{
  "path": "ReactTypes.js",
  "edits": [
    {
      "set_line": {
        "anchor": "347:cb",
        "new_text": "  revealOrder: 'forwards' | 'backwards' | 'unstable_legacy-backwards',"
      }
    }
  ]
}
```

## Failed Tasks (0% passing)

### Duplicate Duplicate Line Flip 003 (SyntheticEvent.js) — 0/1

**All runs failed with same error:** File mismatch for SyntheticEvent.js

**Diff (expected vs actual):**
```diff
@@ -448 @@
 
     // KeyPress is deprecated, but its replacement is not yet final and not
     // implemented in any major browser. Only KeyPress has charCode.
-    if (event.type === 'keypress') {
+    if (event.type !== 'keypress') {
       return getEventCharCode(
         // $FlowFixMe[incompatible-call] unable to narrow to `KeyboardEvent`
         event,
```

### Operator Remove Negation 001 (ReactDOMClient.js) — 0/1

**All runs failed with same error:** File mismatch for ReactDOMClient.js

**Diff (expected vs actual):**
```diff
@@ -49 @@
 const foundDevTools = injectIntoDevTools();
 
 if (__DEV__) {
-  if (!foundDevTools && canUseDOM && window.top === window.self) {
+  if (foundDevTools && canUseDOM && window.top === window.self) {
     // If we're in Chrome or Firefox, provide a download link if not installed.
     if (
       (navigator.userAgent.indexOf('Chrome') > -1 && navigator.userAgent.indexOf('Edge') === -1) ||
```

### Operator Remove Negation 002 (NativeEventsView.js) — 0/1

**All runs failed with same error:** File mismatch for NativeEventsView.js

**Diff (expected vs actual):**
```diff
@@ -114 @@
       },
       size: { width: xStop - xStart, height: NATIVE_EVENT_HEIGHT },
     };
-    if (!rectIntersectsRect(eventRect, rect)) {
+    if (rectIntersectsRect(eventRect, rect)) {
       return; // Not in view
     }
 
```

### Operator Remove Negation 003 (ReactFlightUnbundledReferences.js) — 0/1

**All runs failed with same error:** File mismatch for ReactFlightUnbundledReferences.js

**Diff (expected vs actual):**
```diff
@@ -7 @@
  * @flow
  */
 
-import type { ReactClientValue } from 'react-server/src/ReactFlightServer';
+import type {ReactClientValue} from 'react-server/src/ReactFlightServer';
 
 export type ServerReference<T: Function> = T & {
   $$typeof: symbol,
@@ -29 @@
 export function isClientReference(reference: Object): boolean {
   return reference.$$typeof === CLIENT_REFERENCE_TAG;
 }
-
 export function isServerReference(reference: Object): boolean {
   return reference.$$typeof === SERVER_REFERENCE_TAG;
 }
@@ -39 @@
   id: string,
   exportName: string,
 ): ClientReference<T> {
-  return registerClientReferenceImpl(proxyImplementation, id + '#' + exportName, false);
+  return registerClientReferenceImpl(
+    proxyImplementation,
+    id + '#' + exportName,
+    false,
+  );
 }
 
 function registerClientReferenceImpl<T>(
@@ -48 @@
   async: boolean,
 ): ClientReference<T> {
   return Object.defineProperties(proxyImplementation, {
-    $$typeof: { value: CLIENT_REFERENCE_TAG },
-    $$id: { value: id },
-    $$async: { value: async },
+    $$typeof: {value: CLIENT_REFERENCE_TAG},
+    $$id: {value: id},
+    $$async: {value: async},
   });
 }
 
@@ -69 @@
           'Cannot bind "this" of a Server Action. Pass null or undefined as the first argument to .bind().',
         );
       }
-    }
+      }
     const args = ArraySlice.call(arguments, 1);
     const args = ArraySlice.call(arguments, 1);
-    const $$typeof = { value: SERVER_REFERENCE_TAG };
-    const $$id = { value: this.$$id };
-    const $$bound = { value: this.$$bound ? this.$$bound.concat(args) : args };
+    const $$typeof = {value: SERVER_REFERENCE_TAG};
+    const $$id = {value: this.$$id};
+    const $$bound = {value: this.$$bound ? this.$$bound.concat(args) : args};
     return Object.defineProperties(
       (newFn: any),
       (__DEV__
@@ -85 @@
               value: this.$$location,
               configurable: true,
             },
-            bind: { value: bind, configurable: true },
+      ...
```

### Operator Swap Nullish 002 (EnterLeaveEventPlugin.js) — 0/1

**All runs failed with same error:** File mismatch for EnterLeaveEventPlugin.js

**Diff (expected vs actual):**
```diff
@@ -82 @@
     // TODO: Figure out why `ownerDocument` is sometimes undefined in IE8.
     const doc = (nativeEventTarget: any).ownerDocument;
     if (doc) {
-      win = doc.defaultView || doc.parentWindow;
+      win = doc.defaultView ?? doc.parentWindow;
     } else {
       win = window;
     }
```

### Operator Swap Nullish 003 (backend.js) — 0/1

**All runs failed with same error:** File mismatch for backend.js

**Sample agent response (run 1):**
```
I have fixed the bug in `backend.js` where the operands of the nullish coalescing operator were swapped.

The issue was located at line 218, where `resolveRNStyle ?? hook.resolveRNStyle` was used to determine the React Native style resolver. In this context, the `hook.resolveRNStyle` (provided by the renderer through the global hook) should take precedence or be the primary source depending on the initialized state, and the operands were found to be in the wrong priority order for this specif...
```

**Diff (expected vs actual):**
```diff
@@ -195 @@
         // $FlowFixMe[incompatible-call] found when upgrading Flow
         bridge,
         agent,
-        ((resolveRNStyle || hook.resolveRNStyle: any): ResolveNativeStyle),
+        ((hook.resolveRNStyle ?? resolveRNStyle: any): ResolveNativeStyle),
         nativeStyleEditorValidAttributes || hook.nativeStyleEditorValidAttributes || null,
       );
     } else {
```

### Regex Swap Regex Quantifier 002 (ReactFlightStackConfigV8.js) — 0/1

**All runs failed with same error:** File mismatch for ReactFlightStackConfigV8.js

**Diff (expected vs actual):**
```diff
@@ -126 @@
 //     at filename:0:0
 //     at async filename:0:0
 const frameRegExp =
-  /^ {3} at (?:(.+) \((?:(.+):(\d+):(\d+)|\<anonymous\>)\)|(?:async )?(.+):(\d+):(\d+)|\<anonymous\>)$/;
+  /^ {3} at (?:(.+) \((?:(.+):(\d*):(\d+)|\<anonymous\>)\)|(?:async )?(.+):(\d+):(\d+)|\<anonymous\>)$/;
 
 // DEV-only cache of parsed and filtered stack frames.
 const stackTraceCache: WeakMap<Error, ReactStackTrace> = __DEV__ ? new WeakMap() : (null: any);
```

### Structural Delete Statement 002 (getComponentNameFromFiber.js) — 0/1

**All runs failed with same error:** File mismatch for getComponentNameFromFiber.js

**Sample agent response (run 1):**
```
I restored the deleted statement in the `getWrappedName` function in `getComponentNameFromFiber.js`. This statement initializes `functionName` using `getComponentNameFromType(innerType)`, which is required for the subsequent string construction.

```javascript
function getWrappedName(
  outerType: mixed,
  innerType: any,
  wrapperName: string,
): string {
  const functionName = getComponentNameFromType(innerType) || '';
  return (
    (outerType: any).displayName ||
    (functionName !== '' ...
```

**Diff (expected vs actual):**
```diff
@@ -54 @@
 
 // Keep in sync with shared/getComponentNameFromType
 function getWrappedName(outerType: mixed, innerType: any, wrapperName: string): string {
-  const functionName = innerType.displayName || innerType.name || '';
+  const functionName = getComponentNameFromType(innerType) || '';
   return (
     (outerType: any).displayName ||
     (functionName !== '' ? `${wrapperName}(${functionName})` : wrapperName)
```

### Structural Delete Statement 003 (simulateBrowserEventDispatch.js) — 0/1

**All runs failed with same error:** File mismatch for simulateBrowserEventDispatch.js

**Sample agent response (run 1):**
```
I have fixed the bug in `simulateBrowserEventDispatch.js`. 

The bug was caused by the deletion of statements that initialize the event's internal path and target at the beginning of the dispatch process. Without these, the `appendToEventPath` function would fail as it attempted to push to an uninitialized array, and event handlers would receive an incorrect or missing `target`. Additionally, I corrected `targetOverride` to ensure it correctly references the wrapper (DOM node) rather than the...
```

**Diff (expected vs actual):**
```diff
@@ -71 @@
 
   const targetOverride = legacyTargetOverrideFlag
     ? wrapperForImpl(targetImpl._globalObject._document)
-    : targetImpl;
+    : wrapperForImpl(targetImpl);
+
+  eventImpl._path = [];
+  eventImpl.target = targetOverride;
   let relatedTarget = retarget(eventImpl.relatedTarget, targetImpl);
 
   if (targetImpl !== relatedTarget || targetImpl === eventImpl.relatedTarget) {
@@ -82 @@
     const isActivationEvent = false; // TODO Not ported in fork.
 
     if (isActivationEvent && targetImpl._hasActivationBehavior) {
-      activationTarget = targetImpl;
     }
 
     let slotInClosedTree = false;
```

### Structural Remove Early Return 003 (ReactFiberAsyncAction.js) — 0/1

**All runs failed with same error:** File mismatch for ReactFiberAsyncAction.js

**Sample agent response (run 1):**
```
I have restored the missing guard clause in `entangleAsyncAction`. This early return ensures that if the provided `thenable` is not a valid thenable (i.e., it is `null` or doesn't have a `then` method), the function returns it immediately without attempting to entangle it or incrementing the pending action count. This prevents potential runtime errors when synchronous actions are passed to the entanglement logic.

```javascript
export function entangleAsyncAction<S>(
  transition: Transition,...
```

**Diff (expected vs actual):**
```diff
@@ -56 @@
 let needsIsomorphicIndicator: boolean = false;
 
 export function entangleAsyncAction<S>(transition: Transition, thenable: Thenable<S>): Thenable<S> {
+  if (thenable === null || typeof thenable.then !== 'function') {
+    return thenable;
+  }
   // `thenable` is the return value of the async action scope function. Create
   // a combined thenable that resolves once every entangled scope function
   // has finished.
@@ -176 @@
 export function registerDefaultIndicator(
   onDefaultTransitionIndicator: () => void | (() => void),
 ): void {
-  if (!enableDefaultTransitionIndicator) {
-    return;
-  }
   if (isomorphicDefaultTransitionIndicator === undefined) {
     isomorphicDefaultTransitionIndicator = onDefaultTransitionIndicator;
   } else if (isomorphicDefaultTransitionIndicator !== onDefaultTransitionIndicator) {
```

### Structural Swap Adjacent Lines 003 (backend.js) — 0/1

**All runs failed with same error:** File mismatch for backend.js

**Sample agent response (run 1):**
```
I have fixed a bug in `backend.js` where the `Agent` was being instantiated before the reload and profile flags were reset in `connectToDevTools`. This resulted in the agent potentially picking up stale profiling state. I have reordered these two adjacent statements (the agent instantiation and the conditional flag reset block) to ensure a clean state for the new session.

```javascript
<<<<
    const agent = new Agent(bridge, isProfiling, onReloadAndProfile);
    if (typeof onReloadAndProfil...
```

**Diff (expected vs actual):**
```diff
@@ -77 @@
     useHttps = false,
     port = 8097,
     websocket,
-    resolveRNStyle = (null: $FlowFixMe),
     retryConnectionDelay = 2000,
     retryConnectionDelay = 2000,
+    resolveRNStyle = (null: $FlowFixMe),
     isAppActive = () => true,
     onSettingsUpdated,
     isReloadAndProfileSupported = getIsReloadAndProfileSupported(),
@@ -169 @@
 
     // TODO (npm-packages) Warn if "isBackendStorageAPISupported"
     // $FlowFixMe[incompatible-call] found when upgrading Flow
-    const agent = new Agent(bridge, isProfiling, onReloadAndProfile);
     if (typeof onReloadAndProfileFlagsReset === 'function') {
       onReloadAndProfileFlagsReset();
     }
     if (typeof onReloadAndProfileFlagsReset === 'function') {
       onReloadAndProfileFlagsReset();
     }
+    const agent = new Agent(bridge, isProfiling, onReloadAndProfile);
 
     if (onSettingsUpdated != null) {
       agent.addListener('updateHookSettings', onSettingsUpdated);
```

### Structural Swap If Else 001 (importFile.js) — 0/1

**All runs failed with same error:** File mismatch for importFile.js

**Diff (expected vs actual):**
```diff
@@ -31 @@
       processedData,
     };
   } catch (error) {
-    if (error instanceof InvalidProfileError) {
+    if (!(error instanceof InvalidProfileError)) {
       return {
       return {
-        status: 'INVALID_PROFILE_ERROR',
+        status: 'UNEXPECTED_ERROR',
         error,
       };
     } else {
@@ -38 @@
       };
     } else {
       return {
-        status: 'UNEXPECTED_ERROR',
+        status: 'INVALID_PROFILE_ERROR',
         error,
       };
     }
```

### Unicode Unicode Hyphen 002 (UnsupportedBridgeProtocolDialog.js) — 0/1

**All runs failed with same error:** File mismatch for UnsupportedBridgeProtocolDialog.js

**Sample agent response (run 1):**
```
The bug was a Unicode EN DASH in the import statement on line 19 of `UnsupportedBridgeProtocolDialog.js`. I replaced it with a plain ASCII hyphen.
```

**Diff (expected vs actual):**
```diff
@@ -8 @@
  */
 
 import * as React from 'react';
-import { Fragment, useContext, useEffect } from 'react';
-import { ModalDialogContext } from './ModalDialog';
-import { StoreContext } from './context';
-import { currentBridgeProtocol } from 'react-devtools-shared/src/bridge';
+import {Fragment, useContext, useEffect} from 'react';
+import {ModalDialogContext} from './ModalDialog';
+import {StoreContext} from './context';
+import {currentBridgeProtocol} from 'react-devtools-shared/src/bridge';
 import Button from './Button';
 import ButtonIcon from './ButtonIcon';
 import Button from './Button';
 import ButtonIcon from './ButtonIcon';
-import { copy } from 'clipboard-js';
+import {copy} from 'clipboard-js';
 import styles from './UnsupportedBridgeProtocolDialog.css';
 import styles from './UnsupportedBridgeProtocolDialog.css';
-import { withPermissionsCheck } from 'react-devtools-shared/src/frontend/utils/withPermissionsCheck';
+import {withPermissionsCheck} from 'react-devtools-shared/src/frontend/utils/withPermissionsCheck';
 
 
-import type { BridgeProtocol } from 'react-devtools-shared/src/bridge';
+import type {BridgeProtocol} from 'react-devtools-shared/src/bridge';
 
 const DEVTOOLS_VERSION = process.env.DEVTOOLS_VERSION;
 
 const DEVTOOLS_VERSION = process.env.DEVTOOLS_VERSION;
-const INSTRUCTIONS_FB_URL = 'https://fb.me/devtools-unsupported-bridge-protocol';
+const INSTRUCTIONS_FB_URL =
+  'https://fb.me/devtools-unsupported-bridge-protocol';
 const MODAL_DIALOG_ID = 'UnsupportedBridgeProtocolDialog';
 
 export default function UnsupportedBridgeProtocolDialog(_: {}): null {
 const MODAL_DIALOG_ID = 'UnsupportedBridgeProtocolDialog';
 
 export default function UnsupportedBridgeProtocolDialog(_: {}): null {
-  const { dialogs, dispatch } = useContext(ModalDialogContext);
+  const {dialogs, dispatch} = useContext(ModalDialogContext);
   const store = useContext(StoreContext);
 
   const store = useContext(StoreContext);
 
-  const isVisible = !!dialogs.find...
```
