# skins (the Claude Skins mod; the name "claude-skins" is reserved by the validator)

`/skin <name>` switches a colour skin live; `/skin` lists them; `/skin off` returns to engine defaults. The choice persists across sessions in `$.store`.

Skins: noir (default), tokyo-night, dracula, catppuccin, nord, gruvbox, solarized.

## What is actually restyled (ui.render hooks)
- **ToolUse** rows: icon, tool name, dim argument summary, duration (measured by a `tool.call` hook, shown once the call ends), `+N -M` for edits.
- **ToolResult** of `Edit`: a bordered diff card built from the result's `structuredPatch` (line numbers, add/delete colouring, `+N -M`, first 16 lines). Errored, staged or non-Edit results fall back to `next(e)`.
- **Spinner**: coloured glyph and word. Approximation: the engine's own elapsed time and token counts are not shown while this hook draws.

## Not restyled (fall back to the engine)
AssistantMessage markdown, UserMessage, ToolGroup, ToolProgress, TurnDuration, AbovePrompt (no usage rings), Pane, tables. There is no table or usage-ring hook point for this mod. As with the original, the app's own background is not changed.

Colours are hex values passed to `Text` / `Box` props; a terminal without truecolor approximates them.

Runs nothing, touches no files, makes no network calls (only `$.store` for the skin name).
