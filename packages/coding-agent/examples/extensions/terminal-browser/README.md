# terminal-browser extension

Run a real browser inside the OMK terminal UI.

Port of the [terminal-browser Claude Code plugin](https://github.com/zenbu-labs/terminal-browser/tree/main/claude-code-plugin)
(MIT, zenbu-labs). OMK has no function-hooks/Pane API, so the pane is a
`ctx.ui.custom` overlay that renders kitty unicode placeholders; the
`terminal-browser claude-bridge` HTTP API is reused unchanged.

## Requirements

- `terminal-browser` CLI — `curl -fsSL https://terminal-browser.sh/install | bash` or `brew install terminal-browser`
- A terminal with kitty graphics protocol **and unicode placeholders**: ghostty, kitty, cmux, supacode, other libghostty terminals
- Interactive TUI mode (`omk`), not `-p`/RPC/JSON
- Not tmux/screen (multiplexers rewrite graphics escapes)

## Usage

```sh
omk --extension ./examples/extensions/terminal-browser
# or copy this directory to ~/.omk/agent/extensions/terminal-browser for auto-load
```

| Command | Action |
| --- | --- |
| `/browser example.com` | open pane at URL (https assumed) |
| `/browser http://localhost:3000` | open pane at local dev server |
| `/browser` | toggle close when open; open start page otherwise |
| `/browser close` | close pane |
| `ctrl+q` (in pane) | close pane |

LLM tools: `terminal_browser_open { url? }`, `terminal_browser_close`.
In-page control: `terminal-browser action ...` (agent-browser-compatible CLI).
"Send to agent" (ctrl+g in the browser) inserts selected text into the OMK editor.

## How it works

1. `terminal-browser claude-bridge launch` spawns a detached bridge child that
   reports `{ port, token }` and serves HTTP on `127.0.0.1` (`bridge.ts`).
2. The bridge runs `terminal-browser open` with `PIXEL_EMBED`/`PIXEL_TTY`,
   receives pixel frames, and writes kitty graphics to the TTY.
3. The overlay component (`browser-surface.ts`) prints unicode placeholder cells;
   the terminal composites the browser pixels over them.
4. Input: SGR mouse + keys are translated to bridge `/input` events
   (cell coordinates — the bridge scales to pixels).
5. Polling `/state` at 250ms while open (1.2s idle) refreshes title/URL/placed
   and drains the agent-text inbox into the editor.

## Caveats

Upstream plugin caveats apply: 50fps cap, occasional redraw glitches (select
text to force repaint), mouse coordinates are cell-granular, and the bridge
makes loopback HTTP requests (OS may prompt for local-network access).
Override the binary with `TERMINAL_BROWSER_COMMAND`.
