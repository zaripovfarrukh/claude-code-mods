import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { EditRecord } from '../types'

const PANE = 'replay-theater'
const edits = atom({ plugin: 'replay-theater', key: 'edits' } as const, [])
const step = atom({ plugin: 'replay-theater', key: 'step' } as const, 0)

const lines = (s: string) => (s === '' ? [] : s.split('\n'))

// One hunk: every old line removed, every new line added. Not a minimal diff.
function hunk(oldS: string, newS: string): { diff: string; added: number; removed: number } {
  const o = lines(oldS)
  const n = lines(newS)
  const body = [...o.map(l => '-' + l), ...n.map(l => '+' + l)].join('\n')
  return { diff: `@@ -1,${o.length} +1,${n.length} @@\n${body}`, added: n.length, removed: o.length }
}

const baseName = (p: string) => p.split('/').pop() || p

function record(e: Record<string, unknown>): EditRecord[] {
  const path = String(e.file_path ?? '')
  if (e.tool === 'Edit') {
    return [{ tool: 'Edit', path, ...hunk(String(e.old_string ?? ''), String(e.new_string ?? '')) }]
  }
  if (e.tool === 'Write') {
    return [{ tool: 'Write', path, ...hunk('', String(e.content ?? '')) }]
  }
  if (e.tool === 'MultiEdit' && Array.isArray(e.edits)) {
    return (e.edits as Record<string, unknown>[]).map(x => ({
      tool: 'MultiEdit' as const,
      path,
      ...hunk(String(x.old_string ?? ''), String(x.new_string ?? '')),
    }))
  }
  return []
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'replay',
      description: 'Step through the file edits Claude made in the last turn',
    })
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    // Reset per prompt, but not for the /replay command itself.
    if (!/^\s*\/replay\b/.test(e.text ?? '')) {
      await update($, edits, () => [])
      await update($, step, () => 0)
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const made = e.tool === 'Edit' || e.tool === 'Write' || e.tool === 'MultiEdit'
      ? record(e as unknown as Record<string, unknown>)
      : []
    const ran = await next(e)
    if (made.length > 0) await update($, edits, list => [...list, ...made].slice(-500))
    return ran
  })

  on('command.run', { command: 'replay' }, async $ => {
    const list = await read($, edits)
    if (list.length === 0) return { text: 'Replay Theater: no Edit/Write/MultiEdit changes recorded this turn.' }
    await update($, step, () => 0)
    await $.ui.open({ id: PANE, title: 'Replay Theater' })
    return { text: `Replay Theater opened: ${list.length} edits.` }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = await read($, edits)
    if (e.props.hasSurvey || list.length === 0) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    return (
      <Box>
        <Text dimColor>
          Replay · press r or type /replay · {list.length} edit{list.length === 1 ? '' : 's'}{' '}
        </Text>
        <Button
          key="replay"
          label="Replay"
          hotkey="r"
          onPress={async () => {
            await update($, step, () => 0)
            await $.ui.open({ id: PANE, title: 'Replay Theater' })
          }}
        />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text, Code } = $.ui.resolve(e)
    const list = await read($, edits)
    const i = Math.min(Math.max(0, await read($, step)), Math.max(0, list.length - 1))
    const cur = list[i]
    if (!cur) return <Text dimColor>No edits recorded this turn.</Text>
    return (
      <Box flexDirection="column">
        <Box justifyContent="space-between">
          <Text bold color="magenta">Replay Theater</Text>
          <Text dimColor>  step {i + 1} of {list.length}</Text>
        </Box>
        <Text>
          {list.map((_, k) => (k === i ? `[${k + 1}]` : ` ${k + 1} `)).slice(0, 30).join(' ')}
        </Text>
        <Text bold color="cyan">{baseName(cur.path)}</Text>
        <Text dimColor>{cur.path}</Text>
        <Text dimColor>
          {cur.tool === 'Write' ? 'Write' : 'Edit'} <Text color="green">+{cur.added}</Text>{' '}
          <Text color="red">-{cur.removed}</Text>
        </Text>
        <Code source={cur.diff} format="diff" path={cur.path} />
        <Box>
          <Button key="prev" label="◀ Prev" onPress={() => update($, step, n => Math.max(0, n - 1))} />
          <Text> </Text>
          <Button key="next" label="Next ▶" onPress={() => update($, step, n => Math.min(list.length - 1, n + 1))} />
          <Text> </Text>
          <Button key="close" label="Close" onPress={() => $.ui.close({ id: PANE })} />
        </Box>
      </Box>
    )
  })
}
