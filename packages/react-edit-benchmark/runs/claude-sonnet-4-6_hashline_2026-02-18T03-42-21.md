# Edit Benchmark Report

## Configuration

| Setting | Value |
|---------|-------|
| Date | 2026-02-18T03:34:20.384Z |
| Model | p-anthropic/p-anthropic/claude-sonnet-4-6 |
| Thinking Level | low |
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
| Total Tasks | 80 |
| Total Runs | 80 |
| Successful Runs | 66 |
| **Task Success Rate** | **82.5% (66/80)** |
| Verified Rate | 82.5% (66/80) |
| Edit Tool Usage Rate | 97.5% (78/80) |
| **Edit Success Rate** | **97.6%** |
| Timeout Runs | 0 |
| Mutation Intent Match Rate | 79.5% |
| Patch Failure Rate | 2.4% (2/83) |
| Tasks All Passing | 66 |
| Tasks Flaky/Failing | 14 |

### Tool Calls

| Tool | Total | Avg/Run |
|------|-------|---------|
| Read | 178 | 2.2 |
| Edit | 83 | 1.0 |
| Write | 0 | 0.0 |
| **Tool Input Chars** | 28,974 | 362 |

### Tokens & Time

| Metric | Total | Avg/Run |
|--------|-------|---------|
| Input Tokens | 487 | 6 |
| Output Tokens | 138,786 | 1,735 |
| Total Tokens | 3,619,452 | 45,243 |
| Duration | 3291.0s | 41.1s |
| **Avg Indent Score** | — | **0.00** |

### Hashline Edit Subtypes

| Operation | Count | % |
|-----------|-------|---|
| set_line | 80 | 84.2% |
| replace_lines | 5 | 5.3% |
| insert_after | 9 | 9.5% |
| replace | 1 | 1.1% |
| **Total** | **95** | 100% |

## Task Results

| Task | File | Success | Edit Hit | R/E/W | Tokens (In/Out) | Time | Indent |
|------|------|---------|----------|-------|-----------------|------|--------|
| Access Remove Optional Chain 001 | fallbackEvalContext.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/365 | 9.3s | 0.00 |
| Access Remove Optional Chain 003 | hookNamesCache.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/505 | 13.2s | 0.00 |
| Access Remove Optional Chain 005 | registerDevToolsEventLogger.js | 1/1 ✅ | 100.0% | 5/1/0 | 9/2,155 | 41.2s | 0.00 |
| Access Remove Optional Chain 007 | index.js | 0/1 ❌ | 100.0% | 2/1/0 | 4/18,096 | 297.0s | 0.00 |
| Call Swap Call Args 001 | formatConsoleArguments.js | 1/1 ✅ | 100.0% | 1/1/0 | 5/249 | 5.6s | 0.00 |
| Call Swap Call Args 003 | ReactFlightDOMServerBrowser.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/464 | 16.3s | 0.00 |
| Call Swap Call Args 005 | ReactNoopPersistent.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/684 | 14.4s | 0.00 |
| Call Swap Call Args 007 | parseSourceAndMetadata.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/644 | 13.2s | 0.00 |
| Duplicate Duplicate Line Flip 001 | isCustomElement.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/711 | 16.6s | 0.00 |
| Duplicate Duplicate Line Flip 003 | ReactFiberDevToolsHook.js | 0/1 ❌ | 100.0% | 2/1/0 | 4/19,910 | 269.1s | 0.00 |
| Duplicate Duplicate Line Flip 005 | shallowEqual.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/378 | 9.1s | 0.00 |
| Duplicate Duplicate Line Flip 007 | ReactDOMEventReplaying.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/5,797 | 98.4s | 0.00 |
| Identifier Identifier Multi Edit 001 | Button.js | 1/1 ✅ | 100.0% | 3/1/0 | 7/771 | 14.2s | 0.00 |
| Identifier Identifier Multi Edit 003 | ReactFlightDOMClientBrowser.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/649 | 13.1s | 0.00 |
| Identifier Identifier Multi Edit 005 | githubAPI.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/544 | 11.4s | 0.00 |
| Identifier Identifier Multi Edit 007 | ReactFiberComponentStack.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/587 | 11.7s | 0.00 |
| Import Swap Named Imports 001 | ListApp.js | 1/1 ✅ | 100.0% | 3/1/0 | 7/1,850 | 34.3s | 0.00 |
| Import Swap Named Imports 003 | index.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/4,004 | 65.4s | 0.00 |
| Import Swap Named Imports 005 | SuspenseScrubber.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/542 | 11.5s | 0.00 |
| Import Swap Named Imports 007 | InspectedElement.js | 0/1 ❌ | 100.0% | 0/0/0 | 0/0 | 360.0s | 0.00 |
| Literal Flip Boolean 001 | ReactDOMLegacyServerImpl.js | 1/1 ✅ | 100.0% | 3/1/0 | 7/3,934 | 63.5s | 0.00 |
| Literal Flip Boolean 003 | ReactProfilerTimer.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/690 | 18.8s | 0.00 |
| Literal Flip Boolean 005 | OpenInEditorButton.js | 1/1 ✅ | 100.0% | 3/1/0 | 7/1,907 | 35.1s | 0.00 |
| Literal Flip Boolean 007 | Element.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/478 | 12.1s | 0.00 |
| Literal Off By One 001 | ReactOwnerStackFrames.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/374 | 9.2s | 0.00 |
| Literal Off By One 003 | ReactFlightClientConfigBundlerTurbopack.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/555 | 12.8s | 0.00 |
| Literal Off By One 005 | ContextMenu.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/505 | 10.8s | 0.00 |
| Literal Off By One 007 | index.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/727 | 16.1s | 0.00 |
| Operator Remove Negation 001 | prepareInjection.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/343 | 9.5s | 0.00 |
| Operator Remove Negation 003 | ReactDOMSelection.js | 1/1 ✅ | 100.0% | 3/1/0 | 7/1,231 | 45.7s | 0.00 |
| Operator Remove Negation 005 | ReactDOMContainer.js | 0/1 ❌ | 100.0% | 0/0/0 | 0/0 | 360.0s | 0.00 |
| Operator Remove Negation 007 | SelectEventPlugin.js | 1/1 ✅ | 100.0% | 3/1/0 | 7/569 | 20.1s | 0.00 |
| Operator Swap Arithmetic 001 | formatConsoleArguments.js | 1/1 ✅ | 100.0% | 1/1/0 | 5/255 | 6.1s | 0.00 |
| Operator Swap Arithmetic 003 | ReactFlightDOMServerBrowser.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/771 | 18.2s | 0.00 |
| Operator Swap Arithmetic 005 | ReactFiberConfigWithNoResources.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/350 | 9.5s | 0.00 |
| Operator Swap Arithmetic 007 | useCanvasInteraction.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/659 | 14.4s | 0.00 |
| Operator Swap Comparison 001 | useSmartTooltip.js | 1/1 ✅ | 100.0% | 3/1/0 | 7/2,306 | 36.7s | 0.00 |
| Operator Swap Comparison 003 | ReactFlightDOMServerBrowser.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/712 | 16.2s | 0.00 |
| Operator Swap Comparison 005 | Rectangle.js | 1/1 ✅ | 100.0% | 3/1/0 | 7/1,595 | 29.6s | 0.00 |
| Operator Swap Comparison 007 | ReactFiberTreeReflection.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/812 | 21.0s | 0.00 |
| Operator Swap Equality 001 | ReactNoopFlightClient.js | 1/1 ✅ | 100.0% | 4/1/0 | 8/1,349 | 29.2s | 0.00 |
| Operator Swap Equality 003 | astUtils.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/798 | 17.4s | 0.00 |
| Operator Swap Equality 005 | ReactDOMContainer.js | 1/1 ✅ | 100.0% | 3/1/0 | 7/588 | 13.9s | 0.00 |
| Operator Swap Equality 007 | ReactFlightDOMServerBrowser.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/1,103 | 21.2s | 0.00 |
| Operator Swap Increment Decrement 001 | index.js | 1/1 ✅ | 100.0% | 1/1/0 | 5/243 | 5.9s | 0.00 |
| Operator Swap Increment Decrement 003 | ReactFlightClientConfigBundlerESM.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/422 | 13.0s | 0.00 |
| Operator Swap Increment Decrement 005 | ReactFiberViewTransitionComponent.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/408 | 11.7s | 0.00 |
| Operator Swap Increment Decrement 007 | ReactFiberConcurrentUpdates.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/612 | 20.1s | 0.00 |
| Operator Swap Logical 001 | ErrorView.js | 0/1 ❌ | 100.0% | 3/1/0 | 7/4,323 | 82.4s | 0.00 |
| Operator Swap Logical 003 | DevTools.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/591 | 14.6s | 0.00 |
| Operator Swap Logical 005 | UseEffectEvent.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/689 | 20.1s | 0.00 |
| Operator Swap Logical 007 | getHookNameForLocation.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/970 | 22.1s | 0.00 |
| Operator Swap Nullish 001 | ElementBadges.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/491 | 10.6s | 0.00 |
| Operator Swap Nullish 003 | ReactComponentStackFrame.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/659 | 15.0s | 0.00 |
| Operator Swap Nullish 005 | ReactLogo.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/739 | 16.3s | 0.00 |
| Operator Swap Nullish 007 | SuspenseBreadcrumbs.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/1,035 | 22.7s | 0.00 |
| Regex Swap Regex Quantifier 001 | SimpleValues.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/395 | 9.1s | 0.00 |
| Regex Swap Regex Quantifier 003 | utils.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/1,975 | 41.4s | 0.00 |
| Regex Swap Regex Quantifier 005 | formatWithStyles.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/977 | 19.0s | 0.00 |
| Regex Swap Regex Quantifier 007 | RunReactCompiler.ts | 1/1 ✅ | 100.0% | 3/2/0 | 6/10,260 | 168.7s | 0.00 |
| Structural Delete Statement 001 | useExtensionComponentsPanelVisibility.js | 0/1 ❌ | 100.0% | 2/1/0 | 6/541 | 10.7s | 0.00 |
| Structural Delete Statement 003 | useCanvasInteraction.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/895 | 18.1s | 0.00 |
| Structural Delete Statement 005 | StackTraceView.js | 0/1 ❌ | 100.0% | 5/1/0 | 9/1,930 | 35.0s | 0.00 |
| Structural Delete Statement 007 | ReactDOMFizzStaticBrowser.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/1,227 | 20.8s | 0.00 |
| Structural Remove Early Return 001 | ReactFlightAsyncDispatcher.js | 0/1 ❌ | 100.0% | 2/1/0 | 6/1,615 | 29.3s | 0.00 |
| Structural Remove Early Return 003 | ReactDOMComponentTree.js | 0/1 ❌ | 100.0% | 2/1/0 | 6/1,623 | 33.5s | 0.00 |
| Structural Remove Early Return 005 | TabBar.js | 0/1 ❌ | 100.0% | 4/1/0 | 8/942 | 24.3s | 0.00 |
| Structural Remove Early Return 007 | CommitTreeBuilder.js | 0/1 ❌ | 60.0% | 5/5/0 | 13/4,255 | 90.9s | 0.00 |
| Structural Swap Adjacent Lines 001 | reactPolling.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/458 | 9.3s | 0.00 |
| Structural Swap Adjacent Lines 003 | OwnersStack.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/534 | 12.2s | 0.00 |
| Structural Swap Adjacent Lines 005 | ReactOwnerStackFrames.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/730 | 13.0s | 0.00 |
| Structural Swap Adjacent Lines 007 | ReactFlightClientConfigBundlerWebpack.js | 0/1 ❌ | 100.0% | 2/1/0 | 6/1,605 | 27.6s | 0.00 |
| Structural Swap If Else 001 | utils.js | 0/1 ❌ | 100.0% | 1/1/0 | 3/7,037 | 135.4s | 0.00 |
| Structural Swap If Else 003 | ReactDOMFloat.js | 0/1 ❌ | 100.0% | 3/1/0 | 7/5,497 | 86.3s | 0.00 |
| Structural Swap If Else 005 | ReactClientConsoleConfigPlain.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/960 | 21.5s | 0.00 |
| Structural Swap If Else 007 | index.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/842 | 16.6s | 0.00 |
| Unicode Unicode Hyphen 001 | formatProdErrorMessage.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/378 | 8.7s | 0.00 |
| Unicode Unicode Hyphen 003 | SourceMapConsumer.js | 1/1 ✅ | 100.0% | 3/1/0 | 7/569 | 13.1s | 0.00 |
| Unicode Unicode Hyphen 005 | babel.config.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/400 | 8.5s | 0.00 |
| Unicode Unicode Hyphen 007 | ReactInternalTestUtils.js | 1/1 ✅ | 100.0% | 2/1/0 | 6/443 | 11.5s | 0.00 |

## Category Summary

| Category | Runs | Verified | Edit Used | Success | Min/Avg/Max Difficulty |
|----------|------|----------|-----------|---------|------------------------|
| access | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) | 3 / 7.5 / 10 |
| call | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) | 2 / 7.8 / 14 |
| duplicate | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) | 8 / 11.3 / 17 |
| identifier | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) | 4 / 6.8 / 9 |
| import | 4 | 75.0% (3/4) | 75.0% (3/4) | 75.0% (3/4) | 2 / 3.8 / 5 |
| literal | 8 | 100.0% (8/8) | 100.0% (8/8) | 100.0% (8/8) | 3 / 6.9 / 10 |
| operator | 28 | 92.9% (26/28) | 96.4% (27/28) | 92.9% (26/28) | 3 / 6.7 / 10 |
| regex | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) | 2 / 5.8 / 10 |
| structural | 16 | 43.8% (7/16) | 100.0% (16/16) | 43.8% (7/16) | 4 / 8.3 / 13 |
| unicode | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) | 2 / 4.8 / 8 |

## Mutation Summary

| Mutation | Category | Runs | Verified | Edit Used | Success |
|----------|----------|------|----------|-----------|---------|
| delete-statement | structural | 4 | 50.0% (2/4) | 100.0% (4/4) | 50.0% (2/4) |
| duplicate-line-flip | duplicate | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) |
| flip-boolean | literal | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| identifier-multi-edit | identifier | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| off-by-one | literal | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| remove-early-return | structural | 4 | 0.0% (0/4) | 100.0% (4/4) | 0.0% (0/4) |
| remove-negation | operator | 4 | 75.0% (3/4) | 75.0% (3/4) | 75.0% (3/4) |
| remove-optional-chain | access | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) |
| swap-adjacent-lines | structural | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) |
| swap-arithmetic | operator | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| swap-call-args | call | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| swap-comparison | operator | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| swap-equality | operator | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| swap-if-else | structural | 4 | 50.0% (2/4) | 100.0% (4/4) | 50.0% (2/4) |
| swap-increment-decrement | operator | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| swap-logical | operator | 4 | 75.0% (3/4) | 100.0% (4/4) | 75.0% (3/4) |
| swap-named-imports | import | 4 | 75.0% (3/4) | 75.0% (3/4) | 75.0% (3/4) |
| swap-nullish | operator | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| swap-regex-quantifier | regex | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| unicode-hyphen | unicode | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |

## Difficulty Summary

| Difficulty Score | Runs | Verified | Edit Used | Success |
|------------------|------|----------|-----------|---------|
| 0-2 | 4 | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| 3-5 | 24 | 79.2% (19/24) | 91.7% (22/24) | 79.2% (19/24) |
| 6-8 | 27 | 85.2% (23/27) | 100.0% (27/27) | 85.2% (23/27) |
| 9+ | 25 | 80.0% (20/25) | 100.0% (25/25) | 80.0% (20/25) |

## Edit Tool Errors

Failures where the edit tool returned an error or failed to apply the patch.

### Structural Remove Early Return 007 (CommitTreeBuilder.js)

#### Run 1

##### Attempt 1

- Path: CommitTreeBuilder.js
- Operation: —

**Tool error**

```
Insert-after edit (src "N:HH..") requires non-empty dst
```

**Patch args**

```diff
{
  "path": "CommitTreeBuilder.js",
  "edits": [
    {
      "insert_after": {
        "intent": "Restore the blank line between guard clause and next block",
        "anchor": "69:18",
        "text": ""
      }
    }
  ]
}
```

##### Attempt 2

- Path: CommitTreeBuilder.js
- Operation: —

**Tool error**

```
No changes made to CommitTreeBuilder.js. The edits produced identical content.
Edit 0: replacement for 69:18 is identical to current content:
  69:18|   }
  const { profilingData } = profilerStore;
Your content must differ from what the file already contains. Re-read the file to see the current state.
The file differs from the original fixture at these lines:
67:e7  +  if (commitTrees.length > commitIndex) {
67:54  +    return commitTrees[commitIndex];
67:18  +  }
67:05  +
```

**Patch args**

```diff
{
  "path": "CommitTreeBuilder.js",
  "edits": [
    {
      "replace_lines": {
        "intent": "Add blank line between guard clause closing brace and profilingData block",
        "start_anchor": "69:18",
        "end_anchor": "70:f2",
        "new_text": "  }\n\n  const { profilingData } = profilerStore;"
      }
    }
  ]
}
```

## Failed Tasks (0% passing)

### Access Remove Optional Chain 007 (index.js) — 0/1

**All runs failed with same error:** File mismatch for index.js

**Sample agent response (run 1):**
```
Fix applied. Line 251 now reads `bridge?.emit('extensionComponentsPanelShown')`, restoring the optional chain that guards against `bridge` being null during the cleanup/remount window between page navigations.
```

**Diff (expected vs actual):**
```diff
@@ -64 @@
     },
 
     send(event: string, payload: any, transferable?: Array<any>) {
-      port?.postMessage({ event, payload }, transferable);
+      port.postMessage({ event, payload }, transferable);
     },
   });
 
@@ -248 @@
       });
 
       createdPanel.onShown.addListener(() => {
-        bridge.emit('extensionComponentsPanelShown');
+        bridge?.emit('extensionComponentsPanelShown');
       });
       createdPanel.onHidden.addListener(() => {
         bridge.emit('extensionComponentsPanelHidden');
```

### Duplicate Duplicate Line Flip 003 (ReactFiberDevToolsHook.js) — 0/1

**All runs failed with same error:** File mismatch for ReactFiberDevToolsHook.js

**Sample agent response (run 1):**
```
Line 95 now matches the pattern used in every other catch block (`if (!hasLoggedError) {`, hash `7d`), and no longer redundantly re-checks `__DEV__` inside a block already gated by `if (__DEV__)`.
```

**Diff (expected vs actual):**
```diff
@@ -46 @@
 export function injectInternals(internals: Object): boolean {
   if (typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ === 'undefined') {
     // No DevTools
-    return false;
+    return true;
   }
   const hook = __REACT_DEVTOOLS_GLOBAL_HOOK__;
   if (hook.isDisabled) {
@@ -92 @@
       try {
         injectedHook.onScheduleFiberRoot(rendererID, root, children);
       } catch (err) {
-        if (__DEV__ && !hasLoggedError) {
+        if (!hasLoggedError) {
           hasLoggedError = true;
           console.error('React instrumentation encountered an error: %o', err);
         }
```

### Import Swap Named Imports 007 (InspectedElement.js) — 0/1

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | — | 0 / 0 | 360.0s |

### Operator Remove Negation 005 (ReactDOMContainer.js) — 0/1

| Run | Status | Error | Tokens (in/out) | Time |
|-----|--------|-------|-----------------|------|
| 1 | ❌ | — | 0 / 0 | 360.0s |

### Operator Swap Logical 001 (ErrorView.js) — 0/1

**All runs failed with same error:** File mismatch for ErrorView.js

**Sample agent response (run 1):**
```
Changed `!==` to `!=` on line 36. The strict inequality `!== null` only guards against `null`, while the loose `!= null` correctly guards against both `null` and `undefined` — the intended check for an optional function prop.
```

**Diff (expected vs actual):**
```diff
@@ -32 @@
       {children}
       <div className={styles.ErrorInfo}>
         <div className={styles.HeaderRow}>
-          <div className={styles.ErrorHeader}>Uncaught Error: {errorMessage || ''}</div>
-          {dismissError !== null && (
+          <div className={styles.ErrorHeader}>Uncaught Error: {errorMessage && ''}</div>
+          {dismissError != null && (
             <Button className={styles.CloseButton} onClick={dismissError}>
               Dismiss
               <ButtonIcon className={styles.CloseButtonIcon} type="close" />
```

### Structural Delete Statement 001 (useExtensionComponentsPanelVisibility.js) — 0/1

**All runs failed with same error:** File mismatch for useExtensionComponentsPanelVisibility.js

**Sample agent response (run 1):**
```
Restored the missing `const [isVisible, setIsVisible] = useState(true);` declaration on line 16. Without it, `isVisible` and `setIsVisible` were undefined, causing the hook to always return `undefined` instead of a boolean, and the state setters in `onPanelShown`/`onPanelHidden` would throw at runtime.
```

**Diff (expected vs actual):**
```diff
@@ -14 @@
 // For other implementations, this hook will just return constant `true` value.
 export function useExtensionComponentsPanelVisibility(bridge: FrontendBridge): boolean {
   const [isVisible, setIsVisible] = useState(true);
-
   useEffect(() => {
     function onPanelShown() {
       setIsVisible(true);
```

### Structural Delete Statement 005 (StackTraceView.js) — 0/1

**All runs failed with same error:** File mismatch for StackTraceView.js

**Sample agent response (run 1):**
```
`ignored` is now defined at line 52, derived from `symbolicatedCallSite.ignored` (or `false` when not symbolicated), exactly matching the pattern used for the location destructuring on lines 50–51.
```

**Diff (expected vs actual):**
```diff
@@ -50 @@
   const [functionName, url, line, column] =
     symbolicatedCallSite !== null ? symbolicatedCallSite.location : callSite;
   const ignored = symbolicatedCallSite !== null ? symbolicatedCallSite.ignored : false;
+
   // TODO: Make an option to be able to toggle the display of ignore listed rows.
   // Ideally this UI should be higher than a single Stack Trace so that there's not
   // multiple buttons in a single inspection taking up space.
```

### Structural Remove Early Return 001 (ReactFlightAsyncDispatcher.js) — 0/1

**All runs failed with same error:** File mismatch for ReactFlightAsyncDispatcher.js

**Sample agent response (run 1):**
```
The guard clause is restored. `resolveCache` now correctly returns the server-managed cache when a request is active, and falls back to a fresh `Map()` otherwise — matching the pattern used in `cacheSignal` and consistent with the `getCache` import.
```

**Diff (expected vs actual):**
```diff
@@ -14 @@
 
 function resolveCache(): Map<Function, mixed> {
   const request = resolveRequest();
+
   if (request) {
     return getCache(request);
   }
```

### Structural Remove Early Return 003 (ReactDOMComponentTree.js) — 0/1

**All runs failed with same error:** File mismatch for ReactDOMComponentTree.js

**Sample agent response (run 1):**
```
The fix is correct. The restored guard clause:

```js
if (targetFiber) {
  return targetFiber;
}
```

goes immediately after `targetFiber` is computed, before the fall-through to `getParentHydrationBoundary`. This matches the surrounding comments exactly: "If we don't find a Fiber…" now refers to the case where `targetFiber` is falsy, and the loop continues upward; when it is truthy, we return it immediately.
```

**Diff (expected vs actual):**
```diff
@@ -185 @@
             ? internalInstanceMap.get(hydrationInstance)
             : // $FlowFixMe[prop-missing]
               hydrationInstance[internalInstanceKey];
+
           if (targetFiber) {
             return targetFiber;
           }
           if (targetFiber) {
             return targetFiber;
           }
+
           // If we don't find a Fiber on the comment, it might be because
           // we haven't gotten to hydrate it yet. There might still be a
           // parent boundary that hasn't above this one so we need to find
```

### Structural Remove Early Return 005 (TabBar.js) — 0/1

**All runs failed with same error:** File mismatch for TabBar.js

**Sample agent response (run 1):**
```
The guard clause is restored. Lines 92–94 now contain the exact 3-line pattern: `if (tab === null) {` / `return null;` / `}`, inserted before the destructure on line 95 to safely skip null entries in the `tabs` array.
```

**Diff (expected vs actual):**
```diff
@@ -90 @@
     <Fragment>
       {tabs.map((tab) => {
         if (tab === null) {
-          return <div key="VRule" className={styles.VRule} />;
+          return null;
         }
         }
-
         const { icon, id, label, title } = tab;
 
         let button = (
```

### Structural Remove Early Return 007 (CommitTreeBuilder.js) — 0/1

**All runs failed with same error:** File mismatch for CommitTreeBuilder.js

**Sample agent response (run 1):**
```
The fix is correct. The restored guard clause at lines 67–69:

```js
if (commitTrees.length > commitIndex) {
  return commitTrees[commitIndex];
}
```

— returns the already-cached commit tree when it exists, preventing `null` from being returned when the loop body is skipped because `commitTrees.length > commitIndex`.
```

**Diff (expected vs actual):**
```diff
@@ -63 @@
   }
 
   const commitTrees = ((rootToCommitTreeMap.get(rootID): any): Array<CommitTree>);
-  if (commitIndex < commitTrees.length) {
+
+  if (commitTrees.length > commitIndex) {
     return commitTrees[commitIndex];
   }
 
```

### Structural Swap Adjacent Lines 007 (ReactFlightClientConfigBundlerWebpack.js) — 0/1

**All runs failed with same error:** File mismatch for ReactFlightClientConfigBundlerWebpack.js

**Sample agent response (run 1):**
```
Correct. `chunkCache.set(chunkId, thenable)` now precedes `thenable.then(resolve, ignoreReject)`, so the cache is populated with the in-flight thenable before the cleanup handler is attached.
```

**Diff (expected vs actual):**
```diff
@@ -184 @@
     const entry = chunkCache.get(chunkId);
     if (entry === undefined) {
       const thenable = loadChunk(chunkId, chunkFilename);
-      promises.push(thenable);
-      // $FlowFixMe[method-unbinding]
       const resolve = chunkCache.set.bind(chunkCache, chunkId, null);
       const resolve = chunkCache.set.bind(chunkCache, chunkId, null);
-      thenable.then(resolve, ignoreReject);
+      // $FlowFixMe[method-unbinding]
+      promises.push(thenable);
       chunkCache.set(chunkId, thenable);
       chunkCache.set(chunkId, thenable);
+      thenable.then(resolve, ignoreReject);
     } else if (entry !== null) {
       promises.push(entry);
     }
```

### Structural Swap If Else 001 (utils.js) — 0/1

**All runs failed with same error:** File mismatch for utils.js

**Sample agent response (run 1):**
```
Lines 24 and 26 are now correct — only those two lines were touched, everything else is unchanged.
```

**Diff (expected vs actual):**
```diff
@@ -21 @@
 
     // Check if sourceURL is a correct URL, which has a protocol specified
     if (sourceURL.startsWith('file:///')) {
-      filePath = new URL(sourceURL).pathname;
+      filePath = sourceURL;
     } else if (sourceURL.includes('://')) {
     } else if (sourceURL.includes('://')) {
-      // $FlowFixMe[cannot-resolve-name]
+      filePath = new URL(sourceURL).pathname;
+    } else {
       if (!__IS_INTERNAL_VERSION__) {
       if (!__IS_INTERNAL_VERSION__) {
-        // In this case, we can't really determine the path to a file, disable a button
-        return { url: null, shouldDisableButton: true };
+        return {
+          url: null,
+          shouldDisableButton: true,
+        };
       } else {
         const endOfSourceMapURLPattern = '.js/';
         const endOfSourceMapURLIndex = sourceURL.lastIndexOf(endOfSourceMapURLPattern);
       } else {
         const endOfSourceMapURLPattern = '.js/';
         const endOfSourceMapURLIndex = sourceURL.lastIndexOf(endOfSourceMapURLPattern);
-
         if (endOfSourceMapURLIndex === -1) {
         if (endOfSourceMapURLIndex === -1) {
-          return { url: null, shouldDisableButton: true };
+          return {
+            url: null,
+            shouldDisableButton: true,
+          };
         } else {
           filePath = sourceURL.slice(
             endOfSourceMapURLIndex + endOfSourceMapURLPattern.length,
@@ -40 @@
           );
         }
       }
-    } else {
-      filePath = sourceURL;
     }
 
     const lineNumberAsString = String(line);
```

### Structural Swap If Else 003 (ReactDOMFloat.js) — 0/1

**All runs failed with same error:** File mismatch for ReactDOMFloat.js

**Sample agent response (run 1):**
```
The fix is correct. Now:

- `if (encountered)` → fires `console.error` with the general "Expected up to two arguments" message (only when there are actual argument validation failures).
- `else` → runs the `switch` to check for unsupported `as` module types (only when arguments are structurally valid and no errors were accumulated).

Previously, the `else` branch was unconditionally logging an error even when `encountered` was `''` (no issues), and the `switch` — which only makes sense when a...
```

**Diff (expected vs actual):**
```diff
@@ -257 @@
         case 'script': {
           break;
         }
-
-        // We have an invalid as type and need to warn
         default: {
           const typeOfAs = getValueDescriptorExpectingEnumForWarning(as);
           console.error(
```
