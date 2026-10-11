import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Proposal } from '../types'

const proposal = atom({ plugin: 'reflect', key: 'proposal' } as const, null)

const HEADING = '## Learned rules'
const MIN_CHARS = 12
const MAX_CHARS = 600

const PROMPT = `You watch what a user types to a coding assistant. Decide whether the message is a CORRECTION or a stated PREFERENCE that should become a durable, reusable rule for future sessions (for example "no - in this repo we always use pnpm, not npm", "stop adding comments to my code", "I prefer tabs").

Most messages are NOT: ordinary tasks, questions, requests, one-off instructions, follow-ups and thanks are all NONE. When unsure, reply NONE.

If it is, reply with exactly one line: RULE: <one imperative sentence, e.g. Always use pnpm instead of npm in this repository.>
Otherwise reply with exactly: NONE

Message:
`

function parseRule(text: string): string | null {
  const m = text.trim().match(/^RULE:\s*(.+)$/im)
  const rule = m?.[1]?.replace(/\s+/g, ' ').trim()
  return rule && rule.length <= 300 ? rule : null
}

function cleanRule(text: string): string {
  return text.replace(/^\s*-\s+/, '').replace(/\s+/g, ' ').trim()
}

// Returns the new file text, or null when an identical rule is already there.
function addRule(existing: string, rule: string): string | null {
  const line = `- ${rule}`
  const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()
  if (existing.split('\n').some(l => norm(l) === norm(line))) return null
  const lines = existing.split('\n')
  const at = lines.findIndex(l => l.trim() === HEADING)
  if (at === -1) {
    const base = existing.replace(/\s+$/, '')
    return `${base}${base === '' ? '' : '\n\n'}${HEADING}\n\n${line}\n`
  }
  let end = lines.length
  for (let i = at + 1; i < lines.length; i++) {
    if (/^#{1,6}\s/.test(lines[i]!)) { end = i; break }
  }
  while (end > at + 1 && lines[end - 1]!.trim() === '') end--
  lines.splice(end, 0, line)
  const out = lines.join('\n')
  return out.endsWith('\n') ? out : `${out}\n`
}

async function save($: EngineInterface, rule: string, isGlobal: boolean): Promise<string> {
  let path = './CLAUDE.md'
  if (isGlobal) {
    const home = await $.env.get('HOME')
    if (!home) return 'Could not find your home folder'
    path = `${home}/.claude/CLAUDE.md`
  }
  let existing = ''
  if (await $.fs.exists(path)) {
    const got = await $.fs.read(path)
    existing = typeof got === 'string' ? got : ''
  }
  const next = addRule(existing, rule)
  if (next === null) return 'Rule already saved'
  await $.fs.write(path, next)
  return `Saved to ${isGlobal ? '~/.claude/CLAUDE.md' : './CLAUDE.md'}`
}

async function classify($: EngineInterface, text: string): Promise<string | null> {
  const r = await $.model.complete({ model: 'haiku', prompt: PROMPT + text, maxTokens: 80, effort: 'low', timeoutMs: 15000 })
  return r.isAnswered ? parseRule(r.text) : null
}

async function finish($: EngineInterface, isGlobal: boolean) {
  const cur = await read($, proposal)
  if (cur === null) return
  try {
    let rule = cur.rule
    if (cur.isEditing) {
      const box = await $.prompt.read()
      const typed = cleanRule(box.text)
      if (typed !== '') rule = typed
    }
    rule = cleanRule(rule)
    if (rule === '') return
    const msg = await save($, rule, isGlobal)
    if (cur.isEditing) await $.prompt.fill({ text: '' })
    $.ui.toast(msg)
    await update($, proposal, () => null)
  } catch {
    $.ui.toast('reflect: could not save the rule')
  }
}

export const register: Register = on => {
  let seq = 0

  on('prompt.submit', async ($, e, next) => {
    try {
      seq += 1
      const mine = seq
      await update($, proposal, () => null)
      const text = e.text.trim()
      const isOwn = e.origin.kind === 'plugin'
      if (!isOwn && text.length >= MIN_CHARS && text.length <= MAX_CHARS && !text.startsWith('/')) {
        // fire and forget: the prompt never waits on the check
        void classify($, text)
          .then(async rule => {
            if (rule !== null && mine === seq) {
              await update($, proposal, () => ({ rule, isEditing: false, note: '' }))
            }
          })
          .catch(() => {})
      }
    } catch {
      // never disturb the prompt
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const cur: Proposal | null = await read($, proposal)
    if (e.props.hasSurvey || cur === null) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column" marginY={1}>
        <Text>
          <Text color="green">reflect · </Text>
          <Text color="green">{cur.isEditing ? 'editing in the prompt box, then press Save' : `"${cur.rule}"`}</Text>
        </Text>
        <Box>
          <Button key="save" label="[ Save to ./CLAUDE.md ]" onPress={() => finish($, false)} />
          <Text> </Text>
          <Button key="global" label="[ Global instead ]" onPress={() => finish($, true)} />
          <Text> </Text>
          {!cur.isEditing && (
            <Button
              key="edit"
              label="[ Edit ]"
              onPress={async () => {
                await $.prompt.fill({ text: cur.rule })
                await update($, proposal, () => ({ ...cur, isEditing: true }))
              }}
            />
          )}
          {!cur.isEditing && <Text> </Text>}
          <Button key="skip" label="[ Skip ]" onPress={() => update($, proposal, () => null)} />
        </Box>
      </Box>
    )
  })
}
