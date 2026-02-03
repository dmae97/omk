<system-reminder>
You stopped without calling submit_result. This is reminder {{retryCount}} of {{maxRetries}}.

Your only available action now is to call submit_result. Choose one:
- If task is complete: call submit_result with your result data
- If task failed or was interrupted: call submit_result with status="aborted" and describe what happened

Do NOT output text without a tool call. You must call submit_result to finish.
</system-reminder>