# OMK TUI Control Design System

## Product Surface

OMK interactive startup/control mode is a terminal-first operations console. The control surface must feel like a live tmux pane: dense, scan-friendly, monochrome-black background, neon status colors, and no marketing layout.

## Visual Tokens

- Background: terminal black.
- Primary accent: electric cyan for titles, dividers, and route labels.
- Secondary accent: magenta/violet for active borders and model suffixes.
- Status green: vivid green for ready/armed/online states.
- Warning yellow: cyberpunk amber for core labels and matrix accents.
- Muted text: teal-gray for labels and metadata.
- Borders: cyan/magenta neon lines, rounded terminal geometry (╭─╮│╰╯).

## Typography

- Terminal monospace only.
- Uppercase labels for control groups.
- Compact rows over large prose.
- No viewport-scaled text.

## Layout

- Wide view uses a two-column tmux pattern: main hero/control deck on the left and a fixed-width control pane on the right.
- Expanded help keeps the deck and right control pane visible, then places context/resources below.
- Right control pane remains fixed-width and visually pinned while the main/expanded content grows or scrolls.
- Narrow view may collapse to the existing compact/expanded single-column fallback.

## Motion

- Banner animation is gradient-only and ANSI color-only.
- Motion is opt-in, TTY-gated, reduced-motion aware, and uses color drift/reveal effects rather than layout changes.

## Components

- Hero deck: centered OMK title, route labels, animated ASCII mark, model/status legend.
- Right control pane: tab bar, OMK://CONTROL identity, status, TODO, session, model/context, runtime/MCP/skills, control summary.
- Expanded resources: unboxed terminal sections below the deck.

## QA Gates

- Component render regression must prove expanded mode preserves the fixed control pane.
- tmux capture must show no overflow at the target reference width.
- Visual QA must include TUI text check and reviewer synthesis before completion.
