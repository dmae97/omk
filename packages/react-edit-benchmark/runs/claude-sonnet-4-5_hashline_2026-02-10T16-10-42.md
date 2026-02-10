# Edit Benchmark Report

## Configuration

| Setting | Value |
|---------|-------|
| Date | 2026-02-10T16:02:38.782Z |
| Model | p-anthropic/p-anthropic/claude-sonnet-4-5 |
| Thinking Level | default |
| Runs per task | 3 |
| Edit Variant | hashline |
| Edit Fuzzy | auto |
| Edit Fuzzy Threshold | auto |
| Require Edit Tool | no |
| No-Edit Baseline | no |

## Summary

| Metric | Value |
|--------|-------|
| Total Tasks | 60 |
| Total Runs | 180 |
| Successful Runs | 137 |
| **Task Success Rate** | **76.1% (137/180)** |
| Verified Rate | 76.1% (137/180) |
| Edit Tool Usage Rate | 97.8% (176/180) |
| **Edit Success Rate** | **97.8%** |
| Patch Failure Rate | 2.2% (4/185) |
| Tasks All Passing | 38 |
| Tasks Flaky/Failing | 22 |

### Tool Calls

| Tool | Total | Avg/Run |
|------|-------|---------|
| Read | 212 | 1.2 |
| Edit | 185 | 1.0 |
| Write | 0 | 0.0 |
| **Tool Input Chars** | 42,131 | 234 |

### Tokens & Time

| Metric | Total | Avg/Run |
|--------|-------|---------|
| Input Tokens | 2,935,507 | 16,308 |
| Output Tokens | 193,356 | 1,074 |
| Total Tokens | 12,015,653 | 66,754 |
| Duration | 4907.8s | 27.3s |
| **Avg Indent Score** | — | **2.23** |

## Task Results

| Task | File | Success | Edit Hit | R/E/W | Tokens (In/Out) | Time | Indent |
|------|------|---------|----------|-------|-----------------|------|--------|
| Access Remove Optional Chain 001 | registerDevToolsEventLogger.js | 2/3 ⚠️ | 100.0% | 1/1/0 | 12,866/1,097 | 22.4s | 1.00 |
| Access Remove Optional Chain 002 | TimelineContext.js | 3/3 ✅ | 100.0% | 1/1/0 | 5,707/964 | 20.6s | 1.29 |
| Access Remove Optional Chain 003 | astUtils.js | 0/3 ❌ | 100.0% | 1/1/0 | 26,837/1,034 | 24.7s | 4.85 |
| Call Swap Call Args 001 | testHelpers.js | 3/3 ✅ | 100.0% | 1/1/0 | 5,700/796 | 17.3s | 1.33 |
| Call Swap Call Args 002 | FlamegraphChartBuilder.js | 3/3 ✅ | 100.0% | 1/1/0 | 8,522/718 | 18.2s | 3.79 |
| Call Swap Call Args 003 | SyntheticEvent.js | 3/3 ✅ | 100.0% | 1/1/0 | 38/1,728 | 32.3s | 3.76 |
| Duplicate Duplicate Line Flip 001 | index.js | 3/3 ✅ | 100.0% | 1/1/0 | 26,441/487 | 14.1s | 0.00 |
| Duplicate Duplicate Line Flip 002 | ActivityList.js | 3/3 ✅ | 100.0% | 1/1/0 | 28,151/583 | 16.5s | 3.61 |
| Duplicate Duplicate Line Flip 003 | SyntheticEvent.js | 3/3 ✅ | 100.0% | 1/1/0 | 15,282/1,105 | 26.3s | 1.02 |
| Identifier Identifier Multi Edit 001 | TabBar.js | 2/3 ⚠️ | 100.0% | 1/1/0 | 15,162/956 | 18.8s | 3.33 |
| Identifier Identifier Multi Edit 002 | EventPluginRegistry.js | 3/3 ✅ | 100.0% | 1/1/0 | 10,236/908 | 20.5s | 3.94 |
| Identifier Identifier Multi Edit 003 | ReactPerformanceTrackProperties.js | 2/3 ⚠️ | 100.0% | 1/1/0 | 16,504/1,036 | 22.4s | 9.95 |
| Import Swap Named Imports 001 | CommitFlamegraphListItem.js | 3/3 ✅ | 100.0% | 1/1/0 | 34/815 | 21.3s | 2.86 |
| Import Swap Named Imports 002 | ReactDOMTextarea.js | 3/3 ✅ | 100.0% | 2/1/0 | 24,378/899 | 24.2s | 2.41 |
| Import Swap Named Imports 003 | StyleEditor.js | 1/3 ⚠️ | 100.0% | 1/1/0 | 22,125/3,090 | 94.7s | 1.31 |
| Literal Flip Boolean 001 | testHelpers.js | 3/3 ✅ | 100.0% | 1/1/0 | 4,254/651 | 15.9s | 1.33 |
| Literal Flip Boolean 002 | ReactNoopFlightServer.js | 3/3 ✅ | 100.0% | 1/1/0 | 22,591/561 | 15.6s | 1.11 |
| Literal Flip Boolean 003 | ReactFlightDOMClientEdge.js | 2/3 ⚠️ | 100.0% | 1/1/0 | 5,515/1,176 | 26.5s | 3.58 |
| Literal Off By One 001 | githubAPI.js | 1/3 ⚠️ | 100.0% | 1/1/0 | 19,343/601 | 14.5s | 0.67 |
| Literal Off By One 002 | code-path.js | 3/3 ✅ | 100.0% | 1/1/0 | 11,727/1,104 | 23.3s | 3.50 |
| Literal Off By One 003 | InspectedElement.js | 3/3 ✅ | 100.0% | 1/1/0 | 37/1,170 | 27.8s | 3.60 |
| Operator Remove Negation 001 | ReactDOMClient.js | 2/3 ⚠️ | 75.0% | 3/3/0 | 30,542/4,629 | 99.3s | 1.08 |
| Operator Remove Negation 002 | NativeEventsView.js | 2/3 ⚠️ | 100.0% | 1/1/0 | 8,676/403 | 50.1s | 3.03 |
| Operator Remove Negation 003 | ReactFlightUnbundledReferences.js | 0/3 ❌ | 100.0% | 0/0/0 | 6,637/1,646 | 113.1s | 2.00 |
| Operator Swap Arithmetic 001 | fallbackEvalContext.js | 3/3 ✅ | 100.0% | 1/1/0 | 16,127/399 | 11.8s | 0.07 |
| Operator Swap Arithmetic 002 | CSSShorthandProperty.js | 3/3 ✅ | 100.0% | 1/1/0 | 20,921/525 | 16.0s | 2.85 |
| Operator Swap Arithmetic 003 | hooks.js | 0/3 ❌ | 100.0% | 2/1/0 | 12,748/3,394 | 72.3s | 2.25 |
| Operator Swap Comparison 001 | index.js | 3/3 ✅ | 100.0% | 1/1/0 | 8,267/526 | 13.2s | 0.00 |
| Operator Swap Comparison 002 | ReactFlightDOMServerBrowser.js | 3/3 ✅ | 100.0% | 1/1/0 | 43,928/571 | 16.2s | 1.57 |
| Operator Swap Comparison 003 | ReactFlightDOMServerNode.js | 2/3 ⚠️ | 100.0% | 1/1/0 | 23,358/968 | 20.3s | 1.95 |
| Operator Swap Equality 001 | readInputData.js | 3/3 ✅ | 100.0% | 1/1/0 | 5,150/533 | 13.3s | 0.00 |
| Operator Swap Equality 002 | editor.js | 3/3 ✅ | 100.0% | 1/1/0 | 27,588/776 | 18.8s | 0.00 |
| Operator Swap Equality 003 | hooks.js | 3/3 ✅ | 100.0% | 2/1/0 | 14,243/733 | 19.6s | 2.25 |
| Operator Swap Increment Decrement 001 | ReactFlightDOMClientNode.js | 3/3 ✅ | 100.0% | 1/1/0 | 11,209/673 | 16.9s | 1.52 |
| Operator Swap Increment Decrement 002 | ReactFlightDOMClientNode.js | 3/3 ✅ | 100.0% | 1/1/0 | 16,127/695 | 19.3s | 1.92 |
| Operator Swap Increment Decrement 003 | loadSourceAndMetadata.js | 3/3 ✅ | 100.0% | 1/1/0 | 8,646/712 | 16.9s | 3.72 |
| Operator Swap Logical 001 | profiling.js | 3/3 ✅ | 100.0% | 1/1/0 | 8,308/853 | 19.1s | 0.00 |
| Operator Swap Logical 002 | SourceMapMetadataConsumer.js | 3/3 ✅ | 100.0% | 1/1/0 | 21,475/1,112 | 24.4s | 3.14 |
| Operator Swap Logical 003 | DevToolsFiberComponentStack.js | 3/3 ✅ | 100.0% | 1/1/0 | 34/1,281 | 27.7s | 4.13 |
| Operator Swap Nullish 001 | getBatchRange.js | 2/3 ⚠️ | 100.0% | 2/1/0 | 9,994/1,491 | 33.3s | 1.33 |
| Operator Swap Nullish 002 | EnterLeaveEventPlugin.js | 2/3 ⚠️ | 100.0% | 1/1/0 | 10,233/1,848 | 38.6s | 1.56 |
| Operator Swap Nullish 003 | backend.js | 0/3 ❌ | 100.0% | 1/1/0 | 32,679/1,678 | 35.6s | 3.15 |
| Regex Swap Regex Quantifier 001 | githubAPI.js | 3/3 ✅ | 100.0% | 1/1/0 | 15,720/691 | 18.2s | 0.67 |
| Regex Swap Regex Quantifier 002 | ReactFlightStackConfigV8.js | 3/3 ✅ | 100.0% | 1/1/0 | 32,219/1,237 | 28.4s | 3.06 |
| Regex Swap Regex Quantifier 003 | utils.js | 3/3 ✅ | 100.0% | 1/1/0 | 32,642/1,272 | 30.5s | 2.00 |
| Structural Delete Statement 001 | UnsupportedVersionDialog.js | 3/3 ✅ | 100.0% | 1/1/0 | 7,840/631 | 15.2s | 6.22 |
| Structural Delete Statement 002 | getComponentNameFromFiber.js | 3/3 ✅ | 100.0% | 1/1/0 | 20,707/499 | 15.6s | 0.62 |
| Structural Delete Statement 003 | simulateBrowserEventDispatch.js | 0/3 ❌ | 100.0% | 1/1/0 | 8,750/1,153 | 25.8s | 4.46 |
| Structural Remove Early Return 001 | InspectedElementStateTree.js | 3/3 ✅ | 100.0% | 1/1/0 | 31,420/749 | 18.6s | 0.36 |
| Structural Remove Early Return 002 | useCommitFilteringAndNavigation.js | 1/3 ⚠️ | 100.0% | 1/1/0 | 9,845/625 | 16.6s | 1.24 |
| Structural Remove Early Return 003 | ReactFiberAsyncAction.js | 0/3 ❌ | 100.0% | 1/1/0 | 9,874/1,579 | 30.3s | 1.46 |
| Structural Swap Adjacent Lines 001 | ReactServerConsoleConfigPlain.js | 3/3 ✅ | 100.0% | 1/1/0 | 12,881/543 | 14.7s | 1.00 |
| Structural Swap Adjacent Lines 002 | ReactNoopFlightServer.js | 1/3 ⚠️ | 100.0% | 1/1/0 | 28,771/873 | 18.6s | 0.74 |
| Structural Swap Adjacent Lines 003 | backend.js | 0/3 ❌ | 66.7% | 1/1/0 | 5,359/1,779 | 58.2s | 3.15 |
| Structural Swap If Else 001 | importFile.js | 1/3 ⚠️ | 100.0% | 2/1/0 | 20,759/1,978 | 35.5s | 0.00 |
| Structural Swap If Else 002 | ReactNativeFiberInspector.js | 0/3 ❌ | 75.0% | 1/1/0 | 18,757/963 | 21.1s | 3.18 |
| Structural Swap If Else 003 | ReactDOMFizzStaticNode.js | 3/3 ✅ | 100.0% | 1/1/0 | 3,051/1,372 | 27.0s | 1.88 |
| Unicode Unicode Hyphen 001 | Rectangle.js | 3/3 ✅ | 100.0% | 1/1/0 | 30,644/499 | 16.3s | 3.00 |
| Unicode Unicode Hyphen 002 | UnsupportedBridgeProtocolDialog.js | 3/3 ✅ | 100.0% | 1/1/0 | 59,061/429 | 13.0s | 3.83 |
| Unicode Unicode Hyphen 003 | ReactTypes.js | 3/3 ✅ | 100.0% | 1/1/0 | 11,866/657 | 18.4s | 1.24 |

## Category Summary

| Category | Runs | Verified | Edit Used | Success | Min/Avg/Max Difficulty |
|----------|------|----------|-----------|---------|------------------------|
| access | 9 | 55.6% (5/9) | 100.0% (9/9) | 55.6% (5/9) | 7 / 8.7 / 10 |
| call | 9 | 100.0% (9/9) | 100.0% (9/9) | 100.0% (9/9) | 6 / 7.7 / 10 |
| duplicate | 9 | 100.0% (9/9) | 100.0% (9/9) | 100.0% (9/9) | 7 / 9.7 / 12 |
| identifier | 9 | 77.8% (7/9) | 100.0% (9/9) | 77.8% (7/9) | 6 / 9.3 / 14 |
| import | 9 | 77.8% (7/9) | 88.9% (8/9) | 77.8% (7/9) | 2 / 4.7 / 6 |
| literal | 18 | 83.3% (15/18) | 100.0% (18/18) | 83.3% (15/18) | 4 / 6.2 / 9 |
| operator | 63 | 77.8% (49/63) | 95.2% (60/63) | 77.8% (49/63) | 1 / 6.5 / 13 |
| regex | 9 | 100.0% (9/9) | 100.0% (9/9) | 100.0% (9/9) | 6 / 7.3 / 8 |
| structural | 36 | 50.0% (18/36) | 100.0% (36/36) | 50.0% (18/36) | 4 / 7.6 / 15 |
| unicode | 9 | 100.0% (9/9) | 100.0% (9/9) | 100.0% (9/9) | 1 / 3.0 / 6 |

## Mutation Summary

| Mutation | Category | Runs | Verified | Edit Used | Success |
|----------|----------|------|----------|-----------|---------|
| delete-statement | structural | 9 | 66.7% (6/9) | 100.0% (9/9) | 66.7% (6/9) |
| duplicate-line-flip | duplicate | 9 | 100.0% (9/9) | 100.0% (9/9) | 100.0% (9/9) |
| flip-boolean | literal | 9 | 88.9% (8/9) | 100.0% (9/9) | 88.9% (8/9) |
| identifier-multi-edit | identifier | 9 | 77.8% (7/9) | 100.0% (9/9) | 77.8% (7/9) |
| off-by-one | literal | 9 | 77.8% (7/9) | 100.0% (9/9) | 77.8% (7/9) |
| remove-early-return | structural | 9 | 44.4% (4/9) | 100.0% (9/9) | 44.4% (4/9) |
| remove-negation | operator | 9 | 44.4% (4/9) | 66.7% (6/9) | 44.4% (4/9) |
| remove-optional-chain | access | 9 | 55.6% (5/9) | 100.0% (9/9) | 55.6% (5/9) |
| swap-adjacent-lines | structural | 9 | 44.4% (4/9) | 100.0% (9/9) | 44.4% (4/9) |
| swap-arithmetic | operator | 9 | 66.7% (6/9) | 100.0% (9/9) | 66.7% (6/9) |
| swap-call-args | call | 9 | 100.0% (9/9) | 100.0% (9/9) | 100.0% (9/9) |
| swap-comparison | operator | 9 | 88.9% (8/9) | 100.0% (9/9) | 88.9% (8/9) |
| swap-equality | operator | 9 | 100.0% (9/9) | 100.0% (9/9) | 100.0% (9/9) |
| swap-if-else | structural | 9 | 44.4% (4/9) | 100.0% (9/9) | 44.4% (4/9) |
| swap-increment-decrement | operator | 9 | 100.0% (9/9) | 100.0% (9/9) | 100.0% (9/9) |
| swap-logical | operator | 9 | 100.0% (9/9) | 100.0% (9/9) | 100.0% (9/9) |
| swap-named-imports | import | 9 | 77.8% (7/9) | 88.9% (8/9) | 77.8% (7/9) |
| swap-nullish | operator | 9 | 44.4% (4/9) | 100.0% (9/9) | 44.4% (4/9) |
| swap-regex-quantifier | regex | 9 | 100.0% (9/9) | 100.0% (9/9) | 100.0% (9/9) |
| unicode-hyphen | unicode | 9 | 100.0% (9/9) | 100.0% (9/9) | 100.0% (9/9) |

## Difficulty Summary

| Difficulty Score | Runs | Verified | Edit Used | Success |
|------------------|------|----------|-----------|---------|
| 0-2 | 18 | 94.4% (17/18) | 100.0% (18/18) | 94.4% (17/18) |
| 3-5 | 36 | 80.6% (29/36) | 97.2% (35/36) | 80.6% (29/36) |
| 6-8 | 72 | 76.4% (55/72) | 98.6% (71/72) | 76.4% (55/72) |
| 9+ | 54 | 66.7% (36/54) | 96.3% (52/54) | 66.7% (36/54) |

## Edit Tool Errors

Failures where the edit tool returned an error or failed to apply the patch.

### Operator Remove Negation 001 (ReactDOMClient.js)

#### Run 1

##### Attempt 1

- Path: /tmp/reach-benchmark-IDdsxr/batch-a451507a-6cab-4242-acc6-d8e81ded6335/ReactDOMClient.js
- Operation: —

**Tool error**

```
No changes made to /tmp/reach-benchmark-IDdsxr/batch-a451507a-6cab-4242-acc6-d8e81ded6335/ReactDOMClient.js. The edits produced identical content.
```

**Patch args**

```diff
{
  "edits": [
    {
      "old": [
        "57:ff"
      ],
      "new": [
        "  if (foundDevTools && canUseDOM && window.top === window.self) {"
      ]
    }
  ],
  "path": "/tmp/reach-benchmark-IDdsxr/batch-a451507a-6cab-4242-acc6-d8e81ded6335/ReactDOMClient.js"
}
```

#### Run 2

##### Attempt 1

- Path: ReactDOMClient.js
- Operation: —

**Tool error**

```
No changes made to ReactDOMClient.js. The edits produced identical content.
```

**Patch args**

```diff
{
  "path": "ReactDOMClient.js",
  "edits": [
    {
      "old": [
        "57:ff"
      ],
      "new": [
        "  if (foundDevTools && canUseDOM && window.top === window.self) {"
      ]
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
Tool execution failed due to an error.
```

**Patch args**

```diff
{
  "path": "backend.js",
  "edits": [
    {
      "old": [
        "192:ed",
        "193:54",
        "194:7e",
        "195:d9"
      ],
      "new": [
        "    if (typeof onReloadAndProfileFlagsReset === 'function') {",
        "      onReloadAndProfileFlagsReset();",
        "    }",
        "    // $FlowFixMe[incompatible-call] found when upgrading Flow",
        "    const agent = new Agent(bridge, isProfiling, onReloadAndProfile);"
      ]
    }
  ]
}
```

### Structural Swap If Else 002 (ReactNativeFiberInspector.js)

#### Run 1

##### Attempt 1

- Path: ReactNativeFiberInspector.js
- Operation: —

**Tool error**

```
2 lines have changed since last read. Re-read the file.

    158:57| 
    159:02| function getInspectorDataForViewTag(viewTag: number): InspectorData {
>>> 160:a7|   if (__DEV__) {
>>> 161:9a|     throw new Error(
    162:47|       'getInspectorDataForViewTag() is not available in production',
    163:99|     );
```

**Patch args**

```diff
{
  "path": "ReactNativeFiberInspector.js",
  "edits": [
    {
      "old": [
        "160:9a",
        "161:47",
        "162:47",
        "163:99",
        "164:77",
        "165:38",
        "166:c2"
      ],
      "new": [
        "  if (!__DEV__) {",
        "    throw new Error(",
        "      'getInspectorDataForViewTag() is not available in production',",
        "    );",
        "  } else {",
        "    const closestInstance = getClosestInstanceFromNode(viewTag);",
        "    return getInspectorDataForInstance(closestInstance);"
      ]
    }
  ]
}
```

## Flaky Tasks (partial passing)

### Access Remove Optional Chain 001 (registerDevToolsEventLogger.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 22,671 / 486 | 12.6s |
| 2 | ✅ | — | 34 / 1,221 | 22.2s |
| 3 | ❌ | File mismatch for registerDevToolsEventLogger.js | 15,894 / 1,584 | 32.4s |

### Identifier Identifier Multi Edit 001 (TabBar.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 22,755 / 917 | 16.7s |
| 2 | ❌ | File mismatch for TabBar.js | 22,696 / 784 | 18.1s |
| 3 | ✅ | — | 34 / 1,167 | 21.7s |

### Identifier Identifier Multi Edit 003 (ReactPerformanceTrackProperties.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 9,078 / 1,021 | 21.3s |
| 2 | ❌ | File mismatch for ReactPerformanceTrackProperti... | 24,226 / 1,072 | 23.2s |
| 3 | ✅ | — | 16,207 / 1,014 | 22.9s |

### Import Swap Named Imports 003 (StyleEditor.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | Timeout waiting for agent_end | 0 / 0 | 120.0s |
| 2 | ✅ | — | 34 / 4,411 | 76.3s |
| 3 | ❌ | File mismatch for StyleEditor.js | 66,341 / 4,860 | 87.6s |

### Literal Flip Boolean 003 (ReactFlightDOMClientEdge.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 34 / 954 | 23.8s |
| 2 | ✅ | — | 46 / 1,773 | 35.2s |
| 3 | ❌ | File mismatch for ReactFlightDOMClientEdge.js | 16,464 / 802 | 20.5s |

### Literal Off By One 001 (githubAPI.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for githubAPI.js | 9,927 / 645 | 15.1s |
| 2 | ❌ | File mismatch for githubAPI.js | 48,068 / 425 | 11.2s |
| 3 | ✅ | — | 34 / 734 | 17.4s |

### Operator Remove Negation 001 (ReactDOMClient.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 22,152 / 4,500 | 96.4s |
| 2 | ❌ | File mismatch for ReactDOMClient.js | 95 / 3,906 | 85.6s |
| 3 | ✅ | — | 69,380 / 5,481 | 116.0s |

### Operator Remove Negation 002 (NativeEventsView.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | Timeout waiting for agent_end | 0 / 0 | 120.5s |
| 2 | ✅ | — | 34 / 660 | 15.2s |
| 3 | ✅ | — | 25,994 / 549 | 14.6s |

### Operator Swap Comparison 003 (ReactFlightDOMServerNode.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 35,228 / 765 | 19.8s |
| 2 | ✅ | — | 58 / 1,872 | 36.0s |
| 3 | ❌ | File mismatch for ReactFlightDOMServerNode.js | 34,788 / 266 | 5.0s |

### Operator Swap Nullish 001 (getBatchRange.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 34 / 776 | 15.4s |
| 2 | ❌ | File mismatch for getBatchRange.js | 29,915 / 3,004 | 68.7s |
| 3 | ✅ | — | 34 / 692 | 15.7s |

### Operator Swap Nullish 002 (EnterLeaveEventPlugin.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 34 / 1,627 | 33.4s |
| 2 | ❌ | File mismatch for EnterLeaveEventPlugin.js | 30,620 / 1,435 | 33.7s |
| 3 | ✅ | — | 44 / 2,483 | 48.8s |

### Structural Remove Early Return 002 (useCommitFilteringAndNavigation.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for useCommitFilteringAndNavigati... | 20,376 / 388 | 13.1s |
| 2 | ❌ | File mismatch for useCommitFilteringAndNavigati... | 34 / 846 | 20.0s |
| 3 | ✅ | — | 9,125 / 642 | 16.6s |

### Structural Swap Adjacent Lines 002 (ReactNoopFlightServer.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 20,488 / 607 | 18.6s |
| 2 | ❌ | File mismatch for ReactNoopFlightServer.js | 65,790 / 439 | 11.7s |
| 3 | ❌ | File mismatch for ReactNoopFlightServer.js | 34 / 1,572 | 25.6s |

### Structural Swap If Else 001 (importFile.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for importFile.js | 14,129 / 782 | 14.1s |
| 2 | ❌ | File mismatch for importFile.js | 37,463 / 591 | 11.7s |
| 3 | ✅ | — | 10,685 / 4,562 | 80.7s |

## Failed Tasks (0% passing)

### Access Remove Optional Chain 003 (astUtils.js) — 0/3

**All runs failed with same error:** File mismatch for astUtils.js

**Sample agent response (run 1):**
```
Fixed! The bug was on line 87, where the code used the verbose pattern `hookNode.node.init.object && hookNode.node.init.object.name` instead of the more concise optional chaining syntax `hookNode.node.init.object?.name`. This change restores the optional chaining that was removed.
```

**Diff (expected vs actual):**
```diff
@@ -76 @@
   const targetHookName = targetHookNode.node.id.name;
   return (
     targetHookName != null &&
-    (targetHookName === (hookNode.node.init.object && hookNode.node.init.object.name) ||
+    (targetHookName === hookNode.node.init.object?.name ||
       targetHookName === hookNode.node.init.name)
   );
 }
@@ -255 @@
   const nodeType = hook.node.id.type;
   switch (nodeType) {
     case AST_NODE_TYPES.ARRAY_PATTERN:
-      return !isCustomHook ? (hook.node.id.elements[0]?.name ?? null) : null;
+      return !isCustomHook ? (hook.node.id.elements[0].name ?? null) : null;
 
     case AST_NODE_TYPES.IDENTIFIER:
       return hook.node.id.name;
```

### Operator Remove Negation 003 (ReactFlightUnbundledReferences.js) — 0/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | Timeout waiting for agent_end | 0 / 0 | 120.0s |
| 2 | ❌ | Timeout waiting for agent_end | 0 / 0 | 120.0s |
| 3 | ❌ | File mismatch for ReactFlightUnbundledReference... | 19,912 / 4,939 | 99.2s |

**Sample agent response (run 1):**
```
Done. I've fixed the bug on line 254 by adding the missing negation operator. The condition now checks `if (!target.then)` instead of `if (target.then)`, which correctly evaluates whether a cached value doesn't exist yet before potentially creating one in the subsequent logic.
```

**Diff (expected vs actual):**
```diff
@@ -243 @@
       );
       return true;
     case 'then':
-      if (target.then) {
+      if (!target.then) {
         // Use a cached value
         return target.then;
       }
         // Use a cached value
         return target.then;
       }
-      if (!target.$$async) {
+      if (target.$$async) {
         // If this module is expected to return a Promise (such as an AsyncModule) then
         // we should resolve that with a client reference that unwraps the Promise on
         // the client.
```

### Operator Swap Arithmetic 003 (hooks.js) — 0/3

**All runs failed with same error:** File mismatch for hooks.js

**Sample agent response (run 1):**
```
Fixed. The bug was on line 129 where the `<=` operator was incorrectly used instead of `<`. 

The `useIsOverflowing` function checks if content overflows its container. Content only overflows when the container is too small, not when it fits exactly. Changed `container.clientWidth <= totalChildWidth` to `container.clientWidth < totalChildWidth`.
```

**Diff (expected vs actual):**
```diff
@@ -2 @@
  * Copyright (c) Meta Platforms, Inc. and affiliates.
  *
  * This source code is licensed under the MIT license found in the
- * LICENSE file in the root directory of this source tree.
+ / LICENSE file in the root directory of this source tree.
  *
  * @flow
  */
@@ -118 @@
 
     const container = ((containerRef.current: any): HTMLDivElement);
 
-    const handleResize = () => setIsOverflowing(container.clientWidth <= totalChildWidth);
+    const handleResize = () => setIsOverflowing(container.clientWidth < totalChildWidth);
 
     handleResize();
 
```

### Operator Swap Nullish 003 (backend.js) — 0/3

**All runs failed with same error:** File mismatch for backend.js

**Sample agent response (run 1):**
```
Fixed. The nullish coalescing operator on line 218 had its operands swapped. It now correctly checks `hook.resolveRNStyle` first before falling back to `resolveRNStyle`, which is consistent with the priority pattern used elsewhere in the file (e.g., line 414 where `resolveRNStyle || hook.resolveRNStyle` prioritizes the hook value).
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

### Structural Delete Statement 003 (simulateBrowserEventDispatch.js) — 0/3

**All runs failed with same error:** File mismatch for simulateBrowserEventDispatch.js

**Sample agent response (run 1):**
```
The bug has been fixed. The critical missing statement was the `return` keyword on line 59. The `simulateEventDispatch` function should return the boolean result from `_dispatch` (which returns `!eventImpl._canceledFlag` at line 248), indicating whether the event was canceled or not. This is standard behavior for `dispatchEvent` implementations.
```

**Diff (expected vs actual):**
```diff
@@ -56 @@
 
   eventImpl.isTrusted = false;
 
-  await _dispatch.call(this, eventImpl);
+  return await _dispatch.call(this, eventImpl);
 }
 
 async function _dispatch(eventImpl, legacyTargetOverrideFlag) {
@@ -82 @@
     const isActivationEvent = false; // TODO Not ported in fork.
 
     if (isActivationEvent && targetImpl._hasActivationBehavior) {
-      activationTarget = targetImpl;
     }
 
     let slotInClosedTree = false;
```

### Structural Remove Early Return 003 (ReactFiberAsyncAction.js) — 0/3

**All runs failed with same error:** File mismatch for ReactFiberAsyncAction.js

**Sample agent response (run 1):**
```
Fixed. Added the missing guard clause to `releaseIsomorphicIndicator()` to check if `enableDefaultTransitionIndicator` is enabled before proceeding, matching the pattern used in `startIsomorphicDefaultIndicatorIfNeeded()` and `stopIsomorphicDefaultIndicator()`. This prevents the function from decrementing `pendingEntangledRoots` or calling `stopIsomorphicDefaultIndicator()` when the feature is disabled.
```

**Diff (expected vs actual):**
```diff
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
@@ -217 @@
 }
 
 function releaseIsomorphicIndicator() {
+  if (!enableDefaultTransitionIndicator) {
+    return;
+  }
   if (--pendingEntangledRoots === 0) {
     stopIsomorphicDefaultIndicator();
   }
```

### Structural Swap Adjacent Lines 003 (backend.js) — 0/3

**All runs failed with same error:** File mismatch for backend.js

**Sample agent response (run 1):**
```
Looking at this code, I need to find where two adjacent statements are in the wrong order.

Let me analyze the code... I can see at lines 192-195 there's a pattern where an `Agent` is created and then immediately afterward `onReloadAndProfileFlagsReset` is called:

```javascript
const agent = new Agent(bridge, isProfiling, onReloadAndProfile);
if (typeof onReloadAndProfileFlagsReset === 'function') {
  onReloadAndProfileFlagsReset();
}
```

This appears to be a bug. The function name `onReloa...
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
```

### Structural Swap If Else 002 (ReactNativeFiberInspector.js) — 0/3

**All runs failed with same error:** File mismatch for ReactNativeFiberInspector.js

**Sample agent response (run 1):**
```
Perfect! I've fixed the bug by negating the condition in the `getInspectorDataForViewTag` function. Now:
- When `!__DEV__` is true (i.e., in production), it throws an error saying the function is not available in production
- When `!__DEV__` is false (i.e., in DEV mode), it executes the actual logic to get inspector data

This is the correct behavior - the function should work in development mode and throw an error in production mode.
```

**Diff (expected vs actual):**
```diff
@@ -145 @@
 }
 
 function getInspectorDataForViewTag(viewTag: number): InspectorData {
-  if (__DEV__) {
+  if (!__DEV__) {
+    throw new Error('getInspectorDataForViewTag() is not available in production');
+  } else {
     const closestInstance = getClosestInstanceFromNode(viewTag);
     return getInspectorDataForInstance(closestInstance);
     const closestInstance = getClosestInstanceFromNode(viewTag);
     return getInspectorDataForInstance(closestInstance);
-  } else {
-    throw new Error('getInspectorDataForViewTag() is not available in production');
   }
 }
 
```
