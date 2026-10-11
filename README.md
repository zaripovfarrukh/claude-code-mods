# claude-code-mods

Eight mods for Claude Code, each a plugin of function hooks. They draw panes, bands
and status lines inside Claude Code and hook its tool calls and prompts.

Requires Claude Code **2.1.293 or newer**. Install from a terminal session (the
desktop Code tab has no `/plugin` command); a mod installed at user scope loads in
the desktop app too.

## Install

```
/plugin install <mod> --marketplace <owner>/claude-code-mods
```

Answer `y` to add the marketplace, then choose a scope. Replace `<mod>` with one of
the names below.

| Mod | Command | What it does |
| --- | --- | --- |
| `savvy-progress` | `/agents-info` | A live panel of every subagent: model, context fill, tokens, estimated cost and time, plus a progress band above the prompt. |
| `you-should-know` | `/should-know` | A second agent reads each finished turn and flags one thing you might miss, as a note above the prompt. |
| `filetree` | `/filetree` | Your project's file tree in a pane, lighting up the files Claude reads and edits. |
| `cache-tax` | `/keepwarm`, `/cache-tax` | Holds your next message once when the prompt cache has gone cold and shows what re-sending would cost. |
| `blast-radius` | automatic | Holds risky shell commands (`rm -rf`, force push, `reset --hard`) and lists what they would affect before you decide. |
| `reflect` | automatic | Spots your corrections and offers to save them as rules in CLAUDE.md. |
| `replay-theater` | `/replay` | Steps through every file edit of the last turn, one diff at a time. |
| `skins` | `/skin <name>` | Restyles tool rows and diff cards in seven themes. |

## What each one costs or touches

- `you-should-know` and `reflect` make an extra model call per turn or per prompt.
- `cache-tax`'s `/keepwarm` pings the API on a timer while Claude Code is open.
- `reflect` writes to `./CLAUDE.md` or `~/.claude/CLAUDE.md`, but only when you press a button.
- `blast-radius` and `filetree` run shell commands (`find`, `du`, `git status`) to measure and to read state.
- `filetree` shows your real folder and file names; `reflect` shows your prompt text.
- All cost figures are estimates from token counts and a built-in price table, not a bill.

`blast-radius` is a safety net, not a permission system. Keep your normal
permissions on.

## Status

These were built from screenshots in one session and are validated and unit-tested,
but most have not been exercised live. Treat them as working drafts.
