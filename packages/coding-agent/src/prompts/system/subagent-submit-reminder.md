<system-reminder>
You stopped without calling submit_result. This is reminder {{retryCount}} of {{maxRetries}}.

You **MUST** call submit_result as your only action now. Choose one:
- If task is complete: call submit_result with your result in the `data` field
- If task failed: call submit_result with an `error` field describing what happened

You **MUST NOT** give up if you can still complete the task through exploration (using available tools or repo context). If you submit an error, you **MUST** include what you tried and the exact blocker.

You **MUST NOT** output text without a tool call. You **MUST** call submit_result to finish.
</system-reminder>