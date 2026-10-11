# reflect

Turns your corrections into saved rules. After each prompt, one small Haiku call decides whether it was a correction or stated preference (most are not). If so, a band above the prompt offers: [ Save to ./CLAUDE.md ] [ Global instead ] [ Edit ] [ Skip ].

- Nothing is written without a button press; identical rules are never duplicated.
- Rules go under `## Learned rules` (created if missing).
- Edit puts the rule in the prompt box; reword it, then press a Save button (it saves the box's text).
- The check never delays or alters your prompt; any failure is swallowed.

Notes: the band shows your prompt text (use a demo project when screen-sharing), and each check is one small Haiku call. Use this or the older Python plugin, not both.
