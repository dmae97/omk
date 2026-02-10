# Edit Benchmark Report

## Configuration

| Setting | Value |
|---------|-------|
| Date | 2026-02-10T15:08:32.379Z |
| Model | p-anthropic/claude-haiku-4-5 |
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
| Successful Runs | 115 |
| **Task Success Rate** | **63.9% (115/180)** |
| Verified Rate | 63.9% (115/180) |
| Edit Tool Usage Rate | 98.9% (178/180) |
| **Edit Success Rate** | **82.5%** |
| Patch Failure Rate | 17.5% (40/228) |
| Tasks All Passing | 29 |
| Tasks Flaky/Failing | 31 |

### Tool Calls

| Tool | Total | Avg/Run |
|------|-------|---------|
| Read | 306 | 1.7 |
| Edit | 228 | 1.3 |
| Write | 0 | 0.0 |
| **Tool Input Chars** | 66,644 | 370 |

### Tokens & Time

| Metric | Total | Avg/Run |
|--------|-------|---------|
| Input Tokens | 2,254 | 13 |
| Output Tokens | 212,270 | 1,179 |
| Total Tokens | 13,426,833 | 74,594 |
| Duration | 2409.4s | 13.4s |
| **Avg Indent Score** | — | **2.21** |

## Task Results

| Task | File | Success | Edit Hit | R/E/W | Tokens (In/Out) | Time | Indent |
|------|------|---------|----------|-------|-----------------|------|--------|
| Access Remove Optional Chain 001 | registerDevToolsEventLogger.js | 3/3 ✅ | 100.0% | 1/1/0 | 8/687 | 8.2s | 1.00 |
| Access Remove Optional Chain 002 | TimelineContext.js | 1/3 ⚠️ | 100.0% | 1/1/0 | 8/791 | 10.1s | 1.28 |
| Access Remove Optional Chain 003 | astUtils.js | 0/3 ❌ | 100.0% | 1/1/0 | 8/939 | 13.0s | 4.84 |
| Call Swap Call Args 001 | testHelpers.js | 3/3 ✅ | 100.0% | 1/1/0 | 10/377 | 5.4s | 1.33 |
| Call Swap Call Args 002 | FlamegraphChartBuilder.js | 1/3 ⚠️ | 75.0% | 2/1/0 | 12/3,045 | 26.5s | 3.72 |
| Call Swap Call Args 003 | SyntheticEvent.js | 0/3 ❌ | 100.0% | 1/1/0 | 5/6,049 | 84.1s | 3.79 |
| Duplicate Duplicate Line Flip 001 | index.js | 3/3 ✅ | 100.0% | 1/1/0 | 8/368 | 6.2s | 0.33 |
| Duplicate Duplicate Line Flip 002 | ActivityList.js | 3/3 ✅ | 100.0% | 2/1/0 | 13/618 | 9.4s | 3.62 |
| Duplicate Duplicate Line Flip 003 | SyntheticEvent.js | 3/3 ✅ | 60.0% | 2/2/0 | 16/1,036 | 13.4s | 1.02 |
| Identifier Identifier Multi Edit 001 | TabBar.js | 1/3 ⚠️ | 100.0% | 3/2/0 | 18/1,103 | 13.7s | 3.21 |
| Identifier Identifier Multi Edit 002 | EventPluginRegistry.js | 2/3 ⚠️ | 100.0% | 1/1/0 | 7/7,904 | 19.8s | 3.88 |
| Identifier Identifier Multi Edit 003 | ReactPerformanceTrackProperties.js | 2/3 ⚠️ | 71.4% | 4/2/0 | 31/1,400 | 17.2s | 9.87 |
| Import Swap Named Imports 001 | CommitFlamegraphListItem.js | 0/3 ❌ | 100.0% | 1/1/0 | 13/727 | 9.5s | 2.86 |
| Import Swap Named Imports 002 | ReactDOMTextarea.js | 3/3 ✅ | 100.0% | 2/1/0 | 11/782 | 10.3s | 2.41 |
| Import Swap Named Imports 003 | StyleEditor.js | 1/3 ⚠️ | 100.0% | 2/1/0 | 10/855 | 12.0s | 1.31 |
| Literal Flip Boolean 001 | testHelpers.js | 3/3 ✅ | 100.0% | 1/1/0 | 11/432 | 6.5s | 1.32 |
| Literal Flip Boolean 002 | ReactNoopFlightServer.js | 3/3 ✅ | 100.0% | 2/1/0 | 14/522 | 8.5s | 1.10 |
| Literal Flip Boolean 003 | ReactFlightDOMClientEdge.js | 1/3 ⚠️ | 100.0% | 1/1/0 | 12/589 | 8.5s | 3.55 |
| Literal Off By One 001 | githubAPI.js | 2/3 ⚠️ | 100.0% | 2/1/0 | 10/528 | 6.8s | 0.69 |
| Literal Off By One 002 | code-path.js | 2/3 ⚠️ | 60.0% | 2/2/0 | 18/1,327 | 15.0s | 3.17 |
| Literal Off By One 003 | InspectedElement.js | 3/3 ✅ | 50.0% | 2/2/0 | 20/880 | 12.9s | 3.57 |
| Operator Remove Negation 001 | ReactDOMClient.js | 2/3 ⚠️ | 100.0% | 1/1/0 | 10/1,388 | 16.2s | 1.08 |
| Operator Remove Negation 002 | NativeEventsView.js | 3/3 ✅ | 50.0% | 2/2/0 | 19/658 | 9.3s | 2.97 |
| Operator Remove Negation 003 | ReactFlightUnbundledReferences.js | 0/3 ❌ | 55.6% | 5/3/0 | 39/3,259 | 36.7s | 1.98 |
| Operator Swap Arithmetic 001 | fallbackEvalContext.js | 3/3 ✅ | 100.0% | 1/1/0 | 7/359 | 5.1s | 0.20 |
| Operator Swap Arithmetic 002 | CSSShorthandProperty.js | 2/3 ⚠️ | 100.0% | 2/1/0 | 9/492 | 8.1s | 2.86 |
| Operator Swap Arithmetic 003 | hooks.js | 0/3 ❌ | 100.0% | 2/1/0 | 10/1,000 | 13.6s | 2.26 |
| Operator Swap Comparison 001 | index.js | 3/3 ✅ | 100.0% | 1/1/0 | 10/370 | 5.7s | 0.00 |
| Operator Swap Comparison 002 | ReactFlightDOMServerBrowser.js | 1/3 ⚠️ | 100.0% | 2/1/0 | 10/763 | 9.6s | 1.56 |
| Operator Swap Comparison 003 | ReactFlightDOMServerNode.js | 2/3 ⚠️ | 100.0% | 2/1/0 | 19/5,386 | 10.8s | 1.94 |
| Operator Swap Equality 001 | readInputData.js | 3/3 ✅ | 100.0% | 1/1/0 | 7/471 | 6.2s | 0.67 |
| Operator Swap Equality 002 | editor.js | 3/3 ✅ | 100.0% | 1/1/0 | 11/383 | 6.8s | 0.11 |
| Operator Swap Equality 003 | hooks.js | 3/3 ✅ | 100.0% | 1/1/0 | 11/410 | 6.9s | 2.22 |
| Operator Swap Increment Decrement 001 | ReactFlightDOMClientNode.js | 3/3 ✅ | 100.0% | 1/1/0 | 14/470 | 7.7s | 1.50 |
| Operator Swap Increment Decrement 002 | ReactFlightDOMClientNode.js | 3/3 ✅ | 100.0% | 1/1/0 | 3/448 | 7.6s | 1.88 |
| Operator Swap Increment Decrement 003 | loadSourceAndMetadata.js | 3/3 ✅ | 100.0% | 1/1/0 | 8/362 | 6.5s | 3.71 |
| Operator Swap Logical 001 | profiling.js | 3/3 ✅ | 100.0% | 1/1/0 | 11/489 | 6.4s | 0.00 |
| Operator Swap Logical 002 | SourceMapMetadataConsumer.js | 2/3 ⚠️ | 75.0% | 1/1/0 | 13/1,111 | 12.2s | 3.14 |
| Operator Swap Logical 003 | DevToolsFiberComponentStack.js | 3/3 ✅ | 60.0% | 2/2/0 | 14/907 | 12.1s | 3.94 |
| Operator Swap Nullish 001 | getBatchRange.js | 3/3 ✅ | 100.0% | 2/1/0 | 13/518 | 7.3s | 1.32 |
| Operator Swap Nullish 002 | EnterLeaveEventPlugin.js | 3/3 ✅ | 100.0% | 1/1/0 | 7/739 | 9.3s | 1.54 |
| Operator Swap Nullish 003 | backend.js | 2/3 ⚠️ | 60.0% | 2/2/0 | 11/760 | 10.3s | 3.13 |
| Regex Swap Regex Quantifier 001 | githubAPI.js | 2/3 ⚠️ | 66.7% | 1/1/0 | 8/307 | 5.9s | 0.69 |
| Regex Swap Regex Quantifier 002 | ReactFlightStackConfigV8.js | 3/3 ✅ | 100.0% | 1/1/0 | 11/1,496 | 18.2s | 2.97 |
| Regex Swap Regex Quantifier 003 | utils.js | 2/3 ⚠️ | 75.0% | 2/1/0 | 14/1,250 | 14.9s | 1.97 |
| Structural Delete Statement 001 | UnsupportedVersionDialog.js | 3/3 ✅ | 100.0% | 2/1/0 | 18/653 | 9.2s | 6.22 |
| Structural Delete Statement 002 | getComponentNameFromFiber.js | 0/3 ❌ | 100.0% | 1/1/0 | 8/499 | 8.1s | 0.41 |
| Structural Delete Statement 003 | simulateBrowserEventDispatch.js | 0/3 ❌ | 50.0% | 2/1/0 | 10/4,135 | 79.0s | 4.35 |
| Structural Remove Early Return 001 | InspectedElementStateTree.js | 0/3 ❌ | 75.0% | 1/1/0 | 9/601 | 9.3s | 0.12 |
| Structural Remove Early Return 002 | useCommitFilteringAndNavigation.js | 0/3 ❌ | 80.0% | 3/2/0 | 20/924 | 12.5s | 2.39 |
| Structural Remove Early Return 003 | ReactFiberAsyncAction.js | 0/3 ❌ | 80.0% | 2/2/0 | 14/1,251 | 14.6s | 1.41 |
| Structural Swap Adjacent Lines 001 | ReactServerConsoleConfigPlain.js | 3/3 ✅ | 100.0% | 1/1/0 | 5/644 | 9.0s | 1.00 |
| Structural Swap Adjacent Lines 002 | ReactNoopFlightServer.js | 0/3 ❌ | 100.0% | 2/1/0 | 12/641 | 8.9s | 0.00 |
| Structural Swap Adjacent Lines 003 | backend.js | 0/3 ❌ | 42.9% | 2/2/0 | 24/1,701 | 17.1s | 3.11 |
| Structural Swap If Else 001 | importFile.js | 0/3 ❌ | 75.0% | 2/1/0 | 7/848 | 9.8s | 0.52 |
| Structural Swap If Else 002 | ReactNativeFiberInspector.js | 0/3 ❌ | 50.0% | 3/2/0 | 17/1,080 | 12.1s | 3.18 |
| Structural Swap If Else 003 | ReactDOMFizzStaticNode.js | 3/3 ✅ | 50.0% | 3/2/0 | 24/1,434 | 17.0s | 1.76 |
| Unicode Unicode Hyphen 001 | Rectangle.js | 3/3 ✅ | 100.0% | 1/1/0 | 8/449 | 8.3s | 3.00 |
| Unicode Unicode Hyphen 002 | UnsupportedBridgeProtocolDialog.js | 3/3 ✅ | 100.0% | 2/1/0 | 13/590 | 9.3s | 3.83 |
| Unicode Unicode Hyphen 003 | ReactTypes.js | 3/3 ✅ | 100.0% | 2/1/0 | 10/554 | 8.5s | 1.23 |

## Category Summary

| Category | Runs | Verified | Edit Used | Success | Min/Avg/Max Difficulty |
|----------|------|----------|-----------|---------|------------------------|
| access | 9 | 44.4% (4/9) | 100.0% (9/9) | 44.4% (4/9) | 7 / 8.7 / 10 |
| call | 9 | 44.4% (4/9) | 88.9% (8/9) | 44.4% (4/9) | 6 / 7.7 / 10 |
| duplicate | 9 | 100.0% (9/9) | 100.0% (9/9) | 100.0% (9/9) | 7 / 9.7 / 12 |
| identifier | 9 | 55.6% (5/9) | 100.0% (9/9) | 55.6% (5/9) | 6 / 9.3 / 14 |
| import | 9 | 44.4% (4/9) | 100.0% (9/9) | 44.4% (4/9) | 2 / 4.7 / 6 |
| literal | 18 | 77.8% (14/18) | 100.0% (18/18) | 77.8% (14/18) | 4 / 6.2 / 9 |
| operator | 63 | 79.4% (50/63) | 100.0% (63/63) | 79.4% (50/63) | 1 / 6.5 / 13 |
| regex | 9 | 77.8% (7/9) | 100.0% (9/9) | 77.8% (7/9) | 6 / 7.3 / 8 |
| structural | 36 | 25.0% (9/36) | 97.2% (35/36) | 25.0% (9/36) | 4 / 7.6 / 15 |
| unicode | 9 | 100.0% (9/9) | 100.0% (9/9) | 100.0% (9/9) | 1 / 3.0 / 6 |

## Mutation Summary

| Mutation | Category | Runs | Verified | Edit Used | Success |
|----------|----------|------|----------|-----------|---------|
| delete-statement | structural | 9 | 33.3% (3/9) | 88.9% (8/9) | 33.3% (3/9) |
| duplicate-line-flip | duplicate | 9 | 100.0% (9/9) | 100.0% (9/9) | 100.0% (9/9) |
| flip-boolean | literal | 9 | 77.8% (7/9) | 100.0% (9/9) | 77.8% (7/9) |
| identifier-multi-edit | identifier | 9 | 55.6% (5/9) | 100.0% (9/9) | 55.6% (5/9) |
| off-by-one | literal | 9 | 77.8% (7/9) | 100.0% (9/9) | 77.8% (7/9) |
| remove-early-return | structural | 9 | 0.0% (0/9) | 100.0% (9/9) | 0.0% (0/9) |
| remove-negation | operator | 9 | 55.6% (5/9) | 100.0% (9/9) | 55.6% (5/9) |
| remove-optional-chain | access | 9 | 44.4% (4/9) | 100.0% (9/9) | 44.4% (4/9) |
| swap-adjacent-lines | structural | 9 | 33.3% (3/9) | 100.0% (9/9) | 33.3% (3/9) |
| swap-arithmetic | operator | 9 | 55.6% (5/9) | 100.0% (9/9) | 55.6% (5/9) |
| swap-call-args | call | 9 | 44.4% (4/9) | 88.9% (8/9) | 44.4% (4/9) |
| swap-comparison | operator | 9 | 66.7% (6/9) | 100.0% (9/9) | 66.7% (6/9) |
| swap-equality | operator | 9 | 100.0% (9/9) | 100.0% (9/9) | 100.0% (9/9) |
| swap-if-else | structural | 9 | 33.3% (3/9) | 100.0% (9/9) | 33.3% (3/9) |
| swap-increment-decrement | operator | 9 | 100.0% (9/9) | 100.0% (9/9) | 100.0% (9/9) |
| swap-logical | operator | 9 | 88.9% (8/9) | 100.0% (9/9) | 88.9% (8/9) |
| swap-named-imports | import | 9 | 44.4% (4/9) | 100.0% (9/9) | 44.4% (4/9) |
| swap-nullish | operator | 9 | 88.9% (8/9) | 100.0% (9/9) | 88.9% (8/9) |
| swap-regex-quantifier | regex | 9 | 77.8% (7/9) | 100.0% (9/9) | 77.8% (7/9) |
| unicode-hyphen | unicode | 9 | 100.0% (9/9) | 100.0% (9/9) | 100.0% (9/9) |

## Difficulty Summary

| Difficulty Score | Runs | Verified | Edit Used | Success |
|------------------|------|----------|-----------|---------|
| 0-2 | 18 | 77.8% (14/18) | 100.0% (18/18) | 77.8% (14/18) |
| 3-5 | 36 | 66.7% (24/36) | 100.0% (36/36) | 66.7% (24/36) |
| 6-8 | 72 | 65.3% (47/72) | 100.0% (72/72) | 65.3% (47/72) |
| 9+ | 54 | 55.6% (30/54) | 96.3% (52/54) | 55.6% (30/54) |

## Edit Tool Errors

Failures where the edit tool returned an error or failed to apply the patch.

### Call Swap Call Args 002 (FlamegraphChartBuilder.js)

#### Run 3

##### Attempt 1

- Path: /tmp/reach-benchmark-rsjpV0/batch-56b56e64-6464-49dc-a916-5c02d3e0e866/FlamegraphChartBuilder.js
- Operation: —

**Tool error**

```
Line 71 has changed since last read (expected 8ad1, got c894). Re-read the file.
```

**Patch args**

```diff
{
  "path": "/tmp/reach-benchmark-rsjpV0/batch-56b56e64-6464-49dc-a916-5c02d3e0e866/FlamegraphChartBuilder.js",
  "edits": [
    {
      "src": [
        "71:8ad1"
      ],
      "dst": [
        "    idToDepthMap.set(id, currentDepth);"
      ]
    }
  ]
}
```

### Duplicate Duplicate Line Flip 003 (SyntheticEvent.js)

#### Run 1

##### Attempt 1

- Path: SyntheticEvent.js
- Operation: —

**Tool error**

```
Line 464 has changed since last read (expected 04ea, got ba1e). Re-read the file.
```

**Patch args**

```diff
{
  "path": "SyntheticEvent.js",
  "edits": [
    {
      "src": [
        "464:04ea"
      ],
      "dst": [
        "      if (event.type === 'keypress') {"
      ]
    }
  ]
}
```

#### Run 3

##### Attempt 1

- Path: /tmp/reach-benchmark-rsjpV0/batch-39f4945b-1db3-40b3-b593-f2d891fe91bd/SyntheticEvent.js
- Operation: —

**Tool error**

```
Line 464 has changed since last read (expected 04ea, got ba1e). Re-read the file.
```

**Patch args**

```diff
{
  "path": "/tmp/reach-benchmark-rsjpV0/batch-39f4945b-1db3-40b3-b593-f2d891fe91bd/SyntheticEvent.js",
  "edits": [
    {
      "src": [
        "464:04ea"
      ],
      "dst": [
        "     if (event.type === 'keypress') {"
      ]
    }
  ]
}
```

### Identifier Identifier Multi Edit 003 (ReactPerformanceTrackProperties.js)

#### Run 1

##### Attempt 1

- Path: /tmp/reach-benchmark-rsjpV0/batch-2cf1a725-8ea3-49ed-93bf-34635bb9feea/ReactPerformanceTrackProperties.js
- Operation: —

**Tool error**

```
Line 281 has changed since last read (expected 3ba4, got c202). Re-read the file.
```

**Patch args**

```diff
{
  "path": "/tmp/reach-benchmark-rsjpV0/batch-2cf1a725-8ea3-49ed-93bf-34635bb9feea/ReactPerformanceTrackProperties.js",
  "edits": [
    {
      "src": [
        "281:3ba4"
      ],
      "dst": [
        "const ADDED = '+\\xa0';"
      ]
    }
  ]
}
```

#### Run 3

##### Attempt 1

- Path: ReactPerformanceTrackProperties.js
- Operation: —

**Tool error**

```
Line 281 has changed since last read (expected 3ba4, got c202). Re-read the file.
```

**Patch args**

```diff
{
  "path": "ReactPerformanceTrackProperties.js",
  "edits": [
    {
      "src": [
        "281:3ba4"
      ],
      "dst": [
        "const ADDED = '+\\xa0';"
      ]
    },
    {
      "src": [
        "361:acf7"
      ],
      "dst": [
        "              properties.push([REMOVED + line, desc], [ADDED + line, desc]);"
      ]
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
Line 231 has changed since last read (expected 5dd7, got 354e). Re-read the file.
```

**Patch args**

```diff
{
  "path": "code-path.js",
  "edits": [
    {
      "src": [
        "231:5dd7"
      ],
      "dst": [
        "        item[1] = 0;"
      ]
    }
  ]
}
```

#### Run 2

##### Attempt 1

- Path: code-path.js
- Operation: —

**Tool error**

```
Line 231 has changed since last read (expected 5dd7, got 354e). Re-read the file.
```

**Patch args**

```diff
{
  "path": "code-path.js",
  "edits": [
    {
      "src": [
        "231:5dd7"
      ],
      "dst": [
        "        item[1] = 0;"
      ]
    }
  ]
}
```

### Literal Off By One 003 (InspectedElement.js)

#### Run 1

##### Attempt 1

- Path: InspectedElement.js
- Operation: —

**Tool error**

```
Line 205 has changed since last read (expected 345e, got aee5). Re-read the file.
```

**Patch args**

```diff
{
  "path": "InspectedElement.js",
  "edits": [
    {
      "src": [
        "205:345e"
      ],
      "dst": [
        "   if (element.isStrictModeNonCompliant && element.parentID !== 0) {"
      ]
    }
  ]
}
```

#### Run 2

##### Attempt 1

- Path: /tmp/reach-benchmark-rsjpV0/batch-754f97df-e3c9-4462-a0b0-6e0b6cc0a500/InspectedElement.js
- Operation: —

**Tool error**

```
Line 205 has changed since last read (expected 345e, got aee5). Re-read the file.
```

**Patch args**

```diff
{
  "path": "/tmp/reach-benchmark-rsjpV0/batch-754f97df-e3c9-4462-a0b0-6e0b6cc0a500/InspectedElement.js",
  "edits": [
    {
      "src": [
        "205:345e"
      ],
      "dst": [
        "   if (element.isStrictModeNonCompliant && element.parentID !== 0) {"
      ]
    }
  ]
}
```

#### Run 3

##### Attempt 1

- Path: InspectedElement.js
- Operation: —

**Tool error**

```
Line 205 has changed since last read (expected 345e, got aee5). Re-read the file.
```

**Patch args**

```diff
{
  "path": "InspectedElement.js",
  "edits": [
    {
      "src": [
        "205:345e"
      ],
      "dst": [
        "  if (element.isStrictModeNonCompliant && element.parentID !== 0) {"
      ]
    }
  ]
}
```

### Operator Remove Negation 002 (NativeEventsView.js)

#### Run 1

##### Attempt 1

- Path: NativeEventsView.js
- Operation: —

**Tool error**

```
Line 117 has changed since last read (expected 6d3b, got e0f0). Re-read the file.
```

**Patch args**

```diff
{
  "path": "NativeEventsView.js",
  "edits": [
    {
      "src": [
        "117:6d3b"
      ],
      "dst": [
        "     if (!rectIntersectsRect(eventRect, rect)) {"
      ]
    }
  ]
}
```

#### Run 2

##### Attempt 1

- Path: NativeEventsView.js
- Operation: —

**Tool error**

```
Line 117 has changed since last read (expected 6d3b, got e0f0). Re-read the file.
```

**Patch args**

```diff
{
  "path": "NativeEventsView.js",
  "edits": [
    {
      "src": [
        "117:6d3b"
      ],
      "dst": [
        "     if (!rectIntersectsRect(eventRect, rect)) {"
      ]
    }
  ]
}
```

#### Run 3

##### Attempt 1

- Path: NativeEventsView.js
- Operation: —

**Tool error**

```
Line 117 has changed since last read (expected 6d3b, got e0f0). Re-read the file.
```

**Patch args**

```diff
{
  "path": "NativeEventsView.js",
  "edits": [
    {
      "src": [
        "117:6d3b"
      ],
      "dst": [
        "     if (!rectIntersectsRect(eventRect, rect)) {"
      ]
    }
  ]
}
```

### Operator Remove Negation 003 (ReactFlightUnbundledReferences.js)

#### Run 1

##### Attempt 1

- Path: /tmp/reach-benchmark-rsjpV0/batch-74a717e9-6e86-4559-aca5-17fddf7ce44f/ReactFlightUnbundledReferences.js
- Operation: —

**Tool error**

```
Line 254 has changed since last read (expected 74c0, got 49f7). Re-read the file.
```

**Patch args**

```diff
{
  "path": "/tmp/reach-benchmark-rsjpV0/batch-74a717e9-6e86-4559-aca5-17fddf7ce44f/ReactFlightUnbundledReferences.js",
  "edits": [
    {
      "src": [
        "254:74c0"
      ],
      "dst": [
        "      if (!target.then) {"
      ]
    }
  ]
}
```

#### Run 2

##### Attempt 1

- Path: ReactFlightUnbundledReferences.js
- Operation: —

**Tool error**

```
Line 296 has changed since last read (expected 2df9, got 0463). Re-read the file.
```

**Patch args**

```diff
{
  "path": "ReactFlightUnbundledReferences.js",
  "edits": [
    {
      "src": [
        "296:2df9"
      ],
      "dst": [
        "   if (cachedReference) {"
      ]
    }
  ]
}
```

#### Run 3

##### Attempt 1

- Path: /tmp/reach-benchmark-rsjpV0/batch-b25c949d-fc12-40e6-a9a6-8af872853c1f/ReactFlightUnbundledReferences.js
- Operation: —

**Tool error**

```
Line 296 has changed since last read (expected 2df9, got 0463). Re-read the file.
```

**Patch args**

```diff
{
  "path": "/tmp/reach-benchmark-rsjpV0/batch-b25c949d-fc12-40e6-a9a6-8af872853c1f/ReactFlightUnbundledReferences.js",
  "edits": [
    {
      "src": [
        "296:2df9"
      ],
      "dst": [
        "   if (cachedReference) {"
      ]
    }
  ]
}
```

##### Attempt 2

- Path: /tmp/reach-benchmark-rsjpV0/batch-b25c949d-fc12-40e6-a9a6-8af872853c1f/ReactFlightUnbundledReferences.js
- Operation: —

**Tool error**

```
Line 296 has changed since last read (expected 0463, got c85f). Re-read the file.
```

**Patch args**

```diff
{
  "path": "/tmp/reach-benchmark-rsjpV0/batch-b25c949d-fc12-40e6-a9a6-8af872853c1f/ReactFlightUnbundledReferences.js",
  "edits": [
    {
      "src": [
        "296:0463"
      ],
      "dst": [
        "   if (cachedReference) {"
      ]
    }
  ]
}
```

### Operator Swap Logical 002 (SourceMapMetadataConsumer.js)

#### Run 3

##### Attempt 1

- Path: SourceMapMetadataConsumer.js
- Operation: —

**Tool error**

```
No changes made to SourceMapMetadataConsumer.js. The edits produced identical content.
```

**Patch args**

```diff
{
  "path": "SourceMapMetadataConsumer.js",
  "edits": [
    {
      "src": [
        "51:7df6"
      ],
      "dst": [
        "    sourceRoot != null && util.isAbsolute(sourceRoot) || util.isAbsolute(source)"
      ]
    }
  ]
}
```

### Operator Swap Logical 003 (DevToolsFiberComponentStack.js)

#### Run 1

##### Attempt 1

- Path: DevToolsFiberComponentStack.js
- Operation: —

**Tool error**

```
Line 221 has changed since last read (expected 421f, got 1edc). Re-read the file.
```

**Patch args**

```diff
{
  "path": "DevToolsFiberComponentStack.js",
  "edits": [
    {
      "src": [
        "221:421f"
      ],
      "dst": [
        "           if (owner && ownerStack) {"
      ]
    }
  ]
}
```

#### Run 2

##### Attempt 1

- Path: /tmp/reach-benchmark-rsjpV0/batch-74a717e9-6e86-4559-aca5-17fddf7ce44f/DevToolsFiberComponentStack.js
- Operation: —

**Tool error**

```
Line 221 has changed since last read (expected 421f, got 1edc). Re-read the file.
```

**Patch args**

```diff
{
  "path": "/tmp/reach-benchmark-rsjpV0/batch-74a717e9-6e86-4559-aca5-17fddf7ce44f/DevToolsFiberComponentStack.js",
  "edits": [
    {
      "src": [
        "221:421f"
      ],
      "dst": [
        "         if (owner && ownerStack) {"
      ]
    }
  ]
}
```

### Operator Swap Nullish 003 (backend.js)

#### Run 2

##### Attempt 1

- Path: backend.js
- Operation: —

**Tool error**

```
Line 218 has changed since last read (expected 5b80, got 0310). Re-read the file.
```

**Patch args**

```diff
{
  "path": "backend.js",
  "edits": [
    {
      "src": [
        "218:5b80"
      ],
      "dst": [
        "         ((resolveRNStyle || hook.resolveRNStyle: any): ResolveNativeStyle),"
      ]
    }
  ]
}
```

#### Run 3

##### Attempt 1

- Path: /tmp/reach-benchmark-rsjpV0/batch-e0b46062-d9ba-41cc-bbd9-ee82883633af/backend.js
- Operation: —

**Tool error**

```
Line 218 has changed since last read (expected f84d, got 0310). Re-read the file.
```

**Patch args**

```diff
{
  "path": "/tmp/reach-benchmark-rsjpV0/batch-e0b46062-d9ba-41cc-bbd9-ee82883633af/backend.js",
  "edits": [
    {
      "src": [
        "218:f84d"
      ],
      "dst": [
        "         ((resolveRNStyle || hook.resolveRNStyle: any): ResolveNativeStyle),"
      ]
    }
  ]
}
```

### Regex Swap Regex Quantifier 001 (githubAPI.js)

#### Run 2

##### Attempt 1

- Path: githubAPI.js
- Operation: —

**Tool error**

```
Tool execution failed due to an error.
```

**Patch args**

```diff
{
  "path": "githubAPI.js",
  "edits": [
    {
      "src": [
        "19:70e5"
      ],
      "dst": [
        "  message = message.replace(/\"[0-9]+"
      ]
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
Line 203 has changed since last read (expected 2328, got 2f7c). Re-read the file.
```

**Patch args**

```diff
{
  "path": "utils.js",
  "edits": [
    {
      "src": [
        "203:2328"
      ],
      "dst": [
        "   if (!/^[a-z]+$/i.test(word)) {"
      ]
    }
  ]
}
```

### Structural Delete Statement 003 (simulateBrowserEventDispatch.js)

#### Run 1

##### Attempt 1

- Path: /tmp/reach-benchmark-rsjpV0/batch-87df8b36-50f5-448e-b8bc-7509654a0020/simulateBrowserEventDispatch.js
- Operation: —

**Tool error**

```
Line 208 has changed since last read (expected d591, got c56f). Re-read the file.
```

**Patch args**

```diff
{
  "path": "/tmp/reach-benchmark-rsjpV0/batch-87df8b36-50f5-448e-b8bc-7509654a0020/simulateBrowserEventDispatch.js",
  "edits": [
    {
      "src": [
        "208:d591"
      ],
      "dst": [
        "     }\n",
        "\n",
        "     for (let i = 0; i < eventImpl._path.length; i++) {"
      ],
      "after": "208:d591"
    }
  ]
}
```

#### Run 3

##### Attempt 1

- Path: simulateBrowserEventDispatch.js
- Operation: —

**Tool error**

```
Line 207 has changed since last read (expected c56f, got d136). Re-read the file.
```

**Patch args**

```diff
{
  "path": "simulateBrowserEventDispatch.js",
  "edits": [
    {
      "src": [],
      "dst": [
        "",
        "       if (struct.target !== null) {",
        "         await invokeEventListeners(struct, eventImpl, 'bubbling');",
        "       }"
      ],
      "after": "207:c56f"
    }
  ]
}
```

### Structural Remove Early Return 001 (InspectedElementStateTree.js)

#### Run 2

##### Attempt 1

- Path: /tmp/reach-benchmark-rsjpV0/batch-3e86ef52-ce85-4777-8af3-3bfa5ed810e8/InspectedElementStateTree.js
- Operation: —

**Tool error**

```
Line 38 has changed since last read (expected 0f38, got 53b0). Re-read the file.
```

**Patch args**

```diff
{
  "path": "/tmp/reach-benchmark-rsjpV0/batch-3e86ef52-ce85-4777-8af3-3bfa5ed810e8/InspectedElementStateTree.js",
  "edits": [
    {
      "src": [],
      "dst": [
        "  if (!state) {",
        "    return null;",
        "  }"
      ],
      "after": "38:0f38"
    }
  ]
}
```

### Structural Remove Early Return 002 (useCommitFilteringAndNavigation.js)

#### Run 2

##### Attempt 1

- Path: /tmp/reach-benchmark-rsjpV0/batch-39f4945b-1db3-40b3-b593-f2d891fe91bd/useCommitFilteringAndNavigation.js
- Operation: —

**Tool error**

```
Line 63 has changed since last read (expected eac2, got bee4). Re-read the file.
```

**Patch args**

```diff
{
  "path": "/tmp/reach-benchmark-rsjpV0/batch-39f4945b-1db3-40b3-b593-f2d891fe91bd/useCommitFilteringAndNavigation.js",
  "edits": [
    {
      "src": [
        "63:eac2"
      ],
      "dst": [
        "       if (filtered[i] === commitIndex) return i;"
      ]
    }
  ]
}
```

### Structural Remove Early Return 003 (ReactFiberAsyncAction.js)

#### Run 3

##### Attempt 1

- Path: ReactFiberAsyncAction.js
- Operation: —

**Tool error**

```
Line 243 has changed since last read (expected f3e3, got e856). Re-read the file.
```

**Patch args**

```diff
{
  "path": "ReactFiberAsyncAction.js",
  "edits": [
    {
      "src": [],
      "dst": [
        "  if (!enableDefaultTransitionIndicator) {",
        "    return;",
        "  }"
      ],
      "after": "243:f3e3"
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
No changes made to backend.js. The edits produced identical content.
```

**Patch args**

```diff
{
  "path": "backend.js",
  "edits": [
    {
      "src": [
        "388:d17a",
        "389:10ba",
        "390:35a8"
      ],
      "dst": [
        "   if (typeof onReloadAndProfileFlagsReset === 'function') {",
        "     onReloadAndProfileFlagsReset();",
        "   }"
      ]
    }
  ]
}
```

##### Attempt 2

- Path: backend.js
- Operation: —

**Tool error**

```
Source lines must be consecutive. Got line 390 followed by 392.
```

**Patch args**

```diff
{
  "path": "backend.js",
  "edits": [
    {
      "src": [
        "388:d17a",
        "389:10ba",
        "390:35a8",
        "392:74aa"
      ],
      "dst": [
        "   if (typeof onReloadAndProfileFlagsReset === 'function') {",
        "     onReloadAndProfileFlagsReset();",
        "   }",
        "   const agent = new Agent(bridge, isProfiling, onReloadAndProfile);"
      ]
    }
  ]
}
```

##### Attempt 3

- Path: backend.js
- Operation: —

**Tool error**

```
No changes made to backend.js. The edits produced identical content.
```

**Patch args**

```diff
{
  "path": "backend.js",
  "edits": [
    {
      "src": [
        "388:d17a",
        "389:10ba",
        "390:35a8",
        "391:83b5",
        "392:74aa"
      ],
      "dst": [
        "   if (typeof onReloadAndProfileFlagsReset === 'function') {",
        "     onReloadAndProfileFlagsReset();",
        "   }",
        "",
        "   const agent = new Agent(bridge, isProfiling, onReloadAndProfile);"
      ]
    }
  ]
}
```

#### Run 3

##### Attempt 1

- Path: backend.js
- Operation: —

**Tool error**

```
Invalid line reference "392:blank". Expected format "LINE:HASH" (e.g. "5:a3f2").
```

**Patch args**

```diff
{
  "path": "backend.js",
  "edits": [
    {
      "src": [
        "389:2e7a",
        "390:9d64",
        "391:51e1",
        "392:blank",
        "393:1d3b",
        "394:346a",
        "395:d06e"
      ],
      "dst": [
        "  if (onSettingsUpdated != null) {",
        "    agent.addListener('updateHookSettings', onSettingsUpdated);",
        "  }",
        "",
        "  if (typeof onReloadAndProfileFlagsReset === 'function') {",
        "    onReloadAndProfileFlagsReset();",
        "  }"
      ]
    }
  ]
}
```

### Structural Swap If Else 001 (importFile.js)

#### Run 1

##### Attempt 1

- Path: importFile.js
- Operation: —

**Tool error**

```
No changes made to importFile.js. The edits produced identical content.
```

**Patch args**

```diff
{
  "path": "importFile.js",
  "edits": [
    {
      "src": [
        "34:0349",
        "35:4dea",
        "36:a314",
        "37:2ff2",
        "38:34f2",
        "39:60d6",
        "40:951d",
        "41:d3fb",
        "42:f412",
        "43:d4a6",
        "44:a4ba"
      ],
      "dst": [
        "     if (!(error instanceof InvalidProfileError)) {",
        "       return {",
        "         status: 'UNEXPECTED_ERROR',",
        "         error,",
        "       };",
        "     } else {",
        "       return {",
        "         status: 'INVALID_PROFILE_ERROR',",
        "         error,",
        "       };",
        "     }"
      ]
    }
  ]
}
```

### Structural Swap If Else 002 (ReactNativeFiberInspector.js)

#### Run 1

##### Attempt 1

- Path: /tmp/reach-benchmark-rsjpV0/batch-3e86ef52-ce85-4777-8af3-3bfa5ed810e8/ReactNativeFiberInspector.js
- Operation: —

**Tool error**

```
Line 160 has changed since last read (expected c0e4, got 0cb4). Re-read the file.
```

**Patch args**

```diff
{
  "path": "/tmp/reach-benchmark-rsjpV0/batch-3e86ef52-ce85-4777-8af3-3bfa5ed810e8/ReactNativeFiberInspector.js",
  "edits": [
    {
      "src": [
        "160:c0e4",
        "161:ef7a",
        "162:810a",
        "163:8a8b",
        "164:9237",
        "165:950e",
        "166:7526"
      ],
      "dst": [
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

#### Run 2

##### Attempt 1

- Path: /tmp/reach-benchmark-rsjpV0/batch-9ef3e453-a94d-433d-a918-c3693e05cd33/ReactNativeFiberInspector.js
- Operation: —

**Tool error**

```
Line 160 has changed since last read (expected c0e4, got 0cb4). Re-read the file.
```

**Patch args**

```diff
{
  "path": "/tmp/reach-benchmark-rsjpV0/batch-9ef3e453-a94d-433d-a918-c3693e05cd33/ReactNativeFiberInspector.js",
  "edits": [
    {
      "src": [
        "160:c0e4",
        "161:ef7a",
        "162:810a",
        "163:8a8b",
        "164:9237",
        "165:950e",
        "166:7526"
      ],
      "dst": [
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

#### Run 3

##### Attempt 1

- Path: ReactNativeFiberInspector.js
- Operation: —

**Tool error**

```
Line 160 has changed since last read (expected c0e4, got 0cb4). Re-read the file.
```

**Patch args**

```diff
{
  "path": "ReactNativeFiberInspector.js",
  "edits": [
    {
      "src": [
        "160:c0e4"
      ],
      "dst": [
        "  if (!__DEV__) {"
      ]
    }
  ]
}
```

### Structural Swap If Else 003 (ReactDOMFizzStaticNode.js)

#### Run 1

##### Attempt 1

- Path: ReactDOMFizzStaticNode.js
- Operation: —

**Tool error**

```
Line 169 has changed since last read (expected 31fd, got 7b33). Re-read the file.
```

**Patch args**

```diff
{
  "path": "ReactDOMFizzStaticNode.js",
  "edits": [
    {
      "src": [
        "169:31fd",
        "170:2dcb",
        "171:1b88",
        "172:f7af",
        "173:a58f",
        "174:4283",
        "175:1fa1",
        "176:752b",
        "177:35eb",
        "178:0836",
        "179:d38d",
        "180:6949"
      ],
      "dst": [
        "     if (options && options.signal) {",
        "       const signal = options.signal;",
        "       if (signal.aborted) {",
        "         abort(request, (signal: any).reason);",
        "       } else {",
        "         const listener = () => {",
        "           abort(request, (signal: any).reason);",
        "           signal.removeEventListener('abort', listener);",
        "         };",
        "         signal.addEventListener('abort', listener);",
        "       }",
        "     }",
        "     startWork(request);"
      ]
    }
  ]
}
```

#### Run 2

##### Attempt 1

- Path: ReactDOMFizzStaticNode.js
- Operation: —

**Tool error**

```
Line 169 has changed since last read (expected 31fd, got 7b33). Re-read the file.
```

**Patch args**

```diff
{
  "path": "ReactDOMFizzStaticNode.js",
  "edits": [
    {
      "src": [
        "169:31fd",
        "170:2dcb",
        "171:1b88",
        "172:f7af",
        "173:a58f",
        "174:4283",
        "175:1fa1",
        "176:752b",
        "177:35eb",
        "178:0836",
        "179:d38d"
      ],
      "dst": [
        "    if (options && options.signal) {",
        "      const signal = options.signal;",
        "      if (signal.aborted) {",
        "        abort(request, (signal: any).reason);",
        "      } else {",
        "        const listener = () => {",
        "          abort(request, (signal: any).reason);",
        "          signal.removeEventListener('abort', listener);",
        "        };",
        "        signal.addEventListener('abort', listener);",
        "      }"
      ]
    }
  ]
}
```

#### Run 3

##### Attempt 1

- Path: /tmp/reach-benchmark-rsjpV0/batch-93ba3ba1-4f8f-4157-ab4d-35b6abbd000d/ReactDOMFizzStaticNode.js
- Operation: —

**Tool error**

```
Line 169 has changed since last read (expected 31fd, got 7b33). Re-read the file.
```

**Patch args**

```diff
{
  "path": "/tmp/reach-benchmark-rsjpV0/batch-93ba3ba1-4f8f-4157-ab4d-35b6abbd000d/ReactDOMFizzStaticNode.js",
  "edits": [
    {
      "src": [
        "169:31fd",
        "170:2dcb",
        "171:e66b",
        "172:d149",
        "173:45b0",
        "174:50c9",
        "175:e8f8",
        "176:d1a1",
        "177:752b",
        "178:35eb",
        "179:0836",
        "180:d38d"
      ],
      "dst": [
        "169:9855",
        "    if (options && options.signal) {",
        "      const signal = options.signal;",
        "      if (signal.aborted) {",
        "        abort(request, (signal: any).reason);",
        "      } else {",
        "        const listener = () => {",
        "          abort(request, (signal: any).reason);",
        "          signal.removeEventListener('abort', listener);",
        "        };",
        "        signal.addEventListener('abort', listener);",
        "      }"
      ]
    }
  ]
}
```

## Flaky Tasks (partial passing)

### Access Remove Optional Chain 002 (TimelineContext.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 7 / 598 | 8.1s |
| 2 | ❌ | File mismatch for TimelineContext.js | 13 / 810 | 10.6s |
| 3 | ❌ | File mismatch for TimelineContext.js | 4 / 964 | 11.7s |

### Call Swap Call Args 002 (FlamegraphChartBuilder.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for FlamegraphChartBuilder.js | 7 / 2,045 | 19.1s |
| 2 | ❌ | File mismatch for FlamegraphChartBuilder.js | 4 / 937 | 9.9s |
| 3 | ✅ | — | 24 / 6,152 | 50.4s |

### Identifier Identifier Multi Edit 001 (TabBar.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 30 / 1,206 | 14.3s |
| 2 | ❌ | File mismatch for TabBar.js | 12 / 1,240 | 16.4s |
| 3 | ❌ | File mismatch for TabBar.js | 13 / 862 | 10.4s |

### Identifier Identifier Multi Edit 002 (EventPluginRegistry.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 7 / 574 | 6.8s |
| 2 | ❌ | File mismatch for EventPluginRegistry.js | 10 / 22,463 | 42.7s |
| 3 | ✅ | — | 5 / 674 | 9.8s |

### Identifier Identifier Multi Edit 003 (ReactPerformanceTrackProperties.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 54 / 2,355 | 27.9s |
| 2 | ❌ | File mismatch for ReactPerformanceTrackProperti... | 12 / 570 | 7.1s |
| 3 | ✅ | — | 27 / 1,274 | 16.5s |

### Import Swap Named Imports 003 (StyleEditor.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for StyleEditor.js | 9 / 1,164 | 14.0s |
| 2 | ✅ | — | 4 / 601 | 9.0s |
| 3 | ❌ | File mismatch for StyleEditor.js | 16 / 799 | 13.0s |

### Literal Flip Boolean 003 (ReactFlightDOMClientEdge.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 10 / 449 | 6.8s |
| 2 | ❌ | File mismatch for ReactFlightDOMClientEdge.js | 16 / 646 | 9.5s |
| 3 | ❌ | File mismatch for ReactFlightDOMClientEdge.js | 9 / 671 | 9.2s |

### Literal Off By One 001 (githubAPI.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 10 / 307 | 5.2s |
| 2 | ✅ | — | 10 / 579 | 7.6s |
| 3 | ❌ | File mismatch for githubAPI.js | 11 / 697 | 7.7s |

### Literal Off By One 002 (code-path.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 23 / 847 | 9.8s |
| 2 | ✅ | — | 22 / 2,735 | 28.4s |
| 3 | ❌ | File mismatch for code-path.js | 10 / 399 | 6.8s |

### Operator Remove Negation 001 (ReactDOMClient.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 13 / 1,464 | 16.2s |
| 2 | ✅ | — | 7 / 1,470 | 17.3s |
| 3 | ❌ | File mismatch for ReactDOMClient.js | 10 / 1,229 | 15.2s |

### Operator Swap Arithmetic 002 (CSSShorthandProperty.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 6 / 348 | 5.3s |
| 2 | ✅ | — | 4 / 415 | 6.0s |
| 3 | ❌ | File mismatch for CSSShorthandProperty.js | 18 / 713 | 13.1s |

### Operator Swap Comparison 002 (ReactFlightDOMServerBrowser.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 9 / 1,030 | 12.1s |
| 2 | ❌ | File mismatch for ReactFlightDOMServerBrowser.js | 6 / 567 | 6.7s |
| 3 | ❌ | File mismatch for ReactFlightDOMServerBrowser.js | 16 / 693 | 10.1s |

### Operator Swap Comparison 003 (ReactFlightDOMServerNode.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 22 / 804 | 11.7s |
| 2 | ✅ | — | 22 / 934 | 13.5s |
| 3 | ❌ | File mismatch for ReactFlightDOMServerNode.js | 14 / 14,421 | 7.2s |

### Operator Swap Logical 002 (SourceMapMetadataConsumer.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 10 / 510 | 6.4s |
| 2 | ✅ | — | 4 / 1,227 | 13.7s |
| 3 | ❌ | File mismatch for SourceMapMetadataConsumer.js | 25 / 1,596 | 16.4s |

### Operator Swap Nullish 003 (backend.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for backend.js | 4 / 393 | 5.7s |
| 2 | ✅ | — | 12 / 1,008 | 13.1s |
| 3 | ✅ | — | 18 / 879 | 12.2s |

### Regex Swap Regex Quantifier 001 (githubAPI.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 10 / 385 | 6.3s |
| 2 | ❌ | File mismatch for githubAPI.js | 8 / 110 | 5.2s |
| 3 | ✅ | — | 7 / 426 | 6.1s |

### Regex Swap Regex Quantifier 003 (utils.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 16 / 1,690 | 22.2s |
| 2 | ❌ | File mismatch for utils.js | 12 / 1,263 | 13.0s |
| 3 | ✅ | — | 13 / 798 | 9.6s |

## Failed Tasks (0% passing)

### Access Remove Optional Chain 003 (astUtils.js) — 0/3

**All runs failed with same error:** File mismatch for astUtils.js

**Sample agent response (run 1):**
```
Fixed. The bug was on line 87 in the `filterMemberNodesOfTargetHook` function. The property access `hookNode.node.init.object.name` should use optional chaining (`?.`) to safely access the `name` property, changing it from:

```javascript
(hookNode.node.init.object && hookNode.node.init.object.name)
```

to:

```javascript
(hookNode.node.init.object?.name)
```

This is both more concise and safer, as optional chaining handles the null/undefined check internally.
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

### Call Swap Call Args 003 (SyntheticEvent.js) — 0/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | Timeout waiting for agent_end | 0 / 0 | 120.0s |
| 2 | ❌ | File mismatch for SyntheticEvent.js | 5 / 9,147 | 68.6s |
| 3 | ❌ | File mismatch for SyntheticEvent.js | 10 / 8,999 | 63.6s |

**Sample agent response (run 1):**
```
Done! The bug is fixed. On lines 313-314 in the `EventConstructor.call()` invocation, the arguments `nativeEvent` and `nativeInst` were swapped. They should pass `nativeInst` (the native event target) before `nativeEvent` (the native event) to correctly match the constructor's parameter order.
```

**Diff (expected vs actual):**
```diff
@@ -250 @@
 function getPooledWarningPropertyDefinition(propName, getVal) {
   function set(val) {
     const action = isFunction ? 'setting the method' : 'setting the property';
-    warn(action, 'This is effectively a no-op');
+    warn('This is effectively a no-op', action);
     return val;
   }
 
@@ -286 @@
   const EventConstructor = this;
   if (EventConstructor.eventPool.length) {
     const instance = EventConstructor.eventPool.pop();
-    EventConstructor.call(instance, dispatchConfig, targetInst, nativeEvent, nativeInst);
+    EventConstructor.call(instance, dispatchConfig, targetInst, nativeInst, nativeEvent);
     return instance;
   }
   return new EventConstructor(dispatchConfig, targetInst, nativeEvent, nativeInst);
```

### Import Swap Named Imports 001 (CommitFlamegraphListItem.js) — 0/3

**All runs failed with same error:** File mismatch for CommitFlamegraphListItem.js

**Sample agent response (run 1):**
```
Done. I've swapped `Fragment` and `memo` on line 11 from:
```javascript
import {Fragment, memo, useContext, useCallback} from 'react';
```

to:
```javascript
import {memo, Fragment, useContext, useCallback} from 'react';
```

This is the minimal fix—only the two named imports that were in the wrong order have been swapped, and no other code has been modified.
```

**Diff (expected vs actual):**
```diff
@@ -8 @@
  */
 
 import * as React from 'react';
-import { Fragment, memo, useCallback, useContext } from 'react';
+import { memo, Fragment, useContext, useCallback } from 'react';
 import { areEqual } from 'react-window';
 import { barWidthThreshold } from './constants';
 import { getGradientColor } from './utils';
```

### Operator Remove Negation 003 (ReactFlightUnbundledReferences.js) — 0/3

**All runs failed with same error:** File mismatch for ReactFlightUnbundledReferences.js

**Sample agent response (run 1):**
```
Perfect. The bug has been fixed. The negation operator was missing on line 254. The condition should check `if (!target.then)` (if target.then does NOT exist) rather than `if (target.then)` (if target.then EXISTS). This is consistent with the caching pattern used elsewhere in the file (see line 296: `if (!cachedReference)`), where we only create/cache a value if it doesn't already exist.
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
Fixed. The arithmetic/comparison operator on line 129 was incorrect. It should be `<` (less than) instead of `<=` (less than or equal to). The container is considered overflowing only when its width is strictly less than the total child width, not when they're equal. When the widths are equal, all content fits without overflow.
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

### Structural Delete Statement 002 (getComponentNameFromFiber.js) — 0/3

**All runs failed with same error:** File mismatch for getComponentNameFromFiber.js

**Sample agent response (run 1):**
```
Perfect. The missing statement has been restored. The `getWrappedName` function now properly defines the `functionName` variable by calling `getComponentNameFromType(innerType)` before using it in the return statement. This fixes the undefined variable reference that was causing the bug.
```

**Diff (expected vs actual):**
```diff
@@ -54 @@
 
 // Keep in sync with shared/getComponentNameFromType
 function getWrappedName(outerType: mixed, innerType: any, wrapperName: string): string {
-  const functionName = innerType.displayName || innerType.name || '';
+  const functionName = getComponentNameFromType(innerType);
   return (
     (outerType: any).displayName ||
     (functionName !== '' ? `${wrapperName}(${functionName})` : wrapperName)
```

### Structural Delete Statement 003 (simulateBrowserEventDispatch.js) — 0/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for simulateBrowserEventDispatch.js | 12 / 4,317 | 47.1s |
| 2 | ❌ | Timeout waiting for agent_end | 0 / 0 | 120.6s |
| 3 | ❌ | File mismatch for simulateBrowserEventDispatch.js | 17 / 8,087 | 69.4s |

**Sample agent response (run 1):**
```
Done. I've added the missing critical statement `eventImpl.eventPhase = EVENT_PHASE.NONE;` between the two loops (after line 208). 

**The issue**: Between the capturing phase loop (which processes backwards through the event path with 'capturing' listeners) and the bubbling phase loop (which processes forwards with 'bubbling' listeners), there was a missing statement that resets the event phase. This statement is critical for proper DOM event dispatch semantics - after completing the capturi...
```

**Diff (expected vs actual):**
```diff
@@ -82 @@
     const isActivationEvent = false; // TODO Not ported in fork.
 
     if (isActivationEvent && targetImpl._hasActivationBehavior) {
-      activationTarget = targetImpl;
     }
 
     let slotInClosedTree = false;
@@ -179 @@
 
       await invokeEventListeners(struct, eventImpl, 'capturing');
     }
+    eventImpl.eventPhase = EVENT_PHASE.NONE;
 
     for (let i = 0; i < eventImpl._path.length; i++) {
       const struct = eventImpl._path[i];
```

### Structural Remove Early Return 001 (InspectedElementStateTree.js) — 0/3

**All runs failed with same error:** File mismatch for InspectedElementStateTree.js

**Sample agent response (run 1):**
```
Done. I've restored the missing guard clause after line 38. The 3-line pattern checks if `state` is falsy and returns `null` early if it is, which prevents accessing properties on an undefined or null `state` object. This guard clause should execute before the rest of the component logic.
```

**Diff (expected vs actual):**
```diff
@@ -7 @@
  * @flow
  */
 
-import { copy } from 'clipboard-js';
+import {copy} from 'clipboard-js';
 import * as React from 'react';
 import * as React from 'react';
-import { ElementTypeHostComponent } from 'react-devtools-shared/src/frontend/types';
+import {ElementTypeHostComponent} from 'react-devtools-shared/src/frontend/types';
 import Button from '../Button';
 import ButtonIcon from '../ButtonIcon';
 import KeyValue from './KeyValue';
 import Button from '../Button';
 import ButtonIcon from '../ButtonIcon';
 import KeyValue from './KeyValue';
-import { alphaSortEntries, serializeDataForCopy } from '../utils';
+import {alphaSortEntries, serializeDataForCopy} from '../utils';
 import Store from '../../store';
 import styles from './InspectedElementSharedStyles.css';
 import Store from '../../store';
 import styles from './InspectedElementSharedStyles.css';
-import { withPermissionsCheck } from 'react-devtools-shared/src/frontend/utils/withPermissionsCheck';
+import {withPermissionsCheck} from 'react-devtools-shared/src/frontend/utils/withPermissionsCheck';
 
 
-import type { InspectedElement } from 'react-devtools-shared/src/frontend/types';
-import type { FrontendBridge } from 'react-devtools-shared/src/bridge';
-import type { Element } from 'react-devtools-shared/src/frontend/types';
+import type {InspectedElement} from 'react-devtools-shared/src/frontend/types';
+import type {FrontendBridge} from 'react-devtools-shared/src/bridge';
+import type {Element} from 'react-devtools-shared/src/frontend/types';
 
 type Props = {
   bridge: FrontendBridge,
@@ -35 @@
   inspectedElement,
   store,
 }: Props): React.Node {
-  const { state, type } = inspectedElement;
-  if (state == null) {
+  const {state, type} = inspectedElement;
+  if (!state) {
     return null;
     return null;
-  }
+  
 
   // HostSingleton and HostHoistable may have state that we don't want to expose to users
   const isHostComponent = type === ElementTypeHostComponent;
@@ -49 @@
   }
 
   e...
```

### Structural Remove Early Return 002 (useCommitFilteringAndNavigation.js) — 0/3

**All runs failed with same error:** File mismatch for useCommitFilteringAndNavigation.js

**Sample agent response (run 1):**
```
Perfect. The guard clause has been restored. The `findFilteredIndex` function now:
1. Returns early if `commitIndex === null` (line 62)
2. Loops through the filtered array (line 63)
3. **Returns the index `i` if the filtered element matches `commitIndex`** (line 64 - the missing guard clause)
4. Returns `null` if no match is found (line 66)

The fix is complete. The missing 3-line guard clause pattern (if condition, return statement, closing brace) has been added back inside the for loop.
```

**Diff (expected vs actual):**
```diff
@@ -63 @@
     (commitIndex: number | null, filtered: Array<number>): number | null => {
       if (commitIndex === null) return null;
       for (let i = 0; i < filtered.length; i++) {
-        if (filtered[i] === commitIndex) {
-          return i;
-        }
+        if (filtered[i] === commitIndex) return i;
       }
       return null;
     },
```

### Structural Remove Early Return 003 (ReactFiberAsyncAction.js) — 0/3

**All runs failed with same error:** File mismatch for ReactFiberAsyncAction.js

**Sample agent response (run 1):**
```
Done. I've restored the missing guard clause that checks if `isomorphicDefaultTransitionIndicator === null` and returns early if it is. This prevents attempting to call a null indicator function. The guard clause is placed right before the code attempts to use `isomorphicDefaultTransitionIndicator`, which is the correct position to prevent null reference errors.
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
@@ -195 @@
   if (!needsIsomorphicIndicator) {
     return;
   }
-  if (isomorphicDefaultTransitionIndicator != null && pendingIsomorphicIndicator === null) {
+  if (isomorphicDefaultTransitionIndicator === null) {
+    return;
+  }
+  if (pendingIsomorphicIndicator === null) {
     try {
       pendingIsomorphicIndicator = isomorphicDefaultTransitionIndicator() || noop;
     } catch (x) {
```

### Structural Swap Adjacent Lines 002 (ReactNoopFlightServer.js) — 0/3

**All runs failed with same error:** File mismatch for ReactNoopFlightServer.js

**Sample agent response (run 1):**
```
Done. I've swapped the two adjacent lines back to their correct order. The `return textEncoder.encode(content);` statement (the body of `stringToChunk`) is now on line 46, and the `flushBuffered` function definition is now on line 47, restoring the proper structure of the configuration object.
```

**Diff (expected vs actual):**
```diff
@@ -14 @@
  * environment.
  */
 
-import type { ReactClientValue } from 'react-server/src/ReactFlightServer';
+import type {ReactClientValue} from 'react-server/src/ReactFlightServer';
 
 
-import { saveModule } from 'react-noop-renderer/flight-modules';
+import {saveModule} from 'react-noop-renderer/flight-modules';
 
 import ReactFlightServer from 'react-server/flight';
 
@@ -42 @@
   completeWriting(destination: Destination): void {},
   close(destination: Destination): void {},
   closeWithError(destination: Destination, error: mixed): void {},
-  flushBuffered(destination: Destination): void {},
   stringToChunk(content: string): Uint8Array {
     return textEncoder.encode(content);
   stringToChunk(content: string): Uint8Array {
     return textEncoder.encode(content);
+  flushBuffered(destination: Destination): void {},
   },
   stringToPrecomputedChunk(content: string): Uint8Array {
     return textEncoder.encode(content);
@@ -58 @@
   getClientReferenceKey(reference: Object): Object {
     return reference;
   },
-  resolveClientReferenceMetadata(config: void, reference: { $$typeof: symbol, value: any }) {
+  resolveClientReferenceMetadata(
+    config: void,
+    reference: {$$typeof: symbol, value: any},
+  ) {
     return saveModule(reference.value);
   },
 });
@@ -68 @@
   filterStackFrame?: (url: string, functionName: string) => boolean,
   identifierPrefix?: string,
   signal?: AbortSignal,
-  debugChannel?: { onMessage?: (message: string) => void },
+  debugChannel?: {onMessage?: (message: string) => void},
   onError?: (error: mixed) => void,
 };
 
@@ -98 @@
     }
   }
   if (__DEV__ && options && options.debugChannel !== undefined) {
-    options.debugChannel.onMessage = (message) => {
+    options.debugChannel.onMessage = message => {
       ReactNoopFlightServer.resolveDebugMessage(request, message);
     };
   }
@@ -107 @@
   return destination;
 }
 
-export { render };
+export {render};
```

### Structural Swap Adjacent Lines 003 (backend.js) — 0/3

**All runs failed with same error:** File mismatch for backend.js

**Sample agent response (run 1):**
```
Perfect! The swap has been completed successfully. The two adjacent statements are now in the correct order:

1. Lines 388-390: `if (typeof onReloadAndProfileFlagsReset === 'function') { onReloadAndProfileFlagsReset(); }` — Reset the flags first
2. Line 392: `const agent = new Agent(bridge, isProfiling, onReloadAndProfile);` — Create the agent after resetting

This is the correct logical order: reset the profiling flags before creating the agent, rather than after.
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
@@ -358 @@
     bridge.send('overrideComponentFilters', savedComponentFilters);
   }
 
-  const agent = new Agent(bridge, isProfiling, onReloadAndProfile);
   if (typeof onReloadAndProfileFlagsReset === 'function') {
     onReloadAndProfileFlagsReset();
   }
@@ -363 @@
     onReloadAndProfileFlagsReset();
   }
 
+  const agent = new Agent(bridge, isProfiling, onReloadAndProfile);
+
   if (onSettingsUpdated != null) {
     agent.addListener('updateHookSettings', onSettingsUpdated);
   }
```

### Structural Swap If Else 001 (importFile.js) — 0/3

**All runs failed with same error:** File mismatch for importFile.js

**Sample agent response (run 1):**
```
The indentation does appear to have an extra space. Let me look at line 20 to understand the expected indentation level. Lines 20-32 show 2 spaces for the try block content. Line 33 shows the catch with 2 spaces. Lines 34+ should have 4 spaces for content inside the catch block.

Looking at the output, line 34 starts with many spaces (shown as space-padded in the output). The issue is that the output is being displayed with visual alignment. The actual structure should be fine. Let me verify ...
```

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

### Structural Swap If Else 002 (ReactNativeFiberInspector.js) — 0/3

**All runs failed with same error:** File mismatch for ReactNativeFiberInspector.js

**Sample agent response (run 1):**
```
Done. I've fixed the swapped if/else branches in the `getInspectorDataForViewTag` function by negating the condition from `if (__DEV__)` to `if (!__DEV__)`. Now the error is correctly thrown in production, and the inspector data is returned in development mode.
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
