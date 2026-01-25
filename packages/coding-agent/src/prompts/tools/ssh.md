# SSH

Execute commands on remote SSH hosts.

<instruction>
1. Check the host's shell type from "Available hosts" below
2. Use ONLY commands for that shell type
3. Construct your command using the reference below
</instruction>

<commands>
**linux/bash, linux/zsh, macos/bash, macos/zsh** — Unix-like systems:
- Files: `ls`, `cat`, `head`, `tail`, `grep`, `find`
- System: `ps`, `top`, `df`, `uname`, `free` (Linux), `df`, `uname`, `top` (macOS)
- Navigation: `cd`, `pwd`
**windows/bash, windows/sh** — Windows with Unix compatibility layer (WSL, Cygwin, Git Bash):
- Files: `ls`, `cat`, `head`, `tail`, `grep`, `find`
- System: `ps`, `top`, `df`, `uname`
- Navigation: `cd`, `pwd`
- Note: These are Windows hosts but use Unix commands
**windows/powershell** — Native Windows PowerShell:
- Files: `Get-ChildItem`, `Get-Content`, `Select-String`
- System: `Get-Process`, `Get-ComputerInfo`
- Navigation: `Set-Location`, `Get-Location`
**windows/cmd** — Native Windows Command Prompt:
- Files: `dir`, `type`, `findstr`, `where`
- System: `tasklist`, `systeminfo`
- Navigation: `cd`, `echo %CD%`
</commands>

<output>
Command output (stdout/stderr combined), truncated at 50KB. Exit code is captured.
If output is truncated, full output is stored under $ARTIFACTS and referenced as `artifact://<id>` in metadata.
</output>

<critical>
Each host runs a specific shell. You MUST use commands native to that shell.
Verify host shell type from "Available hosts" and use matching commands.
</critical>

<example name="linux">
Task: List files in /home/user on host "server1"
Host: server1 (10.0.0.1) | linux/bash
Command: `ls -la /home/user`
</example>

<example name="windows-cmd">
Task: Show running processes on host "winbox"
Host: winbox (192.168.1.5) | windows/cmd
Command: `tasklist /v`
</example>

<example name="windows-wsl">
Task: Check disk usage on host "wsl-dev"
Host: wsl-dev (192.168.1.10) | windows/bash
Command: `df -h`
Note: Windows host with WSL — use Unix commands
</example>

<example name="macos">
Task: Get system info on host "macbook"
Host: macbook (10.0.0.20) | macos/zsh
Command: `uname -a && sw_vers`
</example>