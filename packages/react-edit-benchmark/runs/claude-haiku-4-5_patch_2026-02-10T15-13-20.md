# Edit Benchmark Report

## Configuration

| Setting | Value |
|---------|-------|
| Date | 2026-02-10T15:08:17.991Z |
| Model | p-anthropic/claude-haiku-4-5 |
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
| Successful Runs | 94 |
| **Task Success Rate** | **52.2% (94/180)** |
| Verified Rate | 52.2% (94/180) |
| Edit Tool Usage Rate | 99.4% (179/180) |
| **Edit Success Rate** | **88.6%** |
| Patch Failure Rate | 11.4% (35/308) |
| Tasks All Passing | 20 |
| Tasks Flaky/Failing | 40 |

### Tool Calls

| Tool | Total | Avg/Run |
|------|-------|---------|
| Read | 362 | 2.0 |
| Edit | 308 | 1.7 |
| Write | 5 | 0.0 |
| **Tool Input Chars** | 172,572 | 959 |

### Tokens & Time

| Metric | Total | Avg/Run |
|--------|-------|---------|
| Input Tokens | 4,318 | 24 |
| Output Tokens | 222,334 | 1,235 |
| Total Tokens | 15,717,514 | 87,320 |
| Duration | 2601.8s | 14.5s |
| **Avg Indent Score** | — | **2.17** |

## Task Results

| Task | File | Success | Edit Hit | R/E/W | Tokens (In/Out) | Time | Indent |
|------|------|---------|----------|-------|-----------------|------|--------|
| Access Remove Optional Chain 001 | registerDevToolsEventLogger.js | 3/3 ✅ | 80.0% | 2/2/0 | 25/1,357 | 15.5s | 1.00 |
| Access Remove Optional Chain 002 | TimelineContext.js | 1/3 ⚠️ | 100.0% | 1/1/0 | 14/441 | 5.7s | 1.29 |
| Access Remove Optional Chain 003 | astUtils.js | 0/3 ❌ | 83.3% | 4/2/0 | 33/4,097 | 36.5s | 4.85 |
| Call Swap Call Args 001 | testHelpers.js | 0/3 ❌ | 100.0% | 1/1/0 | 15/1,045 | 11.0s | 0.89 |
| Call Swap Call Args 002 | FlamegraphChartBuilder.js | 0/3 ❌ | 100.0% | 2/1/0 | 25/2,519 | 22.2s | 3.79 |
| Call Swap Call Args 003 | SyntheticEvent.js | 0/3 ❌ | 100.0% | 7/4/0 | 70/5,325 | 52.0s | 3.76 |
| Duplicate Duplicate Line Flip 001 | index.js | 3/3 ✅ | 100.0% | 1/1/0 | 13/424 | 5.2s | 0.00 |
| Duplicate Duplicate Line Flip 002 | ActivityList.js | 3/3 ✅ | 100.0% | 1/1/0 | 13/514 | 6.9s | 3.61 |
| Duplicate Duplicate Line Flip 003 | SyntheticEvent.js | 3/3 ✅ | 100.0% | 3/1/0 | 22/1,066 | 12.8s | 1.02 |
| Identifier Identifier Multi Edit 001 | TabBar.js | 0/3 ❌ | 100.0% | 2/3/0 | 33/1,156 | 14.4s | 3.16 |
| Identifier Identifier Multi Edit 002 | EventPluginRegistry.js | 1/3 ⚠️ | 100.0% | 4/5/0 | 49/1,486 | 19.4s | 2.63 |
| Identifier Identifier Multi Edit 003 | ReactPerformanceTrackProperties.js | 3/3 ✅ | 100.0% | 4/3/0 | 45/1,492 | 18.4s | 9.95 |
| Import Swap Named Imports 001 | CommitFlamegraphListItem.js | 2/3 ⚠️ | 100.0% | 1/1/0 | 17/697 | 8.4s | 2.86 |
| Import Swap Named Imports 002 | ReactDOMTextarea.js | 1/3 ⚠️ | 100.0% | 1/1/0 | 14/472 | 6.8s | 2.36 |
| Import Swap Named Imports 003 | StyleEditor.js | 1/3 ⚠️ | 100.0% | 1/1/0 | 14/497 | 6.5s | 1.31 |
| Literal Flip Boolean 001 | testHelpers.js | 3/3 ✅ | 100.0% | 1/1/0 | 14/385 | 5.4s | 1.32 |
| Literal Flip Boolean 002 | ReactNoopFlightServer.js | 1/3 ⚠️ | 100.0% | 1/1/0 | 15/892 | 11.5s | 1.11 |
| Literal Flip Boolean 003 | ReactFlightDOMClientEdge.js | 1/3 ⚠️ | 75.0% | 1/1/0 | 19/843 | 11.5s | 3.58 |
| Literal Off By One 001 | githubAPI.js | 3/3 ✅ | 100.0% | 1/1/0 | 16/557 | 6.7s | 0.67 |
| Literal Off By One 002 | code-path.js | 0/3 ❌ | 100.0% | 2/1/0 | 17/1,018 | 10.7s | 3.50 |
| Literal Off By One 003 | InspectedElement.js | 1/3 ⚠️ | 100.0% | 3/2/0 | 33/1,066 | 12.7s | 2.40 |
| Operator Remove Negation 001 | ReactDOMClient.js | 1/3 ⚠️ | 100.0% | 4/3/0 | 43/1,948 | 21.4s | 1.08 |
| Operator Remove Negation 002 | NativeEventsView.js | 2/3 ⚠️ | 100.0% | 2/1/0 | 23/671 | 10.2s | 2.02 |
| Operator Remove Negation 003 | ReactFlightUnbundledReferences.js | 0/3 ❌ | 100.0% | 5/7/0 | 66/7,261 | 109.3s | 1.00 |
| Operator Swap Arithmetic 001 | fallbackEvalContext.js | 1/3 ⚠️ | 100.0% | 4/4/0 | 48/4,392 | 41.1s | 0.00 |
| Operator Swap Arithmetic 002 | CSSShorthandProperty.js | 3/3 ✅ | 100.0% | 1/1/0 | 15/381 | 6.3s | 2.88 |
| Operator Swap Arithmetic 003 | hooks.js | 1/3 ⚠️ | 100.0% | 1/1/0 | 15/611 | 8.8s | 2.25 |
| Operator Swap Comparison 001 | index.js | 3/3 ✅ | 100.0% | 1/1/0 | 17/343 | 7.9s | 0.00 |
| Operator Swap Comparison 002 | ReactFlightDOMServerBrowser.js | 1/3 ⚠️ | 100.0% | 1/1/0 | 17/718 | 9.1s | 1.04 |
| Operator Swap Comparison 003 | ReactFlightDOMServerNode.js | 2/3 ⚠️ | 100.0% | 1/1/0 | 14/932 | 10.8s | 1.95 |
| Operator Swap Equality 001 | readInputData.js | 3/3 ✅ | 100.0% | 1/1/0 | 15/370 | 5.0s | 0.33 |
| Operator Swap Equality 002 | editor.js | 2/3 ⚠️ | 100.0% | 1/1/0 | 15/572 | 7.3s | 0.58 |
| Operator Swap Equality 003 | hooks.js | 3/3 ✅ | 100.0% | 1/1/0 | 15/520 | 7.3s | 2.25 |
| Operator Swap Increment Decrement 001 | ReactFlightDOMClientNode.js | 3/3 ✅ | 100.0% | 1/1/0 | 14/476 | 8.4s | 1.52 |
| Operator Swap Increment Decrement 002 | ReactFlightDOMClientNode.js | 3/3 ✅ | 100.0% | 4/2/0 | 41/1,081 | 13.5s | 1.92 |
| Operator Swap Increment Decrement 003 | loadSourceAndMetadata.js | 2/3 ⚠️ | 100.0% | 2/1/0 | 19/636 | 8.7s | 3.72 |
| Operator Swap Logical 001 | profiling.js | 1/3 ⚠️ | 100.0% | 1/1/0 | 15/502 | 5.4s | 0.00 |
| Operator Swap Logical 002 | SourceMapMetadataConsumer.js | 0/3 ❌ | 50.0% | 1/2/0 | 22/963 | 11.1s | 3.08 |
| Operator Swap Logical 003 | DevToolsFiberComponentStack.js | 1/3 ⚠️ | 100.0% | 2/2/0 | 28/1,508 | 17.9s | 4.13 |
| Operator Swap Nullish 001 | getBatchRange.js | 2/3 ⚠️ | 100.0% | 1/1/0 | 15/425 | 6.5s | 0.89 |
| Operator Swap Nullish 002 | EnterLeaveEventPlugin.js | 0/3 ❌ | 100.0% | 2/2/0 | 28/1,259 | 14.9s | 1.56 |
| Operator Swap Nullish 003 | backend.js | 1/3 ⚠️ | 100.0% | 1/1/0 | 14/622 | 8.4s | 3.15 |
| Regex Swap Regex Quantifier 001 | githubAPI.js | 3/3 ✅ | 100.0% | 1/1/0 | 14/438 | 6.1s | 0.67 |
| Regex Swap Regex Quantifier 002 | ReactFlightStackConfigV8.js | 3/3 ✅ | 100.0% | 2/1/0 | 19/957 | 12.5s | 3.06 |
| Regex Swap Regex Quantifier 003 | utils.js | 3/3 ✅ | 100.0% | 3/2/0 | 29/2,134 | 23.4s | 2.00 |
| Structural Delete Statement 001 | UnsupportedVersionDialog.js | 3/3 ✅ | 100.0% | 1/1/0 | 14/486 | 6.5s | 6.22 |
| Structural Delete Statement 002 | getComponentNameFromFiber.js | 0/3 ❌ | 11.1% | 3/6/0 | 62/2,552 | 23.5s | 0.62 |
| Structural Delete Statement 003 | simulateBrowserEventDispatch.js | 1/3 ⚠️ | 100.0% | 2/1/0 | 18/1,235 | 14.0s | 2.98 |
| Structural Remove Early Return 001 | InspectedElementStateTree.js | 1/3 ⚠️ | 20.0% | 3/3/0 | 37/2,003 | 18.4s | 0.36 |
| Structural Remove Early Return 002 | useCommitFilteringAndNavigation.js | 1/3 ⚠️ | 100.0% | 2/1/0 | 19/652 | 8.9s | 3.73 |
| Structural Remove Early Return 003 | ReactFiberAsyncAction.js | 0/3 ❌ | 100.0% | 1/1/0 | 18/1,006 | 11.5s | 1.46 |
| Structural Swap Adjacent Lines 001 | ReactServerConsoleConfigPlain.js | 3/3 ✅ | 66.7% | 3/3/0 | 37/1,325 | 16.2s | 1.00 |
| Structural Swap Adjacent Lines 002 | ReactNoopFlightServer.js | 0/3 ❌ | 100.0% | 2/1/0 | 20/589 | 8.3s | 1.11 |
| Structural Swap Adjacent Lines 003 | backend.js | 0/3 ❌ | 71.4% | 3/2/0 | 36/3,323 | 28.8s | 3.14 |
| Structural Swap If Else 001 | importFile.js | 0/3 ❌ | 100.0% | 2/1/0 | 16/674 | 7.4s | 0.00 |
| Structural Swap If Else 002 | ReactNativeFiberInspector.js | 1/3 ⚠️ | 100.0% | 1/1/0 | 15/634 | 9.2s | 3.18 |
| Structural Swap If Else 003 | ReactDOMFizzStaticNode.js | 2/3 ⚠️ | 100.0% | 2/1/0 | 19/902 | 10.3s | 2.00 |
| Unicode Unicode Hyphen 001 | Rectangle.js | 3/3 ✅ | 100.0% | 1/1/0 | 15/305 | 5.1s | 3.00 |
| Unicode Unicode Hyphen 002 | UnsupportedBridgeProtocolDialog.js | 2/3 ⚠️ | 100.0% | 1/1/0 | 15/533 | 7.5s | 3.83 |
| Unicode Unicode Hyphen 003 | ReactTypes.js | 3/3 ✅ | 100.0% | 3/1/0 | 21/822 | 10.4s | 1.24 |

## Category Summary

| Category | Runs | Verified | Edit Used | Success | Min/Avg/Max Difficulty |
|----------|------|----------|-----------|---------|------------------------|
| access | 9 | 44.4% (4/9) | 100.0% (9/9) | 44.4% (4/9) | 7 / 8.7 / 10 |
| call | 9 | 0.0% (0/9) | 100.0% (9/9) | 0.0% (0/9) | 6 / 7.7 / 10 |
| duplicate | 9 | 100.0% (9/9) | 100.0% (9/9) | 100.0% (9/9) | 7 / 9.7 / 12 |
| identifier | 9 | 44.4% (4/9) | 100.0% (9/9) | 44.4% (4/9) | 6 / 9.3 / 14 |
| import | 9 | 44.4% (4/9) | 100.0% (9/9) | 44.4% (4/9) | 2 / 4.7 / 6 |
| literal | 18 | 50.0% (9/18) | 100.0% (18/18) | 50.0% (9/18) | 4 / 6.2 / 9 |
| operator | 63 | 55.6% (35/63) | 98.4% (62/63) | 55.6% (35/63) | 1 / 6.5 / 13 |
| regex | 9 | 100.0% (9/9) | 100.0% (9/9) | 100.0% (9/9) | 6 / 7.3 / 8 |
| structural | 36 | 33.3% (12/36) | 100.0% (36/36) | 33.3% (12/36) | 4 / 7.6 / 15 |
| unicode | 9 | 88.9% (8/9) | 100.0% (9/9) | 88.9% (8/9) | 1 / 3.0 / 6 |

## Mutation Summary

| Mutation | Category | Runs | Verified | Edit Used | Success |
|----------|----------|------|----------|-----------|---------|
| delete-statement | structural | 9 | 44.4% (4/9) | 100.0% (9/9) | 44.4% (4/9) |
| duplicate-line-flip | duplicate | 9 | 100.0% (9/9) | 100.0% (9/9) | 100.0% (9/9) |
| flip-boolean | literal | 9 | 55.6% (5/9) | 100.0% (9/9) | 55.6% (5/9) |
| identifier-multi-edit | identifier | 9 | 44.4% (4/9) | 100.0% (9/9) | 44.4% (4/9) |
| off-by-one | literal | 9 | 44.4% (4/9) | 100.0% (9/9) | 44.4% (4/9) |
| remove-early-return | structural | 9 | 22.2% (2/9) | 100.0% (9/9) | 22.2% (2/9) |
| remove-negation | operator | 9 | 33.3% (3/9) | 88.9% (8/9) | 33.3% (3/9) |
| remove-optional-chain | access | 9 | 44.4% (4/9) | 100.0% (9/9) | 44.4% (4/9) |
| swap-adjacent-lines | structural | 9 | 33.3% (3/9) | 100.0% (9/9) | 33.3% (3/9) |
| swap-arithmetic | operator | 9 | 55.6% (5/9) | 100.0% (9/9) | 55.6% (5/9) |
| swap-call-args | call | 9 | 0.0% (0/9) | 100.0% (9/9) | 0.0% (0/9) |
| swap-comparison | operator | 9 | 66.7% (6/9) | 100.0% (9/9) | 66.7% (6/9) |
| swap-equality | operator | 9 | 88.9% (8/9) | 100.0% (9/9) | 88.9% (8/9) |
| swap-if-else | structural | 9 | 33.3% (3/9) | 100.0% (9/9) | 33.3% (3/9) |
| swap-increment-decrement | operator | 9 | 88.9% (8/9) | 100.0% (9/9) | 88.9% (8/9) |
| swap-logical | operator | 9 | 22.2% (2/9) | 100.0% (9/9) | 22.2% (2/9) |
| swap-named-imports | import | 9 | 44.4% (4/9) | 100.0% (9/9) | 44.4% (4/9) |
| swap-nullish | operator | 9 | 33.3% (3/9) | 100.0% (9/9) | 33.3% (3/9) |
| swap-regex-quantifier | regex | 9 | 100.0% (9/9) | 100.0% (9/9) | 100.0% (9/9) |
| unicode-hyphen | unicode | 9 | 88.9% (8/9) | 100.0% (9/9) | 88.9% (8/9) |

## Difficulty Summary

| Difficulty Score | Runs | Verified | Edit Used | Success |
|------------------|------|----------|-----------|---------|
| 0-2 | 18 | 66.7% (12/18) | 100.0% (18/18) | 66.7% (12/18) |
| 3-5 | 36 | 52.8% (19/36) | 100.0% (36/36) | 52.8% (19/36) |
| 6-8 | 72 | 56.9% (41/72) | 100.0% (72/72) | 56.9% (41/72) |
| 9+ | 54 | 40.7% (22/54) | 98.1% (53/54) | 40.7% (22/54) |

## Edit Tool Errors

Failures where the edit tool returned an error or failed to apply the patch.

### Access Remove Optional Chain 001 (registerDevToolsEventLogger.js)

#### Run 3

##### Attempt 1

- Path: /tmp/reach-benchmark-9HqIlD/batch-278ec619-0fe1-46d0-9180-2101273f8bf4/registerDevToolsEventLogger.js
- Operation: —

**Tool error**

```
Diff contains no hunks
```

**Patch args**

```diff
@@ currentLoggingIFrame.contentWindow?.postMessage(
```

### Access Remove Optional Chain 003 (astUtils.js)

#### Run 2

##### Attempt 1

- Path: /tmp/reach-benchmark-9HqIlD/batch-278ec619-0fe1-46d0-9180-2101273f8bf4/astUtils.js
- Operation: —

**Tool error**

```
Found 2 matches for context 'const varDeclInit = variableDeclaratorPath?.node?.init;' in /tmp/reach-benchmark-9HqIlD/batch-278ec619-0fe1-46d0-9180-2101273f8bf4/astUtils.js. Matching strategy: prefix.

  456 |             // within a VariableDeclarator, so we can extract `count` as
  457 |             // the Hook name.
  458 |             const varDeclInit = variableDeclaratorPath?.node.init;
  459 |       const varDeclInit = variableDeclaratorPath?.node?.init;
  460 |             if (varDeclInit != null) {

  457 |             // the Hook name.
  458 |             const varDeclInit = variableDeclaratorPath?.node.init;
  459 |       const varDeclInit = variableDeclaratorPath?.node?.init;
  460 |             if (varDeclInit != null) {
  461 |               switch (varDeclInit.type) {

Add more surrounding context or additional @@ anchors to make it unique.
```

**Patch args**

```diff
@@ const varDeclInit = variableDeclaratorPath?.node?.init;
+      const varDeclInit = variableDeclaratorPath?.node.init;
```

### Literal Flip Boolean 003 (ReactFlightDOMClientEdge.js)

#### Run 2

##### Attempt 1

- Path: ReactFlightDOMClientEdge.js
- Operation: —

**Tool error**

```
Diff contains no hunks
```

**Patch args**

```diff
@@     __DEV__ && options ? options.replayConsoleLogs === false : false, // defaults to false
```

### Operator Swap Logical 002 (SourceMapMetadataConsumer.js)

#### Run 1

##### Attempt 1

- Path: SourceMapMetadataConsumer.js
- Operation: —

**Tool error**

```
Failed to find expected lines in /tmp/reach-benchmark-9HqIlD/batch-a3f03de9-6681-4eb8-80bf-b7f2638d7948/SourceMapMetadataConsumer.js:
 // Always ensure that absolute sources are internally stored relative to
 // the source root, if the source root is absolute. Not doing this would
 // be particularly problematic when the source root is a prefix of the
 // source (valid, but why??). See github issue #199 and bugzil.la/1188982.
 source =
   sourceRoot != null && util.isAbsolute(sourceRoot) || util.isAbsolute(source)
     ? util.relative(sourceRoot, source)
     : source;@@
source = util.normalize(source);
 // Always ensure that absolute sources are internally stored relative to
 // the source root, if the source root is absolute. Not doing this would
 // be particularly problematic when the source root is a prefix of the
 // source (valid, but why??). See github issue #199 and bugzil.la/1188982.
 source =
   sourceRoot != null && util.isAbsolute(sourceRoot) && util.isAbsolute(source)
     ? util.relative(sourceRoot, source)
     : source;

Closest match (51% similar) near line 46:
  44 |   // See bugzil.la/1090768.
  45 |   source = util.normalize(source);
  46 |   // Always ensure that absolute sources are internally stored relative to
  47 |   // the source root, if the source root is absolute. Not doing this would
  48 |   // be particularly problematic when the source root is a prefix of the
```

**Patch args**

```diff
@@ source = util.normalize(source);
  // Always ensure that absolute sources are internally stored relative to
  // the source root, if the source root is absolute. Not doing this would
  // be particularly problematic when the source root is a prefix of the
  // source (valid, but why??). See github issue #199 and bugzil.la/1188982.
  source =
    sourceRoot != null && util.isAbsolute(sourceRoot) || util.isAbsolute(source)
      ? util.relative(sourceRoot, source)
      : source;@@
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

- Path: SourceMapMetadataConsumer.js
- Operation: —

**Tool error**

```
Failed to find expected lines in /tmp/reach-benchmark-9HqIlD/batch-a3f03de9-6681-4eb8-80bf-b7f2638d7948/SourceMapMetadataConsumer.js:
   sourceRoot != null && util.isAbsolute(sourceRoot) || util.isAbsolute(source)
     ? util.relative(sourceRoot, source)
     : source;@@
source =
   sourceRoot != null && util.isAbsolute(sourceRoot) && util.isAbsolute(source)
     ? util.relative(sourceRoot, source)
     : source;

Closest match (42% similar) near line 51:
  49 |   // source (valid, but why??). See github issue #199 and bugzil.la/1188982.
  50 |   source =
  51 |     sourceRoot != null && util.isAbsolute(sourceRoot) || util.isAbsolute(source)
  52 |       ? util.relative(sourceRoot, source)
  53 |       : source;
```

**Patch args**

```diff
@@ source =
    sourceRoot != null && util.isAbsolute(sourceRoot) || util.isAbsolute(source)
      ? util.relative(sourceRoot, source)
      : source;@@
source =
    sourceRoot != null && util.isAbsolute(sourceRoot) && util.isAbsolute(source)
      ? util.relative(sourceRoot, source)
      : source;

```

##### Attempt 3

- Path: SourceMapMetadataConsumer.js
- Operation: —

**Tool error**

```
Failed to find expected lines in /tmp/reach-benchmark-9HqIlD/batch-a3f03de9-6681-4eb8-80bf-b7f2638d7948/SourceMapMetadataConsumer.js:
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
 return util.computeSourceURL(sourceRoot, source);@@
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
 return util.computeSourceURL(sourceRoot, source);

Closest match (53% similar) near line 44:
  42 |   // Some source maps produce relative source paths like "./foo.js" instead of
  43 |   // "foo.js".  Normalize these first so that future comparisons will succeed.
  44 |   // See bugzil.la/1090768.
  45 |   source = util.normalize(source);
  46 |   // Always ensure that absolute sources are internally stored relative to
```

**Patch args**

```diff
@@ // "foo.js".  Normalize these first so that future comparisons will succeed.
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
  return util.computeSourceURL(sourceRoot, source);@@
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
  return util.computeSourceURL(sourceRoot, source);

```

### Structural Delete Statement 002 (getComponentNameFromFiber.js)

#### Run 2

##### Attempt 1

- Path: getComponentNameFromFiber.js
- Operation: —

**Tool error**

```
Found 2 matches for context '// Keep in sync with shared/getComponentNameFromType' in /tmp/reach-benchmark-9HqIlD/batch-a3f03de9-6681-4eb8-80bf-b7f2638d7948/getComponentNameFromFiber.js. Matching strategy: prefix.

  53 | import type {ReactComponentInfo} from '../../shared/ReactTypes';
  54 | 
  55 | // Keep in sync with shared/getComponentNameFromType
  56 | function getWrappedName(
  57 |   outerType: mixed,

  65 | }
  66 | 
  67 | // Keep in sync with shared/getComponentNameFromType
  68 | function getContextName(type: ReactContext<any>) {
  69 |   return type.displayName || 'Context';

Add more surrounding context or additional @@ anchors to make it unique.
```

**Patch args**

```diff
@@ // Keep in sync with shared/getComponentNameFromType
function getWrappedName(
  outerType: mixed,
  innerType: any,
  wrapperName: string,
): string {
  return (
    (outerType: any).displayName ||
    (functionName !== '' ? `${wrapperName}(${functionName})` : wrapperName)
  );
}@@
// Keep in sync with shared/getComponentNameFromType
function getWrappedName(
  outerType: mixed,
  innerType: any,
  wrapperName: string,
): string {
  const functionName = getComponentNameFromType(innerType);
  return (
    (outerType: any).displayName ||
    (functionName !== '' ? `${wrapperName}(${functionName})` : wrapperName)
  );
}

```

##### Attempt 2

- Path: getComponentNameFromFiber.js
- Operation: —

**Tool error**

```
Found 2 matches for context '// Keep in sync with shared/getComponentNameFromType' in /tmp/reach-benchmark-9HqIlD/batch-a3f03de9-6681-4eb8-80bf-b7f2638d7948/getComponentNameFromFiber.js. Matching strategy: prefix.

  53 | import type {ReactComponentInfo} from '../../shared/ReactTypes';
  54 | 
  55 | // Keep in sync with shared/getComponentNameFromType
  56 | function getWrappedName(
  57 |   outerType: mixed,

  65 | }
  66 | 
  67 | // Keep in sync with shared/getComponentNameFromType
  68 | function getContextName(type: ReactContext<any>) {
  69 |   return type.displayName || 'Context';

Add more surrounding context or additional @@ anchors to make it unique.
```

**Patch args**

```diff
@@ // Keep in sync with shared/getComponentNameFromType
function getWrappedName(
  outerType: mixed,
  innerType: any,
  wrapperName: string,
): string {
  return (
    (outerType: any).displayName ||
    (functionName !== '' ? `${wrapperName}(${functionName})` : wrapperName)
  );
}

// Keep in sync with shared/getComponentNameFromType
function getContextName(type: ReactContext<any>) {@@
// Keep in sync with shared/getComponentNameFromType
function getWrappedName(
  outerType: mixed,
  innerType: any,
  wrapperName: string,
): string {
  const functionName = getComponentNameFromType(innerType);
  return (
    (outerType: any).displayName ||
    (functionName !== '' ? `${wrapperName}(${functionName})` : wrapperName)
  );
}

// Keep in sync with shared/getComponentNameFromType
function getContextName(type: ReactContext<any>) {

```

##### Attempt 3

- Path: getComponentNameFromFiber.js
- Operation: —

**Tool error**

```
Failed to find expected lines in /tmp/reach-benchmark-9HqIlD/batch-a3f03de9-6681-4eb8-80bf-b7f2638d7948/getComponentNameFromFiber.js:
import {REACT_STRICT_MODE_TYPE} from 'shared/ReactSymbols';
import type {ReactComponentInfo} from '../../shared/ReactTypes';

// Keep in sync with shared/getComponentNameFromType
function getWrappedName(
 outerType: mixed,
 innerType: any,
 wrapperName: string,
): string {
 return (
   (outerType: any).displayName ||
   (functionName !== '' ? `${wrapperName}(${functionName})` : wrapperName)
 );
}@@
import getComponentNameFromType from 'shared/getComponentNameFromType';
import {REACT_STRICT_MODE_TYPE} from 'shared/ReactSymbols';
import type {ReactComponentInfo} from '../../shared/ReactTypes';

// Keep in sync with shared/getComponentNameFromType
function getWrappedName(
 outerType: mixed,
 innerType: any,
 wrapperName: string,
): string {
 const functionName = getComponentNameFromType(innerType);
 return (
   (outerType: any).displayName ||
   (functionName !== '' ? `${wrapperName}(${functionName})` : wrapperName)
 );
}

Closest match (50% similar) near line 52:
  50 | } from 'react-reconciler/src/ReactWorkTags';
  51 | import getComponentNameFromType from 'shared/getComponentNameFromType';
  52 | import {REACT_STRICT_MODE_TYPE} from 'shared/ReactSymbols';
  53 | import type {ReactComponentInfo} from '../../shared/ReactTypes';
  54 | 
```

**Patch args**

```diff
@@ import getComponentNameFromType from 'shared/getComponentNameFromType';
import {REACT_STRICT_MODE_TYPE} from 'shared/ReactSymbols';
import type {ReactComponentInfo} from '../../shared/ReactTypes';

// Keep in sync with shared/getComponentNameFromType
function getWrappedName(
  outerType: mixed,
  innerType: any,
  wrapperName: string,
): string {
  return (
    (outerType: any).displayName ||
    (functionName !== '' ? `${wrapperName}(${functionName})` : wrapperName)
  );
}@@
import getComponentNameFromType from 'shared/getComponentNameFromType';
import {REACT_STRICT_MODE_TYPE} from 'shared/ReactSymbols';
import type {ReactComponentInfo} from '../../shared/ReactTypes';

// Keep in sync with shared/getComponentNameFromType
function getWrappedName(
  outerType: mixed,
  innerType: any,
  wrapperName: string,
): string {
  const functionName = getComponentNameFromType(innerType);
  return (
    (outerType: any).displayName ||
    (functionName !== '' ? `${wrapperName}(${functionName})` : wrapperName)
  );
}

```

##### Attempt 4

- Path: getComponentNameFromFiber.js
- Operation: —

**Tool error**

```
Failed to find expected lines in /tmp/reach-benchmark-9HqIlD/batch-a3f03de9-6681-4eb8-80bf-b7f2638d7948/getComponentNameFromFiber.js:
 outerType: mixed,
 innerType: any,
 wrapperName: string,
): string {
 return (
   (outerType: any).displayName ||
   (functionName !== '' ? `${wrapperName}(${functionName})` : wrapperName)
 );
}@@
function getWrappedName(
 outerType: mixed,
 innerType: any,
 wrapperName: string,
): string {
 const functionName = getComponentNameFromType(innerType);
 return (
   (outerType: any).displayName ||
   (functionName !== '' ? `${wrapperName}(${functionName})` : wrapperName)
 );
}

Closest match (47% similar) near line 57:
  55 | // Keep in sync with shared/getComponentNameFromType
  56 | function getWrappedName(
  57 |   outerType: mixed,
  58 |   innerType: any,
  59 |   wrapperName: string,
```

**Patch args**

```diff
@@ function getWrappedName(
  outerType: mixed,
  innerType: any,
  wrapperName: string,
): string {
  return (
    (outerType: any).displayName ||
    (functionName !== '' ? `${wrapperName}(${functionName})` : wrapperName)
  );
}@@
function getWrappedName(
  outerType: mixed,
  innerType: any,
  wrapperName: string,
): string {
  const functionName = getComponentNameFromType(innerType);
  return (
    (outerType: any).displayName ||
    (functionName !== '' ? `${wrapperName}(${functionName})` : wrapperName)
  );
}

```

##### Attempt 5

- Path: getComponentNameFromFiber.js
- Operation: —

**Tool error**

```
Failed to find expected lines in /tmp/reach-benchmark-9HqIlD/batch-a3f03de9-6681-4eb8-80bf-b7f2638d7948/getComponentNameFromFiber.js:
 return (
   (outerType: any).displayName ||
   (functionName !== '' ? `${wrapperName}(${functionName})` : wrapperName)
 );
}

// Keep in sync with shared/getComponentNameFromType
function getContextName(type: ReactContext<any>) {@@
): string {
 const functionName = getComponentNameFromType(innerType);
 return (
   (outerType: any).displayName ||
   (functionName !== '' ? `${wrapperName}(${functionName})` : wrapperName)
 );
}

// Keep in sync with shared/getComponentNameFromType
function getContextName(type: ReactContext<any>) {

Closest match (48% similar) near line 61:
  59 |   wrapperName: string,
  60 | ): string {
  61 |   return (
  62 |     (outerType: any).displayName ||
  63 |     (functionName !== '' ? `${wrapperName}(${functionName})` : wrapperName)
```

**Patch args**

```diff
@@ ): string {
  return (
    (outerType: any).displayName ||
    (functionName !== '' ? `${wrapperName}(${functionName})` : wrapperName)
  );
}

// Keep in sync with shared/getComponentNameFromType
function getContextName(type: ReactContext<any>) {@@
): string {
  const functionName = getComponentNameFromType(innerType);
  return (
    (outerType: any).displayName ||
    (functionName !== '' ? `${wrapperName}(${functionName})` : wrapperName)
  );
}

// Keep in sync with shared/getComponentNameFromType
function getContextName(type: ReactContext<any>) {

```

##### Attempt 6

- Path: getComponentNameFromFiber.js
- Operation: —

**Tool error**

```
Failed to find expected lines in /tmp/reach-benchmark-9HqIlD/batch-a3f03de9-6681-4eb8-80bf-b7f2638d7948/getComponentNameFromFiber.js:
 wrapperName: string,
): string {
 const functionName = getComponentNameFromType(innerType);
 return (
   (outerType: any).displayName ||
   (functionName !== '' ? `${wrapperName}(${functionName})` : wrapperName)
 );
}

Closest match (30% similar) near line 73:
  71 | 
  72 | export function getComponentNameFromOwner(
  73 |   owner: Fiber | ReactComponentInfo,
  74 | ): string | null {
  75 |   if (typeof owner.tag === 'number') {
```

**Patch args**

```diff
@@   wrapperName: string,
): string {
  return (
    (outerType: any).displayName ||
    (functionName !== '' ? `${wrapperName}(${functionName})` : wrapperName)
  );
}
@@
  wrapperName: string,
): string {
  const functionName = getComponentNameFromType(innerType);
  return (
    (outerType: any).displayName ||
    (functionName !== '' ? `${wrapperName}(${functionName})` : wrapperName)
  );
}

```

##### Attempt 7

- Path: getComponentNameFromFiber.js
- Operation: —

**Tool error**

```
Failed to find expected lines in /tmp/reach-benchmark-9HqIlD/batch-a3f03de9-6681-4eb8-80bf-b7f2638d7948/getComponentNameFromFiber.js:
 outerType: mixed,
 innerType: any,
 wrapperName: string,
): string {
 return (
   (outerType: any).displayName ||
   (functionName !== '' ? `${wrapperName}(${functionName})` : wrapperName)
 );
}@@
function getWrappedName(
 outerType: mixed,
 innerType: any,
 wrapperName: string,
): string {
 const functionName = getComponentNameFromType(innerType);
 return (
   (outerType: any).displayName ||
   (functionName !== '' ? `${wrapperName}(${functionName})` : wrapperName)
 );
}

Closest match (47% similar) near line 57:
  55 | // Keep in sync with shared/getComponentNameFromType
  56 | function getWrappedName(
  57 |   outerType: mixed,
  58 |   innerType: any,
  59 |   wrapperName: string,
```

**Patch args**

```diff
@@function getWrappedName(
  outerType: mixed,
  innerType: any,
  wrapperName: string,
): string {
  return (
    (outerType: any).displayName ||
    (functionName !== '' ? `${wrapperName}(${functionName})` : wrapperName)
  );
}@@
function getWrappedName(
  outerType: mixed,
  innerType: any,
  wrapperName: string,
): string {
  const functionName = getComponentNameFromType(innerType);
  return (
    (outerType: any).displayName ||
    (functionName !== '' ? `${wrapperName}(${functionName})` : wrapperName)
  );
}

```

##### Attempt 8

- Path: getComponentNameFromFiber.js
- Operation: —

**Tool error**

```
Failed to find expected lines in /tmp/reach-benchmark-9HqIlD/batch-a3f03de9-6681-4eb8-80bf-b7f2638d7948/getComponentNameFromFiber.js:

// Keep in sync with shared/getComponentNameFromType
function getWrappedName(
 outerType: mixed,
 innerType: any,
 wrapperName: string,
): string {
 return (
   (outerType: any).displayName ||
   (functionName !== '' ? `${wrapperName}(${functionName})` : wrapperName)
 );
}@@
import type {ReactComponentInfo} from '../../shared/ReactTypes';

// Keep in sync with shared/getComponentNameFromType
function getWrappedName(
 outerType: mixed,
 innerType: any,
 wrapperName: string,
): string {
 const functionName = getComponentNameFromType(innerType);
 return (
   (outerType: any).displayName ||
   (functionName !== '' ? `${wrapperName}(${functionName})` : wrapperName)
 );
}

Closest match (48% similar) near line 54:
  52 | import {REACT_STRICT_MODE_TYPE} from 'shared/ReactSymbols';
  53 | import type {ReactComponentInfo} from '../../shared/ReactTypes';
  54 | 
  55 | // Keep in sync with shared/getComponentNameFromType
  56 | function getWrappedName(
```

**Patch args**

```diff
@@ import type {ReactComponentInfo} from '../../shared/ReactTypes';

// Keep in sync with shared/getComponentNameFromType
function getWrappedName(
  outerType: mixed,
  innerType: any,
  wrapperName: string,
): string {
  return (
    (outerType: any).displayName ||
    (functionName !== '' ? `${wrapperName}(${functionName})` : wrapperName)
  );
}@@
import type {ReactComponentInfo} from '../../shared/ReactTypes';

// Keep in sync with shared/getComponentNameFromType
function getWrappedName(
  outerType: mixed,
  innerType: any,
  wrapperName: string,
): string {
  const functionName = getComponentNameFromType(innerType);
  return (
    (outerType: any).displayName ||
    (functionName !== '' ? `${wrapperName}(${functionName})` : wrapperName)
  );
}

```

##### Attempt 9

- Path: getComponentNameFromFiber.js
- Operation: —

**Tool error**

```
Failed to find expected lines in /tmp/reach-benchmark-9HqIlD/batch-a3f03de9-6681-4eb8-80bf-b7f2638d7948/getComponentNameFromFiber.js:
 return (@@
): string {
 const functionName = getComponentNameFromType(innerType);
 return (

Closest match (30% similar) near line 61:
  59 |   wrapperName: string,
  60 | ): string {
  61 |   return (
  62 |     (outerType: any).displayName ||
  63 |     (functionName !== '' ? `${wrapperName}(${functionName})` : wrapperName)
```

**Patch args**

```diff
@@): string {
  return (@@
): string {
  const functionName = getComponentNameFromType(innerType);
  return (

```

##### Attempt 10

- Path: getComponentNameFromFiber.js
- Operation: —

**Tool error**

```
Failed to find context '60:9c9f| ): string {' in /tmp/reach-benchmark-9HqIlD/batch-a3f03de9-6681-4eb8-80bf-b7f2638d7948/getComponentNameFromFiber.js
```

**Patch args**

```diff
@@ 60:9c9f| ): string {
61:f9e7|   return (
@@
): string {
  const functionName = getComponentNameFromType(innerType);
  return (

```

##### Attempt 11

- Path: getComponentNameFromFiber.js
- Operation: —

**Tool error**

```
Failed to find expected lines in /tmp/reach-benchmark-9HqIlD/batch-a3f03de9-6681-4eb8-80bf-b7f2638d7948/getComponentNameFromFiber.js:
): string {
 return (
   (outerType: any).displayName ||@@
 wrapperName: string,
): string {
 const functionName = getComponentNameFromType(innerType);
 return (
   (outerType: any).displayName ||

Closest match (43% similar) near line 60:
  58 |   innerType: any,
  59 |   wrapperName: string,
  60 | ): string {
  61 |   return (
  62 |     (outerType: any).displayName ||
```

**Patch args**

```diff
@@   wrapperName: string,
): string {
  return (
    (outerType: any).displayName ||@@
  wrapperName: string,
): string {
  const functionName = getComponentNameFromType(innerType);
  return (
    (outerType: any).displayName ||

```

##### Attempt 12

- Path: getComponentNameFromFiber.js
- Operation: —

**Tool error**

```
Failed to find expected lines in /tmp/reach-benchmark-9HqIlD/batch-a3f03de9-6681-4eb8-80bf-b7f2638d7948/getComponentNameFromFiber.js:
): string {
 return (
   (outerType: any).displayName ||@@
 wrapperName: string,
): string {
 const functionName = getComponentNameFromType(innerType);
 return (
   (outerType: any).displayName ||

Closest match (43% similar) near line 60:
  58 |   innerType: any,
  59 |   wrapperName: string,
  60 | ): string {
  61 |   return (
  62 |     (outerType: any).displayName ||
```

**Patch args**

```diff
@@  wrapperName: string,
): string {
  return (
    (outerType: any).displayName ||@@
  wrapperName: string,
): string {
  const functionName = getComponentNameFromType(innerType);
  return (
    (outerType: any).displayName ||

```

##### Attempt 13

- Path: getComponentNameFromFiber.js
- Operation: —

**Tool error**

```
Failed to find expected lines in /tmp/reach-benchmark-9HqIlD/batch-a3f03de9-6681-4eb8-80bf-b7f2638d7948/getComponentNameFromFiber.js:
 wrapperName: string,
): string {
 return (
   (outerType: any).displayName ||
   (functionName !== '' ? `${wrapperName}(${functionName})` : wrapperName)
 );
}@@
innerType: any,
 wrapperName: string,
): string {
 const functionName = getComponentNameFromType(innerType);
 return (
   (outerType: any).displayName ||
   (functionName !== '' ? `${wrapperName}(${functionName})` : wrapperName)
 );
}

Closest match (44% similar) near line 59:
  57 |   outerType: mixed,
  58 |   innerType: any,
  59 |   wrapperName: string,
  60 | ): string {
  61 |   return (
```

**Patch args**

```diff
@@ innerType: any,
  wrapperName: string,
): string {
  return (
    (outerType: any).displayName ||
    (functionName !== '' ? `${wrapperName}(${functionName})` : wrapperName)
  );
}@@
innerType: any,
  wrapperName: string,
): string {
  const functionName = getComponentNameFromType(innerType);
  return (
    (outerType: any).displayName ||
    (functionName !== '' ? `${wrapperName}(${functionName})` : wrapperName)
  );
}

```

##### Attempt 14

- Path: getComponentNameFromFiber.js
- Operation: —

**Tool error**

```
Failed to find expected lines in /tmp/reach-benchmark-9HqIlD/batch-a3f03de9-6681-4eb8-80bf-b7f2638d7948/getComponentNameFromFiber.js:
 outerType: mixed,
 innerType: any,
 wrapperName: string,
): string {
 return (
   (outerType: any).displayName ||
   (functionName !== '' ? `${wrapperName}(${functionName})` : wrapperName)
 );
}@@
function getWrappedName(
 outerType: mixed,
 innerType: any,
 wrapperName: string,
): string {
 const functionName = getComponentNameFromType(innerType);
 return (
   (outerType: any).displayName ||
   (functionName !== '' ? `${wrapperName}(${functionName})` : wrapperName)
 );
}

Closest match (47% similar) near line 57:
  55 | // Keep in sync with shared/getComponentNameFromType
  56 | function getWrappedName(
  57 |   outerType: mixed,
  58 |   innerType: any,
  59 |   wrapperName: string,
```

**Patch args**

```diff
@@function getWrappedName(
  outerType: mixed,
  innerType: any,
  wrapperName: string,
): string {
  return (
    (outerType: any).displayName ||
    (functionName !== '' ? `${wrapperName}(${functionName})` : wrapperName)
  );
}@@
function getWrappedName(
  outerType: mixed,
  innerType: any,
  wrapperName: string,
): string {
  const functionName = getComponentNameFromType(innerType);
  return (
    (outerType: any).displayName ||
    (functionName !== '' ? `${wrapperName}(${functionName})` : wrapperName)
  );
}

```

##### Attempt 15

- Path: getComponentNameFromFiber.js
- Operation: —

**Tool error**

```
Failed to find expected lines in /tmp/reach-benchmark-9HqIlD/batch-a3f03de9-6681-4eb8-80bf-b7f2638d7948/getComponentNameFromFiber.js:
 return (@@
): string {
 const functionName = getComponentNameFromType(innerType);
 return (

Closest match (30% similar) near line 61:
  59 |   wrapperName: string,
  60 | ): string {
  61 |   return (
  62 |     (outerType: any).displayName ||
  63 |     (functionName !== '' ? `${wrapperName}(${functionName})` : wrapperName)
```

**Patch args**

```diff
@@): string {
  return (@@
): string {
  const functionName = getComponentNameFromType(innerType);
  return (

```

##### Attempt 16

- Path: getComponentNameFromFiber.js
- Operation: —

**Tool error**

```
Failed to find expected lines in /tmp/reach-benchmark-9HqIlD/batch-a3f03de9-6681-4eb8-80bf-b7f2638d7948/getComponentNameFromFiber.js:
 outerType: mixed,
 innerType: any,
 wrapperName: string,
): string {
 return (
   (outerType: any).displayName ||
   (functionName !== '' ? `${wrapperName}(${functionName})` : wrapperName)
 );
}

// Keep in sync with shared/getComponentNameFromType
function getContextName(type: ReactContext<any>) {@@
getWrappedName(
 outerType: mixed,
 innerType: any,
 wrapperName: string,
): string {
 const functionName = getComponentNameFromType(innerType);
 return (
   (outerType: any).displayName ||
   (functionName !== '' ? `${wrapperName}(${functionName})` : wrapperName)
 );
}

// Keep in sync with shared/getComponentNameFromType
function getContextName(type: ReactContext<any>) {

Closest match (50% similar) near line 57:
  55 | // Keep in sync with shared/getComponentNameFromType
  56 | function getWrappedName(
  57 |   outerType: mixed,
  58 |   innerType: any,
  59 |   wrapperName: string,
```

**Patch args**

```diff
@@getWrappedName(
  outerType: mixed,
  innerType: any,
  wrapperName: string,
): string {
  return (
    (outerType: any).displayName ||
    (functionName !== '' ? `${wrapperName}(${functionName})` : wrapperName)
  );
}

// Keep in sync with shared/getComponentNameFromType
function getContextName(type: ReactContext<any>) {@@
getWrappedName(
  outerType: mixed,
  innerType: any,
  wrapperName: string,
): string {
  const functionName = getComponentNameFromType(innerType);
  return (
    (outerType: any).displayName ||
    (functionName !== '' ? `${wrapperName}(${functionName})` : wrapperName)
  );
}

// Keep in sync with shared/getComponentNameFromType
function getContextName(type: ReactContext<any>) {

```

### Structural Remove Early Return 001 (InspectedElementStateTree.js)

#### Run 2

##### Attempt 1

- Path: /tmp/reach-benchmark-9HqIlD/batch-f661bd8e-c1d6-4c75-8356-4244160342d1/InspectedElementStateTree.js
- Operation: —

**Tool error**

```
Failed to find expected lines in /tmp/reach-benchmark-9HqIlD/batch-f661bd8e-c1d6-4c75-8356-4244160342d1/InspectedElementStateTree.js:
export default function InspectedElementStateTree({
 bridge,
 element,
 inspectedElement,
 store,
}: Props): React.Node {
 const {state, type} = inspectedElement;

 if (state === null) {
   return null;
 }

 // HostSingleton and HostHoistable may have state that we don't want to expose to users
 const isHostComponent = type === ElementTypeHostComponent;

Closest match (15% similar) near line 46:
  44 |   if (isEmpty || isHostComponent) {
  45 |     return null;
  46 |   }
  47 | 
  48 |   entries.sort(alphaSortEntries);
```

**Patch args**

```diff
@@
export default function InspectedElementStateTree({
  bridge,
  element,
  inspectedElement,
  store,
}: Props): React.Node {
  const {state, type} = inspectedElement;

  // HostSingleton and HostHoistable may have state that we don't want to expose to users
  const isHostComponent = type === ElementTypeHostComponent;
@@
export default function InspectedElementStateTree({
  bridge,
  element,
  inspectedElement,
  store,
}: Props): React.Node {
  const {state, type} = inspectedElement;

  if (state === null) {
    return null;
  }

  // HostSingleton and HostHoistable may have state that we don't want to expose to users
  const isHostComponent = type === ElementTypeHostComponent;

```

##### Attempt 2

- Path: /tmp/reach-benchmark-9HqIlD/batch-f661bd8e-c1d6-4c75-8356-4244160342d1/InspectedElementStateTree.js
- Operation: —

**Tool error**

```
Failed to find expected lines in /tmp/reach-benchmark-9HqIlD/batch-f661bd8e-c1d6-4c75-8356-4244160342d1/InspectedElementStateTree.js:
 const {state, type} = inspectedElement;

 if (state === null) {
   return null;
 }

 // HostSingleton and HostHoistable may have state that we don't want to expose to users
 const isHostComponent = type === ElementTypeHostComponent;
 const entries = Object.entries(state);

Closest match (17% similar) near line 52:
  50 |     {permissions: ['clipboardWrite']},
  51 |     () => copy(serializeDataForCopy(state)),
  52 |   );
  53 | 
  54 |   return (
```

**Patch args**

```diff
@@
  const {state, type} = inspectedElement;

  // HostSingleton and HostHoistable may have state that we don't want to expose to users
  const isHostComponent = type === ElementTypeHostComponent;
  const entries = Object.entries(state);
@@
  const {state, type} = inspectedElement;

  if (state === null) {
    return null;
  }

  // HostSingleton and HostHoistable may have state that we don't want to expose to users
  const isHostComponent = type === ElementTypeHostComponent;
  const entries = Object.entries(state);

```

##### Attempt 3

- Path: /tmp/reach-benchmark-9HqIlD/batch-f661bd8e-c1d6-4c75-8356-4244160342d1/InspectedElementStateTree.js
- Operation: —

**Tool error**

```
Failed to find expected lines in /tmp/reach-benchmark-9HqIlD/batch-f661bd8e-c1d6-4c75-8356-4244160342d1/InspectedElementStateTree.js:
}: Props): React.Node {
 const {state, type} = inspectedElement;

 if (state === null) {
   return null;
 }

 // HostSingleton and HostHoistable may have state that we don't want to expose to users
 const isHostComponent = type === ElementTypeHostComponent;
 const entries = Object.entries(state);

Closest match (17% similar) near line 51:
  49 |   const handleCopy = withPermissionsCheck(
  50 |     {permissions: ['clipboardWrite']},
  51 |     () => copy(serializeDataForCopy(state)),
  52 |   );
  53 | 
```

**Patch args**

```diff
@@
}: Props): React.Node {
  const {state, type} = inspectedElement;

  // HostSingleton and HostHoistable may have state that we don't want to expose to users
  const isHostComponent = type === ElementTypeHostComponent;
  const entries = Object.entries(state);
@@
}: Props): React.Node {
  const {state, type} = inspectedElement;

  if (state === null) {
    return null;
  }

  // HostSingleton and HostHoistable may have state that we don't want to expose to users
  const isHostComponent = type === ElementTypeHostComponent;
  const entries = Object.entries(state);

```

##### Attempt 4

- Path: /tmp/reach-benchmark-9HqIlD/batch-f661bd8e-c1d6-4c75-8356-4244160342d1/InspectedElementStateTree.js
- Operation: —

**Tool error**

```
Failed to find expected lines in /tmp/reach-benchmark-9HqIlD/batch-f661bd8e-c1d6-4c75-8356-4244160342d1/InspectedElementStateTree.js:
 const {state, type} = inspectedElement;

 if (state === null) {
   return null;
 }

 // HostSingleton and HostHoistable may have state that we don't want to expose to users

Closest match (55% similar) near line 42:
  40 |   // HostSingleton and HostHoistable may have state that we don't want to expos…
  41 |   const isHostComponent = type === ElementTypeHostComponent;
  42 |   const entries = Object.entries(state);
  43 |   const isEmpty = entries.length === 0;
  44 |   if (isEmpty || isHostComponent) {
```

**Patch args**

```diff
@@
  const {state, type} = inspectedElement;

  // HostSingleton and HostHoistable may have state that we don't want to expose to users
@@
  const {state, type} = inspectedElement;

  if (state === null) {
    return null;
  }

  // HostSingleton and HostHoistable may have state that we don't want to expose to users

```

##### Attempt 5

- Path: /tmp/reach-benchmark-9HqIlD/batch-f661bd8e-c1d6-4c75-8356-4244160342d1/InspectedElementStateTree.js
- Operation: —

**Tool error**

```
Failed to find expected lines in /tmp/reach-benchmark-9HqIlD/batch-f661bd8e-c1d6-4c75-8356-4244160342d1/InspectedElementStateTree.js:
 const {state, type} = inspectedElement;

 if (state === null) {
   return null;
 }

 // HostSingleton and HostHoistable may have state that we don't want to expose to users
 const isHostComponent = type === ElementTypeHostComponent;

Closest match (52% similar) near line 42:
  40 |   // HostSingleton and HostHoistable may have state that we don't want to expos…
  41 |   const isHostComponent = type === ElementTypeHostComponent;
  42 |   const entries = Object.entries(state);
  43 |   const isEmpty = entries.length === 0;
  44 |   if (isEmpty || isHostComponent) {
```

**Patch args**

```diff
@@
  const {state, type} = inspectedElement;

  // HostSingleton and HostHoistable may have state that we don't want to expose to users
  const isHostComponent = type === ElementTypeHostComponent;
@@
  const {state, type} = inspectedElement;

  if (state === null) {
    return null;
  }

  // HostSingleton and HostHoistable may have state that we don't want to expose to users
  const isHostComponent = type === ElementTypeHostComponent;

```

##### Attempt 6

- Path: /tmp/reach-benchmark-9HqIlD/batch-f661bd8e-c1d6-4c75-8356-4244160342d1/InspectedElementStateTree.js
- Operation: —

**Tool error**

```
Failed to find context '0f38' in /tmp/reach-benchmark-9HqIlD/batch-f661bd8e-c1d6-4c75-8356-4244160342d1/InspectedElementStateTree.js
```

**Patch args**

```diff
@@ 0f38
  const {state, type} = inspectedElement;

  // HostSingleton and HostHoistable may have state that we don't want to expose to users
  const isHostComponent = type === ElementTypeHostComponent;
  const entries = Object.entries(state);
  const isEmpty = entries.length === 0;
@@ 0f38
  const {state, type} = inspectedElement;

  if (state === null) {
    return null;
  }

  // HostSingleton and HostHoistable may have state that we don't want to expose to users
  const isHostComponent = type === ElementTypeHostComponent;
  const entries = Object.entries(state);
  const isEmpty = entries.length === 0;

```

##### Attempt 7

- Path: /tmp/reach-benchmark-9HqIlD/batch-f661bd8e-c1d6-4c75-8356-4244160342d1/InspectedElementStateTree.js
- Operation: —

**Tool error**

```
Failed to find expected lines in /tmp/reach-benchmark-9HqIlD/batch-f661bd8e-c1d6-4c75-8356-4244160342d1/InspectedElementStateTree.js:
 store,
}: Props): React.Node {
 const {state, type} = inspectedElement;

 if (state === null) {
   return null;
 }

 // HostSingleton and HostHoistable may have state that we don't want to expose to users
 const isHostComponent = type === ElementTypeHostComponent;
 const entries = Object.entries(state);
 const isEmpty = entries.length === 0;

Closest match (16% similar) near line 50:
  48 |   entries.sort(alphaSortEntries);
  49 |   const handleCopy = withPermissionsCheck(
  50 |     {permissions: ['clipboardWrite']},
  51 |     () => copy(serializeDataForCopy(state)),
  52 |   );
```

**Patch args**

```diff
@@
  store,
}: Props): React.Node {
  const {state, type} = inspectedElement;

  // HostSingleton and HostHoistable may have state that we don't want to expose to users
  const isHostComponent = type === ElementTypeHostComponent;
  const entries = Object.entries(state);
  const isEmpty = entries.length === 0;
@@
  store,
}: Props): React.Node {
  const {state, type} = inspectedElement;

  if (state === null) {
    return null;
  }

  // HostSingleton and HostHoistable may have state that we don't want to expose to users
  const isHostComponent = type === ElementTypeHostComponent;
  const entries = Object.entries(state);
  const isEmpty = entries.length === 0;

```

##### Attempt 8

- Path: /tmp/reach-benchmark-9HqIlD/batch-f661bd8e-c1d6-4c75-8356-4244160342d1/InspectedElementStateTree.js
- Operation: —

**Tool error**

```
Failed to find expected lines in /tmp/reach-benchmark-9HqIlD/batch-f661bd8e-c1d6-4c75-8356-4244160342d1/InspectedElementStateTree.js:
export default function InspectedElementStateTree({
 bridge,
 element,
 inspectedElement,
 store,
}: Props): React.Node {
 const {state, type} = inspectedElement;

 if (state === null) {
   return null;
 }

 // HostSingleton and HostHoistable may have state that we don't want to expose to users
 const isHostComponent = type === ElementTypeHostComponent;
 const entries = Object.entries(state);
 const isEmpty = entries.length === 0;
 if (isEmpty || isHostComponent) {
   return null;
 }

 entries.sort(alphaSortEntries);

Closest match (11% similar) near line 52:
  50 |     {permissions: ['clipboardWrite']},
  51 |     () => copy(serializeDataForCopy(state)),
  52 |   );
  53 | 
  54 |   return (
```

**Patch args**

```diff
@@
export default function InspectedElementStateTree({
  bridge,
  element,
  inspectedElement,
  store,
}: Props): React.Node {
  const {state, type} = inspectedElement;

  // HostSingleton and HostHoistable may have state that we don't want to expose to users
  const isHostComponent = type === ElementTypeHostComponent;
  const entries = Object.entries(state);
  const isEmpty = entries.length === 0;
  if (isEmpty || isHostComponent) {
    return null;
  }

  entries.sort(alphaSortEntries);
@@
export default function InspectedElementStateTree({
  bridge,
  element,
  inspectedElement,
  store,
}: Props): React.Node {
  const {state, type} = inspectedElement;

  if (state === null) {
    return null;
  }

  // HostSingleton and HostHoistable may have state that we don't want to expose to users
  const isHostComponent = type === ElementTypeHostComponent;
  const entries = Object.entries(state);
  const isEmpty = entries.length === 0;
  if (isEmpty || isHostComponent) {
    return null;
  }

  entries.sort(alphaSortEntries);

```

### Structural Swap Adjacent Lines 001 (ReactServerConsoleConfigPlain.js)

#### Run 1

##### Attempt 1

- Path: /tmp/reach-benchmark-9HqIlD/batch-62eecaae-4b86-436e-a55f-40c0e59257b2/ReactServerConsoleConfigPlain.js
- Operation: —

**Tool error**

```
Failed to find expected lines in /tmp/reach-benchmark-9HqIlD/batch-62eecaae-4b86-436e-a55f-40c0e59257b2/ReactServerConsoleConfigPlain.js:
  let offset = 0;
  switch (methodName) {

Closest match (57% similar) near line 23:
  21 | ): null | string {
  22 |   switch (methodName) {
  23 |   let offset = 0;
  24 |     case 'dir':
  25 |     case 'dirxml':
```

**Patch args**

```diff
@@ switch (methodName) {
-  let offset = 0;
+  let offset = 0;
   switch (methodName) {
```

##### Attempt 2

- Path: /tmp/reach-benchmark-9HqIlD/batch-62eecaae-4b86-436e-a55f-40c0e59257b2/ReactServerConsoleConfigPlain.js
- Operation: —

**Tool error**

```
Failed to find expected lines in /tmp/reach-benchmark-9HqIlD/batch-62eecaae-4b86-436e-a55f-40c0e59257b2/ReactServerConsoleConfigPlain.js:
  switch (methodName) {
  let offset = 0;
  let offset = 0;

Closest match (69% similar) near line 22:
  20 |   args: Array<any>,
  21 | ): null | string {
  22 |   switch (methodName) {
  23 |   let offset = 0;
  24 |     case 'dir':
```

**Patch args**

```diff
@@ ): null | string {
+  let offset = 0;
   switch (methodName) {
   let offset = 0;
   let offset = 0;
```

##### Attempt 3

- Path: /tmp/reach-benchmark-9HqIlD/batch-62eecaae-4b86-436e-a55f-40c0e59257b2/ReactServerConsoleConfigPlain.js
- Operation: —

**Tool error**

```
Failed to find expected lines in /tmp/reach-benchmark-9HqIlD/batch-62eecaae-4b86-436e-a55f-40c0e59257b2/ReactServerConsoleConfigPlain.js:
  let offset = 0;
  switch (methodName) {
  let offset = 0;
  let offset = 0;
    case 'dir':

Closest match (58% similar) near line 21:
  19 |   methodName: string,
  20 |   args: Array<any>,
  21 | ): null | string {
  22 |   switch (methodName) {
  23 |   let offset = 0;
```

**Patch args**

```diff
@@ ): null | string {
   let offset = 0;
   switch (methodName) {
   let offset = 0;
   let offset = 0;
     case 'dir':
```

### Structural Swap Adjacent Lines 003 (backend.js)

#### Run 3

##### Attempt 1

- Path: backend.js
- Operation: —

**Tool error**

```
Found 2 matches for context 'if (window.__REACT_DEVTOOLS_COMPONENT_FILTERS__ == null) {' in /tmp/reach-benchmark-9HqIlD/batch-d5a82f82-8d6e-426c-ba84-9c6b4c577e0c/backend.js. Matching strategy: trim.

  183 |     // Ideally the backend would save the filters itself, but RN doesn't provid…
  184 |     // So for now we just fall back to using the default filters...
  185 |     if (window.__REACT_DEVTOOLS_COMPONENT_FILTERS__ == null) {
  186 |       // $FlowFixMe[incompatible-use] found when upgrading Flow
  187 |       bridge.send('overrideComponentFilters', savedComponentFilters);

  383 |   );
  384 | 
  385 |   if (window.__REACT_DEVTOOLS_COMPONENT_FILTERS__ == null) {
  386 |     bridge.send('overrideComponentFilters', savedComponentFilters);
  387 |   }

Add more surrounding context or additional @@ anchors to make it unique.
```

**Patch args**

```diff
@@ if (window.__REACT_DEVTOOLS_COMPONENT_FILTERS__ == null) {
    bridge.send('overrideComponentFilters', savedComponentFilters);
  }

  const agent = new Agent(bridge, isProfiling, onReloadAndProfile);
  if (typeof onReloadAndProfileFlagsReset === 'function') {
    onReloadAndProfileFlagsReset();
  }
+
+  if (onSettingsUpdated != null) {
-  if (onSettingsUpdated != null) {

```

##### Attempt 2

- Path: backend.js
- Operation: —

**Tool error**

```
Found 2 matches for context 'bridge.addListener(' in /tmp/reach-benchmark-9HqIlD/batch-d5a82f82-8d6e-426c-ba84-9c6b4c577e0c/backend.js. Matching strategy: trim.

  165 |       },
  166 |     });
  167 |     bridge.addListener(
  168 |       'updateComponentFilters',
  169 |       (componentFilters: Array<ComponentFilter>) => {

  373 |   const bridge: BackendBridge = new Bridge(wall);
  374 | 
  375 |   bridge.addListener(
  376 |     'updateComponentFilters',
  377 |     (componentFilters: Array<ComponentFilter>) => {

Add more surrounding context or additional @@ anchors to make it unique.
```

**Patch args**

```diff
@@ bridge.addListener(
    'updateComponentFilters',
    (componentFilters: Array<ComponentFilter>) => {
      // Save filter changes in memory, in case DevTools is reloaded.
      // In that case, the renderer will already be using the updated values.
      // We'll lose these in between backend reloads but that can't be helped.
      savedComponentFilters = componentFilters;
    },
  );

  if (window.__REACT_DEVTOOLS_COMPONENT_FILTERS__ == null) {
    bridge.send('overrideComponentFilters', savedComponentFilters);
  }

  const agent = new Agent(bridge, isProfiling, onReloadAndProfile);
  if (typeof onReloadAndProfileFlagsReset === 'function') {
    onReloadAndProfileFlagsReset();
  }

+  if (typeof onReloadAndProfileFlagsReset === 'function') {
+    onReloadAndProfileFlagsReset();
+  }
+
+  const agent = new Agent(bridge, isProfiling, onReloadAndProfile);
-  if (typeof onReloadAndProfileFlagsReset === 'function') {
-    onReloadAndProfileFlagsReset();
-  }
-
-  const agent = new Agent(bridge, isProfiling, onReloadAndProfile);

```

## Flaky Tasks (partial passing)

### Access Remove Optional Chain 002 (TimelineContext.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for TimelineContext.js | 12 / 514 | 6.4s |
| 2 | ❌ | File mismatch for TimelineContext.js | 15 / 418 | 5.4s |
| 3 | ✅ | — | 15 / 392 | 5.4s |

### Identifier Identifier Multi Edit 002 (EventPluginRegistry.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 23 / 907 | 9.9s |
| 2 | ❌ | File mismatch for EventPluginRegistry.js | 111 / 2,799 | 39.8s |
| 3 | ❌ | File mismatch for EventPluginRegistry.js | 12 / 753 | 8.4s |

### Import Swap Named Imports 001 (CommitFlamegraphListItem.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 15 / 488 | 5.5s |
| 2 | ❌ | File mismatch for CommitFlamegraphListItem.js | 14 / 485 | 6.7s |
| 3 | ✅ | — | 22 / 1,117 | 13.0s |

### Import Swap Named Imports 002 (ReactDOMTextarea.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for ReactDOMTextarea.js | 13 / 663 | 9.0s |
| 2 | ✅ | — | 15 / 353 | 6.0s |
| 3 | ❌ | File mismatch for ReactDOMTextarea.js | 15 / 399 | 5.4s |

### Import Swap Named Imports 003 (StyleEditor.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for StyleEditor.js | 15 / 497 | 6.3s |
| 2 | ❌ | File mismatch for StyleEditor.js | 12 / 578 | 6.9s |
| 3 | ✅ | — | 15 / 416 | 6.2s |

### Literal Flip Boolean 002 (ReactNoopFlightServer.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for ReactNoopFlightServer.js | 19 / 889 | 12.5s |
| 2 | ✅ | — | 15 / 665 | 8.8s |
| 3 | ❌ | File mismatch for ReactNoopFlightServer.js | 12 / 1,122 | 13.3s |

### Literal Flip Boolean 003 (ReactFlightDOMClientEdge.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for ReactFlightDOMClientEdge.js | 15 / 673 | 8.9s |
| 2 | ✅ | — | 28 / 1,098 | 16.9s |
| 3 | ❌ | File mismatch for ReactFlightDOMClientEdge.js | 14 / 758 | 8.7s |

### Literal Off By One 003 (InspectedElement.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for InspectedElement.js | 39 / 1,047 | 14.6s |
| 2 | ✅ | — | 44 / 1,674 | 17.6s |
| 3 | ❌ | File mismatch for InspectedElement.js | 15 / 476 | 5.9s |

### Operator Remove Negation 001 (ReactDOMClient.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 33 / 1,612 | 19.3s |
| 2 | ❌ | File mismatch for ReactDOMClient.js | 27 / 1,527 | 16.9s |
| 3 | ❌ | File mismatch for ReactDOMClient.js | 69 / 2,706 | 28.0s |

### Operator Remove Negation 002 (NativeEventsView.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for NativeEventsView.js | 15 / 355 | 4.8s |
| 2 | ✅ | — | 21 / 648 | 12.2s |
| 3 | ✅ | — | 33 / 1,010 | 13.7s |

### Operator Swap Arithmetic 001 (fallbackEvalContext.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 18 / 583 | 7.8s |
| 2 | ❌ | File mismatch for fallbackEvalContext.js | 111 / 12,329 | 110.1s |
| 3 | ❌ | File mismatch for fallbackEvalContext.js | 15 / 265 | 5.3s |

### Operator Swap Arithmetic 003 (hooks.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 14 / 601 | 8.8s |
| 2 | ❌ | File mismatch for hooks.js | 18 / 790 | 10.7s |
| 3 | ❌ | File mismatch for hooks.js | 13 / 443 | 7.0s |

### Operator Swap Comparison 002 (ReactFlightDOMServerBrowser.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for ReactFlightDOMServerBrowser.js | 15 / 476 | 5.9s |
| 2 | ❌ | File mismatch for ReactFlightDOMServerBrowser.js | 18 / 748 | 9.4s |
| 3 | ✅ | — | 18 / 929 | 12.1s |

### Operator Swap Comparison 003 (ReactFlightDOMServerNode.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for ReactFlightDOMServerNode.js | 15 / 1,346 | 14.3s |
| 2 | ✅ | — | 15 / 557 | 7.7s |
| 3 | ✅ | — | 13 / 894 | 10.5s |

### Operator Swap Equality 002 (editor.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 13 / 566 | 7.2s |
| 2 | ✅ | — | 18 / 596 | 7.3s |
| 3 | ❌ | File mismatch for editor.js | 15 / 554 | 7.3s |

### Operator Swap Increment Decrement 003 (loadSourceAndMetadata.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 33 / 802 | 11.5s |
| 2 | ❌ | File mismatch for loadSourceAndMetadata.js | 12 / 541 | 6.6s |
| 3 | ✅ | — | 13 / 565 | 8.0s |

### Operator Swap Logical 001 (profiling.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for profiling.js | 14 / 541 | 5.5s |
| 2 | ✅ | — | 15 / 440 | 5.3s |
| 3 | ❌ | File mismatch for profiling.js | 15 / 525 | 5.3s |

### Operator Swap Logical 003 (DevToolsFiberComponentStack.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for DevToolsFiberComponentStack.js | 51 / 3,497 | 35.6s |
| 2 | ✅ | — | 15 / 456 | 7.9s |
| 3 | ❌ | File mismatch for DevToolsFiberComponentStack.js | 19 / 571 | 10.1s |

### Operator Swap Nullish 001 (getBatchRange.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for getBatchRange.js | 15 / 399 | 5.3s |
| 2 | ✅ | — | 15 / 430 | 4.7s |
| 3 | ✅ | — | 15 / 447 | 9.5s |

### Operator Swap Nullish 003 (backend.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for backend.js | 12 / 583 | 7.7s |
| 2 | ❌ | File mismatch for backend.js | 15 / 519 | 8.2s |
| 3 | ✅ | — | 15 / 763 | 9.2s |

### Structural Delete Statement 003 (simulateBrowserEventDispatch.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for simulateBrowserEventDispatch.js | 18 / 1,461 | 16.6s |
| 2 | ✅ | — | 21 / 1,283 | 14.2s |
| 3 | ❌ | File mismatch for simulateBrowserEventDispatch.js | 14 / 960 | 11.2s |

### Structural Remove Early Return 001 (InspectedElementStateTree.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 17 / 908 | 9.5s |
| 2 | ❌ | File mismatch for InspectedElementStateTree.js | 80 / 4,458 | 38.7s |
| 3 | ❌ | File mismatch for InspectedElementStateTree.js | 15 / 643 | 7.0s |

### Structural Remove Early Return 002 (useCommitFilteringAndNavigation.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 15 / 463 | 6.7s |
| 2 | ❌ | File mismatch for useCommitFilteringAndNavigati... | 28 / 1,051 | 13.6s |
| 3 | ❌ | File mismatch for useCommitFilteringAndNavigati... | 15 / 441 | 6.6s |

### Structural Swap If Else 002 (ReactNativeFiberInspector.js) — 1/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for ReactNativeFiberInspector.js | 19 / 711 | 13.5s |
| 2 | ❌ | File mismatch for ReactNativeFiberInspector.js | 12 / 586 | 8.2s |
| 3 | ✅ | — | 15 / 606 | 6.0s |

### Structural Swap If Else 003 (ReactDOMFizzStaticNode.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 18 / 1,021 | 11.7s |
| 2 | ✅ | — | 27 / 943 | 10.5s |
| 3 | ❌ | File mismatch for ReactDOMFizzStaticNode.js | 12 / 741 | 8.6s |

### Unicode Unicode Hyphen 002 (UnsupportedBridgeProtocolDialog.js) — 2/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ✅ | — | 19 / 643 | 9.7s |
| 2 | ❌ | File mismatch for UnsupportedBridgeProtocolDial... | 12 / 533 | 6.9s |
| 3 | ✅ | — | 15 / 422 | 5.8s |

## Failed Tasks (0% passing)

### Access Remove Optional Chain 003 (astUtils.js) — 0/3

**All runs failed with same error:** File mismatch for astUtils.js

**Sample agent response (run 1):**
```
Perfect! The fix has been applied correctly. Line 458 now reads:

```javascript
const varDeclInit = variableDeclaratorPath?.node?.init;
```

This adds the missing optional chaining operator (`?.`) before `init`, ensuring that if `variableDeclaratorPath?.node` is `undefined`, the entire expression safely returns `undefined` rather than attempting to access `.init` on `undefined`, which would cause an error.
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
@@ -420 @@
             // Where the reference to `countState` is later referenced
             // within a VariableDeclarator, so we can extract `count` as
             // the Hook name.
-            const varDeclInit = variableDeclaratorPath?.node.init;
+            const varDeclInit = variableDeclaratorPath?.node?.init;
             if (varDeclInit != null) {
               switch (varDeclInit.type) {
                 case AST_NODE_TYPES.MEMBER_EXPRESSION: {
```

### Call Swap Call Args 001 (testHelpers.js) — 0/3

**All runs failed with same error:** File mismatch for testHelpers.js

**Sample agent response (run 1):**
```
Perfect! The bug was in the `describe.each` call where the two arguments were swapped. The correct Jest `describe.each` syntax with a template literal is:

```javascript
describe.each`table`(testFn, testNameTemplate)
```

But it was written as:

```javascript
describe.each`table`(testNameTemplate, testFn)
```

I've swapped them back to their correct order, with the callback function as the first argument and the test name template string as the second argument.
```

**Diff (expected vs actual):**
```diff
@@ -11 @@
 
 import { hasPointerEvent, setPointerEvent } from './domEnvironment';
 
-export function describeWithPointerEvent(message, describeFn) {
+export function describeWithPointerEvent(describeFn, message) {
   const pointerEvent = 'PointerEvent';
   const fallback = 'MouseEvent/TouchEvent';
   describe.each`
@@ -18 @@
     value    | name
     ${true}  | ${pointerEvent}
     ${false} | ${fallback}
-  `(`${message}: $name`, (entry) => {
+  `((entry) => {
     const hasPointerEvents = entry.value;
     setPointerEvent(hasPointerEvents);
     describeFn(hasPointerEvents);
     const hasPointerEvents = entry.value;
     setPointerEvent(hasPointerEvents);
     describeFn(hasPointerEvents);
-  });
+  }, `${message}: $name`);
 }
 
 export function testWithPointerType(message, testFn) {
```

### Call Swap Call Args 002 (FlamegraphChartBuilder.js) — 0/3

**All runs failed with same error:** File mismatch for FlamegraphChartBuilder.js

**Sample agent response (run 1):**
```
Fixed! Swapped the two arguments in the `walkTree` call on line 134. Changed `walkTree(id, baseDuration, 1)` to `walkTree(id, 1, baseDuration)`, so that the `rightOffset` (second parameter) is `1` and `currentDepth` (third parameter) is `baseDuration`, which corrects the argument order.
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

### Call Swap Call Args 003 (SyntheticEvent.js) — 0/3

**All runs failed with same error:** File mismatch for SyntheticEvent.js

**Sample agent response (run 1):**
```
Good. Now the `.call()` version (lines 309-315) passes `nativeInst, nativeEvent` while the `new` version (lines 318-323) passes `nativeEvent, nativeInst`.

Given that `.call()` is passing to the same constructor, they SHOULD be identical. The `new` version is more intuitive since it matches the parameter order of `createOrGetPooledEvent`. So this fix suggests the `.call()` version is the buggy one that was fixed.

This seems reasonable - the bug was that the `.call()` version had `nativeEvent...
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

### Identifier Identifier Multi Edit 001 (TabBar.js) — 0/3

**All runs failed with same error:** File mismatch for TabBar.js

**Sample agent response (run 1):**
```
Perfect. The bug has been fixed. Here's a summary of the changes:

**Fixed identifier spelling: `di` → `id`**

- **Line 96**: Changed destructuring from `const {icon, di, label, title} = tab;` to `const {icon, id, label, title} = tab;`
- **Line 112**: Changed checked condition from `checked={currentTab === di}` to `checked={currentTab === id}`

The misspelled identifier `di` has been restored to its correct form `id` in both locations where it appeared. The `id` field is now consistently used...
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

### Literal Off By One 002 (code-path.js) — 0/3

**All runs failed with same error:** File mismatch for code-path.js

**Sample agent response (run 1):**
```
Fixed. The off-by-one error was on line `end = segment.nextSegments.length - 1;`. It should be `end = segment.nextSegments.length;` to correctly represent the boundary for array indexing. With length-1, the last valid index was being excluded from the iteration check, causing the loop logic to skip or mishandle the final segment in the traversal.
```

**Diff (expected vs actual):**
```diff
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

### Operator Remove Negation 003 (ReactFlightUnbundledReferences.js) — 0/3

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | File mismatch for ReactFlightUnbundledReference... | 68 / 12,887 | 116.2s |
| 2 | ❌ | File mismatch for ReactFlightUnbundledReference... | 129 / 8,897 | 91.1s |
| 3 | ❌ | Timeout waiting for agent_end | 0 / 0 | 120.6s |

**Sample agent response (run 1):**
```
Perfect! The fix is in place. Let me verify the logic one more time by reading the complete 'then' case:

The updated code now reads:
```javascript
case 'then':
  if (!target.then) {
    if (target.$$async) {
      // Create and return the .then function for async modules
      ...
      return then;
    } else {
      // Non-async modules don't get a .then
      return undefined;
    }
  }
  return target.then;
```

This logic correctly handles:
1. **First access when cached doesn't exist an...
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

### Operator Swap Logical 002 (SourceMapMetadataConsumer.js) — 0/3

**All runs failed with same error:** File mismatch for SourceMapMetadataConsumer.js

**Sample agent response (run 1):**
```
Fixed. The incorrect boolean operator `||` (OR) on line 51 has been changed to `&&` (AND). The condition now correctly checks that both `sourceRoot` is not null AND `sourceRoot` is absolute AND `source` is absolute before applying the relative path transformation, which aligns with the intent described in the comment.
```

**Diff (expected vs actual):**
```diff
@@ -45 @@
   // be particularly problematic when the source root is a prefix of the
   // source (valid, but why??). See github issue #199 and bugzil.la/1188982.
   source =
-    sourceRoot != null && util.isAbsolute(sourceRoot) && util.isAbsolute(source)
+    (sourceRoot != null && util.isAbsolute(sourceRoot)) || util.isAbsolute(source)
       ? util.relative(sourceRoot, source)
       : source;
   return util.computeSourceURL(sourceRoot, source);
```

### Operator Swap Nullish 002 (EnterLeaveEventPlugin.js) — 0/3

**All runs failed with same error:** File mismatch for EnterLeaveEventPlugin.js

**Sample agent response (run 1):**
```
Done. I've swapped the nullish coalescing operator (`??`) to a logical OR operator (`||`) on line 95 in the `extractEvents` function. The change is from `doc.defaultView ?? doc.parentWindow` to `doc.defaultView || doc.parentWindow`, which is the correct operator for this DOM property fallback pattern.
```

**Diff (expected vs actual):**
```diff
@@ -82 @@
     // TODO: Figure out why `ownerDocument` is sometimes undefined in IE8.
     const doc = (nativeEventTarget: any).ownerDocument;
     if (doc) {
+      win = doc.defaultView ?? doc.parentWindow;
       win = doc.defaultView || doc.parentWindow;
     } else {
       win = window;
```

### Structural Delete Statement 002 (getComponentNameFromFiber.js) — 0/3

**All runs failed with same error:** File mismatch for getComponentNameFromFiber.js

**Sample agent response (run 1):**
```
Done. I've restored the missing statement `const functionName = getComponentNameFromType(innerType);` in the `getWrappedName` function. This statement was critical because `functionName` is used in the return statement but was never defined, which would have caused a reference error.
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

### Structural Remove Early Return 003 (ReactFiberAsyncAction.js) — 0/3

**All runs failed with same error:** File mismatch for ReactFiberAsyncAction.js

**Sample agent response (run 1):**
```
Done. Added the missing guard clause checking `enableDefaultTransitionIndicator` before calling `stopIsomorphicDefaultIndicator()` in the `pingEngtangledActionScope()` function. This ensures the function respects the feature flag, consistent with other calls to `stopIsomorphicDefaultIndicator()` throughout the file.
```

**Diff (expected vs actual):**
```diff
@@ -99 @@
     }
     clearEntangledAsyncTransitionTypes();
     if (pendingEntangledRoots === 0) {
-      stopIsomorphicDefaultIndicator();
+      if (enableDefaultTransitionIndicator) {
+        stopIsomorphicDefaultIndicator();
+      }
     }
     if (currentEntangledListeners !== null) {
       // All the actions have finished. Close the entangled async action scope
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
Fixed. The two adjacent statements have been swapped back to their correct order. The `return textEncoder.encode(content);` line now belongs inside the `stringToChunk` function, and the `flushBuffered` method declaration is now a separate property in the object, not nested inside `stringToChunk`.
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

### Structural Swap Adjacent Lines 003 (backend.js) — 0/3

**All runs failed with same error:** File mismatch for backend.js

**Sample agent response (run 1):**
```
Perfect! The fix has been applied. The two adjacent statement blocks have been reordered:

**Fixed order in `connectWithCustomMessagingProtocol` function (lines 388-404):**

**Before:**
1. Create agent (line 388)
2. Call `onReloadAndProfileFlagsReset()` (lines 389-391)
3. Set up listeners (lines 393-404)

**After:**
1. Create agent (line 388)
2. Set up listeners (lines 389-400)
3. Call `onReloadAndProfileFlagsReset()` (lines 402-404)

The flag reset callback is now properly invoked after all ...
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
-  if (typeof onReloadAndProfileFlagsReset === 'function') {
-    onReloadAndProfileFlagsReset();
-  }
-
   if (onSettingsUpdated != null) {
     agent.addListener('updateHookSettings', onSettingsUpdated);
   }
@@ -376 @@
     hook.emit('shutdown');
   });
 
+  if (typeof onReloadAndProfileFlagsReset === 'function') {
+    onReloadAndProfileFlagsReset();
+  }
+
   const unsubscribeBackend = initBackend(hook, agent, window, isReloadAndProfileSupported);
 
   const nativeStyleResolver: ResolveNativeStyle | void = resolveRNStyle || hook.resolveRNStyle;
```

### Structural Swap If Else 001 (importFile.js) — 0/3

**All runs failed with same error:** File mismatch for importFile.js

**Sample agent response (run 1):**
```
Done. I've fixed the swapped if/else branches by:
1. Negating the condition to `!(error instanceof InvalidProfileError)`
2. Swapping the return statuses so that `InvalidProfileError` now correctly returns `'UNEXPECTED_ERROR'` and other errors return `'INVALID_PROFILE_ERROR'`
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
