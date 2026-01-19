# Edit Benchmark Report

## Configuration

| Setting | Value |
|---------|-------|
| Date | 2026-01-19T12:21:03.090Z |
| Model | anthropic/p-anthropic/claude-haiku-4-5 |
| Thinking Level | default |
| Runs per task | 3 |
| Edit Variant | patch |
| Edit Fuzzy | auto |
| Edit Fuzzy Threshold | auto |
| Require Edit Tool | no |
| No-Edit Baseline | no |

## Summary

| Metric | Value |
|--------|-------|
| Total Tasks | 60 |
| Total Runs | 180 |
| Successful Runs | 103 |
| **Task Success Rate** | **57.2% (103/180)** |
| Verified Rate | 57.2% (103/180) |
| Edit Tool Usage Rate | 98.9% (178/180) |
| **Edit Success Rate** | **80.6%** |
| Patch Failure Rate | 19.4% (61/314) |
| Tasks All Passing | 24 |
| Tasks Flaky/Failing | 36 |

### Tool Calls

| Tool | Total | Avg/Run |
|------|-------|---------|
| Read | 539 | 3.0 |
| Edit | 314 | 1.7 |
| Write | 8 | 0.0 |
| **Tool Input Chars** | 231,003 | 1,283 |

### Tokens & Time

| Metric | Total | Avg/Run |
|--------|-------|---------|
| Input Tokens | 5,741 | 32 |
| Output Tokens | 255,250 | 1,418 |
| Total Tokens | 12,686,461 | 70,480 |
| Duration | 3479.6s | 19.3s |
| **Avg Indent Score** | — | **2.24** |

## Task Results

| Task | File | Success | Edit Hit | R/E/W | Tokens (In/Out) | Time | Indent |
|------|------|---------|----------|-------|-----------------|------|--------|
| Duplicate Duplicate Line Flip 001 | index.js | 3/3 ✅ | 100.0% | 1/1/0 | 15/376 | 7.7s | 0.00 |
| Literal Flip Boolean 001 | testHelpers.js | 3/3 ✅ | 100.0% | 1/1/0 | 15/388 | 8.1s | 1.30 |
| Duplicate Duplicate Line Flip 002 | ActivityList.js | 3/3 ✅ | 100.0% | 1/1/0 | 19/586 | 10.5s | 3.61 |
| Import Swap Named Imports 003 | StyleEditor.js | 2/3 ⚠️ | 100.0% | 1/1/0 | 19/800 | 11.7s | 1.30 |
| Import Swap Named Imports 002 | ReactDOMTextarea.js | 2/3 ⚠️ | 100.0% | 2/1/0 | 25/757 | 13.0s | 2.39 |
| Import Swap Named Imports 001 | CommitFlamegraphListItem.js | 1/3 ⚠️ | 100.0% | 2/1/0 | 21/1,018 | 15.5s | 2.79 |
| Call Swap Call Args 001 | testHelpers.js | 1/3 ⚠️ | 100.0% | 2/1/0 | 21/937 | 13.8s | 0.44 |
| Access Remove Optional Chain 001 | registerDevToolsEventLogger.js | 3/3 ✅ | 100.0% | 3/1/0 | 26/889 | 14.7s | 1.00 |
| Identifier Identifier Multi Edit 002 | EventPluginRegistry.js | 3/3 ✅ | 88.9% | 4/3/0 | 44/1,492 | 19.0s | 3.89 |
| Duplicate Duplicate Line Flip 003 | SyntheticEvent.js | 2/3 ⚠️ | 100.0% | 2/1/0 | 23/1,178 | 17.5s | 1.02 |
| Access Remove Optional Chain 002 | TimelineContext.js | 0/3 ❌ | 71.4% | 4/2/0 | 43/1,224 | 18.5s | 0.83 |
| Literal Off By One 001 | githubAPI.js | 3/3 ✅ | 75.0% | 3/1/0 | 28/947 | 12.1s | 0.67 |
| Access Remove Optional Chain 003 | astUtils.js | 0/3 ❌ | 60.0% | 3/2/0 | 36/1,863 | 23.4s | 4.82 |
| Operator Swap Arithmetic 001 | fallbackEvalContext.js | 2/3 ⚠️ | 100.0% | 1/1/0 | 18/456 | 9.0s | 0.07 |
| Call Swap Call Args 003 | SyntheticEvent.js | 0/3 ❌ | 57.1% | 4/2/0 | 46/2,517 | 28.2s | 3.76 |
| Operator Swap Comparison 001 | index.js | 2/3 ⚠️ | 100.0% | 1/1/0 | 15/381 | 7.5s | 0.00 |
| Identifier Identifier Multi Edit 001 | TabBar.js | 2/3 ⚠️ | 80.0% | 5/3/0 | 53/2,234 | 27.5s | 3.33 |
| Operator Swap Equality 001 | readInputData.js | 3/3 ✅ | 100.0% | 1/1/0 | 16/423 | 7.8s | 0.00 |
| Literal Flip Boolean 002 | ReactNoopFlightServer.js | 1/3 ⚠️ | 100.0% | 3/2/0 | 29/1,538 | 19.1s | 1.11 |
| Literal Off By One 003 | InspectedElement.js | 3/3 ✅ | 100.0% | 4/2/0 | 43/1,232 | 18.0s | 3.57 |
| Call Swap Call Args 002 | FlamegraphChartBuilder.js | 0/3 ❌ | 100.0% | 5/3/0 | 47/2,988 | 33.9s | 3.72 |
| Operator Swap Comparison 002 | ReactFlightDOMServerBrowser.js | 2/3 ⚠️ | 100.0% | 2/1/0 | 25/853 | 12.9s | 1.57 |
| Identifier Identifier Multi Edit 003 | ReactPerformanceTrackProperties.js | 2/3 ⚠️ | 65.0% | 12/7/0 | 113/3,557 | 44.7s | 9.91 |
| Operator Swap Equality 002 | editor.js | 3/3 ✅ | 100.0% | 2/1/0 | 18/685 | 10.0s | 0.00 |
| Operator Swap Equality 003 | hooks.js | 3/3 ✅ | 100.0% | 1/1/0 | 19/559 | 9.1s | 2.25 |
| Operator Remove Negation 001 | ReactDOMClient.js | 2/3 ⚠️ | 57.1% | 3/2/0 | 36/1,730 | 21.5s | 1.08 |
| Literal Flip Boolean 003 | ReactFlightDOMClientEdge.js | 0/3 ❌ | 50.0% | 4/3/0 | 47/1,885 | 23.5s | 3.57 |
| Operator Swap Arithmetic 003 | hooks.js | 0/3 ❌ | 100.0% | 3/1/0 | 28/1,266 | 19.5s | 2.27 |
| Operator Swap Comparison 003 | ReactFlightDOMServerNode.js | 3/3 ✅ | 100.0% | 4/1/0 | 36/1,213 | 18.5s | 1.93 |
| Operator Swap Increment Decrement 001 | ReactFlightDOMClientNode.js | 3/3 ✅ | 100.0% | 1/1/0 | 19/611 | 9.8s | 1.52 |
| Operator Swap Increment Decrement 002 | ReactFlightDOMClientNode.js | 3/3 ✅ | 75.0% | 2/1/0 | 24/737 | 10.4s | 1.92 |
| Operator Swap Increment Decrement 003 | loadSourceAndMetadata.js | 3/3 ✅ | 100.0% | 2/1/0 | 25/647 | 10.4s | 3.72 |
| Operator Swap Arithmetic 002 | CSSShorthandProperty.js | 3/3 ✅ | 80.0% | 4/2/0 | 36/1,606 | 18.7s | 2.85 |
| Regex Swap Regex Quantifier 001 | githubAPI.js | 3/3 ✅ | 100.0% | 1/1/0 | 17/564 | 7.9s | 0.67 |
| Operator Swap Nullish 003 | backend.js | 0/3 ❌ | 100.0% | 2/1/0 | 18/774 | 11.1s | 3.15 |
| Operator Swap Logical 001 | profiling.js | 3/3 ✅ | 77.8% | 2/3/0 | 36/1,007 | 12.5s | 0.00 |
| Operator Swap Logical 003 | DevToolsFiberComponentStack.js | 2/3 ⚠️ | 75.0% | 3/1/0 | 34/1,195 | 16.6s | 3.92 |
| Operator Remove Negation 002 | NativeEventsView.js | 1/3 ⚠️ | 90.0% | 7/3/0 | 56/2,857 | 35.9s | 2.99 |
| Operator Swap Nullish 001 | getBatchRange.js | 3/3 ✅ | 42.9% | 2/2/0 | 30/948 | 13.7s | 1.33 |
| Structural Delete Statement 001 | UnsupportedVersionDialog.js | 3/3 ✅ | 100.0% | 3/1/0 | 24/634 | 10.8s | 6.22 |
| Structural Swap Adjacent Lines 001 | ReactServerConsoleConfigPlain.js | 3/3 ✅ | 100.0% | 3/1/0 | 26/825 | 11.8s | 1.00 |
| Structural Delete Statement 002 | getComponentNameFromFiber.js | 0/3 ❌ | 30.0% | 3/3/0 | 41/1,300 | 17.2s | 0.62 |
| Operator Swap Logical 002 | SourceMapMetadataConsumer.js | 1/3 ⚠️ | 58.3% | 4/4/0 | 50/2,235 | 25.5s | 3.12 |
| Regex Swap Regex Quantifier 003 | utils.js | 2/3 ⚠️ | 75.0% | 3/1/0 | 31/1,631 | 19.9s | 2.00 |
| Structural Swap If Else 002 | ReactNativeFiberInspector.js | 0/3 ❌ | 100.0% | 1/1/0 | 21/695 | 9.9s | 3.18 |
| Structural Remove Early Return 002 | useCommitFilteringAndNavigation.js | 0/3 ❌ | 50.0% | 3/2/0 | 34/1,027 | 15.8s | 3.68 |
| Structural Swap If Else 001 | importFile.js | 0/3 ❌ | 100.0% | 3/2/0 | 32/974 | 12.3s | 0.00 |
| Structural Delete Statement 003 | simulateBrowserEventDispatch.js | 0/3 ❌ | 100.0% | 4/1/0 | 36/1,447 | 19.0s | 4.29 |
| Structural Remove Early Return 001 | InspectedElementStateTree.js | 0/3 ❌ | 50.0% | 3/2/0 | 34/1,194 | 16.4s | 0.36 |
| Unicode Unicode Hyphen 001 | Rectangle.js | 3/3 ✅ | 100.0% | 1/1/0 | 15/313 | 7.0s | 3.00 |
| Structural Remove Early Return 003 | ReactFiberAsyncAction.js | 0/3 ❌ | 100.0% | 4/1/0 | 37/1,719 | 20.8s | 1.49 |
| Unicode Unicode Hyphen 002 | UnsupportedBridgeProtocolDialog.js | 3/3 ✅ | 100.0% | 2/1/0 | 19/548 | 9.8s | 3.83 |
| Unicode Unicode Hyphen 003 | ReactTypes.js | 3/3 ✅ | 100.0% | 1/1/0 | 20/624 | 9.7s | 1.24 |
| Structural Swap If Else 003 | ReactDOMFizzStaticNode.js | 3/3 ✅ | 100.0% | 4/1/0 | 31/1,103 | 14.3s | 1.77 |
| Literal Off By One 002 | code-path.js | 0/3 ❌ | 100.0% | 5/3/1 | 50/4,424 | 43.5s | 3.50 |
| Structural Swap Adjacent Lines 003 | backend.js | 0/3 ❌ | 42.9% | 3/2/0 | 34/2,444 | 23.4s | 3.15 |
| Structural Swap Adjacent Lines 002 | ReactNoopFlightServer.js | 1/3 ⚠️ | 100.0% | 6/2/0 | 50/1,907 | 23.4s | 1.11 |
| Regex Swap Regex Quantifier 002 | ReactFlightStackConfigV8.js | 2/3 ⚠️ | 100.0% | 4/1/0 | 33/3,894 | 39.8s | 3.05 |
| Operator Remove Negation 003 | ReactFlightUnbundledReferences.js | 0/3 ❌ | 83.3% | 4/2/1 | 35/3,940 | 114.6s | 2.00 |
| Operator Swap Nullish 002 | EnterLeaveEventPlugin.js | 1/3 ⚠️ | 85.7% | 4/2/0 | 40/5,288 | 52.1s | 1.56 |

## Category Summary

| Category | Runs | Verified | Edit Used | Success | Min/Avg/Max Difficulty |
|----------|------|----------|-----------|---------|------------------------|
| access | 9 | 33.3% (3/9) | 100.0% (9/9) | 33.3% (3/9) | 7 / 8.7 / 10 |
| call | 9 | 11.1% (1/9) | 100.0% (9/9) | 11.1% (1/9) | 6 / 7.7 / 10 |
| duplicate | 9 | 88.9% (8/9) | 100.0% (9/9) | 88.9% (8/9) | 7 / 9.7 / 12 |
| identifier | 9 | 77.8% (7/9) | 100.0% (9/9) | 77.8% (7/9) | 6 / 9.3 / 14 |
| import | 9 | 55.6% (5/9) | 100.0% (9/9) | 55.6% (5/9) | 2 / 4.7 / 6 |
| literal | 18 | 55.6% (10/18) | 100.0% (18/18) | 55.6% (10/18) | 4 / 6.2 / 9 |
| operator | 63 | 68.3% (43/63) | 96.8% (61/63) | 68.3% (43/63) | 1 / 6.5 / 13 |
| regex | 9 | 77.8% (7/9) | 100.0% (9/9) | 77.8% (7/9) | 6 / 7.3 / 8 |
| structural | 36 | 27.8% (10/36) | 100.0% (36/36) | 27.8% (10/36) | 4 / 7.6 / 15 |
| unicode | 9 | 100.0% (9/9) | 100.0% (9/9) | 100.0% (9/9) | 1 / 3.0 / 6 |

## Mutation Summary

| Mutation | Category | Runs | Verified | Edit Used | Success |
|----------|----------|------|----------|-----------|---------|
| delete-statement | structural | 9 | 33.3% (3/9) | 100.0% (9/9) | 33.3% (3/9) |
| duplicate-line-flip | duplicate | 9 | 88.9% (8/9) | 100.0% (9/9) | 88.9% (8/9) |
| flip-boolean | literal | 9 | 44.4% (4/9) | 100.0% (9/9) | 44.4% (4/9) |
| identifier-multi-edit | identifier | 9 | 77.8% (7/9) | 100.0% (9/9) | 77.8% (7/9) |
| off-by-one | literal | 9 | 66.7% (6/9) | 100.0% (9/9) | 66.7% (6/9) |
| remove-early-return | structural | 9 | 0.0% (0/9) | 100.0% (9/9) | 0.0% (0/9) |
| remove-negation | operator | 9 | 33.3% (3/9) | 77.8% (7/9) | 33.3% (3/9) |
| remove-optional-chain | access | 9 | 33.3% (3/9) | 100.0% (9/9) | 33.3% (3/9) |
| swap-adjacent-lines | structural | 9 | 44.4% (4/9) | 100.0% (9/9) | 44.4% (4/9) |
| swap-arithmetic | operator | 9 | 55.6% (5/9) | 100.0% (9/9) | 55.6% (5/9) |
| swap-call-args | call | 9 | 11.1% (1/9) | 100.0% (9/9) | 11.1% (1/9) |
| swap-comparison | operator | 9 | 77.8% (7/9) | 100.0% (9/9) | 77.8% (7/9) |
| swap-equality | operator | 9 | 100.0% (9/9) | 100.0% (9/9) | 100.0% (9/9) |
| swap-if-else | structural | 9 | 33.3% (3/9) | 100.0% (9/9) | 33.3% (3/9) |
| swap-increment-decrement | operator | 9 | 100.0% (9/9) | 100.0% (9/9) | 100.0% (9/9) |
| swap-logical | operator | 9 | 66.7% (6/9) | 100.0% (9/9) | 66.7% (6/9) |
| swap-named-imports | import | 9 | 55.6% (5/9) | 100.0% (9/9) | 55.6% (5/9) |
| swap-nullish | operator | 9 | 44.4% (4/9) | 100.0% (9/9) | 44.4% (4/9) |
| swap-regex-quantifier | regex | 9 | 77.8% (7/9) | 100.0% (9/9) | 77.8% (7/9) |
| unicode-hyphen | unicode | 9 | 100.0% (9/9) | 100.0% (9/9) | 100.0% (9/9) |

## Difficulty Summary

| Difficulty Score | Runs | Verified | Edit Used | Success |
|------------------|------|----------|-----------|---------|
| 0-2 | 18 | 77.8% (14/18) | 100.0% (18/18) | 77.8% (14/18) |
| 3-5 | 36 | 58.3% (21/36) | 100.0% (36/36) | 58.3% (21/36) |
| 6-8 | 72 | 56.9% (41/72) | 100.0% (72/72) | 56.9% (41/72) |
| 9+ | 54 | 50.0% (27/54) | 96.3% (52/54) | 50.0% (27/54) |

## Edit Tool Errors

Failures where the edit tool returned an error or failed to apply the patch.

### Identifier Identifier Multi Edit 002 (EventPluginRegistry.js)

#### Run 3

##### Attempt 1

- Path: EventPluginRegistry.js
- Operation: update

**Tool error**

```
Found 2 matches for context 'recomputePluginOrdering()' in EventPluginRegistry.js. Add more surrounding context or additional @@ anchors to make it unique.
```

**Patch args**

```diff
@@ recomputePluginOrdering()
     for (const eventName in publishedEvents) {
       if (
         !publishEventForPlugin(
           publishedEvents[eventName],
           pluginModule,
-          veentName,
+          eventName,
         )
       ) {
         throw new Error(
```

### Access Remove Optional Chain 002 (TimelineContext.js)

#### Run 1

##### Attempt 1

- Path: /tmp/edit-bench-access-remove-optional-chain-002-l9OHtI/TimelineContext.js
- Operation: update

**Tool error**

```
Found 3 matches for context 'function getState() {' in /tmp/edit-bench-access-remove-optional-chain-002-l9OHtI/TimelineContext.js. Add more surrounding context or additional @@ anchors to make it unique.
```

**Patch args**

```diff
@@ function getState() {
-      return store.profilerStore.profilingData.timelineData || null;
+      return store.profilerStore?.profilingData?.timelineData || null;
     },
```

#### Run 2

##### Attempt 1

- Path: TimelineContext.js
- Operation: update

**Tool error**

```
Found 3 matches for context 'function getState() {' in TimelineContext.js. Add more surrounding context or additional @@ anchors to make it unique.
```

**Patch args**

```diff
@@ function getState() {
-      return store.profilerStore.profilingData.timelineData || null;
+      return store.profilerStore?.profilingData.timelineData || null;
     },
   },
 );
```

### Literal Off By One 001 (githubAPI.js)

#### Run 3

##### Attempt 1

- Path: ./githubAPI.js
- Operation: update

**Tool error**

```
Failed to find expected lines in ./githubAPI.js:
  const data = await response.json();
  if (data.items.length > 1) {
    const item = data.items[0];
```

**Patch args**

```diff
@@ export async function searchGitHubIssues(
   const data = await response.json();
-  if (data.items.length > 1) {
+  if (data.items.length > 0) {
     const item = data.items[0];
```

### Access Remove Optional Chain 003 (astUtils.js)

#### Run 2

##### Attempt 1

- Path: ./astUtils.js
- Operation: update

**Tool error**

```
Line 2: Unexpected line in hunk: '// Checks whether hookNode is a member of targetHookNode'. Lines must start with ' ' (context), '+' (add), or '-' (remove)
```

**Patch args**

```diff
// Checks whether hookNode is a member of targetHookNode
function filterMemberNodesOfTargetHook(
  targetHookNode: NodePath,
  hookNode: NodePath,
): boolean {
  const targetHookName = targetHookNode.node.id.name;
  return (
    targetHookName != null &&
    (targetHookName ===
      (hookNode.node.init.object && hookNode.node.init.object.name) ||
      targetHookName === hookNode.node.init.name)
  );
}
```

#### Run 3

##### Attempt 1

- Path: ./astUtils.js
- Operation: update

**Tool error**

```
Line 3: Expected hunk to start with @@ context marker, got: 'function filterMemberNodesOfTargetHook('
```

**Patch args**

```diff
@@ filterMemberNodesOfTargetHook
-// Checks whether hookNode is a member of targetHookNode
function filterMemberNodesOfTargetHook(
  targetHookNode: NodePath,
  hookNode: NodePath,
): boolean {
  const targetHookName = targetHookNode.node.id.name;
  return (
    targetHookName != null &&
    (targetHookName ===
      (hookNode.node.init.object && hookNode.node.init.object.name) ||
      targetHookName === hookNode.node.init.name)
  );
}
```

### Call Swap Call Args 003 (SyntheticEvent.js)

#### Run 1

##### Attempt 1

- Path: ./SyntheticEvent.js
- Operation: update

**Tool error**

```
Line 2: Unexpected line in hunk: 'function createOrGetPooledEvent('. Lines must start with ' ' (context), '+' (add), or '-' (remove)
```

**Patch args**

```diff
@@ createOrGetPooledEvent
function createOrGetPooledEvent(
  dispatchConfig,
  targetInst,
  nativeEvent,
  nativeInst,
) {
  const EventConstructor = this;
  if (EventConstructor.eventPool.length) {
    const instance = EventConstructor.eventPool.pop();
    EventConstructor.call(
      instance,
      dispatchConfig,
      targetInst,
-     nativeEvent,
-     nativeInst,
+     nativeInst,
+     nativeEvent,
    );
    return instance;
  }
  return new EventConstructor(
    dispatchConfig,
    targetInst,
    nativeEvent,
    nativeInst,
  );
}
```

##### Attempt 2

- Path: ./SyntheticEvent.js
- Operation: update

**Tool error**

```
Line 2: Unexpected line in hunk: 'function createOrGetPooledEvent('. Lines must start with ' ' (context), '+' (add), or '-' (remove)
```

**Patch args**

```diff
@@ 
function createOrGetPooledEvent(
  dispatchConfig,
  targetInst,
  nativeEvent,
  nativeInst,
) {
  const EventConstructor = this;
  if (EventConstructor.eventPool.length) {
    const instance = EventConstructor.eventPool.pop();
    EventConstructor.call(
      instance,
      dispatchConfig,
      targetInst,
-     nativeEvent,
-     nativeInst,
+     nativeInst,
+     nativeEvent,
    );
    return instance;
  }
  return new EventConstructor(
    dispatchConfig,
    targetInst,
    nativeEvent,
    nativeInst,
  );
}
```

#### Run 3

##### Attempt 1

- Path: SyntheticEvent.js
- Operation: update

**Tool error**

```
Line 6: Expected hunk to start with @@ context marker, got: ') {'
```

**Patch args**

```diff
@@ function createOrGetPooledEvent(
  dispatchConfig,
  targetInst,
  nativeEvent,
  nativeInst,
) {
  const EventConstructor = this;
  if (EventConstructor.eventPool.length) {
    const instance = EventConstructor.eventPool.pop();
    EventConstructor.call(
      instance,
      dispatchConfig,
-     targetInst,
      nativeEvent,
+     targetInst,
      nativeInst,
     );
    return instance;
  }
```

### Identifier Identifier Multi Edit 001 (TabBar.js)

#### Run 1

##### Attempt 1

- Path: TabBar.js
- Operation: update

**Tool error**

```
Failed to find context 'TabInfo type definition' in TabBar.js
```

**Patch args**

```diff
@@ TabInfo type definition
 type TabInfo = {
   icon: IconType,
-  di: string,
+  id: string,
   label: string,
   title?: string,
 };

```

#### Run 2

##### Attempt 1

- Path: /tmp/edit-bench-identifier-identifier-multi-edit-001-Fywk0G/TabBar.js
- Operation: update

**Tool error**

```
Failed to find expected lines in /tmp/edit-bench-identifier-identifier-multi-edit-001-Fywk0G/TabBar.js:
       const {icon, di, label, title} = tab;
        const {icon, id, label, title} = tab;
        const {icon, di, label, title} = tab;
```

**Patch args**

```diff
@@
        const {icon, di, label, title} = tab;
         const {icon, id, label, title} = tab;
-        const {icon, di, label, title} = tab;

```

### Identifier Identifier Multi Edit 003 (ReactPerformanceTrackProperties.js)

#### Run 1

##### Attempt 1

- Path: ReactPerformanceTrackProperties.js
- Operation: update

**Tool error**

```
Found 2 matches for context 'const typeName =' in ReactPerformanceTrackProperties.js. Add more surrounding context or additional @@ anchors to make it unique.
```

**Patch args**

```diff
@@ const typeName =
                 getComponentNameFromType(nextValue.type) || '\u2026';
               const line = '\xa0\xa0'.repeat(indent) + key;
               const desc = '<' + typeName + ' \u2026 />';
-              properties.push([REMOVED + line, desc], [DADED + line, desc]);
+              properties.push([REMOVED + line, desc], [ADDED + line, desc]);
               isDeeplyEqual = false;
```

##### Attempt 2

- Path: ReactPerformanceTrackProperties.js
- Operation: update

**Tool error**

```
Found 8 matches for context '} else {' in ReactPerformanceTrackProperties.js. Add more surrounding context or additional @@ anchors to make it unique.
```

**Patch args**

```diff
@@ } else {
       properties.push([DADED + '\xa0\xa0'.repeat(indent) + key, '\u2026']);
       isDeeplyEqual = false;
     }
```

##### Attempt 3

- Path: ReactPerformanceTrackProperties.js
- Operation: update

**Tool error**

```
Found 9 matches for context 'properties.push([' in ReactPerformanceTrackProperties.js. Add more surrounding context or additional @@ anchors to make it unique.
```

**Patch args**

```diff
@@ properties.push([
           UNCHANGED + '\xa0\xa0'.repeat(indent) + key,
           desc +
             ' Referentially unequal function closure. Consider memoization.',
         ]);
         continue;
       }
     }

     // Otherwise, emit the change in property and the values.
     addValueToProperties(key, prevValue, properties, indent, REMOVED);
     addValueToProperties(key, nextValue, properties, indent, ADDED);
     isDeeplyEqual = false;
   }
   } else {
-    properties.push([DADED + '\xa0\xa0'.repeat(indent) + key, '\u2026']);
+    properties.push([ADDED + '\xa0\xa0'.repeat(indent) + key, '\u2026']);
     isDeeplyEqual = false;
   }
```

##### Attempt 4

- Path: ReactPerformanceTrackProperties.js
- Operation: update

**Tool error**

```
Found 8 matches for context '} else {' in ReactPerformanceTrackProperties.js. Add more surrounding context or additional @@ anchors to make it unique.
```

**Patch args**

```diff
@@ } else {
       properties.push([DADED + '\xa0\xa0'.repeat(indent) + key, '\u2026']);
       isDeeplyEqual = false;
     }

     nextPropertiesChecked++;
   }
   return isDeeplyEqual;

```

#### Run 3

##### Attempt 1

- Path: /tmp/edit-bench-identifier-identifier-multi-edit-003-FDmQUS/ReactPerformanceTrackProperties.js
- Operation: update

**Tool error**

```
Found 8 matches for context '} else {' in /tmp/edit-bench-identifier-identifier-multi-edit-003-FDmQUS/ReactPerformanceTrackProperties.js. Add more surrounding context or additional @@ anchors to make it unique.
```

**Patch args**

```diff
@@ } else {
       properties.push([DADED + '\xa0\xa0'.repeat(indent) + key, '\u2026']);
       isDeeplyEqual = false;
     }
```

##### Attempt 2

- Path: /tmp/edit-bench-identifier-identifier-multi-edit-003-FDmQUS/ReactPerformanceTrackProperties.js
- Operation: update

**Tool error**

```
Failed to find expected lines in /tmp/edit-bench-identifier-identifier-multi-edit-003-FDmQUS/ReactPerformanceTrackProperties.js:
  }
  return isDeeplyEqual;
}
          properties.push([DADED + '\xa0\xa0'.repeat(indent) + key, '\u2026']);
```

**Patch args**

```diff
@@ nextPropertiesChecked++;
   }
   return isDeeplyEqual;
 }
-          properties.push([DADED + '\xa0\xa0'.repeat(indent) + key, '\u2026']);
+          properties.push([ADDED + '\xa0\xa0'.repeat(indent) + key, '\u2026']);
```

##### Attempt 3

- Path: /tmp/edit-bench-identifier-identifier-multi-edit-003-FDmQUS/ReactPerformanceTrackProperties.js
- Operation: update

**Tool error**

```
Found 8 matches for context 'isDeeplyEqual = false;' in /tmp/edit-bench-identifier-identifier-multi-edit-003-FDmQUS/ReactPerformanceTrackProperties.js. Add more surrounding context or additional @@ anchors to make it unique.
```

**Patch args**

```diff
@@ isDeeplyEqual = false;
       }
     } else {
-      properties.push([DADED + '\xa0\xa0'.repeat(indent) + key, '\u2026']);
+      properties.push([ADDED + '\xa0\xa0'.repeat(indent) + key, '\u2026']);
       isDeeplyEqual = false;
     }
```

### Operator Remove Negation 001 (ReactDOMClient.js)

#### Run 1

##### Attempt 1

- Path: /tmp/edit-bench-operator-remove-negation-001-vF4P3a/ReactDOMClient.js
- Operation: update

**Tool error**

```
Found 2 matches for context 'if (__DEV__) {' in /tmp/edit-bench-operator-remove-negation-001-vF4P3a/ReactDOMClient.js. Add more surrounding context or additional @@ anchors to make it unique.
```

**Patch args**

```diff
@@ if (__DEV__) {
-  if (foundDevTools && canUseDOM && window.top === window.self) {
+  if (!foundDevTools && canUseDOM && window.top === window.self) {
     // If we're in Chrome or Firefox, provide a download link if not installed.
```

#### Run 2

##### Attempt 1

- Path: /tmp/edit-bench-operator-remove-negation-001-rOwoAX/ReactDOMClient.js
- Operation: update

**Tool error**

```
Found 2 matches for context 'if (' in /tmp/edit-bench-operator-remove-negation-001-rOwoAX/ReactDOMClient.js. Add more surrounding context or additional @@ anchors to make it unique.
```

**Patch args**

```diff
@@ if (
      (navigator.userAgent.indexOf('Chrome') > -1 &&
-        navigator.userAgent.indexOf('Edge') === -1) ||
+        navigator.userAgent.indexOf('Edge') > -1) ||
       navigator.userAgent.indexOf('Firefox') > -1
     ) {
```

#### Run 3

##### Attempt 1

- Path: ReactDOMClient.js
- Operation: update

**Tool error**

```
Found 2 matches for context 'if (__DEV__) {' in ReactDOMClient.js. Add more surrounding context or additional @@ anchors to make it unique.
```

**Patch args**

```diff
@@ if (__DEV__) {
-  if (foundDevTools && canUseDOM && window.top === window.self) {
+  if (!foundDevTools && canUseDOM && window.top === window.self) {
     // If we're in Chrome or Firefox, provide a download link if not installed.
```

### Literal Flip Boolean 003 (ReactFlightDOMClientEdge.js)

#### Run 1

##### Attempt 1

- Path: ReactFlightDOMClientEdge.js
- Operation: update

**Tool error**

```
Found 3 matches for context 'createResponseFromOptions' in ReactFlightDOMClientEdge.js. Add more surrounding context or additional @@ anchors to make it unique.
```

**Patch args**

```diff
@@ createResponseFromOptions
     typeof options.nonce === 'string' ? options.nonce : undefined,
     options && options.temporaryReferences
       ? options.temporaryReferences
       : undefined,
     __DEV__ && options && options.findSourceMapURL
       ? options.findSourceMapURL
       : undefined,
-    __DEV__ && options ? options.replayConsoleLogs === false : false, // defaults to false
+    __DEV__ && options ? options.replayConsoleLogs !== false : false, // defaults to false
     __DEV__ && options && options.environmentName
       ? options.environmentName
       : undefined,
```

#### Run 2

##### Attempt 1

- Path: ReactFlightDOMClientEdge.js
- Operation: update

**Tool error**

```
Failed to find expected lines in ReactFlightDOMClientEdge.js:
   __DEV__ && options && options.findSourceMapURL
     ? options.findSourceMapURL
     : undefined,
   __DEV__ && options ? options.replayConsoleLogs !== false : true, // defaults to false
   __DEV__ && options && options.environmentName
```

**Patch args**

```diff
@@ 
    __DEV__ && options && options.findSourceMapURL
      ? options.findSourceMapURL
      : undefined,
    __DEV__ && options ? options.replayConsoleLogs !== false : true, // defaults to false
    __DEV__ && options && options.environmentName
```

##### Attempt 2

- Path: ReactFlightDOMClientEdge.js
- Operation: update

**Tool error**

```
Found 3 matches for context 'createResponseFromOptions' in ReactFlightDOMClientEdge.js. Add more surrounding context or additional @@ anchors to make it unique.
```

**Patch args**

```diff
@@ createResponseFromOptions
    __DEV__ && options ? options.replayConsoleLogs === false : false, // defaults to false
    __DEV__ && options ? options.replayConsoleLogs === false : true, // defaults to false
-    __DEV__ && options ? options.replayConsoleLogs === false : false, // defaults to false
    __DEV__ && options && options.environmentName
```

##### Attempt 3

- Path: ReactFlightDOMClientEdge.js
- Operation: update

**Tool error**

```
Failed to find expected lines in ReactFlightDOMClientEdge.js:
   __DEV__ && options && options.findSourceMapURL
     ? options.findSourceMapURL
     : undefined,
   __DEV__ && options ? options.replayConsoleLogs === false : false, // defaults to false
   __DEV__ && options ? options.replayConsoleLogs === false : true, // defaults to false
    __DEV__ && options ? options.replayConsoleLogs === false : false, // defaults to false
   __DEV__ && options && options.environmentName
     ? options.environmentName
     : undefined,
```

**Patch args**

```diff
@@ 
    __DEV__ && options && options.findSourceMapURL
      ? options.findSourceMapURL
      : undefined,
    __DEV__ && options ? options.replayConsoleLogs === false : false, // defaults to false
    __DEV__ && options ? options.replayConsoleLogs === false : true, // defaults to false
-    __DEV__ && options ? options.replayConsoleLogs === false : false, // defaults to false
    __DEV__ && options && options.environmentName
      ? options.environmentName
      : undefined,
```

##### Attempt 4

- Path: ReactFlightDOMClientEdge.js
- Operation: update

**Tool error**

```
Line 35: Expected hunk to start with @@ context marker, got: '}'
```

**Patch args**

```diff
@@ function createResponseFromOptions(options: Options) {
  const debugChannel: void | DebugChannel =
    __DEV__ && options && options.debugChannel !== undefined
      ? {
          hasReadable: options.debugChannel.readable !== undefined,
          callback: null,
        }
      : undefined;

  return createResponse(
    options.serverConsumerManifest.moduleMap,
    options.serverConsumerManifest.serverModuleMap,
    options.serverConsumerManifest.moduleLoading,
    noServerCall,
    options.encodeFormAction,
    typeof options.nonce === 'string' ? options.nonce : undefined,
    options && options.temporaryReferences
      ? options.temporaryReferences
      : undefined,
    __DEV__ && options && options.findSourceMapURL
      ? options.findSourceMapURL
      : undefined,
-    __DEV__ && options ? options.replayConsoleLogs === false : false, // defaults to false
-    __DEV__ && options ? options.replayConsoleLogs === false : true, // defaults to false
+    __DEV__ && options ? options.replayConsoleLogs !== false : true, // defaults to false
    __DEV__ && options && options.environmentName
      ? options.environmentName
      : undefined,
    __DEV__ && options && options.startTime != null
      ? options.startTime
      : undefined,
    __DEV__ && options && options.endTime != null ? options.endTime : undefined,
    debugChannel,
  );
}
```

### Operator Swap Increment Decrement 002 (ReactFlightDOMClientNode.js)

#### Run 1

##### Attempt 1

- Path: /tmp/edit-bench-operator-swap-increment-decrement-002-LBqroe/ReactFlightDOMClientNode.js
- Operation: update

**Tool error**

```
Found 2 matches for context 'createFromNodeStream function' in /tmp/edit-bench-operator-swap-increment-decrement-002-LBqroe/ReactFlightDOMClientNode.js. Add more surrounding context or additional @@ anchors to make it unique.
```

**Patch args**

```diff
@@ createFromNodeStream function
     let streamEndedCount = 0;
     const handleEnd = () => {
-      if (--streamEndedCount === 2) {
+      if (++streamEndedCount === 2) {
         close(response);
       }
     };
```

### Operator Swap Arithmetic 002 (CSSShorthandProperty.js)

#### Run 2

##### Attempt 1

- Path: /tmp/edit-bench-operator-swap-arithmetic-002-ZlIPSc/CSSShorthandProperty.js
- Operation: update

**Tool error**

```
Failed to find expected lines in /tmp/edit-bench-operator-swap-arithmetic-002-ZlIPSc/CSSShorthandProperty.js:
*
* This source code is licensed under the MIT license found in the
/ LICENSE file in the root directory of this source tree.
*/
```

**Patch args**

```diff
@@ 
 *
 * This source code is licensed under the MIT license found in the
 / LICENSE file in the root directory of this source tree.
 */
+ *
+ * This source code is licensed under the MIT license found in the
+ * LICENSE file in the root directory of this source tree.

```

### Operator Swap Logical 001 (profiling.js)

#### Run 2

##### Attempt 1

- Path: profiling.js
- Operation: update

**Tool error**

```
Failed to find expected lines in profiling.js:
  /* global __REACT_DEVTOOLS_GLOBAL_HOOK__ */
  if (
    typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ === 'undefined' &&
  ) {
    return;
  }
```

**Patch args**

```diff
@@ function checkDCE() {
   /* global __REACT_DEVTOOLS_GLOBAL_HOOK__ */
   if (
     typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ === 'undefined' &&
+    typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE !== 'function'
   ) {
     return;
   }
```

##### Attempt 2

- Path: profiling.js
- Operation: update

**Tool error**

```
Failed to find expected lines in profiling.js:
  if (
    typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ === 'undefined' &&
  ) {
    return;
  }
  if (process.env.NODE_ENV !== 'production') {
```

**Patch args**

```diff
@@ 
   if (
     typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ === 'undefined' &&
+    typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE !== 'function'
   ) {
     return;
   }
   if (process.env.NODE_ENV !== 'production') {
```

### Operator Swap Logical 003 (DevToolsFiberComponentStack.js)

#### Run 3

##### Attempt 1

- Path: /tmp/edit-bench-operator-swap-logical-003-9uyTyV/DevToolsFiberComponentStack.js
- Operation: update

**Tool error**

```
Failed to find expected lines in /tmp/edit-bench-operator-swap-logical-003-9uyTyV/DevToolsFiberComponentStack.js:
        if (owner && debugStack) {
          if (typeof debugStack !== 'string') {
            debugStack = formatOwnerStack(debugStack);
          }
          if (debugStack !== '') {
            info += '\n' + debugStack;
          }
        }
          // Server Component
          const ownerStack: Error = owner.debugStack;
          owner = owner.owner;
          if (owner || ownerStack) {
            info += '\n' + formatOwnerStack(ownerStack);
          }
      } else if (owner.debugStack != null) {
        // Server Component
        const ownerStack: Error = owner.debugStack;
        owner = owner.owner;
        if (owner || ownerStack) {
          info += '\n' + formatOwnerStack(ownerStack);
        }
      } else {
        break;
      }
```

**Patch args**

```diff
@@ getOwnerStackByFiberInDev
         if (owner && debugStack) {
           if (typeof debugStack !== 'string') {
             debugStack = formatOwnerStack(debugStack);
           }
           if (debugStack !== '') {
             info += '\n' + debugStack;
           }
-        }
+        } else if (owner || debugStack) {
           // Server Component
           const ownerStack: Error = owner.debugStack;
           owner = owner.owner;
           if (owner || ownerStack) {
             info += '\n' + formatOwnerStack(ownerStack);
           }
-      } else if (owner.debugStack != null) {
-        // Server Component
-        const ownerStack: Error = owner.debugStack;
-        owner = owner.owner;
-        if (owner || ownerStack) {
-          info += '\n' + formatOwnerStack(ownerStack);
-        }
       } else {
         break;
       }
```

### Operator Remove Negation 002 (NativeEventsView.js)

#### Run 2

##### Attempt 1

- Path: /tmp/edit-bench-operator-remove-negation-002-g39rvP/NativeEventsView.js
- Operation: update

**Tool error**

```
Failed to find expected lines in /tmp/edit-bench-operator-remove-negation-002-g39rvP/NativeEventsView.js:
    };
    if (rectIntersectsRect(eventRect, rect)) {
    }
```

**Patch args**

```diff
@@ _drawSingleNativeEvent
     };
+    if (!rectIntersectsRect(eventRect, rect)) {
+      return; // Not in view
+    }
-    if (rectIntersectsRect(eventRect, rect)) {
-    }
```

### Operator Swap Nullish 001 (getBatchRange.js)

#### Run 1

##### Attempt 1

- Path: /tmp/edit-bench-operator-swap-nullish-001-TohE93/getBatchRange.js
- Operation: update

**Tool error**

```
Line 5: Expected hunk to start with @@ context marker, got: '): [Milliseconds, Milliseconds] {'
```

**Patch args**

```diff
@@ function unmemoizedGetBatchRange(
  batchUID: BatchUID,
  data: TimelineData,
  minStartTime?: number = 0,
): [Milliseconds, Milliseconds] {
  const measures = data.batchUIDToMeasuresMap.get(batchUID);
  if (measures == null ?? measures.length === 0) {
+  if (measures == null || measures.length === 0) {
    throw Error(`Could not find measures with batch UID "${batchUID}"`);
  }
```

##### Attempt 2

- Path: /tmp/edit-bench-operator-swap-nullish-001-TohE93/getBatchRange.js
- Operation: update

**Tool error**

```
Failed to find expected lines in /tmp/edit-bench-operator-swap-nullish-001-TohE93/getBatchRange.js:
 if (measures == null ?? measures.length === 0) {
  if (measures == null ?? measures.length === 0) {
    throw Error(`Could not find measures with batch UID "${batchUID}"`);
  }
```

**Patch args**

```diff
@@ 
  if (measures == null ?? measures.length === 0) {
-  if (measures == null ?? measures.length === 0) {
+  if (measures == null || measures.length === 0) {
     throw Error(`Could not find measures with batch UID "${batchUID}"`);
   }
```

##### Attempt 3

- Path: /tmp/edit-bench-operator-swap-nullish-001-TohE93/getBatchRange.js
- Operation: update

**Tool error**

```
Failed to find expected lines in /tmp/edit-bench-operator-swap-nullish-001-TohE93/getBatchRange.js:
 const measures = data.batchUIDToMeasuresMap.get(batchUID);
 if (measures == null ?? measures.length === 0) {
  if (measures == null ?? measures.length === 0) {
    throw Error(`Could not find measures with batch UID "${batchUID}"`);
  }
```

**Patch args**

```diff
@@ function unmemoizedGetBatchRange(
  const measures = data.batchUIDToMeasuresMap.get(batchUID);
  if (measures == null ?? measures.length === 0) {
-  if (measures == null ?? measures.length === 0) {
+  if (measures == null || measures.length === 0) {
     throw Error(`Could not find measures with batch UID "${batchUID}"`);
   }
```

#### Run 3

##### Attempt 1

- Path: /tmp/edit-bench-operator-swap-nullish-001-fgZ8rd/getBatchRange.js
- Operation: update

**Tool error**

```
Line 5: Expected hunk to start with @@ context marker, got: '): [Milliseconds, Milliseconds] {'
```

**Patch args**

```diff
@@ function unmemoizedGetBatchRange(
  batchUID: BatchUID,
  data: TimelineData,
  minStartTime?: number = 0,
): [Milliseconds, Milliseconds] {
  const measures = data.batchUIDToMeasuresMap.get(batchUID);
- if (measures == null ?? measures.length === 0) {
+ if (measures == null || measures.length === 0) {
    throw Error(`Could not find measures with batch UID "${batchUID}"`);
  }
```

### Structural Delete Statement 002 (getComponentNameFromFiber.js)

#### Run 1

##### Attempt 1

- Path: ./getComponentNameFromFiber.js
- Operation: update

**Tool error**

```
Line 5: Expected hunk to start with @@ context marker, got: '): string {'
```

**Patch args**

```diff
@@ function getWrappedName(
  outerType: mixed,
  innerType: any,
  wrapperName: string,
): string {
  const functionName = (innerType: any).displayName || (innerType: any).name || '';
  return (
    (outerType: any).displayName ||
    (functionName !== '' ? `${wrapperName}(${functionName})` : wrapperName)
  );
}
```

##### Attempt 2

- Path: ./getComponentNameFromFiber.js
- Operation: update

**Tool error**

```
Line 5: Expected hunk to start with @@ context marker, got: '): string {'
```

**Patch args**

```diff
@@ function getWrappedName(
   outerType: mixed,
   innerType: any,
   wrapperName: string,
): string {
+  const functionName = (innerType: any).displayName || (innerType: any).name || '';
   return (
     (outerType: any).displayName ||
     (functionName !== '' ? `${wrapperName}(${functionName})` : wrapperName)
```

##### Attempt 3

- Path: ./getComponentNameFromFiber.js
- Operation: update

**Tool error**

```
Line 2: Unexpected line in hunk: '// Keep in sync with shared/getComponentNameFromType'. Lines must start with ' ' (context), '+' (add), or '-' (remove)
```

**Patch args**

```diff
// Keep in sync with shared/getComponentNameFromType
function getWrappedName(
  outerType: mixed,
  innerType: any,
  wrapperName: string,
): string {
+  const functionName = (innerType: any).displayName || (innerType: any).name || '';
   return (
     (outerType: any).displayName ||
     (functionName !== '' ? `${wrapperName}(${functionName})` : wrapperName)
   );
}
```

##### Attempt 4

- Path: ./getComponentNameFromFiber.js
- Operation: update

**Tool error**

```
Line 5: Expected hunk to start with @@ context marker, got: '): string {'
```

**Patch args**

```diff
@@ function getWrappedName(
 outerType: mixed,
 innerType: any,
 wrapperName: string,
): string {
+  const functionName = (innerType: any).displayName || (innerType: any).name || '';
   return (
     (outerType: any).displayName ||
     (functionName !== '' ? `${wrapperName}(${functionName})` : wrapperName)
```

##### Attempt 5

- Path: ./getComponentNameFromFiber.js
- Operation: update

**Tool error**

```
Found 2 matches for context '// Keep in sync with shared/getComponentNameFromType' in ./getComponentNameFromFiber.js. Add more surrounding context or additional @@ anchors to make it unique.
```

**Patch args**

```diff
@@ // Keep in sync with shared/getComponentNameFromType
 function getWrappedName(
   outerType: mixed,
   innerType: any,
   wrapperName: string,
 ): string {
+  const functionName = (innerType: any).displayName || (innerType: any).name || '';
   return (
     (outerType: any).displayName ||
     (functionName !== '' ? `${wrapperName}(${functionName})` : wrapperName)
```

#### Run 2

##### Attempt 1

- Path: ./getComponentNameFromFiber.js
- Operation: update

**Tool error**

```
Line 5: Expected hunk to start with @@ context marker, got: '): string {'
```

**Patch args**

```diff
@@ function getWrappedName(
  outerType: mixed,
  innerType: any,
  wrapperName: string,
): string {
+  const functionName = getComponentNameFromType(innerType);
  return (
    (outerType: any).displayName ||
    (functionName !== '' ? `${wrapperName}(${functionName})` : wrapperName)
  );
}
```

##### Attempt 2

- Path: ./getComponentNameFromFiber.js
- Operation: update

**Tool error**

```
Line 5: Expected hunk to start with @@ context marker, got: '): string {'
```

**Patch args**

```diff
@@ getWrappedName
  outerType: mixed,
  innerType: any,
  wrapperName: string,
): string {
+  const functionName = getComponentNameFromType(innerType);
  return (
    (outerType: any).displayName ||
    (functionName !== '' ? `${wrapperName}(${functionName})` : wrapperName)
```

### Operator Swap Logical 002 (SourceMapMetadataConsumer.js)

#### Run 2

##### Attempt 1

- Path: /tmp/edit-bench-operator-swap-logical-002-v7EbTB/SourceMapMetadataConsumer.js
- Operation: update

**Tool error**

```
Found 3 matches for context 'normalizeSourcePath(' in /tmp/edit-bench-operator-swap-logical-002-v7EbTB/SourceMapMetadataConsumer.js. Add more surrounding context or additional @@ anchors to make it unique.
```

**Patch args**

```diff
@@ normalizeSourcePath(
  source = util.normalize(source);
  // Some source maps produce relative source paths like "./foo.js" instead of
  // "foo.js".  Normalize these first so that future comparisons will succeed.
  // See bugzil.la/1090768.
  source = util.normalize(source);
  // Always ensure that absolute sources are internally stored relative to
  // the source root, if the source root is absolute. Not doing this would
  // be particularly problematic when the source root is a prefix of the
  // source (valid, but why??). See github issue #199 and bugzil.la/1188982.
  source =
    sourceRoot != null && util.isAbsolute(sourceRoot) && util.isAbsolute(source)
      ? util.relative(sourceRoot, source)
      : source;
```

##### Attempt 2

- Path: /tmp/edit-bench-operator-swap-logical-002-v7EbTB/SourceMapMetadataConsumer.js
- Operation: update

**Tool error**

```
Found 2 matches for context 'let source = sourceInput;' in /tmp/edit-bench-operator-swap-logical-002-v7EbTB/SourceMapMetadataConsumer.js. Add more surrounding context or additional @@ anchors to make it unique.
```

**Patch args**

```diff
@@ let source = sourceInput;

  source = String(source);
  // Some source maps produce relative source paths like "./foo.js" instead of
  // "foo.js".  Normalize these first so that future comparisons will succeed.
  // See bugzil.la/1090768.
  source = util.normalize(source);
  // Always ensure that absolute sources are internally stored relative to
  // the source root, if the source root is absolute. Not doing this would
  // be particularly problematic when the source root is a prefix of the
  // source (valid, but why??). See github issue #199 and bugzil.la/1188982.
  source =
    sourceRoot != null && util.isAbsolute(sourceRoot) || util.isAbsolute(source)
      ? util.relative(sourceRoot, source)
      : source;
  return util.computeSourceURL(sourceRoot, source);
```

##### Attempt 3

- Path: /tmp/edit-bench-operator-swap-logical-002-v7EbTB/SourceMapMetadataConsumer.js
- Operation: update

**Tool error**

```
Line 4: Expected hunk to start with @@ context marker, got: '): string {'
```

**Patch args**

```diff
@@ function normalizeSourcePath(
  sourceInput: string,
  map: {+sourceRoot?: ?string, ...},
): string {
  const {sourceRoot} = map;
  let source = sourceInput;

  source = String(source);
  // Some source maps produce relative source paths like "./foo.js" instead of
  // "foo.js".  Normalize these first so that future comparisons will succeed.
  // See bugzil.la/1090768.
  source = util.normalize(source);
  // Always ensure that absolute sources are internally stored relative to
  // the source root, if the source root is absolute. Not doing this would
  // be particularly problematic when the source root is a prefix of the
  // source (valid, but why??). See github issue #199 and bugzil.la/1188982.
  source =
    sourceRoot != null && util.isAbsolute(sourceRoot) || util.isAbsolute(source)
      ? util.relative(sourceRoot, source)
      : source;
  return util.computeSourceURL(sourceRoot, source);
}
```

##### Attempt 4

- Path: /tmp/edit-bench-operator-swap-logical-002-v7EbTB/SourceMapMetadataConsumer.js
- Operation: update

**Tool error**

```
Line 4: Expected hunk to start with @@ context marker, got: '): string {'
```

**Patch args**

```diff
@@ function normalizeSourcePath(
  sourceInput: string,
  map: {+sourceRoot?: ?string, ...},
): string {
  const {sourceRoot} = map;
  let source = sourceInput;

  source = String(source);
  // Some source maps produce relative source paths like "./foo.js" instead of
  // "foo.js".  Normalize these first so that future comparisons will succeed.
  // See bugzil.la/1090768.
  source = util.normalize(source);
  // Always ensure that absolute sources are internally stored relative to
  // the source root, if the source root is absolute. Not doing this would
  // be particularly problematic when the source root is a prefix of the
  // source (valid, but why??). See github issue #199 and bugzil.la/1188982.
  source =
-   sourceRoot != null && util.isAbsolute(sourceRoot) || util.isAbsolute(source)
+   sourceRoot != null && util.isAbsolute(sourceRoot) && util.isAbsolute(source)
      ? util.relative(sourceRoot, source)
      : source;
  return util.computeSourceURL(sourceRoot, source);
}
```

#### Run 3

##### Attempt 1

- Path: /tmp/edit-bench-operator-swap-logical-002-btNrQj/SourceMapMetadataConsumer.js
- Operation: update

**Tool error**

```
Found 2 matches for context 'normalizeSourcePath function' in /tmp/edit-bench-operator-swap-logical-002-btNrQj/SourceMapMetadataConsumer.js. Add more surrounding context or additional @@ anchors to make it unique.
```

**Patch args**

```diff
@@ normalizeSourcePath function
  source =
    sourceRoot != null && util.isAbsolute(sourceRoot) && util.isAbsolute(source)
      ? util.relative(sourceRoot, source)
      : source;

```

### Regex Swap Regex Quantifier 003 (utils.js)

#### Run 3

##### Attempt 1

- Path: utils.js
- Operation: update

**Tool error**

```
Failed to find context 'function matches for plural logic' in utils.js
```

**Patch args**

```diff
@@ function matches for plural logic
    /[^s]ies$/i.test(word) ||
    /ves$/i.test(word) ||
-   /[^s]s$/i.test(word)
+   /[^s]+s$/i.test(word)

```

### Structural Remove Early Return 002 (useCommitFilteringAndNavigation.js)

#### Run 1

##### Attempt 1

- Path: /tmp/edit-bench-structural-remove-early-return-002-Oon2wo/useCommitFilteringAndNavigation.js
- Operation: update

**Tool error**

```
Found 2 matches for context 'findFilteredIndex function' in /tmp/edit-bench-structural-remove-early-return-002-Oon2wo/useCommitFilteringAndNavigation.js. Add more surrounding context or additional @@ anchors to make it unique.
```

**Patch args**

```diff
@@ findFilteredIndex function
      for (let i = 0; i < filtered.length; i++) {
+      if (filtered[i] === commitIndex) return i;
      }
```

#### Run 2

##### Attempt 1

- Path: /tmp/edit-bench-structural-remove-early-return-002-DCYvWd/useCommitFilteringAndNavigation.js
- Operation: update

**Tool error**

```
Found 2 matches for context 'findFilteredIndex function' in /tmp/edit-bench-structural-remove-early-return-002-DCYvWd/useCommitFilteringAndNavigation.js. Add more surrounding context or additional @@ anchors to make it unique.
```

**Patch args**

```diff
@@ findFilteredIndex function
   const findFilteredIndex = useCallback(
     (commitIndex: number | null, filtered: Array<number>): number | null => {
       if (commitIndex === null) return null;
       for (let i = 0; i < filtered.length; i++) {
+        if (filtered[i] === commitIndex) return i;
       }
       return null;
     },
```

#### Run 3

##### Attempt 1

- Path: /tmp/edit-bench-structural-remove-early-return-002-eikzlO/useCommitFilteringAndNavigation.js
- Operation: update

**Tool error**

```
Found 2 matches for context 'findFilteredIndex function' in /tmp/edit-bench-structural-remove-early-return-002-eikzlO/useCommitFilteringAndNavigation.js. Add more surrounding context or additional @@ anchors to make it unique.
```

**Patch args**

```diff
@@ findFilteredIndex function
  const findFilteredIndex = useCallback(
    (commitIndex: number | null, filtered: Array<number>): number | null => {
      if (commitIndex === null) return null;
      for (let i = 0; i < filtered.length; i++) {
+      if (filtered[i] === commitIndex) return i;
      }
      return null;
    },
    [],
  );
```

### Structural Remove Early Return 001 (InspectedElementStateTree.js)

#### Run 1

##### Attempt 1

- Path: /tmp/edit-bench-structural-remove-early-return-001-xpEte9/InspectedElementStateTree.js
- Operation: —

**Tool error**

```
Validation failed for tool "edit":
  - operation: must have required property 'operation'

Received arguments:
{
  "path": "/tmp/edit-bench-structural-remove-early-return-001-xpEte9/InspectedElementStateTree.js",
  "diff": "@@ line 39-46\n  const isEmpty = entries.length === 0;\n  const isHostComponent = type === ElementTypeHostComponent;\n  if (isHostComponent) {\n    return null;\n  }\n\n  entries.sort(alphaSortEntries);"
}
```

**Patch args**

```diff
@@ line 39-46
  const isEmpty = entries.length === 0;
  const isHostComponent = type === ElementTypeHostComponent;
  if (isHostComponent) {
    return null;
  }

  entries.sort(alphaSortEntries);
```

##### Attempt 2

- Path: /tmp/edit-bench-structural-remove-early-return-001-xpEte9/InspectedElementStateTree.js
- Operation: update

**Tool error**

```
Failed to find expected lines in /tmp/edit-bench-structural-remove-early-return-001-xpEte9/InspectedElementStateTree.js:
 const isEmpty = entries.length === 0;
 const isHostComponent = type === ElementTypeHostComponent;
 if (isEmpty || isHostComponent) {
   return null;
 }
```

**Patch args**

```diff
@@ const isEmpty = entries.length === 0;
  const isEmpty = entries.length === 0;
  const isHostComponent = type === ElementTypeHostComponent;
- if (isEmpty || isHostComponent) {
+ if (isHostComponent) {
    return null;
  }
```

#### Run 2

##### Attempt 1

- Path: /tmp/edit-bench-structural-remove-early-return-001-FgRaeB/InspectedElementStateTree.js
- Operation: —

**Tool error**

```
Validation failed for tool "edit":
  - operation: must have required property 'operation'

Received arguments:
{
  "path": "/tmp/edit-bench-structural-remove-early-return-001-FgRaeB/InspectedElementStateTree.js",
  "diff": "@@ const {state, type} = inspectedElement;\n\n+  if (state == null) {\n+    return null;\n+  }\n   // HostSingleton and HostHoistable may have state that we don't want to expose to users"
}
```

**Patch args**

```diff
@@ const {state, type} = inspectedElement;

+  if (state == null) {
+    return null;
+  }
   // HostSingleton and HostHoistable may have state that we don't want to expose to users
```

### Structural Swap Adjacent Lines 003 (backend.js)

#### Run 1

##### Attempt 1

- Path: backend.js
- Operation: update

**Tool error**

```
Found 2 matches for context 'const agent = new Agent(bridge, isProfiling, onReloadAndProfile);' in backend.js. Add more surrounding context or additional @@ anchors to make it unique.
```

**Patch args**

```diff
@@ const agent = new Agent(bridge, isProfiling, onReloadAndProfile);
-  if (typeof onReloadAndProfileFlagsReset === 'function') {
-    onReloadAndProfileFlagsReset();
-  }
-
   if (onSettingsUpdated != null) {
     agent.addListener('updateHookSettings', onSettingsUpdated);
   }
+  if (typeof onReloadAndProfileFlagsReset === 'function') {
+    onReloadAndProfileFlagsReset();
+  }
+
```

#### Run 2

##### Attempt 1

- Path: backend.js
- Operation: update

**Tool error**

```
Line 48: Expected hunk to start with @@ context marker, got: '}'
```

**Patch args**

```diff
@@ function connectWithCustomMessagingProtocol({
   agent.addListener('shutdown', () => {
     if (onSettingsUpdated != null) {
       agent.removeListener('updateHookSettings', onSettingsUpdated);
     }
 
     // If we received 'shutdown' from `agent`, we assume the `bridge` is already shutting down,
     // and that caused the 'shutdown' event on the `agent`, so we don't need to call `bridge.shutdown()` here.
     hook.emit('shutdown');
   });
 
-  const unsubscribeBackend = initBackend(
+  const nativeStyleResolver: ResolveNativeStyle | void =
+    resolveRNStyle || hook.resolveRNStyle;
+
+  if (nativeStyleResolver != null) {
+    const validAttributes =
+      nativeStyleEditorValidAttributes ||
+      hook.nativeStyleEditorValidAttributes ||
+      null;
+
+    setupNativeStyleEditor(bridge, agent, nativeStyleResolver, validAttributes);
+  }
+
+  return unsubscribeBackend;
+}
+
+export function initBackend(
     hook,
     agent,
     window,
     isReloadAndProfileSupported,
   );
 
-  const nativeStyleResolver: ResolveNativeStyle | void =
-    resolveRNStyle || hook.resolveRNStyle;
-
-  if (nativeStyleResolver != null) {
-    const validAttributes =
-      nativeStyleEditorValidAttributes ||
-      hook.nativeStyleEditorValidAttributes ||
-      null;
-
-    setupNativeStyleEditor(bridge, agent, nativeStyleResolver, validAttributes);
-  }
-
-  return unsubscribeBackend;
}
```

##### Attempt 2

- Path: backend.js
- Operation: update

**Tool error**

```
Found 2 matches for context 'agent.addListener('shutdown', () => {' in backend.js. Add more surrounding context or additional @@ anchors to make it unique.
```

**Patch args**

```diff
@@ agent.addListener('shutdown', () => {
     // If we received 'shutdown' from `agent`, we assume the `bridge` is already shutting down,
     // and that caused the 'shutdown' event on the `agent`, so we don't need to call `bridge.shutdown()` here.
     hook.emit('shutdown');
   });
 
+  const nativeStyleResolver: ResolveNativeStyle | void =
+    resolveRNStyle || hook.resolveRNStyle;
+
   const unsubscribeBackend = initBackend(
     hook,
     agent,
     window,
     isReloadAndProfileSupported,
   );
 
-  const nativeStyleResolver: ResolveNativeStyle | void =
-    resolveRNStyle || hook.resolveRNStyle;
-
   if (nativeStyleResolver != null) {
     const validAttributes =
       nativeStyleEditorValidAttributes ||
```

#### Run 3

##### Attempt 1

- Path: /tmp/edit-bench-structural-swap-adjacent-lines-003-MDz1HS/backend.js
- Operation: update

**Tool error**

```
Found 2 matches for context 'const agent = new Agent(bridge, isProfiling, onReloadAndProfile);' in /tmp/edit-bench-structural-swap-adjacent-lines-003-MDz1HS/backend.js. Add more surrounding context or additional @@ anchors to make it unique.
```

**Patch args**

```diff
@@ const agent = new Agent(bridge, isProfiling, onReloadAndProfile);
-  if (typeof onReloadAndProfileFlagsReset === 'function') {
-    onReloadAndProfileFlagsReset();
-  }

   if (onSettingsUpdated != null) {
     agent.addListener('updateHookSettings', onSettingsUpdated);
   }
   agent.addListener('shutdown', () => {
     if (onSettingsUpdated != null) {
       agent.removeListener('updateHookSettings', onSettingsUpdated);
     }
 
     // If we received 'shutdown' from `agent`, we assume the `bridge` is already shutting down,
     // and that caused the 'shutdown' event on the `agent`, so we don't need to call `bridge.shutdown()` here.
     hook.emit('shutdown');
   });
+
+  if (typeof onReloadAndProfileFlagsReset === 'function') {
+    onReloadAndProfileFlagsReset();
+  }
```

### Operator Remove Negation 003 (ReactFlightUnbundledReferences.js)

#### Run 3

##### Attempt 1

- Path: /tmp/edit-bench-operator-remove-negation-003-WHZapA/ReactFlightUnbundledReferences.js
- Operation: update

**Tool error**

```
Found 2 matches for context 'getReference function' in /tmp/edit-bench-operator-remove-negation-003-WHZapA/ReactFlightUnbundledReferences.js. Add more surrounding context or additional @@ anchors to make it unique.
```

**Patch args**

```diff
@@ getReference function
  let cachedReference = target[name];
- if (!cachedReference) {
+ if (cachedReference) {
    const reference: ClientReference<any> = registerClientReferenceImpl(
```

### Operator Swap Nullish 002 (EnterLeaveEventPlugin.js)

#### Run 2

##### Attempt 1

- Path: /tmp/edit-bench-operator-swap-nullish-002-ZTwFox/EnterLeaveEventPlugin.js
- Operation: update

**Tool error**

```
Failed to find expected lines in /tmp/edit-bench-operator-swap-nullish-002-ZTwFox/EnterLeaveEventPlugin.js:
   if (doc) {
     win = doc.defaultView ?? doc.parentWindow;
   } else {
     win = window;
   }
    win = doc.defaultView ?? doc.parentWindow;
```

**Patch args**

```diff
@@ const doc = (nativeEventTarget: any).ownerDocument;
    if (doc) {
      win = doc.defaultView ?? doc.parentWindow;
    } else {
      win = window;
    }
+win = doc.defaultView || doc.parentWindow;
-    win = doc.defaultView ?? doc.parentWindow;
```

## Flaky Tasks (partial passing)

### Import Swap Named Imports 003 (StyleEditor.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 18 / 630 | 10.3s |
| 2 | ❌ | File mismatch for StyleEditor.js | 18 / 902 | 12.7s |
| 3 | ✅ | — | 20 / 867 | 12.1s |

### Import Swap Named Imports 002 (ReactDOMTextarea.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 26 / 907 | 15.8s |
| 2 | ❌ | File mismatch for ReactDOMTextarea.js | 23 / 571 | 10.7s |
| 3 | ✅ | — | 25 / 794 | 12.6s |

### Import Swap Named Imports 001 (CommitFlamegraphListItem.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for CommitFlamegraphListItem.js | 19 / 836 | 14.1s |
| 2 | ✅ | — | 25 / 992 | 15.2s |
| 3 | ❌ | File mismatch for CommitFlamegraphListItem.js | 20 / 1,227 | 17.2s |

### Call Swap Call Args 001 (testHelpers.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for testHelpers.js | 15 / 659 | 10.0s |
| 2 | ❌ | File mismatch for testHelpers.js | 23 / 812 | 14.1s |
| 3 | ✅ | — | 26 / 1,339 | 17.2s |

### Duplicate Duplicate Line Flip 003 (SyntheticEvent.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 32 / 1,854 | 25.3s |
| 2 | ❌ | File mismatch for SyntheticEvent.js | 19 / 919 | 14.1s |
| 3 | ✅ | — | 19 / 762 | 13.1s |

### Operator Swap Arithmetic 001 (fallbackEvalContext.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 15 / 399 | 10.2s |
| 2 | ✅ | — | 19 / 529 | 8.0s |
| 3 | ❌ | File mismatch for fallbackEvalContext.js | 19 / 439 | 8.7s |

### Operator Swap Comparison 001 (index.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for index.js | 15 / 396 | 7.5s |
| 2 | ✅ | — | 15 / 358 | 7.7s |
| 3 | ✅ | — | 15 / 389 | 7.3s |

### Identifier Identifier Multi Edit 001 (TabBar.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 64 / 1,833 | 26.2s |
| 2 | ✅ | — | 62 / 3,495 | 38.1s |
| 3 | ❌ | File mismatch for TabBar.js | 32 / 1,374 | 18.0s |

### Literal Flip Boolean 002 (ReactNoopFlightServer.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for ReactNoopFlightServer.js | 18 / 872 | 12.8s |
| 2 | ✅ | — | 50 / 2,941 | 34.4s |
| 3 | ❌ | File mismatch for ReactNoopFlightServer.js | 19 / 800 | 10.2s |

### Operator Swap Comparison 002 (ReactFlightDOMServerBrowser.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 22 / 798 | 11.2s |
| 2 | ✅ | — | 22 / 716 | 12.2s |
| 3 | ❌ | File mismatch for ReactFlightDOMServerBrowser.js | 30 / 1,045 | 15.3s |

### Identifier Identifier Multi Edit 003 (ReactPerformanceTrackProperties.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 117 / 3,644 | 47.8s |
| 2 | ❌ | File mismatch for ReactPerformanceTrackProperti... | 108 / 3,301 | 44.1s |
| 3 | ✅ | — | 113 / 3,727 | 42.2s |

### Operator Remove Negation 001 (ReactDOMClient.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 36 / 1,333 | 17.9s |
| 2 | ❌ | File mismatch for ReactDOMClient.js | 45 / 2,860 | 32.9s |
| 3 | ✅ | — | 28 / 996 | 13.6s |

### Operator Swap Logical 003 (DevToolsFiberComponentStack.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 24 / 944 | 13.4s |
| 2 | ✅ | — | 42 / 1,228 | 18.5s |
| 3 | ❌ | File mismatch for DevToolsFiberComponentStack.js | 37 / 1,413 | 18.0s |

### Operator Remove Negation 002 (NativeEventsView.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 28 / 887 | 14.7s |
| 2 | ❌ | File mismatch for NativeEventsView.js | 62 / 4,144 | 49.8s |
| 3 | ❌ | File mismatch for NativeEventsView.js | 79 / 3,539 | 43.3s |

### Operator Swap Logical 002 (SourceMapMetadataConsumer.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for SourceMapMetadataConsumer.js | 28 / 1,062 | 14.2s |
| 2 | ✅ | — | 68 / 3,187 | 31.4s |
| 3 | ❌ | File mismatch for SourceMapMetadataConsumer.js | 54 / 2,455 | 30.9s |

### Regex Swap Regex Quantifier 003 (utils.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 41 / 1,875 | 23.7s |
| 2 | ✅ | — | 30 / 1,281 | 18.1s |
| 3 | ❌ | File mismatch for utils.js | 23 / 1,737 | 18.0s |

### Structural Swap Adjacent Lines 002 (ReactNoopFlightServer.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for ReactNoopFlightServer.js | 28 / 827 | 11.2s |
| 2 | ✅ | — | 80 / 3,581 | 40.1s |
| 3 | ❌ | File mismatch for ReactNoopFlightServer.js | 43 / 1,314 | 18.9s |

### Regex Swap Regex Quantifier 002 (ReactFlightStackConfigV8.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for ReactFlightStackConfigV8.js | 43 / 6,879 | 65.5s |
| 2 | ✅ | — | 19 / 3,130 | 33.5s |
| 3 | ✅ | — | 38 / 1,672 | 20.4s |

### Operator Swap Nullish 002 (EnterLeaveEventPlugin.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for EnterLeaveEventPlugin.js | 33 / 2,852 | 30.9s |
| 2 | ✅ | — | 24 / 1,315 | 24.7s |
| 3 | ❌ | File mismatch for EnterLeaveEventPlugin.js | 64 / 11,697 | 100.6s |

## Failed Tasks (0% passing)

### Access Remove Optional Chain 002 (TimelineContext.js) — 0/3

**All runs failed with same error:** File mismatch for TimelineContext.js

**Sample agent response (run 1):**
```
Done. The optional chaining operators (`?.`) have been restored at line 89 where they were removed. The fix changes:

```javascript
return store.profilerStore.profilingData.timelineData || null;
```

to:

```javascript
return store.profilerStore?.profilingData?.timelineData || null;
```

This ensures safe access to nested properties that may not exist, preventing potential runtime errors when `profilerStore` or `profilingData` are undefined or null.
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

### Access Remove Optional Chain 003 (astUtils.js) — 0/3

**All runs failed with same error:** File mismatch for astUtils.js

**Sample agent response (run 1):**
```
Perfect! The fix has been applied successfully. The optional chaining (`?.`) has been restored to the property access in the `filterMemberWithHookVariableName` function on lines 95-96. 

The bug was that `hook.node.init.property` was being accessed directly without optional chaining, which would cause an error if `hook.node.init` was null or undefined. The fix adds optional chaining (`?.`) to safely handle these cases:
- `hook.node.init?.property?.type` instead of `hook.node.init.property.typ...
```

**Diff (expected vs actual):**
```diff
@@ -84 @@
 // Checks whether hook is the first member node of a state variable declaration node
 function filterMemberWithHookVariableName(hook: NodePath): boolean {
   return (
-    hook.node.init.property.type === AST_NODE_TYPES.NUMERIC_LITERAL &&
-    hook.node.init.property.value === 0
+    hook.node.init?.property?.type === AST_NODE_TYPES.NUMERIC_LITERAL &&
+    hook.node.init?.property?.value === 0
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

**All runs failed with same error:** File mismatch for SyntheticEvent.js

**Sample agent response (run 1):**
```
Perfect. The fix has been applied. The two arguments `nativeEvent` and `nativeInst` were swapped in the `EventConstructor.call()` on lines 313-314. They now correctly pass `nativeInst` (which represents the native event target) before `nativeEvent` to match the SyntheticEvent constructor's expected parameter order.

The bug is now fixed:
- **Before**: `EventConstructor.call(instance, dispatchConfig, targetInst, nativeEvent, nativeInst)`
- **After**: `EventConstructor.call(instance, dispatchCo...
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

### Call Swap Call Args 002 (FlamegraphChartBuilder.js) — 0/3

**All runs failed with same error:** File mismatch for FlamegraphChartBuilder.js

**Sample agent response (run 1):**
```
Good. The fix is applied. Line 161 now reads `walkTree(id, 1, baseDuration)` instead of `walkTree(id, baseDuration, 1)`. 

The two arguments `baseDuration` and `1` have been swapped to restore their original order as requested.
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

### Literal Flip Boolean 003 (ReactFlightDOMClientEdge.js) — 0/3

**All runs failed with same error:** File mismatch for ReactFlightDOMClientEdge.js

**Sample agent response (run 1):**
```
Done. The bug was on line 108: `options.replayConsoleLogs === false` inverted to `options.replayConsoleLogs !== false`.

The original code passed `true` when replayConsoleLogs was explicitly set to `false`, which is backwards. The fix makes it pass the actual value (anything not `false`) or `false` as default, matching the pattern of surrounding parameters and the "defaults to false" comment intent.
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

### Operator Swap Arithmetic 003 (hooks.js) — 0/3

**All runs failed with same error:** File mismatch for hooks.js

**Sample agent response (run 1):**
```
Perfect. The fix has been applied. The comparison operator on line 129 (now showing in the output) has been changed from `<=` to `<`. 

**Fix summary:**
- **File:** `hooks.js`
- **Line:** 129 (in `useIsOverflowing` function)
- **Bug:** Comparison operator was `<=` instead of `<`
- **Change:** `container.clientWidth <= totalChildWidth` → `container.clientWidth < totalChildWidth`

The logic is now correct: the container is only considered overflowing when its client width is strictly less than ...
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
Fixed. The bug was at line 240 where `||` (logical OR) was used instead of `??` (nullish coalescing). This is semantically different:
- `||` treats all falsy values (0, '', false, etc.) as triggers for fallback
- `??` only treats null/undefined as triggers for fallback

The correct operator here is `??` to match the pattern used at line 148 for the same scenario.
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

### Structural Delete Statement 002 (getComponentNameFromFiber.js) — 0/3

**All runs failed with same error:** File mismatch for getComponentNameFromFiber.js

**Sample agent response (run 1):**
```
Done. The deleted statement has been restored. The `getWrappedName` function was missing the variable declaration:

```javascript
const functionName = (innerType: any).displayName || (innerType: any).name || '';
```

This line extracts the function name from `innerType` by checking its `displayName` property first, then falling back to `name`, and finally to an empty string. This variable is then used in the return statement to construct the wrapped component name.
```

**Diff (expected vs actual):**
```diff
@@ -54 @@
 
 // Keep in sync with shared/getComponentNameFromType
 function getWrappedName(outerType: mixed, innerType: any, wrapperName: string): string {
-  const functionName = innerType.displayName || innerType.name || '';
+  const functionName = (innerType: any).displayName || (innerType: any).name || '';
   return (
     (outerType: any).displayName ||
     (functionName !== '' ? `${wrapperName}(${functionName})` : wrapperName)
```

### Structural Swap If Else 002 (ReactNativeFiberInspector.js) — 0/3

**All runs failed with same error:** File mismatch for ReactNativeFiberInspector.js

**Sample agent response (run 1):**
```
Done. The fix is minimal and surgical:

**Change made:** 
- Line 149: Changed `if (__DEV__)` to `if (!__DEV__)` 

**Result:**
- In development (`__DEV__` is true): Goes to else branch, runs the function normally
- In production (`__DEV__` is false, so `!__DEV__` is true): Throws error preventing use

This correctly implements the intended behavior where the function works in dev mode but throws in production.
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

### Structural Remove Early Return 002 (useCommitFilteringAndNavigation.js) — 0/3

**All runs failed with same error:** File mismatch for useCommitFilteringAndNavigation.js

**Sample agent response (run 1):**
```
Perfect. The guard clause has been restored. The fix adds the missing `if` statement with early return inside the `for` loop in the `findFilteredIndex` function. This allows the function to properly search through the filtered array and return the index when a matching commit is found.

The restored pattern is the exact 3-line structure:
- Line 1: `if (filtered[i] === commitIndex) return i;` (the if condition with return statement)
- Lines 2-3: The closing braces for the loop and function
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

### Structural Swap If Else 001 (importFile.js) — 0/3

**All runs failed with same error:** File mismatch for importFile.js

**Sample agent response (run 1):**
```
Done. The fix is applied:

- **Line 34**: Condition negated from `error instanceof InvalidProfileError` to `!(error instanceof InvalidProfileError)`
- **Lines 35-38**: The if block now returns `INVALID_PROFILE_ERROR` (was `UNEXPECTED_ERROR`)
- **Lines 40-43**: The else block now returns `UNEXPECTED_ERROR` (was `INVALID_PROFILE_ERROR`)

The logic is now correct: when the error IS an InvalidProfileError, it returns UNEXPECTED_ERROR; when it's NOT an InvalidProfileError, it returns INVALID_PROFI...
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
         status: 'INVALID_PROFILE_ERROR',
         error,
```

### Structural Delete Statement 003 (simulateBrowserEventDispatch.js) — 0/3

**All runs failed with same error:** File mismatch for simulateBrowserEventDispatch.js

**Sample agent response (run 1):**
```
Perfect. The fix has been applied. The deleted statement `eventImpl.target = wrapperForImpl(struct.item);` has been restored after the loop that searches for a target in the event path. This ensures that if no target is found in the backward loop through the path, `eventImpl.target` is still set to the wrapper of the current struct item, which is the correct default behavior according to the event dispatching spec.
```

**Diff (expected vs actual):**
```diff
@@ -82 @@
     const isActivationEvent = false; // TODO Not ported in fork.
 
     if (isActivationEvent && targetImpl._hasActivationBehavior) {
-      activationTarget = targetImpl;
     }
 
     let slotInClosedTree = false;
@@ -231 @@
     }
   }
 
+  eventImpl.target = wrapperForImpl(struct.item);
   eventImpl.relatedTarget = wrapperForImpl(struct.relatedTarget);
 
   if (eventImpl._stopPropagationFlag) {
```

### Structural Remove Early Return 001 (InspectedElementStateTree.js) — 0/3

**All runs failed with same error:** File mismatch for InspectedElementStateTree.js

**Sample agent response (run 1):**
```
Perfect. The fix is complete. The guard clause has been restored to its correct form:

**What was changed:**
- Line 44: Changed `if (isEmpty || isHostComponent)` to `if (isHostComponent)`

This restores the proper logic flow where:
1. The function returns early only if the element is a HostComponent (which should not expose state)
2. The subsequent code can now properly handle the `isEmpty` case to display "None" when there's no state, or display the state entries otherwise

The fix is minima...
```

**Diff (expected vs actual):**
```diff
@@ -36 @@
   store,
 }: Props): React.Node {
   const { state, type } = inspectedElement;
-  if (state == null) {
-    return null;
-  }
 
   // HostSingleton and HostHoistable may have state that we don't want to expose to users
   const isHostComponent = type === ElementTypeHostComponent;
@@ -44 @@
   const isHostComponent = type === ElementTypeHostComponent;
   const entries = Object.entries(state);
   const isEmpty = entries.length === 0;
-  if (isEmpty || isHostComponent) {
+  if (isHostComponent) {
     return null;
   }
 
```

### Structural Remove Early Return 003 (ReactFiberAsyncAction.js) — 0/3

**All runs failed with same error:** File mismatch for ReactFiberAsyncAction.js

**Sample agent response (run 1):**
```
Perfect. The fix is complete. I've restored the missing guard clause in `startIsomorphicDefaultIndicatorIfNeeded()` that returns early if:
- `isomorphicDefaultTransitionIndicator` is `null`, OR
- `pendingIsomorphicIndicator` is not `null`

This guard clause was removed, leaving the nested `if` statement that would execute the same condition check. By restoring the guard clause, we:
1. Return early when conditions aren't met (cleaner flow)
2. Avoid executing the try-catch block unnecessarily
3...
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
+  if (isomorphicDefaultTransitionIndicator == null || pendingIsomorphicIndicator !== null) {
+    return;
+  }
   if (isomorphicDefaultTransitionIndicator != null && pendingIsomorphicIndicator === null) {
     try {
       pendingIsomorphicIndicator = isomorphicDefaultTransitionIndicator() || noop;
```

### Literal Off By One 002 (code-path.js) — 0/3

**All runs failed with same error:** File mismatch for code-path.js

**Sample agent response (run 1):**
```
Perfect. The fix is complete. The off-by-one error was in the line:

**Before:** `end = segment.nextSegments.length - 1;`  
**After:** `end = segment.nextSegments.length;`

The original code subtracted 1, which caused it to process one fewer element than it should. By removing the `-1`, the loop now correctly iterates through all elements in the `nextSegments` array. The redundant `else if (index === end)` branch has also been removed since it's no longer needed with the corrected `end` value.
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
       if (index < end) {
         item[1] += 1;
         stack.push([segment.nextSegments[index], 0]);
-      } else if (index === end) {
-        item[0] = segment.nextSegments[index];
-        item[1] = 0;
       } else {
         stack.pop();
       }
```

### Structural Swap Adjacent Lines 003 (backend.js) — 0/3

**All runs failed with same error:** File mismatch for backend.js

**Sample agent response (run 1):**
```
Done. The bug was in the `connectWithCustomMessagingProtocol` function where the `onReloadAndProfileFlagsReset()` call was placed before the `agent.addListener('updateHookSettings', ...)` call. I swapped them so the listener setup happens first, before invoking the reset callback. This matches the logical order of initializing listeners before triggering callbacks that depend on the agent being fully configured.
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
+  if (onSettingsUpdated != null) {
+    agent.addListener('updateHookSettings', onSettingsUpdated);
+  }
   if (typeof onReloadAndProfileFlagsReset === 'function') {
     onReloadAndProfileFlagsReset();
   }
@@ -363 @@
     onReloadAndProfileFlagsReset();
   }
 
-  if (onSettingsUpdated != null) {
-    agent.addListener('updateHookSettings', onSettingsUpdated);
-  }
   agent.addListener('shutdown', () => {
     if (onSettingsUpdated != null) {
       agent.removeListener('updateHookSettings', onSettingsUpdated);
```

### Operator Remove Negation 003 (ReactFlightUnbundledReferences.js) — 0/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | Timeout waiting for agent_end | 0 / 0 | 120.2s |
| 2 | ❌ | Timeout waiting for agent_end | 0 / 0 | 120.2s |
| 3 | ❌ | File mismatch for ReactFlightUnbundledReference... | 104 / 11,820 | 103.3s |

**Sample agent response (run 1):**
```
Perfect. The fix is in place. The negation operator was accidentally applied on line 259 (now correctly removed). The logic now correctly checks `if (target.$$async)` instead of `if (!target.$$async)`, meaning:

- When the module IS async, create the Promise proxy and setup the `.then` handling
- When it's NOT async (the else branch), return undefined

This makes semantic sense: async modules should handle the `.then` case with Promise resolution, while non-async modules should not.
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
```
