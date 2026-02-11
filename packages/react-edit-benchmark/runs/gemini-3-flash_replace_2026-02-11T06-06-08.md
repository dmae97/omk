# Edit Benchmark Report

## Configuration

| Setting | Value |
|---------|-------|
| Date | 2026-02-11T06:01:26.426Z |
| Model | openrouter/openrouter/google/gemini-3-flash |
| Thinking Level | default |
| Runs per task | 1 |
| Edit Variant | replace |
| Edit Fuzzy | auto |
| Edit Fuzzy Threshold | auto |
| Guided Mode | no |
| Max Attempts | 1 |
| Require Edit Tool | no |
| Require Read Tool | no |
| No-Edit Baseline | no |

## Summary

| Metric | Value |
|--------|-------|
| Total Tasks | 60 |
| Total Runs | 60 |
| Successful Runs | 42 |
| **Task Success Rate** | **70.0% (42/60)** |
| Verified Rate | 70.0% (42/60) |
| Edit Tool Usage Rate | 81.7% (49/60) |
| **Edit Success Rate** | **87.7%** |
| Timeout Runs | 0 |
| Mutation Intent Match Rate | 82.4% |
| Tasks All Passing | 42 |
| Tasks Flaky/Failing | 18 |

### Tool Calls

| Tool | Total | Avg/Run |
|------|-------|---------|
| Read | 132 | 2.2 |
| Edit | 65 | 1.1 |
| Write | 0 | 0.0 |
| **Tool Input Chars** | 17,361 | 289 |

### Tokens & Time

| Metric | Total | Avg/Run |
|--------|-------|---------|
| Input Tokens | 2,024,435 | 33,741 |
| Output Tokens | 334,385 | 5,573 |
| Total Tokens | 3,209,829 | 53,497 |
| Duration | 3039.3s | 50.7s |
| **Avg Indent Score** | — | **2.24** |

## Task Results

| Task | File | Success | Edit Hit | R/E/W | Tokens (In/Out) | Time | Indent |
|------|------|---------|----------|-------|-----------------|------|--------|
| Access Remove Optional Chain 001 | registerDevToolsEventLogger.js | 1/1 ✅ | 100.0% | 2/1/0 | 39,044/12,636 | 48.4s | 1.00 |
| Access Remove Optional Chain 002 | TimelineContext.js | 1/1 ✅ | 100.0% | 2/1/0 | 24,065/6,418 | 28.7s | 1.29 |
| Access Remove Optional Chain 003 | astUtils.js | 1/1 ✅ | 100.0% | 2/1/0 | 25,946/10,837 | 40.8s | 4.85 |
| Call Swap Call Args 001 | testHelpers.js | 1/1 ✅ | 100.0% | 2/1/0 | 11,742/2,034 | 12.8s | 1.33 |
| Call Swap Call Args 002 | FlamegraphChartBuilder.js | 1/1 ✅ | 100.0% | 1/1/0 | 18,858/2,653 | 43.6s | 3.79 |
| Call Swap Call Args 003 | SyntheticEvent.js | 1/1 ✅ | 100.0% | 2/1/0 | 32,139/13,773 | 48.8s | 3.76 |
| Duplicate Duplicate Line Flip 001 | index.js | 1/1 ✅ | 100.0% | 1/1/0 | 11,336/1,572 | 9.7s | 0.00 |
| Duplicate Duplicate Line Flip 002 | ActivityList.js | 1/1 ✅ | 100.0% | 1/1/0 | 25,703/7,109 | 26.1s | 3.61 |
| Duplicate Duplicate Line Flip 003 | SyntheticEvent.js | 0/1 ❌ | 100.0% | 2/0/0 | 13,591/382 | 62.7s | 1.02 |
| Identifier Identifier Multi Edit 001 | TabBar.js | 1/1 ✅ | 100.0% | 2/3/0 | 63,327/8,667 | 40.1s | 3.33 |
| Identifier Identifier Multi Edit 002 | EventPluginRegistry.js | 1/1 ✅ | 66.7% | 3/3/0 | 76,477/11,228 | 48.4s | 3.94 |
| Identifier Identifier Multi Edit 003 | ReactPerformanceTrackProperties.js | 1/1 ✅ | 100.0% | 2/3/0 | 77,708/421 | 13.0s | 9.95 |
| Import Swap Named Imports 001 | CommitFlamegraphListItem.js | 1/1 ✅ | 100.0% | 5/1/0 | 69,674/9,434 | 53.9s | 2.86 |
| Import Swap Named Imports 002 | ReactDOMTextarea.js | 1/1 ✅ | 50.0% | 5/2/0 | 80,502/8,742 | 44.9s | 2.41 |
| Import Swap Named Imports 003 | StyleEditor.js | 0/1 ❌ | 100.0% | 6/1/0 | 73,270/17,578 | 85.4s | 1.31 |
| Literal Flip Boolean 001 | testHelpers.js | 1/1 ✅ | 100.0% | 3/1/0 | 13,507/1,388 | 14.5s | 1.33 |
| Literal Flip Boolean 002 | ReactNoopFlightServer.js | 0/1 ❌ | 100.0% | 0/0/0 | 0/0 | 120.6s | 0.00 |
| Literal Flip Boolean 003 | ReactFlightDOMClientEdge.js | 1/1 ✅ | 100.0% | 5/1/0 | 60,409/4,577 | 24.6s | 3.58 |
| Literal Off By One 001 | githubAPI.js | 1/1 ✅ | 100.0% | 1/1/0 | 11,190/2,200 | 12.3s | 0.67 |
| Literal Off By One 002 | code-path.js | 1/1 ✅ | 100.0% | 1/1/0 | 27,090/11,936 | 43.6s | 3.50 |
| Literal Off By One 003 | InspectedElement.js | 1/1 ✅ | 100.0% | 3/1/0 | 46,480/4,093 | 58.1s | 3.60 |
| Operator Remove Negation 001 | ReactDOMClient.js | 1/1 ✅ | 75.0% | 3/4/0 | 66,997/2,394 | 93.0s | 1.08 |
| Operator Remove Negation 002 | NativeEventsView.js | 0/1 ❌ | 100.0% | 0/0/0 | 0/0 | 120.7s | 0.00 |
| Operator Remove Negation 003 | ReactFlightUnbundledReferences.js | 0/1 ❌ | 0.0% | 6/4/0 | 102,305/12,771 | 71.3s | 2.00 |
| Operator Swap Arithmetic 001 | fallbackEvalContext.js | 1/1 ✅ | 100.0% | 1/1/0 | 16,709/3,218 | 34.4s | 0.00 |
| Operator Swap Arithmetic 002 | CSSShorthandProperty.js | 1/1 ✅ | 100.0% | 2/1/0 | 30,549/5,171 | 44.1s | 2.88 |
| Operator Swap Arithmetic 003 | hooks.js | 0/1 ❌ | 100.0% | 9/0/0 | 144,621/15,614 | 72.2s | 2.25 |
| Operator Swap Comparison 001 | index.js | 1/1 ✅ | 100.0% | 4/1/0 | 44,596/4,569 | 34.5s | 0.00 |
| Operator Swap Comparison 002 | ReactFlightDOMServerBrowser.js | 1/1 ✅ | 100.0% | 4/1/0 | 68,897/11,860 | 48.7s | 1.57 |
| Operator Swap Comparison 003 | ReactFlightDOMServerNode.js | 1/1 ✅ | 100.0% | 3/1/0 | 40,620/6,440 | 31.0s | 1.95 |
| Operator Swap Equality 001 | readInputData.js | 1/1 ✅ | 100.0% | 1/1/0 | 21,376/1,201 | 27.8s | 0.00 |
| Operator Swap Equality 002 | editor.js | 1/1 ✅ | 100.0% | 2/1/0 | 29,652/3,729 | 16.1s | 0.00 |
| Operator Swap Equality 003 | hooks.js | 1/1 ✅ | 100.0% | 2/1/0 | 30,054/3,801 | 17.3s | 2.25 |
| Operator Swap Increment Decrement 001 | ReactFlightDOMClientNode.js | 1/1 ✅ | 100.0% | 3/1/0 | 30,365/1,911 | 15.6s | 1.52 |
| Operator Swap Increment Decrement 002 | ReactFlightDOMClientNode.js | 1/1 ✅ | 100.0% | 2/1/0 | 20,932/2,257 | 15.0s | 1.92 |
| Operator Swap Increment Decrement 003 | loadSourceAndMetadata.js | 1/1 ✅ | 100.0% | 2/1/0 | 33,047/1,739 | 12.1s | 3.72 |
| Operator Swap Logical 001 | profiling.js | 1/1 ✅ | 100.0% | 1/1/0 | 10,891/2,221 | 14.4s | 0.00 |
| Operator Swap Logical 002 | SourceMapMetadataConsumer.js | 1/1 ✅ | 100.0% | 2/1/0 | 26,149/7,097 | 31.3s | 3.14 |
| Operator Swap Logical 003 | DevToolsFiberComponentStack.js | 1/1 ✅ | 100.0% | 2/1/0 | 26,809/8,870 | 33.9s | 4.13 |
| Operator Swap Nullish 001 | getBatchRange.js | 1/1 ✅ | 100.0% | 1/1/0 | 11,130/2,334 | 14.0s | 1.33 |
| Operator Swap Nullish 002 | EnterLeaveEventPlugin.js | 0/1 ❌ | 100.0% | 0/0/0 | 0/0 | 120.6s | 0.00 |
| Operator Swap Nullish 003 | backend.js | 0/1 ❌ | 100.0% | 0/0/0 | 0/0 | 120.6s | 0.00 |
| Regex Swap Regex Quantifier 001 | githubAPI.js | 1/1 ✅ | 100.0% | 4/1/0 | 58,327/8,753 | 49.1s | 0.67 |
| Regex Swap Regex Quantifier 002 | ReactFlightStackConfigV8.js | 0/1 ❌ | 100.0% | 4/2/0 | 69,272/12,401 | 70.7s | 3.06 |
| Regex Swap Regex Quantifier 003 | utils.js | 0/1 ❌ | 100.0% | 0/0/0 | 0/0 | 120.4s | 0.00 |
| Structural Delete Statement 001 | UnsupportedVersionDialog.js | 1/1 ✅ | 100.0% | 3/1/0 | 30,378/3,409 | 24.4s | 6.22 |
| Structural Delete Statement 002 | getComponentNameFromFiber.js | 1/1 ✅ | 100.0% | 3/1/0 | 38,563/2,581 | 32.6s | 0.62 |
| Structural Delete Statement 003 | simulateBrowserEventDispatch.js | 0/1 ❌ | 66.7% | 4/3/0 | 77,911/21,807 | 116.0s | 4.46 |
| Structural Remove Early Return 001 | InspectedElementStateTree.js | 0/1 ❌ | 100.0% | 3/1/0 | 34,041/13,067 | 51.5s | 0.36 |
| Structural Remove Early Return 002 | useCommitFilteringAndNavigation.js | 0/1 ❌ | 100.0% | 0/0/0 | 0/0 | 120.9s | 0.00 |
| Structural Remove Early Return 003 | ReactFiberAsyncAction.js | 0/1 ❌ | 100.0% | 2/1/0 | 31,547/16,823 | 78.2s | 1.58 |
| Structural Swap Adjacent Lines 001 | ReactServerConsoleConfigPlain.js | 1/1 ✅ | 100.0% | 1/1/0 | 11,545/2,542 | 12.9s | 1.00 |
| Structural Swap Adjacent Lines 002 | ReactNoopFlightServer.js | 1/1 ✅ | 100.0% | 2/1/0 | 37,622/12,790 | 42.2s | 1.11 |
| Structural Swap Adjacent Lines 003 | backend.js | 0/1 ❌ | 100.0% | 0/0/0 | 0/0 | 120.6s | 0.00 |
| Structural Swap If Else 001 | importFile.js | 0/1 ❌ | 100.0% | 1/1/0 | 3,932/406 | 13.8s | 0.00 |
| Structural Swap If Else 002 | ReactNativeFiberInspector.js | 0/1 ❌ | 100.0% | 0/0/0 | 0/0 | 120.7s | 0.00 |
| Structural Swap If Else 003 | ReactDOMFizzStaticNode.js | 0/1 ❌ | 100.0% | 0/0/0 | 0/0 | 120.7s | 0.00 |
| Unicode Unicode Hyphen 001 | Rectangle.js | 1/1 ✅ | 100.0% | 1/1/0 | 19,874/674 | 19.5s | 3.00 |
| Unicode Unicode Hyphen 002 | UnsupportedBridgeProtocolDialog.js | 1/1 ✅ | 100.0% | 1/1/0 | 24,665/1,224 | 38.4s | 3.83 |
| Unicode Unicode Hyphen 003 | ReactTypes.js | 1/1 ✅ | 100.0% | 2/1/0 | 29,001/3,033 | 16.7s | 1.24 |

## Category Summary

| Category | Runs | Verified | Edit Used | Success | Min/Avg/Max Difficulty |
|----------|------|----------|-----------|---------|------------------------|
| access | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) | 7 / 8.7 / 10 |
| call | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) | 6 / 7.7 / 10 |
| duplicate | 3 | 66.7% (2/3) | 66.7% (2/3) | 66.7% (2/3) | 7 / 9.7 / 12 |
| identifier | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) | 6 / 9.3 / 14 |
| import | 3 | 66.7% (2/3) | 100.0% (3/3) | 66.7% (2/3) | 2 / 4.7 / 6 |
| literal | 6 | 83.3% (5/6) | 83.3% (5/6) | 83.3% (5/6) | 4 / 6.2 / 9 |
| operator | 21 | 76.2% (16/21) | 81.0% (17/21) | 76.2% (16/21) | 1 / 6.5 / 13 |
| regex | 3 | 33.3% (1/3) | 66.7% (2/3) | 33.3% (1/3) | 6 / 7.3 / 8 |
| structural | 12 | 33.3% (4/12) | 66.7% (8/12) | 33.3% (4/12) | 4 / 7.6 / 15 |
| unicode | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) | 1 / 3.0 / 6 |

## Mutation Summary

| Mutation | Category | Runs | Verified | Edit Used | Success |
|----------|----------|------|----------|-----------|---------|
| delete-statement | structural | 3 | 66.7% (2/3) | 100.0% (3/3) | 66.7% (2/3) |
| duplicate-line-flip | duplicate | 3 | 66.7% (2/3) | 66.7% (2/3) | 66.7% (2/3) |
| flip-boolean | literal | 3 | 66.7% (2/3) | 66.7% (2/3) | 66.7% (2/3) |
| identifier-multi-edit | identifier | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| off-by-one | literal | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| remove-early-return | structural | 3 | 0.0% (0/3) | 66.7% (2/3) | 0.0% (0/3) |
| remove-negation | operator | 3 | 33.3% (1/3) | 66.7% (2/3) | 33.3% (1/3) |
| remove-optional-chain | access | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| swap-adjacent-lines | structural | 3 | 66.7% (2/3) | 66.7% (2/3) | 66.7% (2/3) |
| swap-arithmetic | operator | 3 | 66.7% (2/3) | 66.7% (2/3) | 66.7% (2/3) |
| swap-call-args | call | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| swap-comparison | operator | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| swap-equality | operator | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| swap-if-else | structural | 3 | 0.0% (0/3) | 33.3% (1/3) | 0.0% (0/3) |
| swap-increment-decrement | operator | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| swap-logical | operator | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| swap-named-imports | import | 3 | 66.7% (2/3) | 100.0% (3/3) | 66.7% (2/3) |
| swap-nullish | operator | 3 | 33.3% (1/3) | 33.3% (1/3) | 33.3% (1/3) |
| swap-regex-quantifier | regex | 3 | 33.3% (1/3) | 66.7% (2/3) | 33.3% (1/3) |
| unicode-hyphen | unicode | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |

## Difficulty Summary

| Difficulty Score | Runs | Verified | Edit Used | Success |
|------------------|------|----------|-----------|---------|
| 0-2 | 6 | 100.0% (6/6) | 100.0% (6/6) | 100.0% (6/6) |
| 3-5 | 12 | 75.0% (9/12) | 83.3% (10/12) | 75.0% (9/12) |
| 6-8 | 24 | 66.7% (16/24) | 79.2% (19/24) | 66.7% (16/24) |
| 9+ | 18 | 61.1% (11/18) | 77.8% (14/18) | 61.1% (11/18) |

## Edit Tool Errors

Failures where the edit tool returned an error or failed to apply the patch.

### Identifier Identifier Multi Edit 002 (EventPluginRegistry.js)

#### Run 1

##### Attempt 1

- Path: EventPluginRegistry.js
- Operation: —

**Tool error**

```
Found 2 occurrences:

  68 |     for (const eventName in publishedEvents) {
  69 |       if (
  70 |         !publishEventForPlugin(
  71 |           publishedEvents[eventName],
  72 |           pluginModule,
  73 |           veentName,
  74 |         )
  75 |       ) {
  76 |         throw new Error(
  77 |           `EventPluginRegistry: Failed to publish event \`${eventName}\` for pl…
  78 |         );
  79 |       }

  110 |         // $FlowFixMe[invalid-computed-prop]
  111 |         const phasedRegistrationName = phasedRegistrationNames[phaseName];
  112 |         publishRegistrationName(
  113 |           phasedRegistrationName,
  114 |           pluginModule,
  115 |           veentName,
  116 |         );
  117 |       }
  118 |     }
  119 |     return true;
  120 |   } else if (dispatchConfig.registrationName) {
  121 |     publishRegistrationName(

Add more context lines to disambiguate.
```

**Patch args**

```diff
{
  "old_text": "          veentName,",
  "path": "EventPluginRegistry.js",
  "new_text": "          eventName,"
}
```

### Import Swap Named Imports 002 (ReactDOMTextarea.js)

#### Run 1

##### Attempt 1

- Path: ReactDOMTextarea.js
- Operation: —

**Tool error**

```
Could not find a close enough match in ReactDOMTextarea.js.

Closest match (80% similar) at line 16:
  - import {trackHydrated, track} from './inputValueTracking';
  + import {track, trackHydrated} from './inputValueTracking';
Closest match was below the 95% similarity threshold.
```

**Patch args**

```diff
{
  "path": "ReactDOMTextarea.js",
  "old_text": "import {trackHydrated, track} from './inputValueTracking';",
  "new_text": "import {track, trackHydrated} from './inputValueTracking';"
}
```

### Operator Remove Negation 001 (ReactDOMClient.js)

#### Run 1

##### Attempt 1

- Path: ReactDOMClient.js
- Operation: —

**Tool error**

```
Could not find a close enough match in ReactDOMClient.js.

Closest match (98% similar) at line 57:
  -   if (!foundDevTools && canUseDOM && window.top === window.self) {
  +   if (foundDevTools && canUseDOM && window.top === window.self) {
Closest match was below the 95% similarity threshold.
```

**Patch args**

```diff
{
  "path": "ReactDOMClient.js",
  "new_text": "  if (foundDevTools && canUseDOM && window.top === window.self) {",
  "old_text": "  if (!foundDevTools && canUseDOM && window.top === window.self) {",
  "all": true
}
```

### Operator Remove Negation 003 (ReactFlightUnbundledReferences.js)

#### Run 1

##### Attempt 1

- Path: ReactFlightUnbundledReferences.js
- Operation: —

**Tool error**

```
Could not find a close enough match in ReactFlightUnbundledReferences.js.

Closest match (39% similar) at line 172:
  - // search for exclamation mark
  +       // React looks for debugInfo on thenables.
Closest match was below the 95% similarity threshold.
```

**Patch args**

```diff
{
  "all": true,
  "new_text": "// search for exclamation mark",
  "path": "ReactFlightUnbundledReferences.js",
  "old_text": "// search for exclamation mark"
}
```

##### Attempt 2

- Path: ReactFlightUnbundledReferences.js
- Operation: —

**Tool error**

```
Could not find a close enough match in ReactFlightUnbundledReferences.js.

Closest match (72% similar) at line 261:
  - // test search
  +         // the client.
Closest match was below the 95% similarity threshold.
```

**Patch args**

```diff
{
  "all": true,
  "new_text": "// test search\n",
  "path": "ReactFlightUnbundledReferences.js",
  "old_text": "// test search\n"
}
```

##### Attempt 3

- Path: ReactFlightUnbundledReferences.js
- Operation: —

**Tool error**

```
Could not find a close enough match in ReactFlightUnbundledReferences.js.

Closest match (53% similar) at line 169:
  - // search
  +       // reference.
Closest match was below the 95% similarity threshold.
```

**Patch args**

```diff
{
  "old_text": "// search",
  "path": "ReactFlightUnbundledReferences.js",
  "new_text": "// search",
  "all": true
}
```

##### Attempt 4

- Path: ReactFlightUnbundledReferences.js
- Operation: —

**Tool error**

```
Could not find a close enough match in ReactFlightUnbundledReferences.js.

Closest match (53% similar) at line 169:
  - // search
  +       // reference.
Closest match was below the 95% similarity threshold.
```

**Patch args**

```diff
{
  "all": true,
  "new_text": "// search",
  "path": "ReactFlightUnbundledReferences.js",
  "old_text": "// search"
}
```

### Structural Delete Statement 003 (simulateBrowserEventDispatch.js)

#### Run 1

##### Attempt 1

- Path: simulateBrowserEventDispatch.js
- Operation: —

**Tool error**

```
Could not find a close enough match in simulateBrowserEventDispatch.js.

Closest match (76% similar) at line 70:
  -   if (targetImpl !== relatedTarget || targetImpl === eventImpl.relatedTarget) {
  +   const targetOverride = legacyTargetOverrideFlag
Closest match was below the 95% similarity threshold.
```

**Patch args**

```diff
{
  "new_text": "  eventImpl._dispatchFlag = true;\n  eventImpl.target = targetOverride;\n\n  if (targetImpl !== relatedTarget || targetImpl === eventImpl.relatedTarget) {",
  "path": "simulateBrowserEventDispatch.js",
  "old_text": "  eventImpl._dispatchFlag = true;\n\n  if (targetImpl !== relatedTarget || targetImpl === eventImpl.relatedTarget) {"
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

### Import Swap Named Imports 003 (StyleEditor.js) — 0/1

**All runs failed with same error:** File mismatch for StyleEditor.js

**Sample agent response (run 1):**
```
The bug in `StyleEditor.js` was identified as swapped imports in a destructuring block from `react-devtools-shared/src/devtools/views/context`. Specifically, `BridgeContext` and `StoreContext` were likely intended to be imported in a specific order if alphabetical, but more importantly, looking at the usage:

```javascript
const bridge = useContext(BridgeContext);
const store = useContext(StoreContext);
```

While the order of imports in a destructuring statement usually doesn't affect functi...
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

### Literal Flip Boolean 002 (ReactNoopFlightServer.js) — 0/1

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | — | 0 / 0 | 120.6s |

### Operator Remove Negation 002 (NativeEventsView.js) — 0/1

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | — | 0 / 0 | 120.7s |

### Operator Remove Negation 003 (ReactFlightUnbundledReferences.js) — 0/1

**All runs failed with same error:** File mismatch for ReactFlightUnbundledReferences.js

**Diff (expected vs actual):**
```diff
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

### Operator Swap Arithmetic 003 (hooks.js) — 0/1

**All runs failed with same error:** File mismatch for hooks.js

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
```

### Operator Swap Nullish 002 (EnterLeaveEventPlugin.js) — 0/1

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | — | 0 / 0 | 120.6s |

### Operator Swap Nullish 003 (backend.js) — 0/1

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | — | 0 / 0 | 120.6s |

### Regex Swap Regex Quantifier 002 (ReactFlightStackConfigV8.js) — 0/1

**All runs failed with same error:** File mismatch for ReactFlightStackConfigV8.js

**Sample agent response (run 1):**
```
I have fixed the bug in `ReactFlightStackConfigV8.js` by swapping the incorrect quantifier in the `frameRegExp` regex.

The quantifier for leading whitespace was `*` (matching zero or more spaces), which was incorrect as V8 stack frames always start with indentation. This was swapped to `+` (matching one or more spaces) to correctly match the whitespace at the beginning of stack frame lines and avoid matching non-frame lines that might start with "at".

```javascript
// ReactFlightStackConfig...
```

**Diff (expected vs actual):**
```diff
@@ -126 @@
 //     at filename:0:0
 //     at async filename:0:0
 const frameRegExp =
-  /^ {3} at (?:(.+) \((?:(.+):(\d+):(\d+)|\<anonymous\>)\)|(?:async )?(.+):(\d+):(\d+)|\<anonymous\>)$/;
+  /^ + at (?:(.+) \((?:(.+):(\d*):(\d+)|\<anonymous\>)\)|(?:async )?(.+):(\d+):(\d+)|\<anonymous\>)$/;
 
 // DEV-only cache of parsed and filtered stack frames.
 const stackTraceCache: WeakMap<Error, ReactStackTrace> = __DEV__ ? new WeakMap() : (null: any);
```

### Regex Swap Regex Quantifier 003 (utils.js) — 0/1

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | — | 0 / 0 | 120.4s |

### Structural Delete Statement 003 (simulateBrowserEventDispatch.js) — 0/1

**All runs failed with same error:** File mismatch for simulateBrowserEventDispatch.js

**Sample agent response (run 1):**
```
The following fixes were applied to `simulateBrowserEventDispatch.js`:

1.  **Added missing `return` statement** in `simulateEventDispatch`: The `_dispatch` function is asynchronous and returns a boolean value (indicating whether the event was canceled). The wrapper `simulateEventDispatch` was awaiting the call but failing to return its result, which is necessary for it to behave like a standard `dispatchEvent` implementation.
2.  **Initialized `eventImpl.target`** in `_dispatch`: The `target...
```

**Diff (expected vs actual):**
```diff
@@ -56 @@
 
   eventImpl.isTrusted = false;
 
-  await _dispatch.call(this, eventImpl);
+  return await _dispatch.call(this, eventImpl);
 }
 
 async function _dispatch(eventImpl, legacyTargetOverrideFlag) {
@@ -72 @@
   const targetOverride = legacyTargetOverrideFlag
     ? wrapperForImpl(targetImpl._globalObject._document)
     : targetImpl;
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

### Structural Remove Early Return 001 (InspectedElementStateTree.js) — 0/1

**All runs failed with same error:** File mismatch for InspectedElementStateTree.js

**Sample agent response (run 1):**
```
The bug in `InspectedElementStateTree.js` was a missing guard clause that resulted in a potential crash when calling `Object.entries(state)` if `state` was `null` or `undefined`. 

As requested, I have restored the exact 3-line guard clause around line 39.

```javascript
  const {state, type} = inspectedElement;

  if (state == null) {
    return null;
  }

  // HostSingleton and HostHoistable may have state that we don't want to expose to users
```

This prevents the crash and ensures that t...
```

**Diff (expected vs actual):**
```diff
@@ -36 @@
   store,
 }: Props): React.Node {
   const { state, type } = inspectedElement;
+
   if (state == null) {
     return null;
   }
```

### Structural Remove Early Return 002 (useCommitFilteringAndNavigation.js) — 0/1

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | — | 0 / 0 | 120.9s |

### Structural Remove Early Return 003 (ReactFiberAsyncAction.js) — 0/1

**All runs failed with same error:** File mismatch for ReactFiberAsyncAction.js

**Sample agent response (run 1):**
```
In `ReactFiberAsyncAction.js`, the `entangleAsyncAction` function was missing a guard clause to handle non-thenable values returned by async actions. While the flow type expects a `Thenable`, in practice, users might return other values from an action scope.

I restored the guard clause that returns the value immediately if it's not a thenable.

```javascript
export function entangleAsyncAction<S>(
  transition: Transition,
  thenable: Thenable<S>,
): Thenable<S> {
  if (
    thenable === nul...
```

**Diff (expected vs actual):**
```diff
@@ -56 @@
 let needsIsomorphicIndicator: boolean = false;
 
 export function entangleAsyncAction<S>(transition: Transition, thenable: Thenable<S>): Thenable<S> {
+  if (thenable === null || typeof thenable !== 'object' || typeof thenable.then !== 'function') {
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

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | — | 0 / 0 | 120.6s |

### Structural Swap If Else 001 (importFile.js) — 0/1

**All runs failed with same error:** File mismatch for importFile.js

**Sample agent response (run 1):**
```
The bug in `importFile.js` was identified where the `if` and `else` branches in the `catch` block were incorrectly handling different types of errors. Specifically, `InvalidProfileError` was returning `UNEXPECTED_ERROR` and vice-versa.

I have negated the condition to `!(error instanceof InvalidProfileError)` while keeping the branch bodies in their positions as per instructions, effectively swapping their roles back to the correct logic.

```javascript
// Before
    if (error instanceof Inva...
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

### Structural Swap If Else 002 (ReactNativeFiberInspector.js) — 0/1

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | — | 0 / 0 | 120.7s |

### Structural Swap If Else 003 (ReactDOMFizzStaticNode.js) — 0/1

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | — | 0 / 0 | 120.7s |
