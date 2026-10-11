# replay-theater

`/replay` steps through the file edits Claude made in the last turn, one diff at a time (red removed, green added), with Prev / Next / Close.

- Records only the Edit, Write and MultiEdit tools. Changes made through shell commands (sed, mv, git, formatters) will NOT appear.
- A hint band appears above the prompt after a turn with edits. The `r` hotkey only fires while the band/pane holds focus (ctrl+x tab, or a click), not from the composer; `/replay` always works.
- Diffs are one hunk per edit (all old lines removed, all new lines added), not a minimal line diff.
- The list resets at each new prompt and persists after the turn ends.
