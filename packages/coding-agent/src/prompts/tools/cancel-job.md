Cancels a running background job started via async tool execution or bash auto-backgrounding.

You **SHOULD** use this when a background `bash` or `task` job is no longer needed or is stuck.

You **MAY** inspect jobs first with `read jobs://` or `read jobs://<job-id>`.
