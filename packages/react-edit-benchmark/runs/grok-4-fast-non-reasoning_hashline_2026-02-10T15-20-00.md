# Edit Benchmark Report

## Configuration

| Setting | Value |
|---------|-------|
| Date | 2026-02-10T15:18:43.720Z |
| Model | xai/grok-4-fast-non-reasoning |
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
| Successful Runs | 64 |
| **Task Success Rate** | **35.6% (64/180)** |
| Verified Rate | 35.6% (64/180) |
| Edit Tool Usage Rate | 97.2% (175/180) |
| **Edit Success Rate** | **93.3%** |
| Patch Failure Rate | 6.7% (13/194) |
| Tasks All Passing | 13 |
| Tasks Flaky/Failing | 47 |

### Tool Calls

| Tool | Total | Avg/Run |
|------|-------|---------|
| Read | 266 | 1.5 |
| Edit | 194 | 1.1 |
| Write | 0 | 0.0 |
| **Tool Input Chars** | 46,694 | 259 |

### Tokens & Time

| Metric | Total | Avg/Run |
|--------|-------|---------|
| Input Tokens | 2,094,617 | 11,637 |
| Output Tokens | 35,295 | 196 |
| Total Tokens | 8,970,437 | 49,836 |
| Duration | 967.0s | 5.4s |
| **Avg Indent Score** | — | **1.60** |

## Task Results

| Task | File | Success | Edit Hit | R/E/W | Tokens (In/Out) | Time | Indent |
|------|------|---------|----------|-------|-----------------|------|--------|
| Access Remove Optional Chain 001 | registerDevToolsEventLogger.js | 0/3 ❌ | 75.0% | 1/1/0 | 14,095/190 | 6.2s | 0.67 |
| Access Remove Optional Chain 002 | TimelineContext.js | 1/3 ⚠️ | 100.0% | 1/1/0 | 4,364/141 | 3.8s | 1.28 |
| Access Remove Optional Chain 003 | astUtils.js | 1/3 ⚠️ | 100.0% | 1/1/0 | 22,746/137 | 4.8s | 4.80 |
| Call Swap Call Args 001 | testHelpers.js | 3/3 ✅ | 100.0% | 1/1/0 | 2,184/128 | 3.7s | 1.33 |
| Call Swap Call Args 002 | FlamegraphChartBuilder.js | 0/3 ❌ | 100.0% | 1/1/0 | 8,046/187 | 4.8s | 0.00 |
| Call Swap Call Args 003 | SyntheticEvent.js | 0/3 ❌ | 100.0% | 1/1/0 | 14,353/210 | 5.0s | 0.00 |
| Duplicate Duplicate Line Flip 001 | index.js | 3/3 ✅ | 100.0% | 1/1/0 | 2,224/136 | 3.4s | 0.00 |
| Duplicate Duplicate Line Flip 002 | ActivityList.js | 0/3 ❌ | 100.0% | 2/1/0 | 8,365/243 | 5.6s | 1.22 |
| Duplicate Duplicate Line Flip 003 | SyntheticEvent.js | 0/3 ❌ | 100.0% | 1/1/0 | 22,428/138 | 4.7s | 0.67 |
| Identifier Identifier Multi Edit 001 | TabBar.js | 1/3 ⚠️ | 60.0% | 1/2/0 | 14,381/233 | 6.5s | 2.10 |
| Identifier Identifier Multi Edit 002 | EventPluginRegistry.js | 1/3 ⚠️ | 66.7% | 1/3/0 | 30,563/414 | 10.6s | 2.48 |
| Identifier Identifier Multi Edit 003 | ReactPerformanceTrackProperties.js | 0/3 ❌ | 100.0% | 1/1/0 | 16,549/128 | 3.8s | 9.95 |
| Import Swap Named Imports 001 | CommitFlamegraphListItem.js | 1/3 ⚠️ | 100.0% | 1/1/0 | 6,298/152 | 4.1s | 2.89 |
| Import Swap Named Imports 002 | ReactDOMTextarea.js | 2/3 ⚠️ | 100.0% | 1/1/0 | 9,737/148 | 3.9s | 2.46 |
| Import Swap Named Imports 003 | StyleEditor.js | 0/3 ❌ | 100.0% | 6/1/0 | 13,072/389 | 8.7s | 0.44 |
| Literal Flip Boolean 001 | testHelpers.js | 3/3 ✅ | 100.0% | 1/1/0 | 2,901/130 | 3.3s | 1.30 |
| Literal Flip Boolean 002 | ReactNoopFlightServer.js | 1/3 ⚠️ | 100.0% | 1/1/0 | 5,037/145 | 4.2s | 1.11 |
| Literal Flip Boolean 003 | ReactFlightDOMClientEdge.js | 0/3 ❌ | 100.0% | 7/1/0 | 30,585/361 | 11.3s | 3.57 |
| Literal Off By One 001 | githubAPI.js | 1/3 ⚠️ | 100.0% | 1/1/0 | 8,523/170 | 6.3s | 0.69 |
| Literal Off By One 002 | code-path.js | 1/3 ⚠️ | 100.0% | 1/1/0 | 12,937/152 | 5.9s | 3.17 |
| Literal Off By One 003 | InspectedElement.js | 0/3 ❌ | 75.0% | 1/1/0 | 16,025/192 | 5.4s | 1.20 |
| Operator Remove Negation 001 | ReactDOMClient.js | 0/3 ❌ | 100.0% | 1/1/0 | 4,104/151 | 3.5s | 1.12 |
| Operator Remove Negation 002 | NativeEventsView.js | 1/3 ⚠️ | 100.0% | 1/1/0 | 16,257/166 | 5.8s | 1.00 |
| Operator Remove Negation 003 | ReactFlightUnbundledReferences.js | 0/3 ❌ | 100.0% | 1/1/0 | 20,232/193 | 6.8s | 0.65 |
| Operator Swap Arithmetic 001 | fallbackEvalContext.js | 3/3 ✅ | 100.0% | 1/1/0 | 19,014/154 | 5.5s | 0.07 |
| Operator Swap Arithmetic 002 | CSSShorthandProperty.js | 1/3 ⚠️ | 100.0% | 5/1/0 | 12,497/360 | 8.0s | 2.85 |
| Operator Swap Arithmetic 003 | hooks.js | 0/3 ❌ | 100.0% | 1/1/0 | 16,850/130 | 4.4s | 2.28 |
| Operator Swap Comparison 001 | index.js | 3/3 ✅ | 100.0% | 1/1/0 | 4,733/127 | 3.8s | 0.67 |
| Operator Swap Comparison 002 | ReactFlightDOMServerBrowser.js | 0/3 ❌ | 100.0% | 1/1/0 | 14,956/175 | 4.6s | 0.00 |
| Operator Swap Comparison 003 | ReactFlightDOMServerNode.js | 0/3 ❌ | 100.0% | 1/1/0 | 15,943/147 | 4.9s | 0.00 |
| Operator Swap Equality 001 | readInputData.js | 3/3 ✅ | 100.0% | 1/1/0 | 2,848/140 | 4.0s | 1.00 |
| Operator Swap Equality 002 | editor.js | 3/3 ✅ | 100.0% | 1/1/0 | 12,317/144 | 5.0s | 0.11 |
| Operator Swap Equality 003 | hooks.js | 0/3 ❌ | 100.0% | 1/1/0 | 15,669/152 | 3.6s | 2.27 |
| Operator Swap Increment Decrement 001 | ReactFlightDOMClientNode.js | 2/3 ⚠️ | 100.0% | 1/1/0 | 3,562/154 | 3.5s | 1.01 |
| Operator Swap Increment Decrement 002 | ReactFlightDOMClientNode.js | 2/3 ⚠️ | 100.0% | 1/1/0 | 7,789/155 | 4.3s | 1.88 |
| Operator Swap Increment Decrement 003 | loadSourceAndMetadata.js | 2/3 ⚠️ | 100.0% | 1/1/0 | 10,616/138 | 4.2s | 3.71 |
| Operator Swap Logical 001 | profiling.js | 2/3 ⚠️ | 100.0% | 1/1/0 | 2,045/135 | 4.1s | 0.00 |
| Operator Swap Logical 002 | SourceMapMetadataConsumer.js | 0/3 ❌ | 100.0% | 1/1/0 | 10,484/190 | 6.3s | 1.05 |
| Operator Swap Logical 003 | DevToolsFiberComponentStack.js | 1/3 ⚠️ | 60.0% | 2/2/0 | 9,884/240 | 5.6s | 2.63 |
| Operator Swap Nullish 001 | getBatchRange.js | 3/3 ✅ | 100.0% | 1/1/0 | 12,967/179 | 4.3s | 1.30 |
| Operator Swap Nullish 002 | EnterLeaveEventPlugin.js | 3/3 ✅ | 100.0% | 1/1/0 | 9,252/133 | 3.8s | 1.55 |
| Operator Swap Nullish 003 | backend.js | 2/3 ⚠️ | 100.0% | 1/1/0 | 13,676/138 | 4.8s | 2.15 |
| Regex Swap Regex Quantifier 001 | githubAPI.js | 1/3 ⚠️ | 100.0% | 1/1/0 | 5,618/158 | 4.5s | 0.25 |
| Regex Swap Regex Quantifier 002 | ReactFlightStackConfigV8.js | 0/3 ❌ | 100.0% | 1/1/0 | 10,202/200 | 6.4s | 0.00 |
| Regex Swap Regex Quantifier 003 | utils.js | 0/3 ❌ | 100.0% | 1/1/0 | 11,431/138 | 4.4s | 1.97 |
| Structural Delete Statement 001 | UnsupportedVersionDialog.js | 1/3 ⚠️ | 100.0% | 1/1/0 | 3,087/158 | 4.3s | 3.86 |
| Structural Delete Statement 002 | getComponentNameFromFiber.js | 0/3 ❌ | 100.0% | 1/1/0 | 5,173/207 | 4.7s | 0.62 |
| Structural Delete Statement 003 | simulateBrowserEventDispatch.js | 0/3 ❌ | 66.7% | 2/1/0 | 30,407/224 | 7.6s | 4.46 |
| Structural Remove Early Return 001 | InspectedElementStateTree.js | 0/3 ❌ | 100.0% | 2/1/0 | 14,633/221 | 7.1s | 0.24 |
| Structural Remove Early Return 002 | useCommitFilteringAndNavigation.js | 0/3 ❌ | 100.0% | 1/1/0 | 14,346/199 | 6.1s | 2.46 |
| Structural Remove Early Return 003 | ReactFiberAsyncAction.js | 0/3 ❌ | 100.0% | 6/1/0 | 16,152/463 | 9.2s | 1.47 |
| Structural Swap Adjacent Lines 001 | ReactServerConsoleConfigPlain.js | 3/3 ✅ | 100.0% | 3/1/0 | 5,799/260 | 6.9s | 1.00 |
| Structural Swap Adjacent Lines 002 | ReactNoopFlightServer.js | 0/3 ❌ | 60.0% | 1/2/0 | 2,860/262 | 5.7s | 0.00 |
| Structural Swap Adjacent Lines 003 | backend.js | 0/3 ❌ | 100.0% | 1/1/0 | 22,372/235 | 6.4s | 1.05 |
| Structural Swap If Else 001 | importFile.js | 0/3 ❌ | 100.0% | 1/1/0 | 8,388/208 | 5.0s | 0.00 |
| Structural Swap If Else 002 | ReactNativeFiberInspector.js | 0/3 ❌ | 100.0% | 1/1/0 | 4,816/269 | 5.0s | 2.12 |
| Structural Swap If Else 003 | ReactDOMFizzStaticNode.js | 0/3 ❌ | 85.7% | 2/2/0 | 20,535/504 | 7.5s | 0.00 |
| Unicode Unicode Hyphen 001 | Rectangle.js | 3/3 ✅ | 100.0% | 1/1/0 | 7,817/146 | 6.3s | 2.87 |
| Unicode Unicode Hyphen 002 | UnsupportedBridgeProtocolDialog.js | 3/3 ✅ | 100.0% | 1/1/0 | 1,990/152 | 3.5s | 3.77 |
| Unicode Unicode Hyphen 003 | ReactTypes.js | 3/3 ✅ | 100.0% | 1/1/0 | 11,471/137 | 5.1s | 1.24 |

## Category Summary

| Category | Runs | Verified | Edit Used | Success | Min/Avg/Max Difficulty |
|----------|------|----------|-----------|---------|------------------------|
| access | 9 | 22.2% (2/9) | 100.0% (9/9) | 22.2% (2/9) | 7 / 8.7 / 10 |
| call | 9 | 33.3% (3/9) | 100.0% (9/9) | 33.3% (3/9) | 6 / 7.7 / 10 |
| duplicate | 9 | 33.3% (3/9) | 100.0% (9/9) | 33.3% (3/9) | 7 / 9.7 / 12 |
| identifier | 9 | 22.2% (2/9) | 100.0% (9/9) | 22.2% (2/9) | 6 / 9.3 / 14 |
| import | 9 | 33.3% (3/9) | 100.0% (9/9) | 33.3% (3/9) | 2 / 4.7 / 6 |
| literal | 18 | 33.3% (6/18) | 94.4% (17/18) | 33.3% (6/18) | 4 / 6.2 / 9 |
| operator | 63 | 49.2% (31/63) | 96.8% (61/63) | 49.2% (31/63) | 1 / 6.5 / 13 |
| regex | 9 | 11.1% (1/9) | 100.0% (9/9) | 11.1% (1/9) | 6 / 7.3 / 8 |
| structural | 36 | 11.1% (4/36) | 94.4% (34/36) | 11.1% (4/36) | 4 / 7.6 / 15 |
| unicode | 9 | 100.0% (9/9) | 100.0% (9/9) | 100.0% (9/9) | 1 / 3.0 / 6 |

## Mutation Summary

| Mutation | Category | Runs | Verified | Edit Used | Success |
|----------|----------|------|----------|-----------|---------|
| delete-statement | structural | 9 | 11.1% (1/9) | 88.9% (8/9) | 11.1% (1/9) |
| duplicate-line-flip | duplicate | 9 | 33.3% (3/9) | 100.0% (9/9) | 33.3% (3/9) |
| flip-boolean | literal | 9 | 44.4% (4/9) | 88.9% (8/9) | 44.4% (4/9) |
| identifier-multi-edit | identifier | 9 | 22.2% (2/9) | 100.0% (9/9) | 22.2% (2/9) |
| off-by-one | literal | 9 | 22.2% (2/9) | 100.0% (9/9) | 22.2% (2/9) |
| remove-early-return | structural | 9 | 0.0% (0/9) | 88.9% (8/9) | 0.0% (0/9) |
| remove-negation | operator | 9 | 11.1% (1/9) | 100.0% (9/9) | 11.1% (1/9) |
| remove-optional-chain | access | 9 | 22.2% (2/9) | 100.0% (9/9) | 22.2% (2/9) |
| swap-adjacent-lines | structural | 9 | 33.3% (3/9) | 100.0% (9/9) | 33.3% (3/9) |
| swap-arithmetic | operator | 9 | 44.4% (4/9) | 88.9% (8/9) | 44.4% (4/9) |
| swap-call-args | call | 9 | 33.3% (3/9) | 100.0% (9/9) | 33.3% (3/9) |
| swap-comparison | operator | 9 | 33.3% (3/9) | 100.0% (9/9) | 33.3% (3/9) |
| swap-equality | operator | 9 | 66.7% (6/9) | 100.0% (9/9) | 66.7% (6/9) |
| swap-if-else | structural | 9 | 0.0% (0/9) | 100.0% (9/9) | 0.0% (0/9) |
| swap-increment-decrement | operator | 9 | 66.7% (6/9) | 100.0% (9/9) | 66.7% (6/9) |
| swap-logical | operator | 9 | 33.3% (3/9) | 100.0% (9/9) | 33.3% (3/9) |
| swap-named-imports | import | 9 | 33.3% (3/9) | 100.0% (9/9) | 33.3% (3/9) |
| swap-nullish | operator | 9 | 88.9% (8/9) | 88.9% (8/9) | 88.9% (8/9) |
| swap-regex-quantifier | regex | 9 | 11.1% (1/9) | 100.0% (9/9) | 11.1% (1/9) |
| unicode-hyphen | unicode | 9 | 100.0% (9/9) | 100.0% (9/9) | 100.0% (9/9) |

## Difficulty Summary

| Difficulty Score | Runs | Verified | Edit Used | Success |
|------------------|------|----------|-----------|---------|
| 0-2 | 18 | 72.2% (13/18) | 100.0% (18/18) | 72.2% (13/18) |
| 3-5 | 36 | 33.3% (12/36) | 97.2% (35/36) | 33.3% (12/36) |
| 6-8 | 72 | 38.9% (28/72) | 95.8% (69/72) | 38.9% (28/72) |
| 9+ | 54 | 20.4% (11/54) | 98.1% (53/54) | 20.4% (11/54) |

## Edit Tool Errors

Failures where the edit tool returned an error or failed to apply the patch.

### Access Remove Optional Chain 001 (registerDevToolsEventLogger.js)

#### Run 2

##### Attempt 1

- Path: registerDevToolsEventLogger.js
- Operation: —

**Tool error**

```
No changes made to registerDevToolsEventLogger.js. The edits produced identical content.
```

**Patch args**

```diff
{
  "path": "registerDevToolsEventLogger.js",
  "edits": [
    {
      "old": [
        "36:9ba4"
      ],
      "new": [
        "        currentLoggingIFrame.contentWindow?.postMessage("
      ]
    },
    {
      "old": [
        "37:a74c"
      ],
      "new": [
        "          {"
      ]
    }
  ]
}
```

### Identifier Identifier Multi Edit 001 (TabBar.js)

#### Run 2

##### Attempt 1

- Path: TabBar.js
- Operation: —

**Tool error**

```
Source lines must be consecutive. Got line 96 followed by 112.
```

**Patch args**

```diff
{
  "path": "TabBar.js",
  "edits": [
    {
      "old": [
        "96:ed75",
        "112:ad71"
      ],
      "new": [
        "96:ed75|         const {icon, id, label, title} = tab;",
        "112:ad71|               checked={currentTab === id}"
      ]
    }
  ]
}
```

#### Run 3

##### Attempt 1

- Path: TabBar.js
- Operation: —

**Tool error**

```
Source lines must be consecutive. Got line 21 followed by 96.
```

**Patch args**

```diff
{
  "path": "TabBar.js",
  "edits": [
    {
      "old": [
        "21:f352",
        "96:ed75",
        "112:ad71"
      ],
      "new": [
        "   id: string,",
        "         const {icon, id, label, title} = tab;",
        "               checked={currentTab === id}"
      ]
    }
  ]
}
```

### Identifier Identifier Multi Edit 002 (EventPluginRegistry.js)

#### Run 2

##### Attempt 1

- Path: EventPluginRegistry.js
- Operation: —

**Tool error**

```
Source lines must be consecutive. Got line 97 followed by 104.
```

**Patch args**

```diff
{
  "path": "EventPluginRegistry.js",
  "edits": [
    {
      "old": [
        "73:13ff",
        "95:054e",
        "115:98cf"
      ],
      "new": [
        "           eventName,",
        "  * @param {string} eventName Event name.",
        "           eventName,"
      ]
    },
    {
      "old": [
        "97:cc87",
        "104:2a3a"
      ],
      "new": [
        "   if (eventNameDispatchConfigs.hasOwnProperty(eventName)) {",
        "   eventNameDispatchConfigs[eventName] = dispatchConfig;"
      ]
    }
  ]
}
```

#### Run 3

##### Attempt 1

- Path: EventPluginRegistry.js
- Operation: —

**Tool error**

```
Source lines must be consecutive. Got line 73 followed by 95.
```

**Patch args**

```diff
{
  "path": "EventPluginRegistry.js",
  "edits": [
    {
      "old": [
        "73:13ff",
        "95:054e"
      ],
      "new": [
        "eventName"
      ]
    }
  ]
}
```

##### Attempt 2

- Path: EventPluginRegistry.js
- Operation: —

**Tool error**

```
Line 95 has changed since last read (expected 054e, got 31d5). Re-read the file.
```

**Patch args**

```diff
{
  "path": "EventPluginRegistry.js",
  "edits": [
    {
      "old": [
        "95:054e"
      ],
      "new": [
        "  eventName: string,\n"
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
Line 248 has changed since last read (expected eadb, got 2dfc). Re-read the file.
```

**Patch args**

```diff
{
  "path": "InspectedElement.js",
  "edits": [
    {
      "old": [
        "248:eadb"
      ],
      "new": [
        "  body = form;"
      ]
    }
  ]
}
```

### Operator Swap Logical 003 (DevToolsFiberComponentStack.js)

#### Run 2

##### Attempt 1

- Path: DevToolsFiberComponentStack.js
- Operation: —

**Tool error**

```
Line 222 has changed since last read (expected 421f, got 0611). Re-read the file.
```

**Patch args**

```diff
{
  "path": "DevToolsFiberComponentStack.js",
  "edits": [
    {
      "old": [
        "221:1edc"
      ],
      "new": [
        "  if (owner || ownerStack !== undefined) {"
      ]
    },
    {
      "old": [
        "222:421f"
      ],
      "new": [
        "    info += '\\n' + formatOwnerStack(ownerStack);"
      ]
    },
    {
      "old": [],
      "new": [
        "  }"
      ],
      "after": "222:421f"
    }
  ]
}
```

##### Attempt 2

- Path: DevToolsFiberComponentStack.js
- Operation: —

**Tool error**

```
Line 222 has changed since last read (expected 421f, got 0611). Re-read the file.
```

**Patch args**

```diff
{
  "path": "DevToolsFiberComponentStack.js",
  "edits": [
    {
      "old": [
        "221:1edc"
      ],
      "new": [
        "  if (owner || ownerStack !== undefined) {"
      ]
    },
    {
      "old": [
        "222:421f"
      ],
      "new": [
        "    info += '\\n' + formatOwnerStack(ownerStack);"
      ]
    },
    {
      "old": [],
      "new": [
        "  }"
      ],
      "after": "222:421f"
    }
  ]
}
```

### Structural Delete Statement 003 (simulateBrowserEventDispatch.js)

#### Run 2

##### Attempt 1

- Path: simulateBrowserEventDispatch.js
- Operation: —

**Tool error**

```
Line 89 has changed since last read (expected 52f0, got 0de9). Re-read the file.
```

**Patch args**

```diff
{
  "path": "simulateBrowserEventDispatch.js",
  "edits": [
    {
      "old": [
        "89:52f0",
        "90:0de9"
      ],
      "new": [
        "    const isActivationEvent = eventImpl.type === 'click' && eventImpl.isTrusted;",
        "    ",
        "    if (isActivationEvent && targetImpl._hasActivationBehavior) {",
        "      activationTarget = targetImpl;",
        "    }"
      ]
    }
  ]
}
```

### Structural Swap Adjacent Lines 002 (ReactNoopFlightServer.js)

#### Run 3

##### Attempt 1

- Path: ReactNoopFlightServer.js
- Operation: —

**Tool error**

```
No changes made to ReactNoopFlightServer.js. The edits produced identical content.
```

**Patch args**

```diff
{
  "path": "ReactNoopFlightServer.js",
  "edits": [
    {
      "old": [
        "46:89b7",
        "47:166d"
      ],
      "new": [
        "  flushBuffered(destination: Destination): void {},",
        "    return textEncoder.encode(content);"
      ]
    }
  ]
}
```

##### Attempt 2

- Path: ReactNoopFlightServer.js
- Operation: —

**Tool error**

```
No changes made to ReactNoopFlightServer.js. The edits produced identical content.
```

**Patch args**

```diff
{
  "path": "ReactNoopFlightServer.js",
  "edits": [
    {
      "old": [
        "47:166d"
      ],
      "new": [
        "    return textEncoder.encode(content);"
      ]
    },
    {
      "old": [
        "46:89b7"
      ],
      "new": [
        "  flushBuffered(destination: Destination): void {},"
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
Line 267 has changed since last read (expected d149, got 9808). Re-read the file.
```

**Patch args**

```diff
{
  "path": "ReactDOMFizzStaticNode.js",
  "edits": [
    {
      "old": [
        "262:150c",
        "263:9855",
        "264:d0c2",
        "265:3756",
        "266:726c",
        "267:d149",
        "268:45b0",
        "269:50c9",
        "270:e8f8",
        "271:4889",
        "272:ba46"
      ],
      "new": [
        "262:150c",
        "263:9855",
        "264:d0c2",
        "265:3756",
        "266:726c",
        "267:d149",
        "268:45b0",
        "269:50c9",
        "270:e8f8",
        "271:4889",
        "272:ba46"
      ],
      "after": "261:9d7e"
    },
    {
      "old": [
        "265:3756",
        "266:726c"
      ],
      "new": [
        "265:3756",
        "266:726c"
      ]
    },
    {
      "old": [
        "267:d149",
        "268:45b0",
        "269:50c9",
        "270:e8f8",
        "271:4889",
        "272:ba46"
      ],
      "new": [
        "272:ba46",
        "267:d149",
        "268:45b0",
        "269:50c9",
        "270:e8f8",
        "271:4889"
      ]
    }
  ]
}
```

## Flaky Tasks (partial passing)

### Access Remove Optional Chain 002 (TimelineContext.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 8,590 / 130 | 3.7s |
| 2 | ❌ | File mismatch for TimelineContext.js | 2,251 / 149 | 4.2s |
| 3 | ❌ | File mismatch for TimelineContext.js | 2,251 / 145 | 3.4s |

### Access Remove Optional Chain 003 (astUtils.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for astUtils.js | 8,951 / 153 | 4.2s |
| 2 | ✅ | — | 31,982 / 120 | 5.9s |
| 3 | ❌ | File mismatch for astUtils.js | 27,304 / 139 | 4.5s |

### Identifier Identifier Multi Edit 001 (TabBar.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for TabBar.js | 10,881 / 190 | 7.0s |
| 2 | ❌ | File mismatch for TabBar.js | 30,398 / 244 | 7.7s |
| 3 | ✅ | — | 1,863 / 265 | 4.8s |

### Identifier Identifier Multi Edit 002 (EventPluginRegistry.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 5,392 / 232 | 5.1s |
| 2 | ❌ | File mismatch for EventPluginRegistry.js | 27,156 / 556 | 10.5s |
| 3 | ❌ | File mismatch for EventPluginRegistry.js | 59,142 / 455 | 16.2s |

### Import Swap Named Imports 001 (CommitFlamegraphListItem.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 6,374 / 164 | 3.7s |
| 2 | ❌ | File mismatch for CommitFlamegraphListItem.js | 1,876 / 138 | 4.8s |
| 3 | ❌ | File mismatch for CommitFlamegraphListItem.js | 10,643 / 154 | 3.7s |

### Import Swap Named Imports 002 (ReactDOMTextarea.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 15,689 / 178 | 3.8s |
| 2 | ✅ | — | 6,764 / 126 | 3.7s |
| 3 | ❌ | File mismatch for ReactDOMTextarea.js | 6,758 / 140 | 4.1s |

### Literal Flip Boolean 002 (ReactNoopFlightServer.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 9,258 / 185 | 6.0s |
| 2 | ❌ | File mismatch for ReactNoopFlightServer.js | 4,030 / 127 | 3.5s |
| 3 | ❌ | File mismatch for ReactNoopFlightServer.js | 1,823 / 122 | 3.1s |

### Literal Off By One 001 (githubAPI.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 13,582 / 132 | 4.6s |
| 2 | ❌ | File mismatch for githubAPI.js | 11,641 / 221 | 8.5s |
| 3 | ❌ | File mismatch for githubAPI.js | 347 / 157 | 5.8s |

### Literal Off By One 002 (code-path.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for code-path.js | 2,991 / 121 | 3.6s |
| 2 | ❌ | File mismatch for code-path.js | 21,132 / 151 | 4.0s |
| 3 | ✅ | — | 14,687 / 183 | 10.1s |

### Operator Remove Negation 002 (NativeEventsView.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for NativeEventsView.js | 8,837 / 152 | 4.4s |
| 2 | ❌ | File mismatch for NativeEventsView.js | 18,078 / 166 | 6.5s |
| 3 | ✅ | — | 21,857 / 179 | 6.5s |

### Operator Swap Arithmetic 002 (CSSShorthandProperty.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for CSSShorthandProperty.js | 2,510 / 135 | 4.3s |
| 2 | ❌ | File mismatch for CSSShorthandProperty.js | 29,816 / 809 | 16.0s |
| 3 | ✅ | — | 5,164 / 137 | 3.7s |

### Operator Swap Increment Decrement 001 (ReactFlightDOMClientNode.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 2,045 / 183 | 3.3s |
| 2 | ❌ | File mismatch for ReactFlightDOMClientNode.js | 1,786 / 135 | 3.8s |
| 3 | ✅ | — | 6,856 / 143 | 3.4s |

### Operator Swap Increment Decrement 002 (ReactFlightDOMClientNode.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 3,833 / 139 | 4.7s |
| 2 | ✅ | — | 6,587 / 146 | 3.5s |
| 3 | ❌ | File mismatch for ReactFlightDOMClientNode.js | 12,947 / 181 | 4.6s |

### Operator Swap Increment Decrement 003 (loadSourceAndMetadata.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for loadSourceAndMetadata.js | 6,947 / 136 | 4.7s |
| 2 | ✅ | — | 17,916 / 148 | 4.4s |
| 3 | ✅ | — | 6,985 / 130 | 3.4s |

### Operator Swap Logical 001 (profiling.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 2,711 / 133 | 4.6s |
| 2 | ❌ | File mismatch for profiling.js | 2,711 / 127 | 3.8s |
| 3 | ✅ | — | 712 / 146 | 4.0s |

### Operator Swap Logical 003 (DevToolsFiberComponentStack.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for DevToolsFiberComponentStack.js | 13,516 / 122 | 3.4s |
| 2 | ❌ | File mismatch for DevToolsFiberComponentStack.js | 9,296 / 437 | 9.3s |
| 3 | ✅ | — | 6,841 / 161 | 4.0s |

### Operator Swap Nullish 003 (backend.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for backend.js | 18,702 / 132 | 5.3s |
| 2 | ✅ | — | 14,914 / 120 | 3.9s |
| 3 | ✅ | — | 7,413 / 162 | 5.1s |

### Regex Swap Regex Quantifier 001 (githubAPI.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 11,315 / 215 | 6.6s |
| 2 | ❌ | File mismatch for githubAPI.js | 4,444 / 128 | 2.8s |
| 3 | ❌ | File mismatch for githubAPI.js | 1,095 / 132 | 4.0s |

### Structural Delete Statement 001 (UnsupportedVersionDialog.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for UnsupportedVersionDialog.js | 1,111 / 171 | 4.6s |
| 2 | ✅ | — | 1,111 / 141 | 4.4s |
| 3 | ❌ | File mismatch for UnsupportedVersionDialog.js | 7,040 / 162 | 3.7s |

## Failed Tasks (0% passing)

### Access Remove Optional Chain 001 (registerDevToolsEventLogger.js) — 0/3

**All runs failed with same error:** File mismatch for registerDevToolsEventLogger.js

**Sample agent response (run 1):**
```
Fixed the removed optional chaining on line 36 (`currentLoggingIFrame.contentWindow.postMessage` → `currentLoggingIFrame.contentWindow?.postMessage` and adjusted indentation).
```

**Diff (expected vs actual):**
```diff
@@ -31 @@
         const additionalContext: LoggerContext | {} =
           fetchAdditionalContext != null ? await fetchAdditionalContext() : {};
 
-        currentLoggingIFrame?.contentWindow?.postMessage(
+        currentLoggingIFrame.contentWindow.postMessage(
           {
             source: 'react-devtools-logging',
             event: eventWithoutMetadata,
```

### Call Swap Call Args 002 (FlamegraphChartBuilder.js) — 0/3

**All runs failed with same error:** File mismatch for FlamegraphChartBuilder.js

**Sample agent response (run 1):**
```
Fixed. The swapped arguments to `walkTree` in the recursive call within `getChartData` (lines 131-134) have been restored to their original order: `rightOffset, childID, currentDepth + 1`. No other changes made.
```

**Diff (expected vs actual):**
```diff
@@ -7 @@
  * @flow
  */
 
-import { formatDuration } from './utils';
+import {formatDuration} from './utils';
 import ProfilerStore from 'react-devtools-shared/src/devtools/ProfilerStore';
 
 import ProfilerStore from 'react-devtools-shared/src/devtools/ProfilerStore';
 
-import type { CommitTree } from './types';
+import type {CommitTree} from './types';
 
 export type ChartNode = {
   actualDuration: number,
@@ -47 @@
 }): ChartData {
   const commitDatum = profilerStore.getCommitData(rootID, commitIndex);
 
-  const { fiberActualDurations, fiberSelfDurations } = commitDatum;
-  const { nodes } = commitTree;
+  const {fiberActualDurations, fiberSelfDurations} = commitDatum;
+  const {nodes} = commitTree;
 
   const chartDataKey = `${rootID}-${commitIndex}`;
   if (cachedChartData.has(chartDataKey)) {
@@ -63 @@
   let maxSelfDuration = 0;
 
   // Generate flame graph structure using tree base durations.
-  const walkTree = (id: number, rightOffset: number, currentDepth: number): ChartNode => {
-    idToDepthMap.set(id, currentDepth);
+  const walkTree = (
+    id: number,
+    rightOffset: number,
+    currentDepth: number,
+  ): ChartNode => {
+    idToDepthMap.set(currentDepth, id);
 
     const node = nodes.get(id);
     if (node == null) {
@@ -71 @@
       throw Error(`Could not find node with id "${id}" in commit tree`);
     }
 
-    const { children, displayName, hocDisplayNames, key, treeBaseDuration, compiledWithForget } =
-      node;
+    const {
+      children,
+      displayName,
+      hocDisplayNames,
+      key,
+      treeBaseDuration,
+      compiledWithForget,
+    } = node;
 
     const actualDuration = fiberActualDurations.get(id) || 0;
     const selfDuration = fiberSelfDurations.get(id) || 0;
@@ -90 @@
 
     let label = `${maybeForgetBadge}${name}${maybeBadge}${maybeKey}`;
     if (didRender) {
-      label += ` (${formatDuration(selfDuration)}ms of ${formatDuration(actualDuration)}ms)`;
+      label += ` (${formatDuration(selfDuration)}...
```

### Call Swap Call Args 003 (SyntheticEvent.js) — 0/3

**All runs failed with same error:** File mismatch for SyntheticEvent.js

**Sample agent response (run 1):**
```
Fixed the swapped arguments in the `SyntheticEvent` constructor calls: `dispatchConfig` and `targetInst` were swapped (now in correct order); `nativeEvent` and `nativeEventTarget` were swapped (now in correct order). Also adjusted the assignment in the constructor body to use the correct parameter (`nativeEventTarget`).
```

**Diff (expected vs actual):**
```diff
@@ -58 @@
  * @param {object} nativeEvent Native browser event.
  * @param {DOMEventTarget} nativeEventTarget Target node.
  */
-function SyntheticEvent(dispatchConfig, targetInst, nativeEvent, nativeEventTarget) {
+function SyntheticEvent(
+  dispatchConfig,
+  targetInst,
+  nativeEvent,
+  nativeEventTarget,
+) {
   if (__DEV__) {
     // these have a getter/setter for warnings
     delete this.nativeEvent;
@@ -191 @@
       Object.defineProperty(
         this,
         'isDefaultPrevented',
-        getPooledWarningPropertyDefinition('isDefaultPrevented', functionThatReturnsFalse),
+        getPooledWarningPropertyDefinition(
+          'isDefaultPrevented',
+          functionThatReturnsFalse,
+        ),
       );
       Object.defineProperty(
         this,
@@ -196 @@
       Object.defineProperty(
         this,
         'isPropagationStopped',
-        getPooledWarningPropertyDefinition('isPropagationStopped', functionThatReturnsFalse),
+        getPooledWarningPropertyDefinition(
+          'isPropagationStopped',
+          functionThatReturnsFalse,
+        ),
       );
       Object.defineProperty(
         this,
@@ -250 @@
 function getPooledWarningPropertyDefinition(propName, getVal) {
   function set(val) {
     const action = isFunction ? 'setting the method' : 'setting the property';
-    warn(action, 'This is effectively a no-op');
+    warn('This is effectively a no-op', action);
     return val;
   }
 
@@ -255 @@
   }
 
   function get() {
-    const action = isFunction ? 'accessing the method' : 'accessing the property';
-    const result = isFunction ? 'This is a no-op function' : 'This is set to null';
+    const action = isFunction
+      ? 'accessing the method'
+      : 'accessing the property';
+    const result = isFunction
+      ? 'This is a no-op function'
+      : 'This is set to null';
     warn(action, result);
     return getVal;
   }
@@ -282 @@
   };
 }
 
-function createOrGetPooledEvent(dispatchConfig, targetInst, nativeEvent...
```

### Duplicate Duplicate Line Flip 002 (ActivityList.js) — 0/3

**All runs failed with same error:** File mismatch for ActivityList.js

**Sample agent response (run 1):**
```
Fixed the duplicated line in `ActivityList.js` (line 152: corrected the operator in the `findIndex` callback to `===` instead of `!==`).
```

**Diff (expected vs actual):**
```diff
@@ -18 @@
 import type Store from 'react-devtools-shared/src/devtools/store';
 
 import * as React from 'react';
-import { useContext, useMemo, useTransition } from 'react';
+import {useContext, useMemo, useTransition} from 'react';
 import {
   ComponentFilterActivitySlice,
   ElementTypeActivity,
@@ -24 @@
   ElementTypeActivity,
 } from 'react-devtools-shared/src/frontend/types';
 import styles from './ActivityList.css';
-import { TreeStateContext, TreeDispatcherContext } from '../Components/TreeContext';
-import { useHighlightHostInstance } from '../hooks';
-import { StoreContext } from '../context';
+import {
+  TreeStateContext,
+  TreeDispatcherContext,
+} from '../Components/TreeContext';
+import {useHighlightHostInstance} from '../hooks';
+import {StoreContext} from '../context';
 
 
-export function useChangeActivitySliceAction(): (id: Element['id'] | null) => void {
+export function useChangeActivitySliceAction(): (
+  id: Element['id'] | null,
+) => void {
   const store = useContext(StoreContext);
 
   function changeActivitySliceAction(activityID: Element['id'] | null) {
@@ -61 @@
   return changeActivitySliceAction;
 }
 
-function findNearestActivityParentID(elementID: Element['id'], store: Store): Element['id'] | null {
+function findNearestActivityParentID(
+  elementID: Element['id'],
+  store: Store,
+): Element['id'] | null {
   let currentID: null | Element['id'] = elementID;
   while (currentID !== null) {
     const element = store.getElementByID(currentID);
@@ -78 @@
 }
 
 function useSelectedActivityID(): Element['id'] | null {
-  const { inspectedElementID } = useContext(TreeStateContext);
+  const {inspectedElementID} = useContext(TreeStateContext);
   const store = useContext(StoreContext);
   return useMemo(() => {
     if (inspectedElementID === null) {
@@ -84 @@
     if (inspectedElementID === null) {
       return null;
     }
-    const nearestActivityID = findNearestActivityParentID(inspectedElementID, store);
+    const nearestA...
```

### Duplicate Duplicate Line Flip 003 (SyntheticEvent.js) — 0/3

**All runs failed with same error:** File mismatch for SyntheticEvent.js

**Sample agent response (run 1):**
```
Fixed the bug in `SyntheticEvent.js` by correcting the duplicated typeof check in the `preventDefault` method from `'unknown'` to `'undefined'` for proper IE compatibility.
```

**Diff (expected vs actual):**
```diff
@@ -95 @@
       if (event.preventDefault) {
         event.preventDefault();
         // $FlowFixMe[illegal-typeof] - flow is not aware of `unknown` in IE
-      } else if (typeof event.returnValue !== 'unknown') {
+      } else if (typeof event.returnValue !== 'undefined') {
         event.returnValue = false;
       }
       this.isDefaultPrevented = functionThatReturnsTrue;
@@ -448 @@
 
     // KeyPress is deprecated, but its replacement is not yet final and not
     // implemented in any major browser. Only KeyPress has charCode.
-    if (event.type === 'keypress') {
+    if (event.type !== 'keypress') {
       return getEventCharCode(
         // $FlowFixMe[incompatible-call] unable to narrow to `KeyboardEvent`
         event,
```

### Identifier Identifier Multi Edit 003 (ReactPerformanceTrackProperties.js) — 0/3

**All runs failed with same error:** File mismatch for ReactPerformanceTrackProperties.js

**Sample agent response (run 1):**
```
Fixed: Corrected the misspelled constant identifier from `DADED` to `ADDED` in the declaration and all usages.
```

**Diff (expected vs actual):**
```diff
@@ -229 @@
 }
 
 const REMOVED = '\u2013\xa0';
-const ADDED = '+\xa0';
+const ADDED = '+ ';
 const UNCHANGED = '\u2007\xa0';
 
 export function addObjectDiffToProperties(
@@ -305 @@
               const typeName = getComponentNameFromType(nextValue.type) || '\u2026';
               const line = '\xa0\xa0'.repeat(indent) + key;
               const desc = '<' + typeName + ' \u2026 />';
-              properties.push([REMOVED + line, desc], [ADDED + line, desc]);
+              properties.push([REMOVED + line, desc], [DADED + line, desc]);
               isDeeplyEqual = false;
               continue;
             }
@@ -373 @@
         isDeeplyEqual = false;
       }
     } else {
-      properties.push([ADDED + '\xa0\xa0'.repeat(indent) + key, '\u2026']);
+      properties.push([DADED + '\xa0\xa0'.repeat(indent) + key, '\u2026']);
       isDeeplyEqual = false;
     }
 
```

### Import Swap Named Imports 003 (StyleEditor.js) — 0/3

**All runs failed with same error:** File mismatch for StyleEditor.js

**Sample agent response (run 1):**
```
Fixed the swapped import names in line 11 of StyleEditor.js by reordering the React hooks to match their module export order: `useState` before `useMemo`.
```

**Diff (expected vs actual):**
```diff
@@ -8 @@
  */
 
 import * as React from 'react';
-import { useContext, useMemo, useRef, useState } from 'react';
+import { useState, useMemo, useContext, useRef } from 'react';
 import { copy } from 'clipboard-js';
 import { BridgeContext, StoreContext } from 'react-devtools-shared/src/devtools/views/context';
 import Button from '../../Button';
```

### Literal Flip Boolean 003 (ReactFlightDOMClientEdge.js) — 0/3

**All runs failed with same error:** File mismatch for ReactFlightDOMClientEdge.js

**Sample agent response (run 1):**
```
The file ReactFlightDOMClientEdge.js appears to have no inverted boolean literals causing a bug. No changes made.

If this is not the correct file or the bug is elsewhere, provide more details (e.g., error message, line number, or symptoms).
```

**Diff (expected vs actual):**
```diff
@@ -100 @@
     typeof options.nonce === 'string' ? options.nonce : undefined,
     options && options.temporaryReferences ? options.temporaryReferences : undefined,
     __DEV__ && options && options.findSourceMapURL ? options.findSourceMapURL : undefined,
-    __DEV__ && options ? options.replayConsoleLogs === true : false, // defaults to false
+    __DEV__ && options ? options.replayConsoleLogs === false : false, // defaults to false
     __DEV__ && options && options.environmentName ? options.environmentName : undefined,
     __DEV__ && options && options.startTime != null ? options.startTime : undefined,
     __DEV__ && options && options.endTime != null ? options.endTime : undefined,
```

### Literal Off By One 003 (InspectedElement.js) — 0/3

**All runs failed with same error:** File mismatch for InspectedElement.js

**Sample agent response (run 1):**
```
### Fix Applied

Changed the off-by-one error in the StrictMode non-compliant class condition from `element.parentID !== 0` to `element.parentID !== 1` on line 248.

**Commit message:**  
fix(InspectedElement.js): correct off-by-one in StrictMode parentID check

**Verification:**  
Inspect a StrictMode non-compliant component with parentID=1; confirm the warning badge and class are applied correctly. Test with parentID=0 to ensure no badge.
```

**Diff (expected vs actual):**
```diff
@@ -179 @@
   }
 
   let strictModeBadge = null;
-  if (element.isStrictModeNonCompliant && element.parentID !== 0) {
+  if (element.isStrictModeNonCompliant && element.parentID !== 1) {
     strictModeBadge = (
       <Tooltip label="This component is not running in StrictMode. Click to learn more.">
         <a
@@ -224 @@
         <div className={styles.SelectedComponentName}>
           <div
             className={
-              element.isStrictModeNonCompliant && element.parentID !== 0
+              element.isStrictModeNonCompliant && element.parentID !== 1
                 ? `${styles.ComponentName} ${styles.StrictModeNonCompliantComponentName}`
                 : styles.ComponentName
             }
```

### Operator Remove Negation 001 (ReactDOMClient.js) — 0/3

**All runs failed with same error:** File mismatch for ReactDOMClient.js

**Sample agent response (run 1):**
```
Fixed: Removed stray logical negation `!` from `canUseDOM` on line 57, changing `if (foundDevTools && !canUseDOM && window.top === window.self)` to `if (foundDevTools && canUseDOM && window.top === window.self)`.
```

**Diff (expected vs actual):**
```diff
@@ -49 @@
 const foundDevTools = injectIntoDevTools();
 
 if (__DEV__) {
-  if (!foundDevTools && canUseDOM && window.top === window.self) {
+  if ((foundDevTools && !canUseDOM) || window.top !== window.self) {
     // If we're in Chrome or Firefox, provide a download link if not installed.
     if (
       (navigator.userAgent.indexOf('Chrome') > -1 && navigator.userAgent.indexOf('Edge') === -1) ||
```

### Operator Remove Negation 003 (ReactFlightUnbundledReferences.js) — 0/3

**All runs failed with same error:** File mismatch for ReactFlightUnbundledReferences.js

**Sample agent response (run 1):**
```
Fixed the bug in `ReactFlightUnbundledReferences.js` by replacing the accidental `undefined` return (which could trigger negation issues in calling code) with an empty object `{}` in the `.then` handler for non-async client modules. This preserves the expected non-function, non-nullish value while making the minimum necessary change.
```

**Diff (expected vs actual):**
```diff
@@ -7 @@
  * @flow
  */
 
-import type { ReactClientValue } from 'react-server/src/ReactFlightServer';
+import type {ReactClientValue} from 'react-server/src/ReactFlightServer';
 
 export type ServerReference<T: Function> = T & {
   $$typeof: symbol,
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
 
@@ -71 @@
       }
     }
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
+            bind: {value: bind, configurable: true},
           }
         : {
             $$typeof,
@@ -91 @@
             $$typeof,
             $$id,
             $$bound,
-            bind: { value: bind, configurable: true },
+            bind: {value: bind, configurable: true},
           }) as PropertyDescriptorMap,
     );
   }
@@ -109 @@
   id: string,
   exportName: null | string,
 ): ServerReference<T> {
-  const $$typeof = { va...
```

### Operator Swap Arithmetic 003 (hooks.js) — 0/3

**All runs failed with same error:** File mismatch for hooks.js

**Sample agent response (run 1):**
```
Fixed: Swapped `<=` to `<` in the arithmetic comparison on line 129 of `hooks.js` in the `useIsOverflowing` hook. This correctly detects overflow when the container width is strictly less than the total child width.
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

### Operator Swap Comparison 002 (ReactFlightDOMServerBrowser.js) — 0/3

**All runs failed with same error:** File mismatch for ReactFlightDOMServerBrowser.js

**Sample agent response (run 1):**
```
Fixed the buggy comparison in `startReadingFromDebugChannelReadableStream` by changing `stringBuffer += done ? ... : ...;` to `stringBuffer += !done ? ... : ...;`. This ensures the buffer is appended only for non-done chunks, with final processing for done.
```

**Diff (expected vs actual):**
```diff
@@ -7 @@
  * @flow
  */
 
-import type { Request, ReactClientValue } from 'react-server/src/ReactFlightServer';
-import type { Thenable } from 'shared/ReactTypes';
-import type { ClientManifest } from './ReactFlightServerConfigWebpackBundler';
-import type { ServerManifest } from 'react-client/src/ReactFlightClientConfig';
+import type {
+  Request,
+  ReactClientValue,
+} from 'react-server/src/ReactFlightServer';
+import type {Thenable} from 'shared/ReactTypes';
+import type {ClientManifest} from './ReactFlightServerConfigWebpackBundler';
+import type {ServerManifest} from 'react-client/src/ReactFlightClientConfig';
 
 import {
   createRequest,
@@ -24 @@
   closeDebugChannel,
 } from 'react-server/src/ReactFlightServer';
 
-import { createResponse, close, getRoot } from 'react-server/src/ReactFlightReplyServer';
+import {
+  createResponse,
+  close,
+  getRoot,
+} from 'react-server/src/ReactFlightReplyServer';
 
 
-import { decodeAction, decodeFormState } from 'react-server/src/ReactFlightActionServer';
+import {
+  decodeAction,
+  decodeFormState,
+} from 'react-server/src/ReactFlightActionServer';
 
 export {
   registerServerReference,
@@ -40 @@
   readFinalStringChunk,
 } from 'react-client/src/ReactFlightClientStreamConfigWeb';
 
-import type { TemporaryReferenceSet } from 'react-server/src/ReactFlightServerTemporaryReferences';
+import type {TemporaryReferenceSet} from 'react-server/src/ReactFlightServerTemporaryReferences';
 
 
-export { createTemporaryReferenceSet } from 'react-server/src/ReactFlightServerTemporaryReferences';
+export {createTemporaryReferenceSet} from 'react-server/src/ReactFlightServerTemporaryReferences';
 
 
-export type { TemporaryReferenceSet };
+export type {TemporaryReferenceSet};
 
 type Options = {
 
 type Options = {
-  debugChannel?: { readable?: ReadableStream, writable?: WritableStream, ... },
+  debugChannel?: {readable?: ReadableStream, writable?: WritableStream, ...},
   environmentName?: string | (() => string),
  ...
```

### Operator Swap Comparison 003 (ReactFlightDOMServerNode.js) — 0/3

**All runs failed with same error:** File mismatch for ReactFlightDOMServerNode.js

**Sample agent response (run 1):**
```
Fixed: Corrected the comparison on line 602 of `ReactFlightDOMServerNode.js` from `pendingFiles == 0` to `pendingFiles === 0` (strict equality).
```

**Diff (expected vs actual):**
```diff
@@ -7 @@
  * @flow
  */
 
-import type { Request, ReactClientValue } from 'react-server/src/ReactFlightServer';
-import type { Destination } from 'react-server/src/ReactServerStreamConfigNode';
-import type { Busboy } from 'busboy';
-import type { Writable } from 'stream';
-import type { ReactFormState, Thenable } from 'shared/ReactTypes';
 import type {
 import type {
+  Request,
+  ReactClientValue,
+} from 'react-server/src/ReactFlightServer';
+import type {Destination} from 'react-server/src/ReactServerStreamConfigNode';
+import type {Busboy} from 'busboy';
+import type {Writable} from 'stream';
+import type {ReactFormState, Thenable} from 'shared/ReactTypes';
+import type {
   ServerManifest,
   ServerReferenceId,
 } from '../client/ReactFlightClientConfigBundlerParcel';
@@ -17 @@
   ServerReferenceId,
 } from '../client/ReactFlightClientConfigBundlerParcel';
 
-import type { Duplex } from 'stream';
+import type {Duplex} from 'stream';
 
 
-import { Readable } from 'stream';
+import {Readable} from 'stream';
 
 
-import { ASYNC_ITERATOR } from 'shared/ReactSymbols';
+import {ASYNC_ITERATOR} from 'shared/ReactSymbols';
 
 import {
   createRequest,
@@ -58 @@
   resolveServerReference,
 } from '../client/ReactFlightClientConfigBundlerParcel';
 
-export { createClientReference, registerServerReference } from '../ReactFlightParcelReferences';
+export {
+  createClientReference,
+  registerServerReference,
+} from '../ReactFlightParcelReferences';
 
 import {
   createStringDecoder,
@@ -66 @@
   readFinalStringChunk,
 } from 'react-client/src/ReactFlightClientStreamConfigNode';
 
-import { textEncoder } from 'react-server/src/ReactServerStreamConfigNode';
+import {textEncoder} from 'react-server/src/ReactServerStreamConfigNode';
 
 
-import type { TemporaryReferenceSet } from 'react-server/src/ReactFlightServerTemporaryReferences';
+import type {TemporaryReferenceSet} from 'react-server/src/ReactFlightServerTemporaryReferences';
 
 
-export { createTemporaryRefer...
```

### Operator Swap Equality 003 (hooks.js) — 0/3

**All runs failed with same error:** File mismatch for hooks.js

**Sample agent response (run 1):**
```
**Fix applied:** Changed `container.clientWidth <= totalChildWidth` to `container.clientWidth < totalChildWidth` on line 129 in the `useIsOverflowing` hook. This correctly sets `isOverflowing` to `true` only when content exceeds the container width (strict overflow), fixing the inverted logic that treated exact fit as overflowing.

The hook now accurately detects overflow for scrolling purposes. No other changes were made.
```

**Diff (expected vs actual):**
```diff
@@ -118 @@
 
     const container = ((containerRef.current: any): HTMLDivElement);
 
-    const handleResize = () => setIsOverflowing(container.clientWidth <= totalChildWidth);
+    const handleResize = () => setIsOverflowing(container.clientWidth < totalChildWidth);
 
     handleResize();
 
@@ -399 @@
     (id: number) => {
       const element = store.getElementByID(id);
       const rendererID = store.getRendererIDForElement(id);
-      if (element !== null && rendererID !== null) {
+      if (element !== null && rendererID === null) {
         bridge.send('scrollToHostInstance', {
           id,
           rendererID,
```

### Operator Swap Logical 002 (SourceMapMetadataConsumer.js) — 0/3

**All runs failed with same error:** File mismatch for SourceMapMetadataConsumer.js

**Sample agent response (run 1):**
```
Fixed the incorrect `&&` to `||` on lines 157-158 in `SourceMapMetadataConsumer.js` to properly check for the presence and non-null value of the React sources extension key.
```

**Diff (expected vs actual):**
```diff
@@ -7 @@
  * @flow strict-local
  */
 
-import type { Position } from './astUtils';
+import type {Position} from './astUtils';
 import type {
   ReactSourceMetadata,
   IndexSourceMap,
@@ -14 @@
   BasicSourceMap,
   MixedSourceMap,
 } from './SourceMapTypes';
-import type { HookMap } from './generateHookMap';
+import type {HookMap} from './generateHookMap';
 import * as util from 'source-map-js/lib/util';
 import * as util from 'source-map-js/lib/util';
-import { decodeHookMap } from './generateHookMap';
-import { getHookNameForLocation } from './getHookNameForLocation';
+import {decodeHookMap} from './generateHookMap';
+import {getHookNameForLocation} from './getHookNameForLocation';
 
 type MetadataMap = Map<string, ?ReactSourceMetadata>;
 
@@ -31 @@
  * By default, source names are normalized using the same logic that the `source-map-js@0.6.2` package uses internally.
  * This is crucial for keeping the sources list in sync with a `SourceMapConsumer` instance.
  */
-function normalizeSourcePath(sourceInput: string, map: { +sourceRoot?: ?string, ... }): string {
-  const { sourceRoot } = map;
+function normalizeSourcePath(
+  sourceInput: string,
+  map: {+sourceRoot?: ?string, ...},
+): string {
+  const {sourceRoot} = map;
   let source = sourceInput;
 
   source = String(source);
@@ -45 @@
   // be particularly problematic when the source root is a prefix of the
   // source (valid, but why??). See github issue #199 and bugzil.la/1188982.
   source =
-    sourceRoot != null && util.isAbsolute(sourceRoot) && util.isAbsolute(source)
+    sourceRoot != null && util.isAbsolute(sourceRoot) || util.isAbsolute(source)
       ? util.relative(sourceRoot, source)
       : source;
   return util.computeSourceURL(sourceRoot, source);
@@ -76 @@
    * `SourceMapConsumer#originalPositionFor` to retrieve a source location,
    * then pass that location to `hookNameFor`.
    */
-  hookNameFor({ line, column, source }: { ...Position, +source: ?string }): ?string {
+  hookNam...
```

### Regex Swap Regex Quantifier 002 (ReactFlightStackConfigV8.js) — 0/3

**All runs failed with same error:** File mismatch for ReactFlightStackConfigV8.js

**Sample agent response (run 1):**
```
Fixed the swapped quantifier in the regex (changed `*` to `+` for whitespace matching before "at"). This ensures it matches exactly four spaces as in V8 stack traces, without allowing zero spaces.

Commit message: `fix(ReactFlightStackConfigV8.js): correct regex quantifier for whitespace matching`
```

**Diff (expected vs actual):**
```diff
@@ -7 @@
  * @flow
  */
 
-import type { ReactStackTrace } from 'shared/ReactTypes';
+import type {ReactStackTrace} from 'shared/ReactTypes';
 
 let framesToSkip: number = 0;
 let collectedStackTrace: null | ReactStackTrace = null;
@@ -20 @@
   const functionName = callSite.getFunctionName();
   let result = '';
   if (functionName) {
-    if (typeName && identifierRegExp.test(functionName) && functionName !== typeName) {
+    if (
+      typeName &&
+      identifierRegExp.test(functionName) &&
+      functionName !== typeName
+    ) {
       result += typeName + '.';
     }
     result += functionName;
@@ -45 @@
   return result;
 }
 
-function collectStackTracePrivate(error: Error, structuredStackTrace: CallSite[]): string {
+function collectStackTracePrivate(
+  error: Error,
+  structuredStackTrace: CallSite[],
+): string {
   const result: ReactStackTrace = [];
   // Collect structured stack traces from the callsites.
   // We mirror how V8 serializes stack frames and how we later parse them.
@@ -95 @@
           : 0;
       // $FlowFixMe[prop-missing]
       const isAsync = callSite.isAsync();
-      result.push([name, filename, line, col, enclosingLine, enclosingCol, isAsync]);
+      result.push([
+        name,
+        filename,
+        line,
+        col,
+        enclosingLine,
+        enclosingCol,
+        isAsync,
+      ]);
     }
   }
   collectedStackTrace = result;
@@ -102 @@
   return '';
 }
 
-function collectStackTrace(error: Error, structuredStackTrace: CallSite[]): string {
+function collectStackTrace(
+  error: Error,
+  structuredStackTrace: CallSite[],
+): string {
   collectStackTracePrivate(error, structuredStackTrace);
   // At the same time we generate a string stack trace just in case someone
   // else reads it. Ideally, we'd call the previous prepareStackTrace to
@@ -126 @@
 //     at filename:0:0
 //     at async filename:0:0
 const frameRegExp =
-  /^ {3} at (?:(.+) \((?:(.+):(\d+):(\d+)|\<anonymous\>)\)|(?:async )?(.+):(\d+...
```

### Regex Swap Regex Quantifier 003 (utils.js) — 0/3

**All runs failed with same error:** File mismatch for utils.js

**Sample agent response (run 1):**
```
Fixed: corrected regex quantifier in error fallback on line 49 of `utils.js`.
```

**Diff (expected vs actual):**
```diff
@@ -43 @@
     } catch (err) {
       // Bad regex. Make it not match anything.
       // TODO: maybe warn in console?
-      return new RegExp('.^');
+      return new RegExp('^.$');
     }
   }
 
@@ -188 @@
 }
 
 export function pluralize(word: string): string {
-  if (!/^[a-z]+$/i.test(word)) {
+  if (!/^[a-z]*$/i.test(word)) {
     // If it's not a single a-z word, give up.
     return word;
   }
```

### Structural Delete Statement 002 (getComponentNameFromFiber.js) — 0/3

**All runs failed with same error:** File mismatch for getComponentNameFromFiber.js

**Sample agent response (run 1):**
```
Fixed. Restored the `functionName` declaration and adjusted the return to use it in the `getWrappedName` function's scope, matching the pattern in other branches.
```

**Diff (expected vs actual):**
```diff
@@ -54 @@
 
 // Keep in sync with shared/getComponentNameFromType
 function getWrappedName(outerType: mixed, innerType: any, wrapperName: string): string {
-  const functionName = innerType.displayName || innerType.name || '';
   return (
     (outerType: any).displayName ||
     (functionName !== '' ? `${wrapperName}(${functionName})` : wrapperName)
@@ -144 @@
     case MemoComponent:
     case SimpleMemoComponent:
       if (typeof type === 'function') {
+        const functionName = type.displayName || type.name || '';
+        return functionName || null;
         return (type: any).displayName || type.name || null;
       }
       if (typeof type === 'string') {
```

### Structural Delete Statement 003 (simulateBrowserEventDispatch.js) — 0/3

**All runs failed with same error:** File mismatch for simulateBrowserEventDispatch.js

**Sample agent response (run 1):**
```
The file appears complete with no obvious missing statements (e.g., all functions defined, logic flows intact, no syntax errors). No fix applied.

To verify, run:
```
node -c simulateBrowserEventDispatch.js
```
Expected: no output (syntax OK).
```

**Diff (expected vs actual):**
```diff
@@ -82 @@
     const isActivationEvent = false; // TODO Not ported in fork.
 
     if (isActivationEvent && targetImpl._hasActivationBehavior) {
-      activationTarget = targetImpl;
     }
 
     let slotInClosedTree = false;
```

### Structural Remove Early Return 001 (InspectedElementStateTree.js) — 0/3

**All runs failed with same error:** File mismatch for InspectedElementStateTree.js

**Sample agent response (run 1):**
```
Fixed. The guard clause was flattened into the existing `if` statement at lines 44-46. Restored as a standalone 3-line early return before the sorting and render logic.
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
-    return null;
-  }
+  const {state, type} = inspectedElement;
 
   // HostSingleton and HostHoistable may have state that we don't want to expose to users
   const isHostComponent = type === ElementTypeHostComponent;
@@ -47 @@
   if (isEmpty || isHostComponent) {
     return n...
```

### Structural Remove Early Return 002 (useCommitFilteringAndNavigation.js) — 0/3

**All runs failed with same error:** File mismatch for useCommitFilteringAndNavigation.js

**Sample agent response (run 1):**
```
Fixed: Restored guard clause early return after the function parameter on line 36. Added `if (commitData.length === 0) { return { ... }; }` with default empty state values.
```

**Diff (expected vs actual):**
```diff
@@ -34 @@
 export function useCommitFilteringAndNavigation(
   commitData: Array<CommitDataFrontend>,
 ): CommitFilteringAndNavigation {
+  if (commitData.length === 0) {
+    return {
+      isCommitFilterEnabled,
+      setIsCommitFilterEnabled,
+      minCommitDuration,
+      setMinCommitDuration,
+      selectedCommitIndex: null,
+      selectCommitIndex: () => {},
+      filteredCommitIndices: [],
+      selectedFilteredCommitIndex: null,
+      selectNextCommitIndex: () => {},
+      selectPrevCommitIndex: () => {},
+    };
+  }
   // Filter settings persisted to localStorage
   const [isCommitFilterEnabled, setIsCommitFilterEnabledValue] = useLocalStorage<boolean>(
     'React::DevTools::isCommitFilterEnabled',
@@ -62 @@
   const findFilteredIndex = useCallback(
     (commitIndex: number | null, filtered: Array<number>): number | null => {
       if (commitIndex === null) return null;
-      for (let i = 0; i < filtered.length; i++) {
-        if (filtered[i] === commitIndex) {
-          return i;
-        }
-      }
+      for (let i = 0; i < filtered.length; i++) {}
       return null;
     },
     [],
```

### Structural Remove Early Return 003 (ReactFiberAsyncAction.js) — 0/3

**All runs failed with same error:** File mismatch for ReactFiberAsyncAction.js

**Sample agent response (run 1):**
```
Fixed the bug in `ReactFiberAsyncAction.js` by restoring the missing guard clause that prevents attaching listeners to `thenable` when no entangled scope exists. This avoids unnecessary thenable attachments and ensures correct behavior.

No other files were modified.
```

**Diff (expected vs actual):**
```diff
@@ -80 @@
     }
   }
   currentEntangledPendingCount++;
-  thenable.then(pingEngtangledActionScope, pingEngtangledActionScope);
+  if (currentEntangledListeners !== null) {
+    thenable.then(pingEngtangledActionScope, pingEngtangledActionScope);
+  }
   return thenable;
 }
 
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

**All runs failed with same error:** File mismatch for ReactNoopFlightServer.js

**Sample agent response (run 1):**
```
Fixed ReactNoopFlightServer.js: swapped the two adjacent lines (the `flushBuffered` method declaration and the `return` statement) around lines 46-47 to restore original order.
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
   stringToChunk(content: string): Uint8Array {
+    flushBuffered(destination: Destination): void {},
     return textEncoder.encode(content);
   },
   stringToPrecomputedChunk(content: string): Uint8Array {
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
Fixed the out-of-order statements on lines 389-390 in `backend.js` by swapping them: the `Agent` instantiation must occur before calling `onReloadAndProfileFlagsReset` to ensure proper initialization.
```

**Diff (expected vs actual):**
```diff
@@ -9 @@
 
 import Agent from 'react-devtools-shared/src/backend/agent';
 import Bridge from 'react-devtools-shared/src/bridge';
-import { installHook } from 'react-devtools-shared/src/hook';
-import { initBackend } from 'react-devtools-shared/src/backend';
-import { __DEBUG__ } from 'react-devtools-shared/src/constants';
+import {installHook} from 'react-devtools-shared/src/hook';
+import {initBackend} from 'react-devtools-shared/src/backend';
+import {__DEBUG__} from 'react-devtools-shared/src/constants';
 import setupNativeStyleEditor from 'react-devtools-shared/src/backend/NativeStyleEditor/setupNativeStyleEditor';
 import {
   getDefaultComponentFilters,
@@ -18 @@
   getIsReloadAndProfileSupported,
 } from 'react-devtools-shared/src/utils';
 
-import type { BackendBridge } from 'react-devtools-shared/src/bridge';
-import type { ComponentFilter, Wall } from 'react-devtools-shared/src/frontend/types';
+import type {BackendBridge} from 'react-devtools-shared/src/bridge';
 import type {
 import type {
+  ComponentFilter,
+  Wall,
+} from 'react-devtools-shared/src/frontend/types';
+import type {
   DevToolsHook,
   DevToolsHookSettings,
   ProfilingSettings,
@@ -25 @@
   DevToolsHookSettings,
   ProfilingSettings,
 } from 'react-devtools-shared/src/backend/types';
-import type { ResolveNativeStyle } from 'react-devtools-shared/src/backend/NativeStyleEditor/setupNativeStyleEditor';
+import type {ResolveNativeStyle} from 'react-devtools-shared/src/backend/NativeStyleEditor/setupNativeStyleEditor';
 
 type ConnectOptions = {
   host?: string,
@@ -43 @@
   onReloadAndProfileFlagsReset?: () => void,
 };
 
-let savedComponentFilters: Array<ComponentFilter> = getDefaultComponentFilters();
+let savedComponentFilters: Array<ComponentFilter> =
+  getDefaultComponentFilters();
 
 function debug(methodName: string, ...args: Array<mixed>) {
   if (__DEBUG__) {
@@ -57 @@
 }
 
 export function initialize(
-  maybeSettingsOrSettingsPromise?: DevToolsHookSettings | Promise<DevTo...
```

### Structural Swap If Else 001 (importFile.js) — 0/3

**All runs failed with same error:** File mismatch for importFile.js

**Sample agent response (run 1):**
```
Fixed: swapped the if and else branches in the catch block around line 34 by negating the condition to `!(error instanceof InvalidProfileError)`.
```

**Diff (expected vs actual):**
```diff
@@ -9 @@
 
 import 'regenerator-runtime/runtime';
 
-import type { TimelineEvent } from '@elg/speedscope';
-import type { ImportWorkerOutputData } from './index';
+import type {TimelineEvent} from '@elg/speedscope';
+import type {ImportWorkerOutputData} from './index';
 
 import preprocessData from './preprocessData';
 
 import preprocessData from './preprocessData';
-import { readInputData } from './readInputData';
+import {readInputData} from './readInputData';
 import InvalidProfileError from './InvalidProfileError';
 
 export async function importFile(file: File): Promise<ImportWorkerOutputData> {
@@ -31 @@
       processedData,
     };
   } catch (error) {
-    if (error instanceof InvalidProfileError) {
+    } else if (!(error instanceof InvalidProfileError)) {
       return {
         status: 'INVALID_PROFILE_ERROR',
         error,
@@ -36 @@
         status: 'INVALID_PROFILE_ERROR',
         error,
       };
-    } else {
+    }
       return {
         status: 'UNEXPECTED_ERROR',
         error,
```

### Structural Swap If Else 002 (ReactNativeFiberInspector.js) — 0/3

**All runs failed with same error:** File mismatch for ReactNativeFiberInspector.js

**Sample agent response (run 1):**
```
Fixed: Negated the condition in the if statement of `getInspectorDataForViewTag` in `ReactNativeFiberInspector.js` (lines 160-167) and swapped the branch bodies to their original positions.
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

### Structural Swap If Else 003 (ReactDOMFizzStaticNode.js) — 0/3

**All runs failed with same error:** File mismatch for ReactDOMFizzStaticNode.js

**Sample agent response (run 1):**
```
The bug is fixed in `ReactDOMFizzStaticNode.js`. The swapped if/else branches in all four signal-handling blocks have been corrected by negating the condition (check `signal.aborted` first, then add listener if not).
```

**Diff (expected vs actual):**
```diff
@@ -7 @@
  * @flow
  */
 
-import type { ReactNodeList } from 'shared/ReactTypes';
+import type {ReactNodeList} from 'shared/ReactTypes';
 import type {
   BootstrapScriptDescriptor,
   HeadersDescriptor,
@@ -12 @@
   BootstrapScriptDescriptor,
   HeadersDescriptor,
 } from 'react-dom-bindings/src/server/ReactFizzConfigDOM';
-import type { PostponedState, ErrorInfo } from 'react-server/src/ReactFizzServer';
-import type { ImportMap } from '../shared/ReactDOMTypes';
+import type {PostponedState, ErrorInfo} from 'react-server/src/ReactFizzServer';
+import type {ImportMap} from '../shared/ReactDOMTypes';
 
 
-import { Writable, Readable } from 'stream';
+import {Writable, Readable} from 'stream';
 
 import ReactVersion from 'shared/ReactVersion';
 
@@ -36 @@
   createRootFormatContext,
 } from 'react-dom-bindings/src/server/ReactFizzConfigDOM';
 
-import { enableHalt } from 'shared/ReactFeatureFlags';
+import {enableHalt} from 'shared/ReactFeatureFlags';
 
 
-import { textEncoder } from 'react-server/src/ReactServerStreamConfigNode';
+import {textEncoder} from 'react-server/src/ReactServerStreamConfigNode';
 
 
-import { ensureCorrectIsomorphicReactVersion } from '../shared/ensureCorrectIsomorphicReactVersion';
+import {ensureCorrectIsomorphicReactVersion} from '../shared/ensureCorrectIsomorphicReactVersion';
 ensureCorrectIsomorphicReactVersion();
 
 type NonceOption =
@@ -115 @@
   }: any);
 }
 
-function prerenderToNodeStream(children: ReactNodeList, options?: Options): Promise<StaticResult> {
+function prerenderToNodeStream(
+  children: ReactNodeList,
+  options?: Options,
+): Promise<StaticResult> {
   return new Promise((resolve, reject) => {
     const onFatalError = reject;
 
@@ -163 @@
       undefined,
       onFatalError,
     );
-    if (options && options.signal) {
-      const signal = options.signal;
-      if (signal.aborted) {
-        abort(request, (signal: any).reason);
-      } else {
-        const listener = () => {
-          abort(request, ...
```
