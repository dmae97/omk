# Edit Benchmark Report

## Configuration

| Setting | Value |
|---------|-------|
| Date | 2026-02-11T09:17:39.390Z |
| Model | openrouter/openrouter/openai/gpt-5.1-codex-mini |
| Thinking Level | default |
| Runs per task | 1 |
| Edit Variant | replace |
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
| Successful Runs | 44 |
| **Task Success Rate** | **73.3% (44/60)** |
| Verified Rate | 73.3% (44/60) |
| Edit Tool Usage Rate | 88.3% (53/60) |
| **Edit Success Rate** | **90.3%** |
| Timeout Runs | 0 |
| Mutation Intent Match Rate | 83.0% |
| Tasks All Passing | 44 |
| Tasks Flaky/Failing | 16 |

### Tool Calls

| Tool | Total | Avg/Run |
|------|-------|---------|
| Read | 175 | 2.9 |
| Edit | 62 | 1.0 |
| Write | 0 | 0.0 |
| **Tool Input Chars** | 28,415 | 474 |

### Tokens & Time

| Metric | Total | Avg/Run |
|--------|-------|---------|
| Input Tokens | 868,675 | 14,478 |
| Output Tokens | 308,078 | 5,135 |
| Total Tokens | 4,059,697 | 67,662 |
| Duration | 5751.5s | 95.9s |
| **Avg Indent Score** | — | **2.25** |

## Task Results

| Task | File | Success | Edit Hit | R/E/W | Tokens (In/Out) | Time | Indent |
|------|------|---------|----------|-------|-----------------|------|--------|
| Access Remove Optional Chain 001 | registerDevToolsEventLogger.js | 1/1 ✅ | 100.0% | 1/1/0 | 6,166/2,212 | 20.3s | 1.00 |
| Access Remove Optional Chain 002 | TimelineContext.js | 1/1 ✅ | 100.0% | 5/1/0 | 12,829/3,742 | 36.1s | 1.29 |
| Access Remove Optional Chain 003 | astUtils.js | 0/1 ❌ | 100.0% | 10/1/0 | 65,394/10,375 | 89.2s | 5.01 |
| Call Swap Call Args 001 | testHelpers.js | 1/1 ✅ | 100.0% | 4/1/0 | 5,767/4,845 | 35.4s | 1.33 |
| Call Swap Call Args 002 | FlamegraphChartBuilder.js | 1/1 ✅ | 100.0% | 9/1/0 | 14,414/8,557 | 188.2s | 3.79 |
| Call Swap Call Args 003 | SyntheticEvent.js | 1/1 ✅ | 100.0% | 3/1/0 | 12,709/6,761 | 48.7s | 3.76 |
| Duplicate Duplicate Line Flip 001 | index.js | 1/1 ✅ | 100.0% | 1/1/0 | 1,629/269 | 11.0s | 0.00 |
| Duplicate Duplicate Line Flip 002 | ActivityList.js | 1/1 ✅ | 100.0% | 1/1/0 | 5,839/1,224 | 11.4s | 3.61 |
| Duplicate Duplicate Line Flip 003 | SyntheticEvent.js | 1/1 ✅ | 100.0% | 1/1/0 | 9,755/9,584 | 69.9s | 1.12 |
| Identifier Identifier Multi Edit 001 | TabBar.js | 1/1 ✅ | 100.0% | 8/3/0 | 27,947/10,952 | 84.8s | 3.33 |
| Identifier Identifier Multi Edit 002 | EventPluginRegistry.js | 1/1 ✅ | 33.3% | 5/3/0 | 29,963/6,470 | 168.1s | 3.94 |
| Identifier Identifier Multi Edit 003 | ReactPerformanceTrackProperties.js | 1/1 ✅ | 100.0% | 14/2/0 | 163,260/6,351 | 86.6s | 9.95 |
| Import Swap Named Imports 001 | CommitFlamegraphListItem.js | 1/1 ✅ | 100.0% | 1/1/0 | 6,574/542 | 12.6s | 2.86 |
| Import Swap Named Imports 002 | ReactDOMTextarea.js | 1/1 ✅ | 100.0% | 3/1/0 | 11,470/2,773 | 23.8s | 2.41 |
| Import Swap Named Imports 003 | StyleEditor.js | 0/1 ❌ | 100.0% | 0/1/0 | 646/11,865 | 249.2s | 1.31 |
| Literal Flip Boolean 001 | testHelpers.js | 1/1 ✅ | 100.0% | 1/1/0 | 3,679/168 | 5.6s | 1.33 |
| Literal Flip Boolean 002 | ReactNoopFlightServer.js | 1/1 ✅ | 100.0% | 5/1/0 | 8,159/2,320 | 27.9s | 1.11 |
| Literal Flip Boolean 003 | ReactFlightDOMClientEdge.js | 1/1 ✅ | 100.0% | 5/1/0 | 14,060/3,808 | 31.7s | 3.58 |
| Literal Off By One 001 | githubAPI.js | 1/1 ✅ | 100.0% | 1/1/0 | 4,278/267 | 5.7s | 0.67 |
| Literal Off By One 002 | code-path.js | 1/1 ✅ | 100.0% | 1/1/0 | 10,691/15,620 | 109.6s | 3.50 |
| Literal Off By One 003 | InspectedElement.js | 1/1 ✅ | 100.0% | 6/1/0 | 27,971/10,718 | 90.9s | 3.60 |
| Operator Remove Negation 001 | ReactDOMClient.js | 0/1 ❌ | 100.0% | 0/0/0 | 0/0 | 360.4s | 0.00 |
| Operator Remove Negation 002 | NativeEventsView.js | 1/1 ✅ | 100.0% | 2/1/0 | 2,857/14,246 | 208.1s | 3.03 |
| Operator Remove Negation 003 | ReactFlightUnbundledReferences.js | 0/1 ❌ | 100.0% | 0/0/0 | 0/0 | 360.4s | 0.00 |
| Operator Swap Arithmetic 001 | fallbackEvalContext.js | 1/1 ✅ | 100.0% | 4/1/0 | 6,798/4,470 | 39.0s | 0.00 |
| Operator Swap Arithmetic 002 | CSSShorthandProperty.js | 0/1 ❌ | 100.0% | 0/0/0 | 0/0 | 360.7s | 0.00 |
| Operator Swap Arithmetic 003 | hooks.js | 0/1 ❌ | 100.0% | 3/1/0 | 27,526/9,075 | 66.8s | 2.25 |
| Operator Swap Comparison 001 | index.js | 1/1 ✅ | 100.0% | 1/1/0 | 1,629/181 | 11.0s | 0.00 |
| Operator Swap Comparison 002 | ReactFlightDOMServerBrowser.js | 1/1 ✅ | 100.0% | 2/1/0 | 10,125/573 | 10.5s | 1.57 |
| Operator Swap Comparison 003 | ReactFlightDOMServerNode.js | 1/1 ✅ | 100.0% | 5/1/0 | 40,062/2,531 | 26.2s | 1.95 |
| Operator Swap Equality 001 | readInputData.js | 1/1 ✅ | 100.0% | 1/1/0 | 3,709/399 | 7.7s | 0.00 |
| Operator Swap Equality 002 | editor.js | 1/1 ✅ | 100.0% | 1/1/0 | 4,808/607 | 12.0s | 0.00 |
| Operator Swap Equality 003 | hooks.js | 1/1 ✅ | 100.0% | 1/1/0 | 13,433/1,414 | 14.0s | 2.25 |
| Operator Swap Increment Decrement 001 | ReactFlightDOMClientNode.js | 1/1 ✅ | 100.0% | 1/1/0 | 2,355/218 | 11.5s | 1.52 |
| Operator Swap Increment Decrement 002 | ReactFlightDOMClientNode.js | 1/1 ✅ | 50.0% | 2/2/0 | 10,329/377 | 11.8s | 1.92 |
| Operator Swap Increment Decrement 003 | loadSourceAndMetadata.js | 1/1 ✅ | 100.0% | 3/1/0 | 15,778/581 | 13.0s | 3.72 |
| Operator Swap Logical 001 | profiling.js | 1/1 ✅ | 100.0% | 1/1/0 | 3,464/400 | 9.4s | 0.00 |
| Operator Swap Logical 002 | SourceMapMetadataConsumer.js | 1/1 ✅ | 25.0% | 6/4/0 | 25,792/10,987 | 86.2s | 3.14 |
| Operator Swap Logical 003 | DevToolsFiberComponentStack.js | 1/1 ✅ | 100.0% | 8/1/0 | 27,355/39,596 | 344.4s | 4.13 |
| Operator Swap Nullish 001 | getBatchRange.js | 1/1 ✅ | 100.0% | 1/1/0 | 2,029/334 | 12.2s | 1.33 |
| Operator Swap Nullish 002 | EnterLeaveEventPlugin.js | 1/1 ✅ | 100.0% | 2/1/0 | 21,796/18,079 | 160.0s | 1.56 |
| Operator Swap Nullish 003 | backend.js | 0/1 ❌ | 100.0% | 7/1/0 | 75,609/15,163 | 216.6s | 3.15 |
| Regex Swap Regex Quantifier 001 | githubAPI.js | 1/1 ✅ | 100.0% | 1/1/0 | 2,025/337 | 12.1s | 0.67 |
| Regex Swap Regex Quantifier 002 | ReactFlightStackConfigV8.js | 1/1 ✅ | 100.0% | 3/1/0 | 21,611/16,181 | 108.4s | 3.06 |
| Regex Swap Regex Quantifier 003 | utils.js | 0/1 ❌ | 100.0% | 0/0/0 | 0/0 | 360.4s | 0.00 |
| Structural Delete Statement 001 | UnsupportedVersionDialog.js | 1/1 ✅ | 100.0% | 1/1/0 | 2,473/453 | 6.7s | 6.22 |
| Structural Delete Statement 002 | getComponentNameFromFiber.js | 0/1 ❌ | 100.0% | 6/1/0 | 7,694/2,125 | 28.2s | 0.62 |
| Structural Delete Statement 003 | simulateBrowserEventDispatch.js | 0/1 ❌ | 100.0% | 0/0/0 | 0/0 | 360.4s | 0.00 |
| Structural Remove Early Return 001 | InspectedElementStateTree.js | 0/1 ❌ | 100.0% | 2/1/0 | 5,328/2,747 | 24.7s | 0.36 |
| Structural Remove Early Return 002 | useCommitFilteringAndNavigation.js | 1/1 ✅ | 100.0% | 5/1/0 | 14,129/12,100 | 85.4s | 3.73 |
| Structural Remove Early Return 003 | ReactFiberAsyncAction.js | 0/1 ❌ | 100.0% | 1/1/0 | 9,655/13,699 | 94.7s | 1.46 |
| Structural Swap Adjacent Lines 001 | ReactServerConsoleConfigPlain.js | 1/1 ✅ | 100.0% | 1/1/0 | 4,576/467 | 6.7s | 1.00 |
| Structural Swap Adjacent Lines 002 | ReactNoopFlightServer.js | 1/1 ✅ | 100.0% | 14/1/0 | 22,088/7,843 | 78.6s | 1.11 |
| Structural Swap Adjacent Lines 003 | backend.js | 0/1 ❌ | 100.0% | 0/0/0 | 0/0 | 360.4s | 0.00 |
| Structural Swap If Else 001 | importFile.js | 0/1 ❌ | 100.0% | 1/1/0 | 2,994/414 | 7.5s | 0.00 |
| Structural Swap If Else 002 | ReactNativeFiberInspector.js | 0/1 ❌ | 100.0% | 1/1/0 | 8,930/12,060 | 85.4s | 3.18 |
| Structural Swap If Else 003 | ReactDOMFizzStaticNode.js | 0/1 ❌ | 100.0% | 0/0/0 | 9,245/121 | 361.0s | 0.00 |
| Unicode Unicode Hyphen 001 | Rectangle.js | 1/1 ✅ | 100.0% | 1/1/0 | 4,247/167 | 5.6s | 3.00 |
| Unicode Unicode Hyphen 002 | UnsupportedBridgeProtocolDialog.js | 1/1 ✅ | 100.0% | 1/1/0 | 7,220/318 | 9.6s | 3.83 |
| Unicode Unicode Hyphen 003 | ReactTypes.js | 1/1 ✅ | 100.0% | 1/1/0 | 7,806/392 | 7.2s | 1.24 |

## Category Summary

| Category | Runs | Verified | Edit Used | Success | Min/Avg/Max Difficulty |
|----------|------|----------|-----------|---------|------------------------|
| access | 3 | 66.7% (2/3) | 100.0% (3/3) | 66.7% (2/3) | 7 / 8.7 / 10 |
| call | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) | 6 / 7.7 / 10 |
| duplicate | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) | 7 / 9.7 / 12 |
| identifier | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) | 6 / 9.3 / 14 |
| import | 3 | 66.7% (2/3) | 100.0% (3/3) | 66.7% (2/3) | 2 / 4.7 / 6 |
| literal | 6 | 100.0% (6/6) | 100.0% (6/6) | 100.0% (6/6) | 4 / 6.2 / 9 |
| operator | 21 | 76.2% (16/21) | 85.7% (18/21) | 76.2% (16/21) | 1 / 6.5 / 13 |
| regex | 3 | 66.7% (2/3) | 66.7% (2/3) | 66.7% (2/3) | 6 / 7.3 / 8 |
| structural | 12 | 33.3% (4/12) | 75.0% (9/12) | 33.3% (4/12) | 4 / 7.6 / 15 |
| unicode | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) | 1 / 3.0 / 6 |

## Mutation Summary

| Mutation | Category | Runs | Verified | Edit Used | Success |
|----------|----------|------|----------|-----------|---------|
| delete-statement | structural | 3 | 33.3% (1/3) | 66.7% (2/3) | 33.3% (1/3) |
| duplicate-line-flip | duplicate | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| flip-boolean | literal | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| identifier-multi-edit | identifier | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| off-by-one | literal | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| remove-early-return | structural | 3 | 33.3% (1/3) | 100.0% (3/3) | 33.3% (1/3) |
| remove-negation | operator | 3 | 33.3% (1/3) | 33.3% (1/3) | 33.3% (1/3) |
| remove-optional-chain | access | 3 | 66.7% (2/3) | 100.0% (3/3) | 66.7% (2/3) |
| swap-adjacent-lines | structural | 3 | 66.7% (2/3) | 66.7% (2/3) | 66.7% (2/3) |
| swap-arithmetic | operator | 3 | 33.3% (1/3) | 66.7% (2/3) | 33.3% (1/3) |
| swap-call-args | call | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| swap-comparison | operator | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| swap-equality | operator | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| swap-if-else | structural | 3 | 0.0% (0/3) | 66.7% (2/3) | 0.0% (0/3) |
| swap-increment-decrement | operator | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| swap-logical | operator | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |
| swap-named-imports | import | 3 | 66.7% (2/3) | 100.0% (3/3) | 66.7% (2/3) |
| swap-nullish | operator | 3 | 66.7% (2/3) | 100.0% (3/3) | 66.7% (2/3) |
| swap-regex-quantifier | regex | 3 | 66.7% (2/3) | 66.7% (2/3) | 66.7% (2/3) |
| unicode-hyphen | unicode | 3 | 100.0% (3/3) | 100.0% (3/3) | 100.0% (3/3) |

## Difficulty Summary

| Difficulty Score | Runs | Verified | Edit Used | Success |
|------------------|------|----------|-----------|---------|
| 0-2 | 6 | 83.3% (5/6) | 83.3% (5/6) | 83.3% (5/6) |
| 3-5 | 12 | 75.0% (9/12) | 91.7% (11/12) | 75.0% (9/12) |
| 6-8 | 24 | 79.2% (19/24) | 95.8% (23/24) | 79.2% (19/24) |
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
Could not find a close enough match in EventPluginRegistry.js.

Closest match (86% similar) at line 69:
  -         if (
  +       if (
Closest match was below the 95% similarity threshold.
```

**Patch args**

```diff
{
  "path": "EventPluginRegistry.js",
  "old_text": "        if (\n          !publishEventForPlugin(\n            publishedEvents[eventName],\n            pluginModule,\n            veentName,\n          ) {\n",
  "new_text": "        if (\n          !publishEventForPlugin(\n            publishedEvents[eventName],\n            pluginModule,\n            eventName,\n          ) {\n"
}
```

##### Attempt 2

- Path: EventPluginRegistry.js
- Operation: —

**Tool error**

```
Could not find a close enough match in EventPluginRegistry.js.

Closest match (85% similar) at line 68:
  -       for (const eventName in publishedEvents) {
  +     for (const eventName in publishedEvents) {
Closest match was below the 95% similarity threshold.
```

**Patch args**

```diff
{
  "path": "EventPluginRegistry.js",
  "old_text": "      for (const eventName in publishedEvents) {\n        if (\n          !publishEventForPlugin(\n            publishedEvents[eventName],\n            pluginModule,\n            veentName,\n          ) {\n",
  "new_text": "      for (const eventName in publishedEvents) {\n        if (\n          !publishEventForPlugin(\n            publishedEvents[eventName],\n            pluginModule,\n            eventName,\n          ) {\n"
}
```

### Operator Swap Increment Decrement 002 (ReactFlightDOMClientNode.js)

#### Run 1

##### Attempt 1

- Path: ReactFlightDOMClientNode.js
- Operation: —

**Tool error**

```
Could not find a close enough match in ReactFlightDOMClientNode.js.

Closest match (77% similar) at line 126:
  -     if (--streamEndedCount === 2) {
  +       if (--streamEndedCount === 2) {
Closest match was below the 95% similarity threshold.
```

**Patch args**

```diff
{
  "path": "ReactFlightDOMClientNode.js",
  "old_text": "    if (--streamEndedCount === 2) {\n      close(response);\n    }\n",
  "new_text": "    if (++streamEndedCount === 2) {\n      close(response);\n    }\n"
}
```

### Operator Swap Logical 002 (SourceMapMetadataConsumer.js)

#### Run 1

##### Attempt 1

- Path: SourceMapMetadataConsumer.js
- Operation: —

**Tool error**

```
Could not find a close enough match in SourceMapMetadataConsumer.js.

Closest match (81% similar) at line 50:
  -     source =
  +   source =
Closest match was below the 95% similarity threshold.
```

**Patch args**

```diff
{
  "path": "SourceMapMetadataConsumer.js",
  "old_text": "    source =\n      sourceRoot != null && util.isAbsolute(sourceRoot) || util.isAbsolute(source)\n        ? util.relative(sourceRoot, source)\n        : source;\n",
  "new_text": "    source =\n      sourceRoot != null && util.isAbsolute(sourceRoot) && util.isAbsolute(source)\n        ? util.relative(sourceRoot, source)\n        : source;\n"
}
```

##### Attempt 2

- Path: SourceMapMetadataConsumer.js
- Operation: —

**Tool error**

```
Could not find a close enough match in SourceMapMetadataConsumer.js.

Closest match (81% similar) at line 50:
  -     source =
  +   source =
Closest match was below the 95% similarity threshold.
```

**Patch args**

```diff
{
  "path": "SourceMapMetadataConsumer.js",
  "old_text": "    source =\n      sourceRoot != null && util.isAbsolute(sourceRoot) || util.isAbsolute(source)\n        ? util.relative(sourceRoot, source)\n        : source;\n",
  "new_text": "    source =\n      sourceRoot != null && util.isAbsolute(sourceRoot) && util.isAbsolute(source)\n        ? util.relative(sourceRoot, source)\n        : source;\n"
}
```

##### Attempt 3

- Path: SourceMapMetadataConsumer.js
- Operation: —

**Tool error**

```
Could not find a close enough match in SourceMapMetadataConsumer.js.

Closest match (81% similar) at line 50:
  -     source =
  +   source =
Closest match was below the 95% similarity threshold.
```

**Patch args**

```diff
{
  "path": "SourceMapMetadataConsumer.js",
  "old_text": "    source =\n      sourceRoot != null && util.isAbsolute(sourceRoot) || util.isAbsolute(source)\n        ? util.relative(sourceRoot, source)\n        : source;\n",
  "new_text": "    source =\n      sourceRoot != null && util.isAbsolute(sourceRoot) && util.isAbsolute(source)\n        ? util.relative(sourceRoot, source)\n        : source;\n"
}
```

## Failed Tasks (0% passing)

### Access Remove Optional Chain 003 (astUtils.js) — 0/1

**All runs failed with same error:** File mismatch for astUtils.js

**Sample agent response (run 1):**
```
Optional chaining is required when reading `path.scope.bindings[hookDeclaredVariableName]` because bindings may be `undefined`. Reverted the accidental removal so the `referencePaths` lookup again uses `?.`, matching the intended guard.
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
```

### Import Swap Named Imports 003 (StyleEditor.js) — 0/1

**All runs failed with same error:** File mismatch for StyleEditor.js

**Sample agent response (run 1):**
```
Swapped the destructured imports so they align with their actual usage (`StoreContext` before `BridgeContext`).
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

### Operator Remove Negation 001 (ReactDOMClient.js) — 0/1

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | — | 0 / 0 | 360.4s |

### Operator Remove Negation 003 (ReactFlightUnbundledReferences.js) — 0/1

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | — | 0 / 0 | 360.4s |

### Operator Swap Arithmetic 002 (CSSShorthandProperty.js) — 0/1

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | — | 0 / 0 | 360.7s |

### Operator Swap Arithmetic 003 (hooks.js) — 0/1

**All runs failed with same error:** File mismatch for hooks.js

**Sample agent response (run 1):**
```
identified the failing arithmetic comparison in `useIsOverflowing`: the hook was reporting overflow even when available space equaled total child width because it used `<=`. Swapped the operator back to `<` so overflow is only signaled when content actually exceeds container width. No tests were run; the change is limited to that comparison line.
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
Swapped the incorrect `||` back to nullish coalescing (`??`) in `connectWithCustomMessagingProtocol` so we only fall back to `hook.resolveRNStyle` when `resolveRNStyle` is `null`/`undefined`, matching the intended behavior elsewhere. No tests were run; please execute relevant suites if required.
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

### Regex Swap Regex Quantifier 003 (utils.js) — 0/1

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | — | 0 / 0 | 360.4s |

### Structural Delete Statement 002 (getComponentNameFromFiber.js) — 0/1

**All runs failed with same error:** File mismatch for getComponentNameFromFiber.js

**Sample agent response (run 1):**
```
Statement restored.
```

**Diff (expected vs actual):**
```diff
@@ -54 @@
 
 // Keep in sync with shared/getComponentNameFromType
 function getWrappedName(outerType: mixed, innerType: any, wrapperName: string): string {
-  const functionName = innerType.displayName || innerType.name || '';
+  const functionName = getComponentNameFromType(innerType);
+
   return (
     (outerType: any).displayName ||
     (functionName !== '' ? `${wrapperName}(${functionName})` : wrapperName)
```

### Structural Delete Statement 003 (simulateBrowserEventDispatch.js) — 0/1

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | — | 0 / 0 | 360.4s |

### Structural Remove Early Return 001 (InspectedElementStateTree.js) — 0/1

**All runs failed with same error:** File mismatch for InspectedElementStateTree.js

**Sample agent response (run 1):**
```
Added the missing guard clause to return early when `state` is null, placing it just before the comment about host component filtering. Tests not run (not requested).
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

### Structural Remove Early Return 003 (ReactFiberAsyncAction.js) — 0/1

**All runs failed with same error:** File mismatch for ReactFiberAsyncAction.js

**Sample agent response (run 1):**
```
Added the missing guard in `pingEngtangledActionScope` to exit early if there’s no pending count before decrementing, then proceed with the existing zero-check logic.
```

**Diff (expected vs actual):**
```diff
@@ -85 @@
 }
 
 function pingEngtangledActionScope() {
+  if (currentEntangledPendingCount === 0) {
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

### Structural Swap Adjacent Lines 003 (backend.js) — 0/1

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | — | 0 / 0 | 360.4s |

### Structural Swap If Else 001 (importFile.js) — 0/1

**All runs failed with same error:** File mismatch for importFile.js

**Sample agent response (run 1):**
```
Condition now negated so each branch executes as originally intended: non-`InvalidProfileError` cases return `UNEXPECTED_ERROR`, otherwise `INVALID_PROFILE_ERROR`.
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
Assumptions:
- `__DEV__` is false in production; negating the original condition ensures the error only fires when not in dev.
- Production builds rely on this branch being removed/minified, so behavior matches intent outside dev.

Changed condition to `if (!__DEV__)` so the error still happens in production while the inspector logic runs in dev.
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

### Structural Swap If Else 003 (ReactDOMFizzStaticNode.js) — 0/1

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | — | 9,245 / 121 | 361.0s |

**Sample agent response (run 1):**
```
Assumptions: abort logic should register listener only when signal wasn’t already aborted. Swapped branches meant we treated aborted signal as if it hadn’t been, and vice versa.

Change: reordered signal handling so we first check `signal.aborted` (and abort immediately if true); only if not aborted do we set up the abort listener. This negates the original condition without changing surrounding structure.
```
