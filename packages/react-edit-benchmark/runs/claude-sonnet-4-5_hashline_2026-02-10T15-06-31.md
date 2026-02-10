# Edit Benchmark Report

## Configuration

| Setting | Value |
|---------|-------|
| Date | 2026-02-10T14:57:11.027Z |
| Model | anthropic/p-anthropic/claude-sonnet-4-5 |
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
| Successful Runs | 135 |
| **Task Success Rate** | **75.0% (135/180)** |
| Verified Rate | 75.0% (135/180) |
| Edit Tool Usage Rate | 94.4% (170/180) |
| **Edit Success Rate** | **96.1%** |
| Patch Failure Rate | 3.9% (7/179) |
| Tasks All Passing | 36 |
| Tasks Flaky/Failing | 24 |

### Tool Calls

| Tool | Total | Avg/Run |
|------|-------|---------|
| Read | 193 | 1.1 |
| Edit | 179 | 1.0 |
| Write | 0 | 0.0 |
| **Tool Input Chars** | 43,974 | 244 |

### Tokens & Time

| Metric | Total | Avg/Run |
|--------|-------|---------|
| Input Tokens | 2,412,336 | 13,402 |
| Output Tokens | 217,000 | 1,206 |
| Total Tokens | 10,692,107 | 59,401 |
| Duration | 5530.1s | 30.7s |
| **Avg Indent Score** | — | **2.23** |

## Task Results

| Task | File | Success | Edit Hit | R/E/W | Tokens (In/Out) | Time | Indent |
|------|------|---------|----------|-------|-----------------|------|--------|
| Access Remove Optional Chain 001 | registerDevToolsEventLogger.js | 2/3 ⚠️ | 100.0% | 1/1/0 | 22,097/929 | 21.7s | 1.00 |
| Access Remove Optional Chain 002 | TimelineContext.js | 3/3 ✅ | 100.0% | 1/1/0 | 7,382/1,052 | 19.9s | 1.29 |
| Access Remove Optional Chain 003 | astUtils.js | 0/3 ❌ | 100.0% | 1/1/0 | 30,910/1,397 | 31.0s | 4.85 |
| Call Swap Call Args 001 | testHelpers.js | 3/3 ✅ | 100.0% | 1/1/0 | 6,534/755 | 17.2s | 1.33 |
| Call Swap Call Args 002 | FlamegraphChartBuilder.js | 2/3 ⚠️ | 100.0% | 1/1/0 | 12,470/390 | 50.1s | 3.79 |
| Call Swap Call Args 003 | SyntheticEvent.js | 3/3 ✅ | 100.0% | 1/1/0 | 8,346/1,285 | 26.8s | 3.76 |
| Duplicate Duplicate Line Flip 001 | index.js | 3/3 ✅ | 100.0% | 1/1/0 | 16,665/512 | 14.1s | 0.00 |
| Duplicate Duplicate Line Flip 002 | ActivityList.js | 3/3 ✅ | 100.0% | 1/1/0 | 14,195/913 | 21.8s | 3.61 |
| Duplicate Duplicate Line Flip 003 | SyntheticEvent.js | 3/3 ✅ | 100.0% | 1/1/0 | 6,047/1,763 | 32.6s | 1.02 |
| Identifier Identifier Multi Edit 001 | TabBar.js | 2/3 ⚠️ | 100.0% | 1/1/0 | 31/3,965 | 28.6s | 3.33 |
| Identifier Identifier Multi Edit 002 | EventPluginRegistry.js | 3/3 ✅ | 80.0% | 1/2/0 | 16,831/1,179 | 26.4s | 3.94 |
| Identifier Identifier Multi Edit 003 | ReactPerformanceTrackProperties.js | 3/3 ✅ | 100.0% | 1/1/0 | 34/1,419 | 28.6s | 9.95 |
| Import Swap Named Imports 001 | CommitFlamegraphListItem.js | 2/3 ⚠️ | 100.0% | 1/1/0 | 28,645/699 | 16.7s | 2.86 |
| Import Swap Named Imports 002 | ReactDOMTextarea.js | 3/3 ✅ | 100.0% | 1/1/0 | 12,143/1,019 | 21.3s | 2.41 |
| Import Swap Named Imports 003 | StyleEditor.js | 0/3 ❌ | 100.0% | 1/1/0 | 6,277/1,943 | 76.6s | 1.33 |
| Literal Flip Boolean 001 | testHelpers.js | 3/3 ✅ | 100.0% | 1/1/0 | 12,319/538 | 13.1s | 1.33 |
| Literal Flip Boolean 002 | ReactNoopFlightServer.js | 3/3 ✅ | 100.0% | 1/1/0 | 5,559/704 | 16.8s | 1.11 |
| Literal Flip Boolean 003 | ReactFlightDOMClientEdge.js | 2/3 ⚠️ | 100.0% | 1/1/0 | 5,172/1,194 | 26.4s | 3.58 |
| Literal Off By One 001 | githubAPI.js | 3/3 ✅ | 100.0% | 1/1/0 | 21,287/580 | 13.3s | 0.67 |
| Literal Off By One 002 | code-path.js | 3/3 ✅ | 75.0% | 1/1/0 | 18,077/1,106 | 24.7s | 3.50 |
| Literal Off By One 003 | InspectedElement.js | 2/3 ⚠️ | 100.0% | 1/1/0 | 34/1,325 | 28.3s | 3.59 |
| Operator Remove Negation 001 | ReactDOMClient.js | 2/3 ⚠️ | 80.0% | 2/2/0 | 13,139/3,700 | 80.1s | 1.08 |
| Operator Remove Negation 002 | NativeEventsView.js | 2/3 ⚠️ | 66.7% | 1/1/0 | 27,122/3,639 | 117.3s | 3.03 |
| Operator Remove Negation 003 | ReactFlightUnbundledReferences.js | 0/3 ❌ | 100.0% | 0/0/0 | 2,990/1,662 | 112.8s | 2.00 |
| Operator Swap Arithmetic 001 | fallbackEvalContext.js | 3/3 ✅ | 100.0% | 1/1/0 | 3,962/609 | 14.5s | 0.00 |
| Operator Swap Arithmetic 002 | CSSShorthandProperty.js | 3/3 ✅ | 100.0% | 2/1/0 | 6,213/613 | 17.5s | 2.84 |
| Operator Swap Arithmetic 003 | hooks.js | 1/3 ⚠️ | 100.0% | 2/1/0 | 28,606/3,077 | 68.1s | 2.25 |
| Operator Swap Comparison 001 | index.js | 3/3 ✅ | 100.0% | 1/1/0 | 9,133/449 | 12.5s | 0.00 |
| Operator Swap Comparison 002 | ReactFlightDOMServerBrowser.js | 3/3 ✅ | 100.0% | 1/1/0 | 34/1,404 | 28.9s | 1.57 |
| Operator Swap Comparison 003 | ReactFlightDOMServerNode.js | 3/3 ✅ | 100.0% | 2/1/0 | 42/1,548 | 30.5s | 1.95 |
| Operator Swap Equality 001 | readInputData.js | 3/3 ✅ | 100.0% | 1/1/0 | 19,030/495 | 13.4s | 0.00 |
| Operator Swap Equality 002 | editor.js | 3/3 ✅ | 100.0% | 1/1/0 | 17,704/614 | 16.9s | 0.00 |
| Operator Swap Equality 003 | hooks.js | 3/3 ✅ | 100.0% | 1/1/0 | 43,257/679 | 18.3s | 2.25 |
| Operator Swap Increment Decrement 001 | ReactFlightDOMClientNode.js | 3/3 ✅ | 100.0% | 1/1/0 | 7,017/609 | 13.7s | 1.52 |
| Operator Swap Increment Decrement 002 | ReactFlightDOMClientNode.js | 3/3 ✅ | 100.0% | 1/1/0 | 18,547/771 | 19.9s | 1.92 |
| Operator Swap Increment Decrement 003 | loadSourceAndMetadata.js | 3/3 ✅ | 100.0% | 1/1/0 | 14,223/506 | 16.5s | 3.72 |
| Operator Swap Logical 001 | profiling.js | 3/3 ✅ | 100.0% | 1/1/0 | 6,812/783 | 16.2s | 0.00 |
| Operator Swap Logical 002 | SourceMapMetadataConsumer.js | 2/3 ⚠️ | 100.0% | 1/1/0 | 12,705/741 | 19.5s | 3.14 |
| Operator Swap Logical 003 | DevToolsFiberComponentStack.js | 2/3 ⚠️ | 100.0% | 1/1/0 | 18,989/3,207 | 19.2s | 4.13 |
| Operator Swap Nullish 001 | getBatchRange.js | 3/3 ✅ | 100.0% | 1/1/0 | 21,557/540 | 13.1s | 1.33 |
| Operator Swap Nullish 002 | EnterLeaveEventPlugin.js | 2/3 ⚠️ | 100.0% | 1/1/0 | 21,798/2,017 | 81.9s | 1.56 |
| Operator Swap Nullish 003 | backend.js | 0/3 ❌ | 100.0% | 1/1/0 | 4,022/2,043 | 38.3s | 3.15 |
| Regex Swap Regex Quantifier 001 | githubAPI.js | 3/3 ✅ | 100.0% | 1/1/0 | 12,939/579 | 14.2s | 0.67 |
| Regex Swap Regex Quantifier 002 | ReactFlightStackConfigV8.js | 3/3 ✅ | 100.0% | 1/1/0 | 18,036/1,718 | 34.3s | 3.06 |
| Regex Swap Regex Quantifier 003 | utils.js | 3/3 ✅ | 100.0% | 1/1/0 | 25,341/1,353 | 31.2s | 2.00 |
| Structural Delete Statement 001 | UnsupportedVersionDialog.js | 3/3 ✅ | 100.0% | 1/1/0 | 27,908/522 | 15.4s | 6.22 |
| Structural Delete Statement 002 | getComponentNameFromFiber.js | 3/3 ✅ | 100.0% | 1/1/0 | 2,574/724 | 17.1s | 0.62 |
| Structural Delete Statement 003 | simulateBrowserEventDispatch.js | 1/3 ⚠️ | 100.0% | 1/1/0 | 14,578/1,014 | 25.5s | 4.46 |
| Structural Remove Early Return 001 | InspectedElementStateTree.js | 3/3 ✅ | 100.0% | 1/1/0 | 26,168/572 | 15.9s | 0.36 |
| Structural Remove Early Return 002 | useCommitFilteringAndNavigation.js | 1/3 ⚠️ | 100.0% | 1/1/0 | 15,979/789 | 18.6s | 1.24 |
| Structural Remove Early Return 003 | ReactFiberAsyncAction.js | 0/3 ❌ | 75.0% | 2/1/0 | 7,234/1,420 | 32.7s | 1.44 |
| Structural Swap Adjacent Lines 001 | ReactServerConsoleConfigPlain.js | 3/3 ✅ | 100.0% | 1/1/0 | 11,301/469 | 11.9s | 1.00 |
| Structural Swap Adjacent Lines 002 | ReactNoopFlightServer.js | 0/3 ❌ | 100.0% | 1/1/0 | 15,706/700 | 55.5s | 0.00 |
| Structural Swap Adjacent Lines 003 | backend.js | 0/3 ❌ | 100.0% | 1/1/0 | 12,904/3,286 | 97.4s | 3.15 |
| Structural Swap If Else 001 | importFile.js | 0/3 ❌ | 100.0% | 1/1/0 | 9,468/905 | 17.3s | 0.00 |
| Structural Swap If Else 002 | ReactNativeFiberInspector.js | 0/3 ❌ | 75.0% | 1/1/0 | 14,537/880 | 20.7s | 3.18 |
| Structural Swap If Else 003 | ReactDOMFizzStaticNode.js | 3/3 ✅ | 75.0% | 2/1/0 | 15,242/1,430 | 30.9s | 1.88 |
| Unicode Unicode Hyphen 001 | Rectangle.js | 3/3 ✅ | 100.0% | 1/1/0 | 14,375/524 | 13.2s | 3.00 |
| Unicode Unicode Hyphen 002 | UnsupportedBridgeProtocolDialog.js | 3/3 ✅ | 100.0% | 1/1/0 | 11,841/584 | 14.8s | 3.83 |
| Unicode Unicode Hyphen 003 | ReactTypes.js | 2/3 ⚠️ | 100.0% | 1/1/0 | 23/495 | 51.6s | 1.24 |

## Category Summary

| Category | Runs | Verified | Edit Used | Success | Min/Avg/Max Difficulty |
|----------|------|----------|-----------|---------|------------------------|
| access | 9 | 55.6% (5/9) | 100.0% (9/9) | 55.6% (5/9) | 7 / 8.7 / 10 |
| call | 9 | 88.9% (8/9) | 88.9% (8/9) | 88.9% (8/9) | 6 / 7.7 / 10 |
| duplicate | 9 | 100.0% (9/9) | 100.0% (9/9) | 100.0% (9/9) | 7 / 9.7 / 12 |
| identifier | 9 | 88.9% (8/9) | 100.0% (9/9) | 88.9% (8/9) | 6 / 9.3 / 14 |
| import | 9 | 55.6% (5/9) | 88.9% (8/9) | 55.6% (5/9) | 2 / 4.7 / 6 |
| literal | 18 | 88.9% (16/18) | 100.0% (18/18) | 88.9% (16/18) | 4 / 6.2 / 9 |
| operator | 63 | 79.4% (50/63) | 92.1% (58/63) | 79.4% (50/63) | 1 / 6.5 / 13 |
| regex | 9 | 100.0% (9/9) | 100.0% (9/9) | 100.0% (9/9) | 6 / 7.3 / 8 |
| structural | 36 | 47.2% (17/36) | 94.4% (34/36) | 47.2% (17/36) | 4 / 7.6 / 15 |
| unicode | 9 | 88.9% (8/9) | 88.9% (8/9) | 88.9% (8/9) | 1 / 3.0 / 6 |

## Mutation Summary

| Mutation | Category | Runs | Verified | Edit Used | Success |
|----------|----------|------|----------|-----------|---------|
| delete-statement | structural | 9 | 77.8% (7/9) | 100.0% (9/9) | 77.8% (7/9) |
| duplicate-line-flip | duplicate | 9 | 100.0% (9/9) | 100.0% (9/9) | 100.0% (9/9) |
| flip-boolean | literal | 9 | 88.9% (8/9) | 100.0% (9/9) | 88.9% (8/9) |
| identifier-multi-edit | identifier | 9 | 88.9% (8/9) | 100.0% (9/9) | 88.9% (8/9) |
| off-by-one | literal | 9 | 88.9% (8/9) | 100.0% (9/9) | 88.9% (8/9) |
| remove-early-return | structural | 9 | 44.4% (4/9) | 100.0% (9/9) | 44.4% (4/9) |
| remove-negation | operator | 9 | 44.4% (4/9) | 66.7% (6/9) | 44.4% (4/9) |
| remove-optional-chain | access | 9 | 55.6% (5/9) | 100.0% (9/9) | 55.6% (5/9) |
| swap-adjacent-lines | structural | 9 | 33.3% (3/9) | 77.8% (7/9) | 33.3% (3/9) |
| swap-arithmetic | operator | 9 | 77.8% (7/9) | 100.0% (9/9) | 77.8% (7/9) |
| swap-call-args | call | 9 | 88.9% (8/9) | 88.9% (8/9) | 88.9% (8/9) |
| swap-comparison | operator | 9 | 100.0% (9/9) | 100.0% (9/9) | 100.0% (9/9) |
| swap-equality | operator | 9 | 100.0% (9/9) | 100.0% (9/9) | 100.0% (9/9) |
| swap-if-else | structural | 9 | 33.3% (3/9) | 100.0% (9/9) | 33.3% (3/9) |
| swap-increment-decrement | operator | 9 | 100.0% (9/9) | 100.0% (9/9) | 100.0% (9/9) |
| swap-logical | operator | 9 | 77.8% (7/9) | 88.9% (8/9) | 77.8% (7/9) |
| swap-named-imports | import | 9 | 55.6% (5/9) | 88.9% (8/9) | 55.6% (5/9) |
| swap-nullish | operator | 9 | 55.6% (5/9) | 88.9% (8/9) | 55.6% (5/9) |
| swap-regex-quantifier | regex | 9 | 100.0% (9/9) | 100.0% (9/9) | 100.0% (9/9) |
| unicode-hyphen | unicode | 9 | 88.9% (8/9) | 88.9% (8/9) | 88.9% (8/9) |

## Difficulty Summary

| Difficulty Score | Runs | Verified | Edit Used | Success |
|------------------|------|----------|-----------|---------|
| 0-2 | 18 | 88.9% (16/18) | 100.0% (18/18) | 88.9% (16/18) |
| 3-5 | 36 | 77.8% (28/36) | 94.4% (34/36) | 77.8% (28/36) |
| 6-8 | 72 | 77.8% (56/72) | 94.4% (68/72) | 77.8% (56/72) |
| 9+ | 54 | 64.8% (35/54) | 92.6% (50/54) | 64.8% (35/54) |

## Edit Tool Errors

Failures where the edit tool returned an error or failed to apply the patch.

### Identifier Identifier Multi Edit 002 (EventPluginRegistry.js)

#### Run 3

##### Attempt 1

- Path: EventPluginRegistry.js
- Operation: —

**Tool error**

```
Line 73 has changed since last read (expected b46b, got 13ff). Re-read the file.
```

**Patch args**

```diff
{
  "path": "EventPluginRegistry.js",
  "edits": [
    {
      "src": [
        "73:b46b"
      ],
      "dst": [
        "          eventName,"
      ]
    },
    {
      "src": [
        "95:054e"
      ],
      "dst": [
        "  eventName: string,"
      ]
    },
    {
      "src": [
        "97:cc87"
      ],
      "dst": [
        "  if (eventNameDispatchConfigs.hasOwnProperty(eventName)) {"
      ]
    },
    {
      "src": [
        "115:98cf"
      ],
      "dst": [
        "          eventName,"
      ]
    }
  ]
}
```

### Literal Off By One 002 (code-path.js)

#### Run 3

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

### Operator Remove Negation 001 (ReactDOMClient.js)

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
      "src": [
        "57:eb3b"
      ],
      "dst": [
        "  if (foundDevTools && canUseDOM && window.top === window.self) {"
      ]
    }
  ]
}
```

### Operator Remove Negation 002 (NativeEventsView.js)

#### Run 2

##### Attempt 1

- Path: /tmp/reach-benchmark-rS3sMY/batch-14207076-45e4-4d12-9160-18a8439e7fc3/NativeEventsView.js
- Operation: —

**Tool error**

```
No changes made to /tmp/reach-benchmark-rS3sMY/batch-14207076-45e4-4d12-9160-18a8439e7fc3/NativeEventsView.js. The edits produced identical content.
```

**Patch args**

```diff
{
  "path": "/tmp/reach-benchmark-rS3sMY/batch-14207076-45e4-4d12-9160-18a8439e7fc3/NativeEventsView.js",
  "edits": [
    {
      "dst": [
        "    if (rectIntersectsRect(eventRect, rect)) {"
      ],
      "src": [
        "117:e0f0"
      ]
    }
  ]
}
```

### Structural Remove Early Return 003 (ReactFiberAsyncAction.js)

#### Run 1

##### Attempt 1

- Path: ReactFiberAsyncAction.js
- Operation: —

**Tool error**

```
Line 103 has changed since last read (expected 0d26, got 5c38). Re-read the file.
```

**Patch args**

```diff
{
  "path": "ReactFiberAsyncAction.js",
  "edits": [
    {
      "src": [],
      "dst": [
        "  if (currentEntangledListeners === null) {",
        "    // This async action finished, but it was during a render that was",
        "    // aborted before the async action scope itself was exited. We need to",
        "    // wait until the scope is exited before proceeding.",
        "    // $FlowFixMe[incompatible-return]",
        "    return;",
        "  }"
      ],
      "after": "103:0d26"
    }
  ]
}
```

### Structural Swap If Else 002 (ReactNativeFiberInspector.js)

#### Run 3

##### Attempt 1

- Path: /tmp/reach-benchmark-rS3sMY/batch-70ec0393-e0fe-4cad-81ab-7d7b596f979e/ReactNativeFiberInspector.js
- Operation: —

**Tool error**

```
Validation failed for tool "edit":
  - edits: must be array

Received arguments:
{
  "edits": "[\n  {\n    \"src\": [\"160:0cb4\", \"161:c0e4\", \"162:ef7a\", \"163:810a\", \"164:8a8b\", \"165:9237\", \"166:950e\"],\n    \"dst\": [\n      \"  if (!__DEV__) {\",\n      \"    throw new Error(\",\n      \"      'getInspectorDataForViewTag() is not available in production',\",\n      \"    );\",\n      \"  } else {\",\n      \"    const closestInstance = getClosestInstanceFromNode(viewTag);\",\n      \"    return getInspectorDataForInstance(closestInstance);\"\n    ]\n  }\n]\n}\n]\n",
  "path": "/tmp/reach-benchmark-rS3sMY/batch-70ec0393-e0fe-4cad-81ab-7d7b596f979e/ReactNativeFiberInspector.js"
}
```

**Patch args**

```diff
{
  "edits": "[\n  {\n    \"src\": [\"160:0cb4\", \"161:c0e4\", \"162:ef7a\", \"163:810a\", \"164:8a8b\", \"165:9237\", \"166:950e\"],\n    \"dst\": [\n      \"  if (!__DEV__) {\",\n      \"    throw new Error(\",\n      \"      'getInspectorDataForViewTag() is not available in production',\",\n      \"    );\",\n      \"  } else {\",\n      \"    const closestInstance = getClosestInstanceFromNode(viewTag);\",\n      \"    return getInspectorDataForInstance(closestInstance);\"\n    ]\n  }\n]\n}\n]\n",
  "path": "/tmp/reach-benchmark-rS3sMY/batch-70ec0393-e0fe-4cad-81ab-7d7b596f979e/ReactNativeFiberInspector.js"
}
```

### Structural Swap If Else 003 (ReactDOMFizzStaticNode.js)

#### Run 3

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

## Flaky Tasks (partial passing)

### Access Remove Optional Chain 001 (registerDevToolsEventLogger.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 11,363 / 768 | 20.1s |
| 2 | ❌ | File mismatch for registerDevToolsEventLogger.js | 17,128 / 1,433 | 25.7s |
| 3 | ✅ | — | 37,801 / 585 | 19.4s |

### Call Swap Call Args 002 (FlamegraphChartBuilder.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 16,596 / 672 | 18.5s |
| 2 | ❌ | Timeout waiting for agent_end | 0 / 0 | 120.0s |
| 3 | ✅ | — | 20,815 / 498 | 11.9s |

### Identifier Identifier Multi Edit 001 (TabBar.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for TabBar.js | 24 / 8,921 | 30.1s |
| 2 | ✅ | — | 34 / 1,404 | 27.5s |
| 3 | ✅ | — | 34 / 1,569 | 28.2s |

### Import Swap Named Imports 001 (CommitFlamegraphListItem.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for CommitFlamegraphListItem.js | 31,582 / 751 | 18.7s |
| 2 | ✅ | — | 11,240 / 748 | 15.7s |
| 3 | ✅ | — | 43,114 / 599 | 15.6s |

### Literal Flip Boolean 003 (ReactFlightDOMClientEdge.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for ReactFlightDOMClientEdge.js | 15,448 / 868 | 24.2s |
| 2 | ✅ | — | 34 / 1,521 | 29.9s |
| 3 | ✅ | — | 34 / 1,192 | 25.1s |

### Literal Off By One 003 (InspectedElement.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 34 / 1,451 | 32.3s |
| 2 | ❌ | File mismatch for InspectedElement.js | 34 / 1,452 | 29.6s |
| 3 | ✅ | — | 34 / 1,072 | 23.2s |

### Operator Remove Negation 001 (ReactDOMClient.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 9,640 / 2,932 | 63.9s |
| 2 | ❌ | File mismatch for ReactDOMClient.js | 29,732 / 4,348 | 93.8s |
| 3 | ✅ | — | 46 / 3,819 | 82.6s |

### Operator Remove Negation 002 (NativeEventsView.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 12,959 / 5,385 | 117.6s |
| 2 | ✅ | — | 68,408 / 5,531 | 114.4s |
| 3 | ❌ | Timeout waiting for agent_end | 0 / 0 | 120.0s |

### Operator Swap Arithmetic 003 (hooks.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 29,065 / 3,299 | 74.2s |
| 2 | ❌ | File mismatch for hooks.js | 56,709 / 735 | 23.5s |
| 3 | ❌ | File mismatch for hooks.js | 44 / 5,196 | 106.6s |

### Operator Swap Logical 002 (SourceMapMetadataConsumer.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 25,405 / 638 | 21.1s |
| 2 | ✅ | — | 34 / 1,051 | 22.9s |
| 3 | ❌ | File mismatch for SourceMapMetadataConsumer.js | 12,676 / 535 | 14.6s |

### Operator Swap Logical 003 (DevToolsFiberComponentStack.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for DevToolsFiberComponentStack.js | 12 / 7,977 | 18.3s |
| 2 | ✅ | — | 36,253 / 817 | 20.0s |
| 3 | ✅ | — | 20,703 / 828 | 19.5s |

### Operator Swap Nullish 002 (EnterLeaveEventPlugin.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | Timeout waiting for agent_end | 0 / 0 | 120.0s |
| 2 | ✅ | — | 40,145 / 940 | 25.2s |
| 3 | ✅ | — | 25,248 / 5,112 | 100.5s |

### Structural Delete Statement 003 (simulateBrowserEventDispatch.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 36,059 / 489 | 16.3s |
| 2 | ❌ | File mismatch for simulateBrowserEventDispatch.js | 7,640 / 1,694 | 40.5s |
| 3 | ❌ | File mismatch for simulateBrowserEventDispatch.js | 34 / 859 | 19.8s |

### Structural Remove Early Return 002 (useCommitFilteringAndNavigation.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 34 / 1,033 | 23.0s |
| 2 | ❌ | File mismatch for useCommitFilteringAndNavigati... | 18,573 / 801 | 17.4s |
| 3 | ❌ | File mismatch for useCommitFilteringAndNavigati... | 29,330 / 534 | 15.4s |

### Unicode Unicode Hyphen 003 (ReactTypes.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 34 / 760 | 17.2s |
| 2 | ✅ | — | 34 / 724 | 17.7s |
| 3 | ❌ | Timeout waiting for agent_end | 0 / 0 | 120.0s |

## Failed Tasks (0% passing)

### Access Remove Optional Chain 003 (astUtils.js) — 0/3

**All runs failed with same error:** File mismatch for astUtils.js

**Sample agent response (run 1):**
```
Fixed. Restored optional chaining on line 87, changing `hookNode.node.init.object && hookNode.node.init.object.name` to `hookNode.node.init.object?.name`.
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

### Import Swap Named Imports 003 (StyleEditor.js) — 0/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | Timeout waiting for agent_end | 0 / 0 | 120.5s |
| 2 | ❌ | File mismatch for StyleEditor.js | 18,798 / 2,892 | 53.4s |
| 3 | ❌ | File mismatch for StyleEditor.js | 34 / 2,938 | 56.0s |

**Sample agent response (run 1):**
```
The fix has been applied. I found and swapped the two named imports on lines 14-15. Looking at the usage in the code:
- Line 36: `const bridge = useContext(BridgeContext);`
- Line 37: `const store = useContext(StoreContext);`

The imports were swapped - `BridgeContext` was imported first but `StoreContext` should come first to match the alphabetical order convention and likely the order expected from the source module. I've corrected this by swapping them to `StoreContext, BridgeContext`.
```

**Diff (expected vs actual):**
```diff
@@ -8 @@
  */
 
 import * as React from 'react';
-import { useContext, useMemo, useRef, useState } from 'react';
+import { useMemo, useContext, useRef, useState } from 'react';
 import { copy } from 'clipboard-js';
 import { copy } from 'clipboard-js';
-import { BridgeContext, StoreContext } from 'react-devtools-shared/src/devtools/views/context';
+import { StoreContext, BridgeContext } from 'react-devtools-shared/src/devtools/views/context';
 import Button from '../../Button';
 import ButtonIcon from '../../ButtonIcon';
 import { serializeDataForCopy } from '../../utils';
```

### Operator Remove Negation 003 (ReactFlightUnbundledReferences.js) — 0/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for ReactFlightUnbundledReference... | 8,969 / 4,985 | 98.4s |
| 2 | ❌ | Timeout waiting for agent_end | 0 / 0 | 120.0s |
| 3 | ❌ | Timeout waiting for agent_end | 0 / 0 | 120.0s |

**Sample agent response (run 1):**
```
Fixed. Changed line 71 from `if (thisBind != null)` to `if (thisBind == null)`, removing the negation operator from the inequality check. This makes the code error when null/undefined IS passed, rather than when it's NOT passed.
```

**Diff (expected vs actual):**
```diff
@@ -64 @@
   if (this.$$typeof === SERVER_REFERENCE_TAG) {
     if (__DEV__) {
       const thisBind = arguments[0];
-      if (thisBind != null) {
+      if (thisBind == null) {
         console.error(
           'Cannot bind "this" of a Server Action. Pass null or undefined as the first argument to .bind().',
         );
@@ -247 @@
         // Use a cached value
         return target.then;
       }
-      if (!target.$$async) {
+      if (target.$$async) {
         // If this module is expected to return a Promise (such as an AsyncModule) then
         // we should resolve that with a client reference that unwraps the Promise on
         // the client.
```

### Operator Swap Nullish 003 (backend.js) — 0/3

**All runs failed with same error:** File mismatch for backend.js

**Sample agent response (run 1):**
```
Fixed. The bug was on line 218 where the operands of the nullish coalescing operator were swapped:

**Before:**
```javascript
((resolveRNStyle ?? hook.resolveRNStyle: any): ResolveNativeStyle),
```

**After:**
```javascript
((hook.resolveRNStyle ?? resolveRNStyle: any): ResolveNativeStyle),
```

The hook property should take precedence when it exists, so it should be checked first in the nullish coalescing chain.
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

### Structural Remove Early Return 003 (ReactFiberAsyncAction.js) — 0/3

**All runs failed with same error:** File mismatch for ReactFiberAsyncAction.js

**Sample agent response (run 1):**
```
Perfect! The bug has been fixed. I've added the missing guard clause to the `pingEngtangledActionScope` function at lines 104-110.

The guard clause checks if `currentEntangledListeners === null` and returns early if true. This prevents the function from:
- Decrementing `currentEntangledPendingCount` when there's no active entangled scope
- Executing cleanup logic on an already-cleaned-up state

This is a critical safety check that ensures `pingEngtangledActionScope` only operates when there'...
```

**Diff (expected vs actual):**
```diff
@@ -85 @@
 }
 
 function pingEngtangledActionScope() {
+  if (currentEntangledListeners === null) {
+    // This async action finished, but it was during a render that was
+    // aborted before the async action scope itself was exited. We need to
+    // wait until the scope is exited before proceeding.
+    // $FlowFixMe[incompatible-return]
+    return;
+  }
   if (--currentEntangledPendingCount === 0) {
     if (enableProfilerTimer && enableComponentPerformanceTrack) {
       if (!hasScheduledTransitionWork()) {
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

### Structural Swap Adjacent Lines 002 (ReactNoopFlightServer.js) — 0/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for ReactNoopFlightServer.js | 27,238 / 488 | 12.9s |
| 2 | ❌ | Timeout waiting for agent_end | 0 / 0 | 120.0s |
| 3 | ❌ | File mismatch for ReactNoopFlightServer.js | 19,880 / 1,611 | 33.5s |

**Sample agent response (run 1):**
```
Fixed. Lines 46 and 47 have been swapped back to their correct order. Now:
- Line 45: `stringToChunk(content: string): Uint8Array {`
- Line 46: `return textEncoder.encode(content);` (body of stringToChunk)
- Line 47: `flushBuffered(destination: Destination): void {},` (next method)

The `stringToChunk` function now has its return statement properly inside its body, and `flushBuffered` comes after it.
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

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for backend.js | 38,678 / 6,235 | 105.7s |
| 2 | ❌ | Timeout waiting for agent_end | 0 / 0 | 120.0s |
| 3 | ❌ | File mismatch for backend.js | 34 / 3,622 | 66.7s |

**Sample agent response (run 1):**
```
Fixed. I swapped lines 192-195 so that `onReloadAndProfileFlagsReset()` is called BEFORE creating the Agent instance. This ensures that any flag reset happens prior to agent initialization, which makes logical sense given the function name suggests it resets profiling-related flags.
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

### Structural Swap If Else 001 (importFile.js) — 0/3

**All runs failed with same error:** File mismatch for importFile.js

**Sample agent response (run 1):**
```
Done. I've fixed the bug by negating the condition on line 34 from `if (error instanceof InvalidProfileError)` to `if (!(error instanceof InvalidProfileError))` and swapped the branch bodies so that:
- `InvalidProfileError` now returns status `INVALID_PROFILE_ERROR` (correct)
- Other errors return status `UNEXPECTED_ERROR` (correct)
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
Done. The bug has been fixed. The condition has been negated from `if (__DEV__)` to `if (!__DEV__)` and the branch bodies have been swapped to their correct positions:
- Now in development mode (`__DEV__`), the function executes normally
- In production (`!__DEV__`), it throws an error
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
