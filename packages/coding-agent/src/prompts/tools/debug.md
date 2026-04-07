Provides debugger access through the Debug Adapter Protocol (DAP). Use this to launch or attach debuggers, set breakpoints, step through execution, inspect threads/stack/variables, evaluate expressions, capture program output, and interrupt hung programs.

<instruction>
- Prefer this over bash when you need program state, breakpoints, stepping, thread inspection, or to interrupt a running process.
- `action: "launch"` starts a debugger session for a program or script. `program` is required. `adapter` is optional; when omitted, the tool selects an installed adapter from the target path and workspace.
- `action: "attach"` connects to an existing process. Provide `pid` for local process attach or `port` for adapters that support remote attach. Use `adapter` to force a specific debugger.
- Breakpoints:
  - Source breakpoints: `set_breakpoint` / `remove_breakpoint` with `file` + `line`
  - Function breakpoints: `set_breakpoint` / `remove_breakpoint` with `function`
  - Optional `condition` adds a conditional breakpoint expression
- Flow control:
  - `continue` resumes execution and waits briefly to see whether the program stops or keeps running
  - `step_over`, `step_in`, `step_out` perform single-step execution
  - `pause` interrupts a running program so you can inspect the current state
- Inspection:
  - `threads` lists threads
  - `stack_trace` returns frames for the current stopped thread
  - `scopes` requires `frame_id` or a current stopped frame
  - `variables` requires `variable_ref` or `scope_id`
  - `evaluate` requires `expression`; use `context: "repl"` for raw debugger commands when the adapter supports them
  - `output` returns captured stdout/stderr/console output from the debuggee and adapter
  - `sessions` lists tracked debug sessions
  - `terminate` ends the active debug session
- Timeouts apply to individual debugger requests, not the full session lifetime.
</instruction>

<caution>
- Only one active debug session is supported at a time.
- Some adapters require a launched session to receive `configurationDone` before the target actually runs; if the tool says configuration is pending, set breakpoints and then call `continue`.
- Adapter availability depends on local binaries. Common built-ins are `gdb`, `lldb-dap`, `python -m debugpy.adapter`, and `dlv dap`.
</caution>

<example name="launch and inspect hang">
1. `debug(action: "launch", program: "./my_app")`
2. `debug(action: "set_breakpoint", file: "src/main.c", line: 42)`
3. `debug(action: "continue")`
4. If the program appears hung: `debug(action: "pause")`
5. Inspect state with `threads`, `stack_trace`, `scopes`, and `variables`
</example>

<example name="raw debugger command through repl">
`debug(action: "evaluate", expression: "info registers", context: "repl")`
</example>
