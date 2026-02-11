# Edit Benchmark Report

## Configuration

| Setting | Value |
|---------|-------|
| Date | 2026-02-11T06:03:42.971Z |
| Model | p-anthropic/p-anthropic/claude-haiku-4-5 |
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
| Successful Runs | 39 |
| **Task Success Rate** | **65.0% (39/60)** |
| Verified Rate | 65.0% (39/60) |
| Edit Tool Usage Rate | 100.0% (60/60) |
| **Edit Success Rate** | **97.2%** |
| Timeout Runs | 0 |
| Mutation Intent Match Rate | 66.7% |
| Tasks All Passing | 39 |
| Tasks Flaky/Failing | 21 |

### Tool Calls

| Tool | Total | Avg/Run |
|------|-------|---------|
| Read | 96 | 1.6 |
| Edit | 72 | 1.2 |
| Write | 0 | 0.0 |
| **Tool Input Chars** | 32,383 | 540 |

### Tokens & Time

| Metric | Total | Avg/Run |
|--------|-------|---------|
| Input Tokens | 883 | 15 |
| Output Tokens | 49,590 | 827 |
| Total Tokens | 2,488,338 | 41,472 |
| Duration | 668.0s | 11.1s |
| **Avg Indent Score** | — | **2.30** |

## Task Results

| Task | File | Success | Edit Hit | R/E/W | Tokens (In/Out) | Time | Indent |
|------|------|---------|----------|-------|-----------------|------|--------|
| Access Remove Optional Chain 001 | registerDevToolsEventLogger.js | 1/1 ✅ | 100.0% | 1/1/0 | 12/407 | 6.1s | 1.00 |
| Access Remove Optional Chain 002 | TimelineContext.js | 0/1 ❌ | 100.0% | 1/1/0 | 12/477 | 8.5s | 1.29 |
| Access Remove Optional Chain 003 | astUtils.js | 0/1 ❌ | 100.0% | 2/1/0 | 15/775 | 11.2s | 4.81 |
| Call Swap Call Args 001 | testHelpers.js | 1/1 ✅ | 100.0% | 1/1/0 | 12/434 | 6.6s | 1.33 |
| Call Swap Call Args 002 | FlamegraphChartBuilder.js | 0/1 ❌ | 100.0% | 2/1/0 | 16/818 | 11.2s | 3.79 |
| Call Swap Call Args 003 | SyntheticEvent.js | 0/1 ❌ | 100.0% | 2/1/0 | 15/3,983 | 34.4s | 3.76 |
| Duplicate Duplicate Line Flip 001 | index.js | 1/1 ✅ | 50.0% | 1/2/0 | 18/497 | 8.6s | 1.00 |
| Duplicate Duplicate Line Flip 002 | ActivityList.js | 1/1 ✅ | 100.0% | 1/1/0 | 12/533 | 7.1s | 3.61 |
| Duplicate Duplicate Line Flip 003 | SyntheticEvent.js | 1/1 ✅ | 100.0% | 1/1/0 | 12/1,015 | 12.3s | 1.02 |
| Identifier Identifier Multi Edit 001 | TabBar.js | 0/1 ❌ | 100.0% | 2/2/0 | 19/1,100 | 12.7s | 3.33 |
| Identifier Identifier Multi Edit 002 | EventPluginRegistry.js | 1/1 ✅ | 100.0% | 1/4/0 | 18/1,031 | 12.9s | 3.65 |
| Identifier Identifier Multi Edit 003 | ReactPerformanceTrackProperties.js | 1/1 ✅ | 100.0% | 2/3/0 | 20/1,253 | 16.8s | 9.95 |
| Import Swap Named Imports 001 | CommitFlamegraphListItem.js | 1/1 ✅ | 100.0% | 1/1/0 | 12/475 | 8.3s | 2.86 |
| Import Swap Named Imports 002 | ReactDOMTextarea.js | 1/1 ✅ | 100.0% | 2/1/0 | 15/644 | 10.2s | 2.41 |
| Import Swap Named Imports 003 | StyleEditor.js | 1/1 ✅ | 100.0% | 2/1/0 | 15/972 | 13.5s | 1.31 |
| Literal Flip Boolean 001 | testHelpers.js | 1/1 ✅ | 100.0% | 1/1/0 | 12/466 | 7.1s | 1.33 |
| Literal Flip Boolean 002 | ReactNoopFlightServer.js | 1/1 ✅ | 100.0% | 2/1/0 | 15/607 | 9.5s | 1.11 |
| Literal Flip Boolean 003 | ReactFlightDOMClientEdge.js | 1/1 ✅ | 100.0% | 1/1/0 | 12/678 | 10.1s | 3.58 |
| Literal Off By One 001 | githubAPI.js | 1/1 ✅ | 100.0% | 1/1/0 | 12/401 | 5.6s | 0.67 |
| Literal Off By One 002 | code-path.js | 0/1 ❌ | 100.0% | 1/1/0 | 12/921 | 10.7s | 3.50 |
| Literal Off By One 003 | InspectedElement.js | 1/1 ✅ | 100.0% | 1/1/0 | 12/681 | 10.8s | 3.60 |
| Operator Remove Negation 001 | ReactDOMClient.js | 1/1 ✅ | 100.0% | 1/1/0 | 12/675 | 10.4s | 1.08 |
| Operator Remove Negation 002 | NativeEventsView.js | 1/1 ✅ | 100.0% | 1/1/0 | 12/400 | 6.4s | 3.03 |
| Operator Remove Negation 003 | ReactFlightUnbundledReferences.js | 0/1 ❌ | 100.0% | 2/3/0 | 18/3,553 | 35.5s | 2.00 |
| Operator Swap Arithmetic 001 | fallbackEvalContext.js | 1/1 ✅ | 100.0% | 1/1/0 | 12/292 | 5.1s | 0.00 |
| Operator Swap Arithmetic 002 | CSSShorthandProperty.js | 1/1 ✅ | 100.0% | 2/1/0 | 15/722 | 12.2s | 2.82 |
| Operator Swap Arithmetic 003 | hooks.js | 0/1 ❌ | 100.0% | 2/2/0 | 18/941 | 14.7s | 2.25 |
| Operator Swap Comparison 001 | index.js | 1/1 ✅ | 100.0% | 1/1/0 | 12/318 | 5.5s | 0.00 |
| Operator Swap Comparison 002 | ReactFlightDOMServerBrowser.js | 0/1 ❌ | 100.0% | 2/1/0 | 16/821 | 12.2s | 1.57 |
| Operator Swap Comparison 003 | ReactFlightDOMServerNode.js | 1/1 ✅ | 100.0% | 2/1/0 | 15/958 | 12.7s | 1.95 |
| Operator Swap Equality 001 | readInputData.js | 1/1 ✅ | 100.0% | 1/1/0 | 12/350 | 5.4s | 0.00 |
| Operator Swap Equality 002 | editor.js | 1/1 ✅ | 100.0% | 1/1/0 | 12/442 | 8.8s | 0.00 |
| Operator Swap Equality 003 | hooks.js | 1/1 ✅ | 100.0% | 1/1/0 | 12/421 | 6.1s | 2.25 |
| Operator Swap Increment Decrement 001 | ReactFlightDOMClientNode.js | 1/1 ✅ | 100.0% | 1/1/0 | 12/347 | 8.2s | 1.52 |
| Operator Swap Increment Decrement 002 | ReactFlightDOMClientNode.js | 1/1 ✅ | 100.0% | 2/1/0 | 15/521 | 9.2s | 1.92 |
| Operator Swap Increment Decrement 003 | loadSourceAndMetadata.js | 1/1 ✅ | 100.0% | 2/1/0 | 16/625 | 9.9s | 3.72 |
| Operator Swap Logical 001 | profiling.js | 1/1 ✅ | 100.0% | 1/1/0 | 12/490 | 6.7s | 0.00 |
| Operator Swap Logical 002 | SourceMapMetadataConsumer.js | 0/1 ❌ | 100.0% | 2/1/0 | 16/709 | 10.7s | 3.14 |
| Operator Swap Logical 003 | DevToolsFiberComponentStack.js | 1/1 ✅ | 100.0% | 2/1/0 | 15/1,073 | 14.0s | 4.13 |
| Operator Swap Nullish 001 | getBatchRange.js | 1/1 ✅ | 100.0% | 1/1/0 | 12/394 | 6.9s | 1.33 |
| Operator Swap Nullish 002 | EnterLeaveEventPlugin.js | 0/1 ❌ | 100.0% | 1/1/0 | 12/898 | 11.8s | 1.56 |
| Operator Swap Nullish 003 | backend.js | 0/1 ❌ | 100.0% | 1/1/0 | 12/451 | 7.3s | 3.15 |
| Regex Swap Regex Quantifier 001 | githubAPI.js | 1/1 ✅ | 100.0% | 1/1/0 | 12/413 | 6.1s | 0.67 |
| Regex Swap Regex Quantifier 002 | ReactFlightStackConfigV8.js | 1/1 ✅ | 100.0% | 2/1/0 | 15/888 | 12.0s | 3.06 |
| Regex Swap Regex Quantifier 003 | utils.js | 1/1 ✅ | 100.0% | 2/1/0 | 15/1,068 | 12.8s | 1.83 |
| Structural Delete Statement 001 | UnsupportedVersionDialog.js | 1/1 ✅ | 100.0% | 1/1/0 | 12/559 | 7.9s | 6.22 |
| Structural Delete Statement 002 | getComponentNameFromFiber.js | 0/1 ❌ | 100.0% | 2/1/0 | 16/798 | 10.4s | 0.62 |
| Structural Delete Statement 003 | simulateBrowserEventDispatch.js | 0/1 ❌ | 100.0% | 3/1/0 | 20/1,644 | 21.6s | 4.10 |
| Structural Remove Early Return 001 | InspectedElementStateTree.js | 0/1 ❌ | 100.0% | 3/1/0 | 20/946 | 14.5s | 0.36 |
| Structural Remove Early Return 002 | useCommitFilteringAndNavigation.js | 0/1 ❌ | 100.0% | 2/1/0 | 15/818 | 13.5s | 3.73 |
| Structural Remove Early Return 003 | ReactFiberAsyncAction.js | 0/1 ❌ | 100.0% | 4/2/0 | 29/1,695 | 18.7s | 1.40 |
| Structural Swap Adjacent Lines 001 | ReactServerConsoleConfigPlain.js | 1/1 ✅ | 100.0% | 1/1/0 | 12/420 | 6.8s | 2.14 |
| Structural Swap Adjacent Lines 002 | ReactNoopFlightServer.js | 0/1 ❌ | 100.0% | 2/1/0 | 15/627 | 10.0s | 1.11 |
| Structural Swap Adjacent Lines 003 | backend.js | 0/1 ❌ | 100.0% | 1/1/0 | 12/1,404 | 12.3s | 3.15 |
| Structural Swap If Else 001 | importFile.js | 0/1 ❌ | 100.0% | 1/1/0 | 12/515 | 6.9s | 0.00 |
| Structural Swap If Else 002 | ReactNativeFiberInspector.js | 0/1 ❌ | 100.0% | 2/1/0 | 15/764 | 10.2s | 3.18 |
| Structural Swap If Else 003 | ReactDOMFizzStaticNode.js | 1/1 ✅ | 50.0% | 6/2/0 | 37/2,238 | 26.8s | 1.88 |
| Unicode Unicode Hyphen 001 | Rectangle.js | 1/1 ✅ | 100.0% | 1/1/0 | 12/304 | 6.3s | 3.00 |
| Unicode Unicode Hyphen 002 | UnsupportedBridgeProtocolDialog.js | 1/1 ✅ | 100.0% | 1/1/0 | 12/320 | 6.2s | 3.83 |
| Unicode Unicode Hyphen 003 | ReactTypes.js | 1/1 ✅ | 100.0% | 2/1/0 | 16/600 | 10.8s | 1.24 |

## Category Summary

| Category | Runs | Verified | Edit Used | Success | Min/Avg/Max Difficulty |
|----------|------|----------|-----------|---------|------------------------|
| access | 3 | 33.3% (1/3) | 100.0% (3/3) | 33.3% (1/3) | 7 / 8.7 / 10 |
| call | 3 | 33.3% (1/3) | 100.0% (3/3) | 33.3% (1/3) | 6 / 7.7 / 10 |
| duplicate | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) | 7 / 9.7 / 12 |
| identifier | 3 | 66.7% (2/3) | 100.0% (3/3) | 66.7% (2/3) | 6 / 9.3 / 14 |
| import | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) | 2 / 4.7 / 6 |
| literal | 6 | 83.3% (5/6) | 100.0% (6/6) | 83.3% (5/6) | 4 / 6.2 / 9 |
| operator | 21 | 71.4% (15/21) | 100.0% (21/21) | 71.4% (15/21) | 1 / 6.5 / 13 |
| regex | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) | 6 / 7.3 / 8 |
| structural | 12 | 25.0% (3/12) | 100.0% (12/12) | 25.0% (3/12) | 4 / 7.6 / 15 |
| unicode | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) | 1 / 3.0 / 6 |

## Mutation Summary

| Mutation | Category | Runs | Verified | Edit Used | Success |
|----------|----------|------|----------|-----------|---------|
| delete-statement | structural | 3 | 33.3% (1/3) | 100.0% (3/3) | 33.3% (1/3) |
| duplicate-line-flip | duplicate | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| flip-boolean | literal | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| identifier-multi-edit | identifier | 3 | 66.7% (2/3) | 100.0% (3/3) | 66.7% (2/3) |
| off-by-one | literal | 3 | 66.7% (2/3) | 100.0% (3/3) | 66.7% (2/3) |
| remove-early-return | structural | 3 | 0.0% (0/3) | 100.0% (3/3) | 0.0% (0/3) |
| remove-negation | operator | 3 | 66.7% (2/3) | 100.0% (3/3) | 66.7% (2/3) |
| remove-optional-chain | access | 3 | 33.3% (1/3) | 100.0% (3/3) | 33.3% (1/3) |
| swap-adjacent-lines | structural | 3 | 33.3% (1/3) | 100.0% (3/3) | 33.3% (1/3) |
| swap-arithmetic | operator | 3 | 66.7% (2/3) | 100.0% (3/3) | 66.7% (2/3) |
| swap-call-args | call | 3 | 33.3% (1/3) | 100.0% (3/3) | 33.3% (1/3) |
| swap-comparison | operator | 3 | 66.7% (2/3) | 100.0% (3/3) | 66.7% (2/3) |
| swap-equality | operator | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| swap-if-else | structural | 3 | 33.3% (1/3) | 100.0% (3/3) | 33.3% (1/3) |
| swap-increment-decrement | operator | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| swap-logical | operator | 3 | 66.7% (2/3) | 100.0% (3/3) | 66.7% (2/3) |
| swap-named-imports | import | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| swap-nullish | operator | 3 | 33.3% (1/3) | 100.0% (3/3) | 33.3% (1/3) |
| swap-regex-quantifier | regex | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| unicode-hyphen | unicode | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |

## Difficulty Summary

| Difficulty Score | Runs | Verified | Edit Used | Success |
|------------------|------|----------|-----------|---------|
| 0-2 | 6 | 100.0% (6/6) | 100.0% (6/6) | 100.0% (6/6) |
| 3-5 | 12 | 66.7% (8/12) | 100.0% (12/12) | 66.7% (8/12) |
| 6-8 | 24 | 66.7% (16/24) | 100.0% (24/24) | 66.7% (16/24) |
| 9+ | 18 | 50.0% (9/18) | 100.0% (18/18) | 50.0% (9/18) |

## Edit Tool Errors

Failures where the edit tool returned an error or failed to apply the patch.

### Duplicate Duplicate Line Flip 001 (index.js)

#### Run 1

##### Attempt 1

- Path: index.js
- Operation: —

**Tool error**

```
Could not find a close enough match in index.js.

Closest match (100% similar) at line 45:
  -    <=ClassComponent ref={ref} {...props} />
  +   <=ClassComponent ref={ref} {...props} />
Found 2 high-confidence matches. Provide more context to make it unique.
```

**Patch args**

```diff
{
  "path": "index.js",
  "old_text": "   <=ClassComponent ref={ref} {...props} />",
  "new_text": "   <ClassComponent ref={ref} {...props} />"
}
```

### Structural Swap If Else 003 (ReactDOMFizzStaticNode.js)

#### Run 1

##### Attempt 1

- Path: /tmp/reach-benchmark-C5b2t7/batch-3088e2a0-4ac5-4b71-bd26-0203fd9c79f3/ReactDOMFizzStaticNode.js
- Operation: —

**Tool error**

```
Could not find a close enough match in /tmp/reach-benchmark-C5b2t7/batch-3088e2a0-4ac5-4b71-bd26-0203fd9c79f3/ReactDOMFizzStaticNode.js.

Closest match (100% similar) at line 169:
  -      if (options && options.signal) {
  +     if (options && options.signal) {
Found 4 high-confidence matches. Provide more context to make it unique.
```

**Patch args**

```diff
{
  "path": "/tmp/reach-benchmark-C5b2t7/batch-3088e2a0-4ac5-4b71-bd26-0203fd9c79f3/ReactDOMFizzStaticNode.js",
  "old_text": "     if (options && options.signal) {\n       const signal = options.signal;\n       if (signal.aborted) {\n         abort(request, (signal: any).reason);\n       } else {\n         const listener = () => {\n           abort(request, (signal: any).reason);\n           signal.removeEventListener('abort', listener);\n         };\n         signal.addEventListener('abort', listener);\n       }\n     }",
  "new_text": "    if (options && options.signal) {\n      const signal = options.signal;\n      if (signal.aborted) {\n        abort(request, (signal: any).reason);\n      } else {\n        const listener = () => {\n          abort(request, (signal: any).reason);\n          signal.removeEventListener('abort', listener);\n        };\n        signal.addEventListener('abort', listener);\n      }\n    }"
}
```

## Failed Tasks (0% passing)

### Access Remove Optional Chain 002 (TimelineContext.js) — 0/1

**All runs failed with same error:** File mismatch for TimelineContext.js

**Sample agent response (run 1):**
```
Done. I've restored the optional chaining operator (`?.`) on the property access chain in the `TimelineContextController` function's `getState()` method at line 92. The fix changes:

```javascript
store.profilerStore.profilingData.timelineData
```

to:

```javascript
store.profilerStore?.profilingData?.timelineData
```

This safely navigates the property chain, returning `undefined` if any intermediate property is null or undefined, rather than throwing an error.
```

**Diff (expected vs actual):**
```diff
@@ -80 @@
       };
     },
     function getState() {
-      return store.profilerStore.profilingData?.timelineData || null;
+      return store.profilerStore?.profilingData?.timelineData || null;
     },
   );
 
```

### Access Remove Optional Chain 003 (astUtils.js) — 0/1

**All runs failed with same error:** File mismatch for astUtils.js

**Sample agent response (run 1):**
```
Done. The bug was on line 87 in the `filterMemberNodesOfTargetHook` function. The pattern `(hookNode.node.init.object && hookNode.node.init.object.name)` was using the old-style conditional check instead of the optional chaining operator `?.`. I've replaced it with `hookNode.node.init.object?.name`, which is the correct modern syntax that safely accesses the `name` property only if `object` is not null/undefined.
```

**Diff (expected vs actual):**
```diff
@@ -75 @@
 function filterMemberNodesOfTargetHook(targetHookNode: NodePath, hookNode: NodePath): boolean {
   const targetHookName = targetHookNode.node.id.name;
   return (
-    targetHookName != null &&
-    (targetHookName === (hookNode.node.init.object && hookNode.node.init.object.name) ||
-      targetHookName === hookNode.node.init.name)
+    (targetHookName != null && targetHookName === hookNode.node.init.object?.name) ||
+    targetHookName === hookNode.node.init.name
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

### Call Swap Call Args 002 (FlamegraphChartBuilder.js) — 0/1

**All runs failed with same error:** File mismatch for FlamegraphChartBuilder.js

**Sample agent response (run 1):**
```
Done. The bug has been fixed. The two arguments `baseDuration` and `1` were swapped in the `walkTree` call on line 162. They are now in the correct order: `walkTree(id, 1, baseDuration)` where `1` is the `currentDepth` and `baseDuration` is the `rightOffset`.
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
Done. I've swapped the arguments `nativeEvent` and `nativeInst` on lines 313-314 in the `EventConstructor.call()` invocation within the `createOrGetPooledEvent` function. 

The bug was that the arguments were being passed in the wrong order:
- **Before**: `nativeEvent, nativeInst` 
- **After**: `nativeInst, nativeEvent`

This ensures the arguments match what the SyntheticEvent constructor expects: `(dispatchConfig, targetInst, nativeEvent, nativeEventTarget)`, where `nativeInst` (the native e...
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
Perfect. The fixes are complete. The misspelled identifier `di` has been corrected to `id` in both locations:

1. **Line 96**: Changed `const {icon, di, label, title} = tab;` to `const {icon, id, label, title} = tab;`
2. **Line 112**: Changed `checked={currentTab === di}` to `checked={currentTab === id}`

Both changes restore the correct identifier name `id`, which is consistent with all other usages throughout the file (lines 103, 105, 106, 108, 115, 130) and matches the pattern established ...
```

**Diff (expected vs actual):**
```diff
@@ -18 @@
 
 type TabInfo = {
   icon: IconType,
-  id: string,
+  di: string,
   label: string,
   title?: string,
 };
```

### Literal Off By One 002 (code-path.js) — 0/1

**All runs failed with same error:** File mismatch for code-path.js

**Sample agent response (run 1):**
```
Done. The off-by-one error was on line 225: `end = segment.nextSegments.length - 1;` should be `end = segment.nextSegments.length;`. 

The bug caused the loop to fail to properly process all segments in the traversal stack. By subtracting 1, the condition `index < end` on line 226 would skip the last segment index, breaking the depth-first traversal logic.
```

**Diff (expected vs actual):**
```diff
@@ -220 @@
       }
 
       // Update the stack.
-      end = segment.nextSegments.length - 1;
+      end = segment.nextSegments.length;
       if (index < end) {
         item[1] += 1;
         stack.push([segment.nextSegments[index], 0]);
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
**Done.** The bug was on line 330. The negation operator `!` was incorrectly inverted. 

The condition should be `if (descriptor)` not `if (!descriptor)`. The logic should only create and define a synthetic property descriptor when one doesn't already exist on the target. With the original negated condition, the code was defining properties that shouldn't be defined or skipping properties that should be.
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
@@ -315 @@
   },
   getOwnPropertyDescriptor: function (target: Function, name: string | symbol): $FlowFixMe {
     let descriptor = Object.getOwnPropertyDescriptor(target, name);
-    if (!descriptor) {
+    if (descriptor) {
       descriptor = {
         value: getReference(target, name),
         writable: false,
```

### Operator Swap Arithmetic 003 (hooks.js) — 0/1

**All runs failed with same error:** File mismatch for hooks.js

**Sample agent response (run 1):**
```
Fixed. The comparison operator on line 129 has been corrected from `<=` to `<`. The overflow condition should trigger when the container's client width is **strictly less than** the total child width (content doesn't fit), not when they're equal or greater.
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

### Operator Swap Comparison 002 (ReactFlightDOMServerBrowser.js) — 0/1

**All runs failed with same error:** File mismatch for ReactFlightDOMServerBrowser.js

**Sample agent response (run 1):**
```
Done. The bug was on line 89 in the `startReadingFromDebugChannelReadableStream` function. The loop condition `i <= messages.length - 1` was changed to the correct form `i < messages.length`. While both are logically equivalent, the latter is the standard pattern and avoids the subtle issue of off-by-one thinking. The fix also simplifies the expression by removing the unnecessary `- 1` arithmetic.
```

**Diff (expected vs actual):**
```diff
@@ -69 @@
       ? readFinalStringChunk(stringDecoder, new Uint8Array(0))
       : readPartialStringChunk(stringDecoder, buffer);
     const messages = stringBuffer.split('\n');
-    for (let i = 0; i < messages.length - 1; i++) {
+    for (let i = 0; i < messages.length; i++) {
       resolveDebugMessage(request, messages[i]);
     }
     stringBuffer = messages[messages.length - 1];
```

### Operator Swap Logical 002 (SourceMapMetadataConsumer.js) — 0/1

**All runs failed with same error:** File mismatch for SourceMapMetadataConsumer.js

**Sample agent response (run 1):**
```
Done. The bug was on line 51: the condition was missing parentheses around the `||` operator. The fix adds parentheses to ensure the logic correctly checks that `sourceRoot != null` AND either `sourceRoot` or `source` is absolute, before calling `util.relative()`.
```

**Diff (expected vs actual):**
```diff
@@ -45 @@
   // be particularly problematic when the source root is a prefix of the
   // source (valid, but why??). See github issue #199 and bugzil.la/1188982.
   source =
-    sourceRoot != null && util.isAbsolute(sourceRoot) && util.isAbsolute(source)
+    sourceRoot != null && (util.isAbsolute(sourceRoot) || util.isAbsolute(source))
       ? util.relative(sourceRoot, source)
       : source;
   return util.computeSourceURL(sourceRoot, source);
```

### Operator Swap Nullish 002 (EnterLeaveEventPlugin.js) — 0/1

**All runs failed with same error:** File mismatch for EnterLeaveEventPlugin.js

**Sample agent response (run 1):**
```
Done. Changed line 104 from using the logical OR operator (`||`) to the nullish coalescing operator (`??`). This ensures that `relatedTarget` is only replaced with `toElement` when it's actually `null` or `undefined`, not when it's merely a falsy value.
```

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
@@ -91 @@
   let from;
   let to;
   if (isOutEvent) {
-    const related = nativeEvent.relatedTarget || (nativeEvent: any).toElement;
+    const related = nativeEvent.relatedTarget ?? (nativeEvent: any).toElement;
     from = targetInst;
     to = related ? getClosestInstanceFromNode((related: any)) : null;
     if (to !== null) {
```

### Operator Swap Nullish 003 (backend.js) — 0/1

**All runs failed with same error:** File mismatch for backend.js

**Sample agent response (run 1):**
```
Done. The bug on line 414 has been fixed. The nullish coalescing operator (`??`) replaces the logical OR (`||`), which is the correct operator for this pattern. This ensures that falsy values like `0`, `false`, or empty strings are not treated as absent—only `null` and `undefined` trigger the fallback to `hook.resolveRNStyle`.
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
@@ -378 @@
 
   const unsubscribeBackend = initBackend(hook, agent, window, isReloadAndProfileSupported);
 
-  const nativeStyleResolver: ResolveNativeStyle | void = resolveRNStyle || hook.resolveRNStyle;
+  const nativeStyleResolver: ResolveNativeStyle | void = resolveRNStyle ?? hook.resolveRNStyle;
 
   if (nativeStyleResolver != null) {
     const validAttributes =
```

### Structural Delete Statement 002 (getComponentNameFromFiber.js) — 0/1

**All runs failed with same error:** File mismatch for getComponentNameFromFiber.js

**Sample agent response (run 1):**
```
The bug has been fixed. The critical statement that was deleted was:

```javascript
const functionName = getComponentNameFromType(innerType);
```

This statement computes the `functionName` variable from the `innerType` parameter using the imported `getComponentNameFromType` function. Without it, the variable `functionName` was undefined when referenced on line 63, causing a runtime error.
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

### Structural Delete Statement 003 (simulateBrowserEventDispatch.js) — 0/1

**All runs failed with same error:** File mismatch for simulateBrowserEventDispatch.js

**Sample agent response (run 1):**
```
Perfect. The fix has been applied successfully. The missing `await waitForMicrotasks();` statement has been restored after the event listener invocation loops complete (line 227), which is the critical statement that was deleted.

This statement is essential because:
1. It implements the core behavior described in the comments: "Real browser events yield to microtasks in-between event handlers"
2. It ensures that after all event listeners have been invoked, the code yields to the microtask qu...
```

**Diff (expected vs actual):**
```diff
@@ -82 @@
     const isActivationEvent = false; // TODO Not ported in fork.
 
     if (isActivationEvent && targetImpl._hasActivationBehavior) {
-      activationTarget = targetImpl;
     }
 
     let slotInClosedTree = false;
@@ -197 @@
     }
   }
 
+  await waitForMicrotasks();
+
   eventImpl.eventPhase = EVENT_PHASE.NONE;
 
   eventImpl.currentTarget = null;
```

### Structural Remove Early Return 001 (InspectedElementStateTree.js) — 0/1

**All runs failed with same error:** File mismatch for InspectedElementStateTree.js

**Sample agent response (run 1):**
```
Perfect. The missing guard clause has been restored:

- Line 40: `if (state == null) {` — guard condition
- Line 41: `return null;` — early return statement
- Line 42: `}` — closing brace

The fix is minimal, preserves the exact code structure, and protects the function from attempting to access `state` when it's null or undefined.
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

**All runs failed with same error:** File mismatch for useCommitFilteringAndNavigation.js

**Sample agent response (run 1):**
```
Done. The missing guard clause has been restored. The 3-line pattern:
- **Line 1**: `if (filtered[i] === commitIndex)`
- **Line 2**: `return i;`
- **Line 3**: closing brace of the if statement

This restores the logic of the `findFilteredIndex` function to properly find and return the index position of a commit in the filtered array, rather than always returning `null`.
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

### Structural Remove Early Return 003 (ReactFiberAsyncAction.js) — 0/1

**All runs failed with same error:** File mismatch for ReactFiberAsyncAction.js

**Sample agent response (run 1):**
```
Perfect. The fix is now complete. The bug was a missing guard clause around lines 118-120. The code that checks `if (pendingEntangledRoots === 0)` and calls `stopIsomorphicDefaultIndicator()` should only execute when `currentEntangledListeners !== null`. 

**Summary of the fix:**
- Added the guard clause `if (currentEntangledListeners !== null)` at line 117 that wraps both:
  - The `pendingEntangledRoots` check and `stopIsomorphicDefaultIndicator()` call (lines 118-120)
  - The rest of the cl...
```

**Diff (expected vs actual):**
```diff
@@ -98 @@
       }
     }
     clearEntangledAsyncTransitionTypes();
-    if (pendingEntangledRoots === 0) {
-      stopIsomorphicDefaultIndicator();
-    }
     if (currentEntangledListeners !== null) {
     if (currentEntangledListeners !== null) {
+      if (pendingEntangledRoots === 0) {
+        stopIsomorphicDefaultIndicator();
+      }
       // All the actions have finished. Close the entangled async action scope
       // and notify all the listeners.
       if (currentEntangledActionThenable !== null) {
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

### Structural Swap Adjacent Lines 002 (ReactNoopFlightServer.js) — 0/1

**All runs failed with same error:** File mismatch for ReactNoopFlightServer.js

**Sample agent response (run 1):**
```
Done. The two adjacent lines have been swapped back to their correct order. The `return textEncoder.encode(content);` statement now properly belongs to the `stringToChunk` function, and `flushBuffered` is now in its correct position.
```

**Diff (expected vs actual):**
```diff
@@ -42 @@
   completeWriting(destination: Destination): void {},
   close(destination: Destination): void {},
   closeWithError(destination: Destination, error: mixed): void {},
-  flushBuffered(destination: Destination): void {},
   stringToChunk(content: string): Uint8Array {
     return textEncoder.encode(content);
   },
   stringToChunk(content: string): Uint8Array {
     return textEncoder.encode(content);
   },
+  flushBuffered(destination: Destination): void {},
   stringToPrecomputedChunk(content: string): Uint8Array {
     return textEncoder.encode(content);
   },
```

### Structural Swap Adjacent Lines 003 (backend.js) — 0/1

**All runs failed with same error:** File mismatch for backend.js

**Sample agent response (run 1):**
```
Done. The bug was in the `connectWithCustomMessagingProtocol` function. The `initBackend` call (lines 406-411) and the flag reset logic (lines 389-391) were in the wrong order. I've moved `initBackend` to execute before the `onReloadAndProfileFlagsReset()` call, which aligns with the correct initialization sequence: create the agent, initialize the backend, then reset the flags.
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
@@ -359 @@
   }
 
   const agent = new Agent(bridge, isProfiling, onReloadAndProfile);
+
+  const unsubscribeBackend = initBackend(hook, agent, window, isReloadAndProfileSupported);
+
   if (typeof onReloadAndProfileFlagsReset === 'function') {
     onReloadAndProfileFlagsReset();
   }
@@ -376 @@
     hook.emit('shutdown');
   });
 
-  const unsubscribeBackend = initBackend(hook, agent, window, isReloadAndProfileSupported);
-
   const nativeStyleResolver: ResolveNativeStyle | void = resolveRNStyle || hook.resolveRNStyle;
 
   if (nativeStyleResolver != null) {
```

### Structural Swap If Else 001 (importFile.js) — 0/1

**All runs failed with same error:** File mismatch for importFile.js

**Sample agent response (run 1):**
```
Done. The condition on line 34 is now negated with `!(error instanceof InvalidProfileError)`, which correctly maps:
- When error is NOT an InvalidProfileError → return `'UNEXPECTED_ERROR'`
- When error IS an InvalidProfileError → return `'INVALID_PROFILE_ERROR'`
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

**All runs failed with same error:** File mismatch for ReactNativeFiberInspector.js

**Sample agent response (run 1):**
```
Fixed. The condition in `getInspectorDataForViewTag` has been negated from `if (__DEV__)` to `if (!__DEV__)`, so the error is now thrown only in production builds, and the inspection code executes in development mode—which is the correct behavior.
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
