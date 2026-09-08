# Windows Setup

OMK requires a bash shell on Windows. Checked locations (in order):

1. Custom path from `~/.omk/agent/settings.json`
2. Git Bash (`C:\Program Files\Git\bin\bash.exe`)
3. `bash.exe` on PATH (Cygwin, MSYS2, WSL)

For most users, [Git for Windows](https://git-scm.com/download/win) is sufficient.

## Custom Shell Path

```json
{
  "shellPath": "C:\\cygwin64\\bin\\bash.exe"
}
```

## Open reports and screenshots from WSL

In Windows Terminal, hold **Ctrl** and left-click a rendered file link. OMK resolves
relative report/image links against the active session's project directory, not the
OMK installation directory. For example, `docs/reviews/mobile-after.png` points into
that project even when the session was resumed from another checkout.

On WSL with `WSL_DISTRO_NAME`, Linux files use Windows-openable
`file://wsl.localhost/<distribution>/...` URLs. Files under the default `/mnt/c/`
style Windows drive mounts use `file:///C:/...`. Native Linux/macOS file links keep
their native paths; SSH sessions do not rewrite paths into the local WSL namespace.
Custom drive mount locations remain accessible through the WSL UNC URL.

Markdown links, image references, existing inline-code file paths, and built-in tool
path headers support this behavior. Ordinary code is not treated as a file. Terminals
without OSC 8 support show the resolved URL in Markdown instead of a hidden target.
The terminal and Windows file associations decide which application opens the file.
A missing artifact must still be created or its path corrected; URL conversion does
not copy files or start a web server.

## Windows screenshot paste

Image paste is already part of the Pi/OMK interactive editor; no separate Pi install
or extra extension is required. In WSL, use **Win+Shift+S → Alt+V** in the OMK prompt.
A validated image appears in the attachment strip and is sent only when you submit.
Ctrl+V is an alternative when forwarded by your terminal; see
[Terminal setup](terminal-setup.md#windows-screenshots-into-a-wsl-prompt).

OMK reads the Windows clipboard first on WSL using an asynchronous, five-second
PowerShell request (`-NoProfile -NonInteractive -STA`). It tries the normal Windows
PowerShell location under `/mnt/c/Windows/` and falls back to `powershell.exe` on PATH
only if that executable location is missing. Windows interop must be enabled.

PNG bytes travel through a bounded in-memory stream: no screenshot temp file, WSL
UNC write, execution-policy override, or Photon BMP conversion is needed. The reader
limits images to the existing prompt size/pixel limits. It never changes clipboard
contents or forwards provider-key environment variables to its child process.

An empty Windows clipboard does not fall through to a stale Linux image. If Windows
interop fails, Linux readers remain fallback sources; if none works, the editor
reports a clipboard failure. Empty-image and successful-attachment states also have
visible messages instead of silent no-ops. Native Linux/macOS/Windows readers remain
unchanged. External/custom editors must forward the configured image-paste action.

If a screenshot still does not attach, first confirm that an image is on the Windows
clipboard and try Alt+V. Check WSL interop/PowerShell if OMK reports acquisition failure,
or save the screenshot and drag its file into the prompt as an alternative.
