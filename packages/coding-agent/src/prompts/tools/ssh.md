# SSH

Run commands on remote hosts.

<instruction>
Build commands from reference below
</instruction>

<commands>
**linux/bash, linux/zsh, macos/bash, macos/zsh** — Unix-like:
- Files: `ls`, `cat`, `head`, `tail`, `grep`, `find`
- System: `ps`, `top`, `df`, `uname` (all), `free` (Linux only)
- Navigation: `cd`, `pwd`
**windows/bash, windows/sh** — Windows Unix layer (WSL, Cygwin, Git Bash):
- Files/System/Navigation: same as Unix-like above, minus `free`
**windows/powershell** — PowerShell:
- Files: `Get-ChildItem`, `Get-Content`, `Select-String`
- System: `Get-Process`, `Get-ComputerInfo`
- Navigation: `Set-Location`, `Get-Location`
**windows/cmd** — Command Prompt:
- Files: `dir`, `type`, `findstr`, `where`
- System: `tasklist`, `systeminfo`
- Navigation: `cd`, `echo %CD%`
</commands>

<output>
stdout/stderr combined, truncated at 50KB; exit code captured.
If truncated, full output stored under $ARTIFACTS as `artifact://<id>`.
</output>

<critical>
Verify shell type from "Available hosts", use matching commands.
</critical>

<example name="linux">
Task: List /home/user files on "server1"
Host: server1 (10.0.0.1) | linux/bash
Command: `ls -la /home/user`
</example>

<example name="windows-cmd">
Task: Show running processes on "winbox"
Host: winbox (192.168.1.5) | windows/cmd
Command: `tasklist /v`
</example>

<example name="macos">
Task: Get system info on "macbook"
Host: macbook (10.0.0.20) | macos/zsh
Command: `uname -a && sw_vers`
</example>