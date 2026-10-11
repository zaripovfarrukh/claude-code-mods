# blast-radius

Holds risky Bash commands before they run, shows what they would affect, and waits for you.

Held: `rm -r/-rf`, `git push --force/-f/--force-with-lease/+ref`, `git reset --hard`, `git clean -f`, `find ... -delete`, SQL `DROP`/`TRUNCATE` (also inside `bash -c "..."`, and after `cd x &&`). Everything else passes through untouched.

The hold shows the command, a headline ("Would delete N files (size)"), up to 15 paths, and `1: Proceed` / `2: Cancel`. Cancel is focused, so Enter means no. No answer in 120 s cancels. Cancel returns a deny to the model. Side pane at 144+ columns; narrower, a band above the prompt.

## Safety net, not a permission system
It reads the command text with a simple splitter. It is not a shell parser and can be bypassed (scripts, `xargs rm`, variables, aliases, `eval`, other tools). Keep your normal permissions on.

## What measuring does and does not do
- rm: `find` lists files/symlinks, `du -sk` gives disk usage (blocks, not byte size), run in the command's cwd (leading `cd` is followed). Variables, `~` and `cd -` give "could not measure"; it still holds.
- git reset --hard: tracked files with changes plus `git diff --stat HEAD`. git clean: `git clean -n` dry run. Force push: `git log origin..HEAD`; it cannot list remote commits you would overwrite.
- find -delete: rerun with `-print`; `-exec` is not measured. SQL: always "could not measure".
- Needs bash/sh, git, find, du.

## Not verified
Written against the 2.1.293 API. validate and unit tests of the command detector pass. The hold, pane/band drawing, hotkeys, Enter-on-Cancel and band fallback were not confirmed working in a live session. In one live attempt the hold fired on a test `rm -rf` but ended in the hook's failure path ("the guard failed"), cause not determined.
