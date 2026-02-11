# Edit Benchmark Report

## Configuration

| Setting | Value |
|---------|-------|
| Date | 2026-02-11T06:42:25.610Z |
| Model | p-anthropic/p-anthropic/claude-haiku-4-5 |
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
| Successful Runs | 41 |
| **Task Success Rate** | **68.3% (41/60)** |
| Verified Rate | 68.3% (41/60) |
| Edit Tool Usage Rate | 100.0% (60/60) |
| **Edit Success Rate** | **93.5%** |
| Timeout Runs | 0 |
| Mutation Intent Match Rate | 65.0% |
| Patch Failure Rate | 6.5% (5/77) |
| Tasks All Passing | 41 |
| Tasks Flaky/Failing | 19 |

### Tool Calls

| Tool | Total | Avg/Run |
|------|-------|---------|
| Read | 135 | 2.3 |
| Edit | 77 | 1.3 |
| Write | 0 | 0.0 |
| **Tool Input Chars** | 22,460 | 374 |

### Tokens & Time

| Metric | Total | Avg/Run |
|--------|-------|---------|
| Input Tokens | 1,122 | 19 |
| Output Tokens | 63,719 | 1,062 |
| Total Tokens | 3,752,782 | 62,546 |
| Duration | 828.0s | 13.8s |
| **Avg Indent Score** | — | **2.26** |

### Hashline Edit Subtypes

| Operation | Count | % |
|-----------|-------|---|
| single | 73 | 83.0% |
| range | 11 | 12.5% |
| insertAfter | 4 | 4.5% |
| **Total** | **88** | 100% |

## Task Results

| Task | File | Success | Edit Hit | R/E/W | Tokens (In/Out) | Time | Indent |
|------|------|---------|----------|-------|-----------------|------|--------|
| Access Remove Optional Chain 001 | registerDevToolsEventLogger.js | 1/1 ✅ | 100.0% | 1/1/0 | 13/437 | 7.7s | 1.00 |
| Access Remove Optional Chain 002 | TimelineContext.js | 1/1 ✅ | 100.0% | 2/1/0 | 16/587 | 8.8s | 1.28 |
| Access Remove Optional Chain 003 | astUtils.js | 0/1 ❌ | 100.0% | 3/1/0 | 20/1,688 | 19.3s | 4.85 |
| Call Swap Call Args 001 | testHelpers.js | 1/1 ✅ | 100.0% | 1/1/0 | 13/339 | 8.2s | 1.33 |
| Call Swap Call Args 002 | FlamegraphChartBuilder.js | 0/1 ❌ | 100.0% | 2/1/0 | 16/1,272 | 13.2s | 3.69 |
| Call Swap Call Args 003 | SyntheticEvent.js | 0/1 ❌ | 100.0% | 3/2/0 | 24/3,940 | 42.1s | 3.76 |
| Duplicate Duplicate Line Flip 001 | index.js | 1/1 ✅ | 100.0% | 1/1/0 | 13/335 | 7.5s | 1.00 |
| Duplicate Duplicate Line Flip 002 | ActivityList.js | 1/1 ✅ | 100.0% | 2/1/0 | 16/536 | 9.3s | 3.63 |
| Duplicate Duplicate Line Flip 003 | SyntheticEvent.js | 1/1 ✅ | 100.0% | 2/1/0 | 18/728 | 12.5s | 1.02 |
| Identifier Identifier Multi Edit 001 | TabBar.js | 0/1 ❌ | 100.0% | 8/2/0 | 46/2,240 | 26.8s | 3.23 |
| Identifier Identifier Multi Edit 002 | EventPluginRegistry.js | 1/1 ✅ | 100.0% | 5/2/0 | 38/1,501 | 17.5s | 3.84 |
| Identifier Identifier Multi Edit 003 | ReactPerformanceTrackProperties.js | 1/1 ✅ | 100.0% | 2/1/0 | 17/961 | 12.1s | 9.71 |
| Import Swap Named Imports 001 | CommitFlamegraphListItem.js | 1/1 ✅ | 100.0% | 1/1/0 | 13/547 | 8.6s | 2.86 |
| Import Swap Named Imports 002 | ReactDOMTextarea.js | 1/1 ✅ | 100.0% | 1/1/0 | 13/449 | 7.0s | 2.41 |
| Import Swap Named Imports 003 | StyleEditor.js | 1/1 ✅ | 100.0% | 2/1/0 | 16/758 | 13.8s | 1.31 |
| Literal Flip Boolean 001 | testHelpers.js | 1/1 ✅ | 100.0% | 1/1/0 | 13/355 | 5.5s | 1.29 |
| Literal Flip Boolean 002 | ReactNoopFlightServer.js | 0/1 ❌ | 100.0% | 1/1/0 | 13/886 | 12.3s | 1.11 |
| Literal Flip Boolean 003 | ReactFlightDOMClientEdge.js | 0/1 ❌ | 100.0% | 3/1/0 | 20/769 | 10.7s | 3.58 |
| Literal Off By One 001 | githubAPI.js | 1/1 ✅ | 100.0% | 1/1/0 | 13/405 | 6.2s | 0.75 |
| Literal Off By One 002 | code-path.js | 0/1 ❌ | 100.0% | 1/1/0 | 13/1,013 | 12.8s | 3.00 |
| Literal Off By One 003 | InspectedElement.js | 1/1 ✅ | 100.0% | 2/1/0 | 16/714 | 11.4s | 3.60 |
| Operator Remove Negation 001 | ReactDOMClient.js | 1/1 ✅ | 100.0% | 1/1/0 | 13/873 | 13.2s | 1.08 |
| Operator Remove Negation 002 | NativeEventsView.js | 1/1 ✅ | 100.0% | 1/1/0 | 13/480 | 6.9s | 2.97 |
| Operator Remove Negation 003 | ReactFlightUnbundledReferences.js | 0/1 ❌ | 100.0% | 3/1/0 | 20/1,441 | 19.1s | 1.98 |
| Operator Swap Arithmetic 001 | fallbackEvalContext.js | 1/1 ✅ | 100.0% | 1/1/0 | 13/293 | 6.2s | 0.20 |
| Operator Swap Arithmetic 002 | CSSShorthandProperty.js | 1/1 ✅ | 100.0% | 5/1/0 | 21/970 | 15.9s | 2.88 |
| Operator Swap Arithmetic 003 | hooks.js | 0/1 ❌ | 100.0% | 1/1/0 | 13/719 | 10.3s | 2.25 |
| Operator Swap Comparison 001 | index.js | 1/1 ✅ | 100.0% | 1/1/0 | 13/360 | 7.0s | 0.00 |
| Operator Swap Comparison 002 | ReactFlightDOMServerBrowser.js | 1/1 ✅ | 100.0% | 1/1/0 | 13/677 | 9.4s | 1.55 |
| Operator Swap Comparison 003 | ReactFlightDOMServerNode.js | 1/1 ✅ | 100.0% | 1/1/0 | 13/869 | 11.7s | 1.95 |
| Operator Swap Equality 001 | readInputData.js | 1/1 ✅ | 100.0% | 1/1/0 | 13/321 | 5.6s | 1.00 |
| Operator Swap Equality 002 | editor.js | 1/1 ✅ | 100.0% | 1/1/0 | 13/349 | 6.7s | 0.17 |
| Operator Swap Equality 003 | hooks.js | 1/1 ✅ | 100.0% | 1/1/0 | 13/439 | 7.1s | 2.25 |
| Operator Swap Increment Decrement 001 | ReactFlightDOMClientNode.js | 1/1 ✅ | 100.0% | 2/1/0 | 16/460 | 7.5s | 1.50 |
| Operator Swap Increment Decrement 002 | ReactFlightDOMClientNode.js | 1/1 ✅ | 100.0% | 3/1/0 | 20/637 | 11.5s | 1.88 |
| Operator Swap Increment Decrement 003 | loadSourceAndMetadata.js | 1/1 ✅ | 100.0% | 2/1/0 | 16/559 | 8.4s | 3.72 |
| Operator Swap Logical 001 | profiling.js | 1/1 ✅ | 100.0% | 1/1/0 | 13/472 | 6.2s | 0.00 |
| Operator Swap Logical 002 | SourceMapMetadataConsumer.js | 1/1 ✅ | 100.0% | 2/1/0 | 18/778 | 9.7s | 3.14 |
| Operator Swap Logical 003 | DevToolsFiberComponentStack.js | 1/1 ✅ | 100.0% | 2/1/0 | 16/759 | 10.4s | 3.94 |
| Operator Swap Nullish 001 | getBatchRange.js | 1/1 ✅ | 100.0% | 1/1/0 | 13/458 | 7.9s | 1.29 |
| Operator Swap Nullish 002 | EnterLeaveEventPlugin.js | 1/1 ✅ | 100.0% | 1/1/0 | 13/1,179 | 14.7s | 1.56 |
| Operator Swap Nullish 003 | backend.js | 0/1 ❌ | 100.0% | 10/6/0 | 74/5,323 | 57.3s | 3.12 |
| Regex Swap Regex Quantifier 001 | githubAPI.js | 0/1 ❌ | 0.0% | 1/1/0 | 8/115 | 5.6s | 0.67 |
| Regex Swap Regex Quantifier 002 | ReactFlightStackConfigV8.js | 0/1 ❌ | 100.0% | 3/1/0 | 23/7,936 | 75.3s | 2.97 |
| Regex Swap Regex Quantifier 003 | utils.js | 1/1 ✅ | 100.0% | 1/1/0 | 13/1,142 | 15.8s | 1.95 |
| Structural Delete Statement 001 | UnsupportedVersionDialog.js | 1/1 ✅ | 100.0% | 2/1/0 | 16/594 | 9.6s | 6.22 |
| Structural Delete Statement 002 | getComponentNameFromFiber.js | 0/1 ❌ | 100.0% | 3/1/0 | 18/939 | 15.0s | 0.62 |
| Structural Delete Statement 003 | simulateBrowserEventDispatch.js | 0/1 ❌ | 66.7% | 5/3/0 | 39/2,910 | 33.0s | 4.23 |
| Structural Remove Early Return 001 | InspectedElementStateTree.js | 0/1 ❌ | 100.0% | 3/1/0 | 18/897 | 13.5s | 0.36 |
| Structural Remove Early Return 002 | useCommitFilteringAndNavigation.js | 1/1 ✅ | 50.0% | 3/2/0 | 23/1,096 | 16.7s | 3.52 |
| Structural Remove Early Return 003 | ReactFiberAsyncAction.js | 0/1 ❌ | 66.7% | 6/3/0 | 34/1,851 | 20.4s | 1.00 |
| Structural Swap Adjacent Lines 001 | ReactServerConsoleConfigPlain.js | 1/1 ✅ | 50.0% | 2/2/0 | 24/693 | 9.5s | 1.00 |
| Structural Swap Adjacent Lines 002 | ReactNoopFlightServer.js | 0/1 ❌ | 100.0% | 6/3/0 | 37/1,830 | 21.2s | 0.00 |
| Structural Swap Adjacent Lines 003 | backend.js | 0/1 ❌ | 100.0% | 2/1/0 | 18/891 | 11.1s | 3.06 |
| Structural Swap If Else 001 | importFile.js | 1/1 ✅ | 100.0% | 3/2/0 | 24/1,428 | 13.3s | 0.00 |
| Structural Swap If Else 002 | ReactNativeFiberInspector.js | 0/1 ❌ | 100.0% | 2/1/0 | 18/599 | 10.0s | 3.18 |
| Structural Swap If Else 003 | ReactDOMFizzStaticNode.js | 1/1 ✅ | 100.0% | 1/1/0 | 12/718 | 9.8s | 1.88 |
| Unicode Unicode Hyphen 001 | Rectangle.js | 1/1 ✅ | 100.0% | 1/1/0 | 13/295 | 7.3s | 3.00 |
| Unicode Unicode Hyphen 002 | UnsupportedBridgeProtocolDialog.js | 1/1 ✅ | 100.0% | 2/1/0 | 18/501 | 8.3s | 3.83 |
| Unicode Unicode Hyphen 003 | ReactTypes.js | 1/1 ✅ | 100.0% | 2/1/0 | 16/408 | 6.6s | 1.23 |

## Category Summary

| Category | Runs | Verified | Edit Used | Success | Min/Avg/Max Difficulty |
|----------|------|----------|-----------|---------|------------------------|
| access | 3 | 66.7% (2/3) | 100.0% (3/3) | 66.7% (2/3) | 7 / 8.7 / 10 |
| call | 3 | 33.3% (1/3) | 100.0% (3/3) | 33.3% (1/3) | 6 / 7.7 / 10 |
| duplicate | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) | 7 / 9.7 / 12 |
| identifier | 3 | 66.7% (2/3) | 100.0% (3/3) | 66.7% (2/3) | 6 / 9.3 / 14 |
| import | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) | 2 / 4.7 / 6 |
| literal | 6 | 50.0% (3/6) | 100.0% (6/6) | 50.0% (3/6) | 4 / 6.2 / 9 |
| operator | 21 | 85.7% (18/21) | 100.0% (21/21) | 85.7% (18/21) | 1 / 6.5 / 13 |
| regex | 3 | 33.3% (1/3) | 100.0% (3/3) | 33.3% (1/3) | 6 / 7.3 / 8 |
| structural | 12 | 41.7% (5/12) | 100.0% (12/12) | 41.7% (5/12) | 4 / 7.6 / 15 |
| unicode | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) | 1 / 3.0 / 6 |

## Mutation Summary

| Mutation | Category | Runs | Verified | Edit Used | Success |
|----------|----------|------|----------|-----------|---------|
| delete-statement | structural | 3 | 33.3% (1/3) | 100.0% (3/3) | 33.3% (1/3) |
| duplicate-line-flip | duplicate | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| flip-boolean | literal | 3 | 33.3% (1/3) | 100.0% (3/3) | 33.3% (1/3) |
| identifier-multi-edit | identifier | 3 | 66.7% (2/3) | 100.0% (3/3) | 66.7% (2/3) |
| off-by-one | literal | 3 | 66.7% (2/3) | 100.0% (3/3) | 66.7% (2/3) |
| remove-early-return | structural | 3 | 33.3% (1/3) | 100.0% (3/3) | 33.3% (1/3) |
| remove-negation | operator | 3 | 66.7% (2/3) | 100.0% (3/3) | 66.7% (2/3) |
| remove-optional-chain | access | 3 | 66.7% (2/3) | 100.0% (3/3) | 66.7% (2/3) |
| swap-adjacent-lines | structural | 3 | 33.3% (1/3) | 100.0% (3/3) | 33.3% (1/3) |
| swap-arithmetic | operator | 3 | 66.7% (2/3) | 100.0% (3/3) | 66.7% (2/3) |
| swap-call-args | call | 3 | 33.3% (1/3) | 100.0% (3/3) | 33.3% (1/3) |
| swap-comparison | operator | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| swap-equality | operator | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| swap-if-else | structural | 3 | 66.7% (2/3) | 100.0% (3/3) | 66.7% (2/3) |
| swap-increment-decrement | operator | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| swap-logical | operator | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| swap-named-imports | import | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| swap-nullish | operator | 3 | 66.7% (2/3) | 100.0% (3/3) | 66.7% (2/3) |
| swap-regex-quantifier | regex | 3 | 33.3% (1/3) | 100.0% (3/3) | 33.3% (1/3) |
| unicode-hyphen | unicode | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |

## Difficulty Summary

| Difficulty Score | Runs | Verified | Edit Used | Success |
|------------------|------|----------|-----------|---------|
| 0-2 | 6 | 100.0% (6/6) | 100.0% (6/6) | 100.0% (6/6) |
| 3-5 | 12 | 75.0% (9/12) | 100.0% (12/12) | 75.0% (9/12) |
| 6-8 | 24 | 62.5% (15/24) | 100.0% (24/24) | 62.5% (15/24) |
| 9+ | 18 | 61.1% (11/18) | 100.0% (18/18) | 61.1% (11/18) |

## Edit Tool Errors

Failures where the edit tool returned an error or failed to apply the patch.

### Regex Swap Regex Quantifier 001 (githubAPI.js)

#### Run 1

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
      "single": {
        "loc": "19:86",
        "replacement": "  message = message.replace(/"
      }
    }
  ]
}
```

### Structural Delete Statement 003 (simulateBrowserEventDispatch.js)

#### Run 1

##### Attempt 1

- Path: simulateBrowserEventDispatch.js
- Operation: —

**Tool error**

```
1 line has changed since last read. Use the updated LINE:HASH references shown below (>>> marks changed lines).

    202:9c|         eventImpl.eventPhase = EVENT_PHASE.AT_TARGET;
    203:32|       } else {
>>> 204:c3|         eventImpl.eventPhase = EVENT_PHASE.CAPTURING_PHASE;
    205:18|       }
    206:05| 

Quick fix — replace stale refs:
	204:32 → 204:c3
```

**Patch args**

```diff
{
  "path": "simulateBrowserEventDispatch.js",
  "edits": [
    {
      "single": {
        "loc": "204:32",
        "replacement": "       } else {\n         eventImpl.eventPhase = EVENT_PHASE.CAPTURING_PHASE;\n       }\n\n       await invokeEventListeners(struct, eventImpl, 'capturing');"
      }
    }
  ]
}
```

### Structural Remove Early Return 002 (useCommitFilteringAndNavigation.js)

#### Run 1

##### Attempt 1

- Path: useCommitFilteringAndNavigation.js
- Operation: —

**Tool error**

```
1 line has changed since last read. Use the updated LINE:HASH references shown below (>>> marks changed lines).

    61:cf|     (commitIndex: number | null, filtered: Array<number>): number | null => {
    62:38|       if (commitIndex === null) return null;
>>> 63:8e|       for (let i = 0; i < filtered.length; i++) {
    64:18|       }
    65:56|       return null;

Quick fix — replace stale refs:
	63:18 → 63:8e
```

**Patch args**

```diff
{
  "path": "useCommitFilteringAndNavigation.js",
  "edits": [
    {
      "single": {
        "loc": "63:18",
        "replacement": "         if (filtered[i] === commitIndex) {"
      }
    }
  ]
}
```

### Structural Remove Early Return 003 (ReactFiberAsyncAction.js)

#### Run 1

##### Attempt 1

- Path: /tmp/reach-benchmark-GoPrAM/batch-b9eff5c9-e12a-4aab-ae52-f7c61d6720fe/ReactFiberAsyncAction.js
- Operation: —

**Tool error**

```
2 lines have changed since last read. Use the updated LINE:HASH references shown below (>>> marks changed lines).

    241:18| }
    242:05| 
>>> 243:70| function releaseIsomorphicIndicator() {
    244:9d|   if (--pendingEntangledRoots === 0) {
    245:eb|     stopIsomorphicDefaultIndicator();
>>> 246:18|   }
    247:18| }
    248:05| 

Quick fix — replace stale refs:
	243:9d → 243:70
	246:18 → 246:18
```

**Patch args**

```diff
{
  "path": "/tmp/reach-benchmark-GoPrAM/batch-b9eff5c9-e12a-4aab-ae52-f7c61d6720fe/ReactFiberAsyncAction.js",
  "edits": [
    {
      "range": {
        "start": "243:9d",
        "end": "246:18",
        "replacement": "function releaseIsomorphicIndicator() {\n  if (!enableDefaultTransitionIndicator) {\n    return;\n  }\n  if (--pendingEntangledRoots === 0) {\n    stopIsomorphicDefaultIndicator();\n  }\n}"
      }
    }
  ]
}
```

### Structural Swap Adjacent Lines 001 (ReactServerConsoleConfigPlain.js)

#### Run 1

##### Attempt 1

- Path: ReactServerConsoleConfigPlain.js
- Operation: —

**Tool error**

```
2 lines have changed since last read. Use the updated LINE:HASH references shown below (>>> marks changed lines).

    20:c3|   args: Array<any>,
    21:c3| ): null | string {
>>> 22:6b|   switch (methodName) {
>>> 23:27|   let offset = 0;
    24:8f|     case 'dir':
    25:c0|     case 'dirxml':

Quick fix — replace stale refs:
	22:6b → 22:6b
	23:8f → 23:27
```

**Patch args**

```diff
{
  "path": "ReactServerConsoleConfigPlain.js",
  "edits": [
    {
      "range": {
        "start": "22:6b",
        "end": "23:8f",
        "replacement": "  let offset = 0;\n  switch (methodName) {"
      }
    }
  ]
}
```

## Failed Tasks (0% passing)

### Access Remove Optional Chain 003 (astUtils.js) — 0/1

**All runs failed with same error:** File mismatch for astUtils.js

**Sample agent response (run 1):**
```
Perfect! The fix has been applied. The optional chaining operator (`?.`) has been restored on line 442 where it accesses `.node.type` on a variable that could potentially be null.

**Summary of the fix:**
- **Location**: Line 442
- **Change**: Added optional chaining operator (`?.`) before `.node.type`
- **Before**: `variableDeclaratorPath.node.type !==`
- **After**: `variableDeclaratorPath?.node.type !==`

This ensures safe property access in case `variableDeclaratorPath` becomes null, which...
```

**Diff (expected vs actual):**
```diff
@@ -255 @@
   const nodeType = hook.node.id.type;
   switch (nodeType) {
     case AST_NODE_TYPES.ARRAY_PATTERN:
-      return !isCustomHook ? (hook.node.id.elements[0]?.name ?? null) : null;
+      return !isCustomHook ? (hook.node.id.elements[0].name ?? null) : null;
 
     case AST_NODE_TYPES.IDENTIFIER:
       return hook.node.id.name;
@@ -405 @@
             let variableDeclaratorPath = referencePath;
             while (
               variableDeclaratorPath != null &&
-              variableDeclaratorPath.node.type !== AST_NODE_TYPES.VARIABLE_DECLARATOR
+              variableDeclaratorPath?.node.type !== AST_NODE_TYPES.VARIABLE_DECLARATOR
             ) {
               variableDeclaratorPath = variableDeclaratorPath.parentPath;
             }
```

### Call Swap Call Args 002 (FlamegraphChartBuilder.js) — 0/1

**All runs failed with same error:** File mismatch for FlamegraphChartBuilder.js

**Sample agent response (run 1):**
```
Done. I've swapped the two arguments on line 162. The call was `walkTree(id, baseDuration, 1)` and is now `walkTree(id, 1, baseDuration)`, correctly passing the depth (1) as the second argument and baseDuration as the third argument, matching the function signature's expectations for `rightOffset` and `currentDepth` respectively.
```

**Diff (expected vs actual):**
```diff
@@ -64 @@
 
   // Generate flame graph structure using tree base durations.
   const walkTree = (id: number, rightOffset: number, currentDepth: number): ChartNode => {
-    idToDepthMap.set(id, currentDepth);
+    idToDepthMap.set(currentDepth, id);
 
     const node = nodes.get(id);
     if (node == null) {
@@ -141 @@
         throw Error(`Could not find node with id "${id}" in commit tree`);
       }
       baseDuration += node.treeBaseDuration;
-      walkTree(id, baseDuration, 1);
+      walkTree(id, 1, baseDuration);
     }
 
     fiberActualDurations.forEach((duration, id) => {
```

### Call Swap Call Args 003 (SyntheticEvent.js) — 0/1

**All runs failed with same error:** File mismatch for SyntheticEvent.js

**Sample agent response (run 1):**
```
Perfect! The bug is fixed. The two arguments `nativeEvent` and `nativeInst` on lines 313-314 (now 313-314) have been swapped to match the constructor's expected parameter order. The constructor expects:
1. `dispatchConfig`
2. `targetInst`
3. `nativeEvent`
4. `nativeEventTarget` (which corresponds to `nativeInst` in this function)

The fix ensures that when `EventConstructor.call()` is invoked, the arguments are passed in the correct order.
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

### Identifier Identifier Multi Edit 001 (TabBar.js) — 0/1

**All runs failed with same error:** File mismatch for TabBar.js

**Sample agent response (run 1):**
```
Perfect! The fixes are complete:

1. **Line 95** (originally line 96): Now correctly destructures `id` instead of the misspelled `di`
2. **Line 111** (originally line 112): Now correctly uses `id` instead of the misspelled `di` 
3. **Line 20**: Type definition now only includes `id: string` (removed the misspelled `di: string`)

The identifier `di` was misspelled and has been restored to `id` in all affected locations.
```

**Diff (expected vs actual):**
```diff
@@ -17 @@
 import type { IconType } from './Icon';
 
 type TabInfo = {
-  icon: IconType,
   id: string,
   label: string,
   title?: string,
```

### Literal Flip Boolean 002 (ReactNoopFlightServer.js) — 0/1

**All runs failed with same error:** File mismatch for ReactNoopFlightServer.js

**Sample agent response (run 1):**
```
Done. I've flipped the boolean comparison on line 89 from `!== undefined` to `=== undefined`, which inverts the boolean literal being passed to `createRequest()`. This was the inverted boolean around the middle of the file.
```

**Diff (expected vs actual):**
```diff
@@ -37 @@
   },
   writeChunkAndReturn(destination: Destination, chunk: string): boolean {
     destination.push(chunk);
-    return true;
+    return false;
   },
   completeWriting(destination: Destination): void {},
   close(destination: Destination): void {},
@@ -83 @@
     undefined,
     __DEV__ && options ? options.environmentName : undefined,
     __DEV__ && options ? options.filterStackFrame : undefined,
-    __DEV__ && options && options.debugChannel !== undefined,
+    __DEV__ && options && options.debugChannel === undefined,
   );
   const signal = options ? options.signal : undefined;
   if (signal) {
```

### Literal Flip Boolean 003 (ReactFlightDOMClientEdge.js) — 0/1

**All runs failed with same error:** File mismatch for ReactFlightDOMClientEdge.js

**Sample agent response (run 1):**
```
Done. Fixed the inverted boolean on line 110. Changed `options.replayConsoleLogs === false` to `options.replayConsoleLogs !== false`, which correctly evaluates the logic so that the value passed defaults to false only when the option is explicitly set to false or undefined, rather than inverting the intended behavior.
```

**Diff (expected vs actual):**
```diff
@@ -100 @@
     typeof options.nonce === 'string' ? options.nonce : undefined,
     options && options.temporaryReferences ? options.temporaryReferences : undefined,
     __DEV__ && options && options.findSourceMapURL ? options.findSourceMapURL : undefined,
-    __DEV__ && options ? options.replayConsoleLogs === true : false, // defaults to false
+    __DEV__ && options ? options.replayConsoleLogs !== false : false, // defaults to false
     __DEV__ && options && options.environmentName ? options.environmentName : undefined,
     __DEV__ && options && options.startTime != null ? options.startTime : undefined,
     __DEV__ && options && options.endTime != null ? options.endTime : undefined,
```

### Literal Off By One 002 (code-path.js) — 0/1

**All runs failed with same error:** File mismatch for code-path.js

**Sample agent response (run 1):**
```
Done. The off-by-one error was on line 226, in the comparison `index < end`. It should be `index <= end` to properly process all segments through the last valid index. When `nextSegments.length` is N, `end` equals N-1 (the last valid index), and we need to process indices 0 through N-1 inclusive, which requires `index <= end`.
```

**Diff (expected vs actual):**
```diff
@@ -221 @@
 
       // Update the stack.
       end = segment.nextSegments.length - 1;
-      if (index < end) {
+      if (index <= end) {
         item[1] += 1;
         stack.push([segment.nextSegments[index], 0]);
       } else if (index === end) {
@@ -226 @@
         stack.push([segment.nextSegments[index], 0]);
       } else if (index === end) {
         item[0] = segment.nextSegments[index];
-        item[1] = 0;
+        item[1] = 1;
       } else {
         stack.pop();
       }
```

### Operator Remove Negation 003 (ReactFlightUnbundledReferences.js) — 0/1

**All runs failed with same error:** File mismatch for ReactFlightUnbundledReferences.js

**Sample agent response (run 1):**
```
Good! The fix is applied. Now the logic reads correctly:

- Line 295: Get `cachedReference` from `target[name]`
- Line 296: **If it exists** (`if (cachedReference)`), enter the block
- Lines 297-312: Create the reference and cache it
- Line 314: Return the (now-cached) reference

This makes sense: we only create a new reference if one doesn't already exist. The negation operator `!` was the bug, inverting the conditional logic.

**Bug fixed:** Changed line 296 from `if (!cachedReference) {` t...
```

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
@@ -288 @@
     );
   }
   let cachedReference = target[name];
-  if (!cachedReference) {
+  if (cachedReference) {
     const reference: ClientReference<any> = registerClientReferenceImpl(
       (function () {
         throw new Error(
```

### Operator Swap Arithmetic 003 (hooks.js) — 0/1

**All runs failed with same error:** File mismatch for hooks.js

**Sample agent response (run 1):**
```
Fixed. The bug was on line 129 in the `useIsOverflowing` hook. The operator `<=` (less than or equal) has been changed to `<` (strictly less than). 

The overflowing condition should be true only when the container width is **strictly less than** the total child width, not when they're equal. With equal widths, the content fits exactly and shouldn't be considered overflowing.
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

### Operator Swap Nullish 003 (backend.js) — 0/1

**All runs failed with same error:** File mismatch for backend.js

**Sample agent response (run 1):**
```
Perfect! **Fixed.** Line 218 now correctly has `resolveRNStyle ?? hook.resolveRNStyle`, which:
- Prioritizes the caller's parameter (`resolveRNStyle`) 
- Falls back to the hook's property (`hook.resolveRNStyle`) if the parameter is nullish
- Matches the consistent pattern used on line 413-414: `resolveRNStyle || hook.resolveRNStyle`
```

**Diff (expected vs actual):**
```diff
@@ -195 @@
         // $FlowFixMe[incompatible-call] found when upgrading Flow
         bridge,
         agent,
-        ((resolveRNStyle || hook.resolveRNStyle: any): ResolveNativeStyle),
+        ((resolveRNStyle ?? hook.resolveRNStyle: any): ResolveNativeStyle),
         nativeStyleEditorValidAttributes || hook.nativeStyleEditorValidAttributes || null,
       );
     } else {
```

### Regex Swap Regex Quantifier 001 (githubAPI.js) — 0/1

**All runs failed with same error:** File mismatch for githubAPI.js

**Sample agent response (run 1):**
```
I can see the bug on line 19. The regex pattern is:

```javascript
/"[0-9]*"/g
```

This pattern uses `*` (zero or more) for matching digits. However, based on the context (removing Fiber IDs from error messages), this should be `+` (one or more) to match at least one digit between the quotes. The bug is that the quantifiers are swapped—it should match one or more digits, not zero or more.

The correct pattern should be: `/"[0-9]+"/g`

Let me fix this:
```

**Diff (expected vs actual):**
```diff
@@ -16 @@
 
 export function searchGitHubIssuesURL(message: string): string {
   // Remove Fiber IDs from error message (as those will be unique).
-  message = message.replace(/"[0-9]+"/g, '');
+  message = message.replace(/"[0-9]*"/g, '');
 
   const filters = [
     'in:title',
```

### Regex Swap Regex Quantifier 002 (ReactFlightStackConfigV8.js) — 0/1

**All runs failed with same error:** File mismatch for ReactFlightStackConfigV8.js

**Sample agent response (run 1):**
```
Perfect! I've changed `(?:async )?` to `(async )?`. This makes the async part a capturing group (removing the `?:` non-capturing modifier) so that group 8 (after the 7 existing groups) can be captured and checked in line 236 where the code does `parsed[8] === 'async '`.

The fix is complete. The change was necessary because:
1. The code at line 236 expects `parsed[8]` to contain the async indicator
2. The original regex had `(?:async )?` which is a non-capturing group, so parsed[8] would be u...
```

**Diff (expected vs actual):**
```diff
@@ -126 @@
 //     at filename:0:0
 //     at async filename:0:0
 const frameRegExp =
-  /^ {3} at (?:(.+) \((?:(.+):(\d+):(\d+)|\<anonymous\>)\)|(?:async )?(.+):(\d+):(\d+)|\<anonymous\>)$/;
+  /^ {3} at (?:(.+) \((?:(.+):(\d*):(\d+)|\<anonymous\>)\)|(async )?(.+):(\d+):(\d+)|\<anonymous\>)$/;
 
 // DEV-only cache of parsed and filtered stack frames.
 const stackTraceCache: WeakMap<Error, ReactStackTrace> = __DEV__ ? new WeakMap() : (null: any);
```

### Structural Delete Statement 002 (getComponentNameFromFiber.js) — 0/1

**All runs failed with same error:** File mismatch for getComponentNameFromFiber.js

**Sample agent response (run 1):**
```
Perfect. The bug has been fixed. The missing statement has been restored:

```javascript
const functionName = getComponentNameFromType(innerType) || '';
```

This statement was required because `functionName` is referenced on line 64 in the ternary expression. Now the function properly:
1. Extracts the component name from the `innerType` using `getComponentNameFromType`
2. Falls back to an empty string if no name is found
3. Returns either the outer type's displayName, or a wrapped name combi...
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
Perfect! The fix is now in place. Here's what was corrected:

## Summary

**Bug:** A `continue;` statement was missing from the first event listener invocation loop.

**Location:** Lines 201-206 in the first loop (capturing phase, going backwards through the event path)

**The Fix:** Added `continue;` inside the `if (struct.target !== null)` block (when `eventPhase === AT_TARGET`).

**Why:** The DOM event dispatch flow has three phases:
1. **Capturing phase** (root → target): Invoked in the f...
```

**Diff (expected vs actual):**
```diff
@@ -82 @@
     const isActivationEvent = false; // TODO Not ported in fork.
 
     if (isActivationEvent && targetImpl._hasActivationBehavior) {
-      activationTarget = targetImpl;
     }
 
     let slotInClosedTree = false;
@@ -173 @@
 
       if (struct.target !== null) {
         eventImpl.eventPhase = EVENT_PHASE.AT_TARGET;
+        continue;
       } else {
         eventImpl.eventPhase = EVENT_PHASE.CAPTURING_PHASE;
       }
```

### Structural Remove Early Return 001 (InspectedElementStateTree.js) — 0/1

**All runs failed with same error:** File mismatch for InspectedElementStateTree.js

**Sample agent response (run 1):**
```
Perfect. The missing guard clause has been restored. The 3-line pattern (if statement, return statement, closing brace) is now in place at lines 39-41:

```javascript
if (state === null) {
  return null;
}
```

This guard clause prevents the code from calling `Object.entries(state)` at line 45 when `state` is null, which would otherwise cause a runtime error. The fix is minimal and preserves the exact code structure without any refactoring or formatting changes to other parts of the file.
```

**Diff (expected vs actual):**
```diff
@@ -36 @@
   store,
 }: Props): React.Node {
   const { state, type } = inspectedElement;
-  if (state == null) {
+  if (state === null) {
     return null;
   }
 
```

### Structural Remove Early Return 003 (ReactFiberAsyncAction.js) — 0/1

**All runs failed with same error:** File mismatch for ReactFiberAsyncAction.js

**Sample agent response (run 1):**
```
Perfect. The fix is complete. The guard clause has been restored to the `releaseIsomorphicIndicator()` function. It now checks `if (!enableDefaultTransitionIndicator)` and returns early, matching the pattern used in `stopIsomorphicDefaultIndicator()` and other functions in the file. This ensures the function doesn't modify state when the feature flag is disabled.
```

**Diff (expected vs actual):**
```diff
@@ -7 @@
  * @flow
  */
 
-import type { Thenable, FulfilledThenable, RejectedThenable } from 'shared/ReactTypes';
-import type { Lane } from './ReactFiberLane';
-import type { Transition } from 'react/src/ReactStartTransition';
+import type {
+  Thenable,
+  FulfilledThenable,
+  RejectedThenable,
+} from 'shared/ReactTypes';
+import type {Lane} from './ReactFiberLane';
+import type {Transition} from 'react/src/ReactStartTransition';
 
 
-import { requestTransitionLane, ensureScheduleIsScheduled } from './ReactFiberRootScheduler';
-import { NoLane } from './ReactFiberLane';
-import { hasScheduledTransitionWork, clearAsyncTransitionTimer } from './ReactProfilerTimer';
 import {
 import {
+  requestTransitionLane,
+  ensureScheduleIsScheduled,
+} from './ReactFiberRootScheduler';
+import {NoLane} from './ReactFiberLane';
+import {
+  hasScheduledTransitionWork,
+  clearAsyncTransitionTimer,
+} from './ReactProfilerTimer';
+import {
   enableComponentPerformanceTrack,
   enableProfilerTimer,
   enableDefaultTransitionIndicator,
@@ -19 @@
   enableProfilerTimer,
   enableDefaultTransitionIndicator,
 } from 'shared/ReactFeatureFlags';
-import { clearEntangledAsyncTransitionTypes } from './ReactFiberTransitionTypes';
+import {clearEntangledAsyncTransitionTypes} from './ReactFiberTransitionTypes';
 
 import noop from 'shared/noop';
 import reportGlobalError from 'shared/reportGlobalError';
@@ -47 @@
 // had any roots registered yet. null means there's more than one callback.
 // If there's more than one callback we bailout to not supporting isomorphic
 // default indicators.
-let isomorphicDefaultTransitionIndicator: void | null | (() => void | (() => void)) = undefined;
+let isomorphicDefaultTransitionIndicator:
+  | void
+  | null
+  | (() => void | (() => void)) = undefined;
 // The clean up function for the currently running indicator.
 let pendingIsomorphicIndicator: null | (() => void) = null;
 // The number of roots that have pending Transitions that depend on t...
```

### Structural Swap Adjacent Lines 002 (ReactNoopFlightServer.js) — 0/1

**All runs failed with same error:** File mismatch for ReactNoopFlightServer.js

**Sample agent response (run 1):**
```
Perfect! The bug is now fixed. The two adjacent lines that were in the wrong order have been corrected:

**Before (buggy):**
- Line 45: `stringToChunk(content: string): Uint8Array {`
- Line 46: `flushBuffered(destination: Destination): void {},`
- Line 47: `return textEncoder.encode(content);`

**After (fixed):**
- Line 42: `stringToChunk(content: string): Uint8Array {`
- Line 43: `return textEncoder.encode(content);`
- Line 44: `},`
- Line 45: `flushBuffered(destination: Destination): void {...
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
 
@@ -39 @@
     destination.push(chunk);
     return true;
   },
-  completeWriting(destination: Destination): void {},
-  close(destination: Destination): void {},
-  closeWithError(destination: Destination, error: mixed): void {},
-  flushBuffered(destination: Destination): void {},
   stringToChunk(content: string): Uint8Array {
     return textEncoder.encode(content);
   },
   stringToChunk(content: string): Uint8Array {
     return textEncoder.encode(content);
   },
+  flushBuffered(destination: Destination): void {},
+  },
   stringToPrecomputedChunk(content: string): Uint8Array {
     return textEncoder.encode(content);
   },
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
 
-export { render };...
```

### Structural Swap Adjacent Lines 003 (backend.js) — 0/1

**All runs failed with same error:** File mismatch for backend.js

**Sample agent response (run 1):**
```
Perfect. The fix is complete. The two adjacent statements have been reordered:
- **Before**: Agent created first (line 388), then flags reset (lines 389-391)
- **After**: Flags reset first (lines 388-390), then agent created (line 391)

This ensures `onReloadAndProfileFlagsReset()` is called before the Agent is instantiated, which is the correct logical order.
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
   if (typeof onReloadAndProfileFlagsReset === 'function') {
     onReloadAndProfileFlagsReset();
   }
+  const agent = new Agent(bridge, isProfiling, onReloadAndProfile);
 
   if (onSettingsUpdated != null) {
     agent.addListener('updateHookSettings', onSettingsUpdated);
```

### Structural Swap If Else 002 (ReactNativeFiberInspector.js) — 0/1

**All runs failed with same error:** File mismatch for ReactNativeFiberInspector.js

**Sample agent response (run 1):**
```
Perfect. The bug is fixed. The condition is now negated (`!__DEV__`) and the branches are in their correct positions:

- **If NOT in development** (`!__DEV__`): throw an error indicating the function isn't available in production
- **Else (in development)**: get the closest instance and return the inspector data
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
