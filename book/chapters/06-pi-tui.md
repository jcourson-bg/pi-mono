# 6. pi-tui — a terminal that doesn't flicker

Most terminal apps flicker. You notice it when a spinner updates and the
whole screen winks. You notice it when `htop` redraws or a loader
animates and your eyes track a faint gray strobe. The terminal wasn't
designed to be an animation target; it was designed to be a line
printer that occasionally moves its cursor.

`pi-tui` gets around this with three ideas — string-level line diffing,
synchronized output, and rendering overlays pre-diff — and a handful of
careful details underneath.

## The render contract

A component is anything that implements:

```ts
interface Component {
  render(width: number): string[];
  handleInput?(data: string): void;
  wantsKeyRelease?: boolean;
  invalidate(): void;
}
```

`render(width)` returns an array of strings — one per line, each
fitting within `width` visible columns. That's it. No JSX tree, no
virtual DOM, no reconciliation. A component's job is to produce lines.

The `TUI` class (`packages/tui/src/tui.ts:217`) is the root container.
It owns the terminal, the `previousLines` array from the last frame,
the overlay stack, and the render throttle. Every frame is a pass
through the component tree producing an array of strings, then a diff
against the last frame's strings, then the minimum ANSI required to
bring the terminal up to date.

The enforcement detail at `tui.ts:1105` is the rule that keeps this
simple:

```
if (visibleWidth(line) > width) {
  // crash with a debug dump
}
```

A component that returns an over-wide line is considered buggy and the
TUI hard-fails with a log dump. This means the diff engine can assume
every line fits exactly; no re-flow, no clipping, no surprise.

## The diff

At `tui.ts:985-996`:

```ts
for (let i = 0; i < maxLines; i++) {
  const oldLine = i < this.previousLines.length ? this.previousLines[i] : "";
  const newLine = i < newLines.length ? newLines[i] : "";
  if (oldLine !== newLine) {
    if (firstChanged === -1) firstChanged = i;
    lastChanged = i;
  }
}
```

Two indices: first and last line that changed. Everything between them
gets re-emitted (with an EL — "erase line," `\x1b[2K` — before each);
everything outside is untouched.

It's line-level, not cell-level, and it's exact string compare. The
content of each line is a single string including ANSI color codes; if
the codes change, the string changes, the line redraws. No state
machine, no ANSI-aware diff. The author took the tradeoff that
occasionally you will redraw a 500-char line because one color code at
the end changed, and that's fine.

Three strategies layer on top:

1. **Full repaint with clear** (`tui.ts:918-942`, `962`). Triggered on
   width change, on first render, or on Termux-style height changes
   (the Android terminal that lies about its size). Emits `CSI 2J`
   (clear screen) + `CSI H` (home) + `CSI 3J` (clear scrollback), then
   writes all lines.

2. **Differential update** (`tui.ts:1069-1155`). Normal path. Moves
   the cursor to the first changed line, `\x1b[2K` before each new
   line, writes content.

3. **Overlay compositing** (`tui.ts:734-794`, `compositeOverlays`).
   Base content is rendered, then overlays at their positions are
   composited *into* the line array, then the composed array is
   diffed. This means an overlay appearing or changing only redraws
   the base lines it covers — not the whole screen.

## The flicker rationale, in code

The comment at `tui.ts:1098` is as close to a design statement as this
package has:

> Only render changed lines (firstChanged to lastChanged), not all
> lines to end. **This reduces flicker when only a single line
> changes (e.g., spinner animation).**

A spinner updating every 80ms is the canonical case. If you redraw
every line, the entire viewport flickers; if you redraw just the
spinner's line, only that line flickers — and it flickers no more than
any single character changing would. Apply the same principle to
streaming LLM text (one line changing per token burst, scrollback
stable) and you get an agent UI that feels alive instead of nauseating.

## CSI 2026 — synchronized output

The second piece. Modern terminals support CSI 2026 (also written
`?2026h` / `?2026l`), a pair of control sequences that tell the
terminal "don't present intermediate state while I'm writing." The
buffer between them is rendered atomically.

pi-tui wraps every render in a pair:

```
\x1b[?2026h
   ...cursor moves, erase lines, content...
\x1b[?2026l
```

Emitted at `tui.ts:920` (fullRender) and `1071` (diffRender). Terminals
that don't understand the sequence silently ignore it; output still
works, you just lose atomicity. No capability detection, no fallback
logic. The author bet on modern terminals and took the simpler code
path.

Between line-level diffing and synchronized output, the result is
that a pi-tui screen updates the way a web page does: the screen never
shows a half-drawn state. For streaming UIs, this is the difference
between "looks like an agent is thinking" and "looks like my terminal
is broken."

## Overlays

`OverlayOptions` (`tui.ts:119-155`) supports anchor-based positioning
(8 cardinals + center), explicit row/col in pixels or percents, margins,
width and max height in either unit, a `visible(termWidth, termHeight)
=> boolean` callback for responsive hide/show, and a `nonCapturing`
flag that determines whether the overlay captures keyboard focus.

Overlays live in an `overlayStack[]` array with `focusOrder` counters.
When compositing (lines 743-744), they are sorted by `focusOrder`
ascending and drawn in that order — later overlays on top. Focus cycles
through the topmost *visible* overlay; hidden overlays don't steal the
keyboard.

The compositing-before-diffing choice is what makes overlays
basically free. A modal popping up only redraws the rectangle the modal
covers. A modal updating only redraws the modal. The rest of the
screen stays exactly as it was.

## Input

Keyboard input comes from stdin as raw bytes, and decoding it is a
swamp. pi-tui handles it in two layers.

`stdin-buffer.ts:29-126` is the low-level reassembler. It recognizes
CSI (`ESC[`), OSC (`ESC]`), DCS (`ESC P`), APC (`ESC _`), and
old-style mouse sequences (`ESC[M` + 3 bytes). It only emits `data`
events when a complete sequence is in hand, so consumers never see
half an escape.

`keys.ts` is the semantic decoder. It understands the Kitty keyboard
protocol and falls back to modifyOtherKeys mode 2 for xterm-family
terminals (tmux, Konsole, older xterm) that don't support Kitty.

Detection logic, `terminal.ts:184-194`:

1. On startup, emit `\x1b[?u` (query Kitty protocol).
2. Wait 150ms. If the terminal replies with `\x1b[?<flags>u`, set
   `_kittyProtocolActive = true`, enable the protocol with `\x1b[>7u`
   (flags: disambiguate escapes, report event types, report base
   layout key).
3. If no reply within 150ms, enable `\x1b[>4;2m` (xterm
   modifyOtherKeys mode 2) as a fallback so you can at least
   distinguish `Ctrl+Shift+T` from `T`.

The binary state flag `_kittyProtocolActive` decides which of two key
parsers runs in `keys.ts`.

Keybindings are resolved through a `KeybindingsManager`
(`keybindings.ts:155-201`) that maps *names* (like
`tui.editor.cursorUp`) to arrays of key IDs, any of which can match.
First match wins; there is no priority or propagation story. A
keybinding is owned by exactly one handler, and swapping themes or
user configs swaps which key triggers which name.

This is the mechanical enforcement of "keybindings are
configuration" from chapter 3.

## Bracketed paste

The terminal sends `\x1b[200~...content...\x1b[201~` around pasted
text. Components buffer between the markers (`input.ts:47-82`,
`editor.ts:252-258`) and treat the whole buffered chunk as a single
logical "paste" event.

Large pastes (>4 KB) are tracked in a paste registry with numeric
IDs. In the editor, the paste gets collapsed to a placeholder like
`[paste #3 (1200 lines)]`, which stands in for the content and can be
selected and deleted as a single unit. The real text is kept in the
registry so commit / render operations can expand it. This is how the
editor stays responsive when someone pastes a 10 MB file.

## Images

On terminals that support it, pi-tui renders real images (not ASCII
art). Detection is env-var based (`terminal-image.ts:40-71`):

- `KITTY_WINDOW_ID`, `TERM_PROGRAM=kitty`, Ghostty, WezTerm → Kitty
  graphics protocol.
- `ITERM_SESSION_ID`, `TERM_PROGRAM=iterm.app` → iTerm2 inline
  images.
- Everything else (VS Code terminal, Alacritty, generic) → null
  capability; the `Image` component renders a text fallback.

No Sixel support. The author bet on Kitty + iTerm2 covering most of
the audience and left Sixel for later.

Kitty encoding (`encodeKitty`, 106-147) splits base64 data into 4 KB
chunks and sends them as a sequence of APC escapes. Each chunk carries
`a=T` (transmit), `f=100` (24-bit PNG), `q=2` (no display on
transmit), plus optional `c=<cols>`, `r=<rows>`, `i=<imageId>` for
reuse across frames.

Cell dimensions (so you know how many rows a 500px image is) come from
a CSI 16t query at startup; results cached.

## The Editor

`components/editor.ts:217-296` is a full multi-line editor with:

- `state.lines[]` — the buffer
- A sticky column for vertical movement (`line 272`): when you move up
  through a short line, the next down-arrow returns you to your original
  column if the new line is long enough
- An `UndoStack<EditorState>` of 100 snapshots (line 348)
- An Emacs-style kill ring with concatenation of consecutive kills
  (`lastAction` tracking)
- A paste markers table for inline collapse of big pastes
- Pluggable autocomplete via `AutocompleteProvider`, debounced 20 ms
  (line 215)
- A separate command-history up/down behavior

It does *not* have built-in syntax highlighting — that's delegated to
an `EditorTheme` callback so you can bring your own highlighter.

## Cursor positioning trick

There's a neat bit at `tui.ts:867-886`. Components don't directly tell
the TUI where to park the hardware cursor after rendering. Instead,
the component embeds a zero-width APC marker (`\x1b_pi:c\x07`) at the
cursor's logical position in the output string. The TUI scans rendered
lines for this `CURSOR_MARKER`, computes the column by measuring
visible width up to the marker, strips the marker from the line, and
emits `\x1b[<row>;<col>G` to place the terminal cursor there.

The benefit: component authors write normal strings. The cursor is a
piece of their output, not a separate piece of bookkeeping. This
matters when a component's content moves — if the cursor travels with
the content, the TUI doesn't need extra logic to track "the cursor
belongs to component X and component X shifted down by 2 lines."

## East Asian width

The `get-east-asian-width` dependency plugs into `graphemeWidth` in
`utils.ts:156-194`. Every visible-width calculation in pi-tui flows
through this function, so double-width characters (CJK, full-width
punctuation, some emoji) are accounted for consistently — in
`visibleWidth`, `truncateToWidth`, `sliceByColumn`, word wrapping, and
the over-wide-line enforcement at `tui.ts:1105`.

One special case: regional indicator symbols (U+1F1E6 .. U+1F1FF, the
components that pair up into flag emoji) are hand-forced to width 2
because terminals are inconsistent about them and the default would
cause "auto-wrap drift" during streaming.

## Performance numbers

The comments reveal the measured targets:

- `MIN_RENDER_INTERVAL_MS = 16` (tui.ts:230): ~60 FPS cap
- 150 ms: Kitty protocol detection timeout
- 20 ms: autocomplete debounce
- 100: max undo snapshots
- 512: width cache size

All tiny numbers. The package doesn't benchmark itself; the design bet
is "terminal I/O is the bottleneck, keep the render loop fast and
cheap and the rest follows." Line-level diffing + synchronized output
+ per-component caching achieves that without intricate
data structures.

## Windows

Node on Windows has a standing "raw stdin doesn't work" problem for
anything involving modifier keys. `terminal.ts:111, 202-223` uses
[`koffi`](https://koffi.dev/) to load the native DLL and set
`ENABLE_VIRTUAL_TERMINAL_INPUT` on the console mode so Shift+Tab
arrives as `ESC[Z` instead of a raw tab byte, and so on. Without
this, Kitty protocol detection wouldn't even get to fire.

This is the kind of plumbing you only know about if you've tried to
ship a TUI on Windows. It's in the repo because the author
apparently tried.

## In one paragraph

pi-tui is a line-level, diff-based, synchronized-output-native TUI
engine with overlays composited before the diff, a strict width
contract that keeps the diff simple, input handling that understands
Kitty and falls back gracefully, and just enough Windows plumbing to
actually work there. It is not a React-for-terminals abstraction.
Components return strings; the engine puts those strings on the
screen.

Next chapter is where pi-ai, pi-agent-core, and pi-tui meet the user:
pi-coding-agent.
