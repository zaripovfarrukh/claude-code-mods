import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Note } from '../types'

const note = atom({ plugin: 'you-should-know', key: 'note' } as const, null)
const isOn = atom({ plugin: 'you-should-know', key: 'isOn' } as const, true)

const MIN_ANSWER_CHARS = 80

const REVIEW_PROMPT = `You are a quiet second reviewer watching a coding session. Look at what the assistant just did in its last turn (the work, the changes, its final answer).

Flag ONE thing the user could easily miss and would want to know: a risky side effect, a subtle bug the change introduces (for example a retry that can double-charge), data loss, a security or privacy problem, a skipped or unverified assumption, or a change that reaches further than the request implied.

Rules:
- Be conservative. If there is nothing genuinely worth interrupting for, reply with exactly: NONE
- Do not summarize the work, praise it, or restate the answer.
- Otherwise reply in exactly this shape, plain text, no markdown headers:
HEADLINE: <one sentence, plain language, what could go wrong>
TITLE: <a short bold-worthy title>
- <short bullet>
- <short bullet>
- <short bullet, at most 4 bullets in all>`

const parse = (text: string): Note | null => {
  const trimmed = text.trim()
  if (!trimmed || /^none\b/i.test(trimmed)) return null
  const head = trimmed.match(/^HEADLINE:\s*(.+)$/im)?.[1]?.trim()
  if (!head) return null
  const body = trimmed.replace(/^HEADLINE:.*$/im, '').trim()
  return { headline: head, body }
}

async function review($: EngineInterface) {
  const reply = await $.model.fork({ prompt: REVIEW_PROMPT })
  if (!reply.isAnswered) return
  const found = parse(reply.text)
  if (found) await update($, note, () => found)
}

export const register: Register = on => {
  let isReviewing = false

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'should-know',
      description: 'Turn the second-agent "you should know" notes on or off',
    })
    return next(e)
  })

  on('command.run', { command: 'should-know' }, async $ => {
    const next = !(await read($, isOn))
    await update($, isOn, () => next)
    if (!next) await update($, note, () => null)
    return { text: next ? 'You-should-know notes are on.' : 'You-should-know notes are off.' }
  })

  on('prompt.submit', async ($, e, next) => {
    await update($, note, () => null)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    const isMain = e.agentId === undefined
    if (isMain && !e.isAborted && e.answer.length >= MIN_ANSWER_CHARS && !isReviewing && (await read($, isOn))) {
      isReviewing = true
      try {
        await review($)
      } catch {
        // a failed side review must never disturb the session
      } finally {
        isReviewing = false
      }
    }
    return done
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const current = await read($, note)
    if (e.props.hasSurvey || current === null) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const dismiss = () => update($, note, () => null)
    return (
      <Box flexDirection="column" marginY={1}>
        <Text>
          <Text color="claude">✦ </Text>
          <Text dimColor>Heads up · </Text>
          <Text>{current.headline}</Text>
        </Text>
        {current.body !== '' && (
          <Box marginTop={1}>
            <Text>{current.body}</Text>
          </Box>
        )}
        <Box marginTop={1}>
          <Button key="ok" label="Understood" onPress={dismiss} />
          <Text>   </Text>
          <Button
            key="chat"
            label="Chat in main session"
            onPress={async () => {
              await $.prompt.fill({
                text: `About your last heads-up ("${current.headline}"): can you check whether it really applies here and show me the fix?`,
              })
              await dismiss()
            }}
          />
          <Text>   </Text>
          <Button key="dismiss" label="Dismiss" onPress={dismiss} />
        </Box>
      </Box>
    )
  })
}
