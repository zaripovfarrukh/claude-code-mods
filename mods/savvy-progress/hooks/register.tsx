import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, TurnUsage } from 'claude-code'

import type { AgentRow } from '../types'

const PANE = 'agents-info'
const agents = atom({ plugin: 'savvy-progress', key: 'agents' } as const, [])
const now = atom({ plugin: 'savvy-progress', key: 'now' } as const, 0)
const isBandHidden = atom({ plugin: 'savvy-progress', key: 'isBandHidden' } as const, false)

// USD per million tokens: [input, output]. An estimate from a built-in table, not a bill.
const PRICES: [string, number, number][] = [
  ['opus', 5, 25],
  ['sonnet', 3, 15],
  ['haiku', 1, 5],
]

const priceOf = (model: string, u: TurnUsage) => {
  const [, input, output] = PRICES.find(([key]) => model.includes(key)) ?? ['', 3, 15]
  return (
    (u.input_tokens * input +
      u.output_tokens * output +
      u.cache_read_input_tokens * input * 0.1 +
      u.cache_creation_input_tokens * input * 1.25) /
    1e6
  )
}

const windowOf = (model: string) => (model.includes('1m') ? 1_000_000 : 200_000)
const ctxOf = (u: TurnUsage) =>
  u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens + u.output_tokens
const totalOf = ctxOf

const fmtTokens = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`)
const fmtCost = (n: number) => `≈$${n.toFixed(2)}`
const fmtTime = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
const bar = (fraction: number, width: number) => {
  const filled = Math.max(0, Math.min(width, Math.round(fraction * width)))
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

function upsert(
  $: EngineInterface,
  id: string,
  patch: (row: AgentRow) => AgentRow,
  seed: Partial<AgentRow> = {},
) {
  return update($, agents, list => {
      const found = list.find(r => r.id === id)
      if (found) return list.map(r => (r.id === id ? patch(r) : r))
      const base: AgentRow = {
        id,
        title: seed.title ?? 'Subagent',
        model: seed.model ?? '',
        isDone: false,
        isFailed: false,
        ctxTokens: 0,
        tokens: 0,
        cost: 0,
        startedAt: Date.now(),
        endedAt: null,
      }
      return [...list, patch({ ...base, ...seed })]
  })
}

async function titles($: EngineInterface) {
    const infos = await $.agent.list()
    await update($, agents, list =>
      list.map(r => {
        const info = infos.find(i => i.id === r.id)
        if (!info) return r
        const isEnded = ['completed', 'failed', 'killed'].includes(info.status)
        return {
          ...r,
          title: info.description || info.type || r.title,
          isFailed: info.status === 'failed' || info.status === 'killed',
          isDone: r.isDone || isEnded,
          endedAt: r.endedAt ?? (isEnded ? Date.now() : null),
        }
      }),
    )
  }


export const register: Register = on => {
  let isOpen = false
  let timer: { cancel: () => void } | undefined

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'agents-info',
      description: 'Open or close the live subagent progress panel',
    })
    timer = $.clock.every(1000, () => {
      void update($, now, () => Date.now())
    })
    return next(e)
  })

  on('command.run', { command: 'agents-info' }, async $ => {
    if (isOpen) {
      isOpen = false
      await $.ui.close({ id: PANE })
      return { text: 'Agents panel closed.' }
    }
    isOpen = true
    await $.ui.open({ id: PANE, title: 'Agents' })
    return { text: 'Agents panel opened.' }
  })

  on('turn.step', async function* ($, e, next) {
    const res = yield* next(e)
    if (e.agentId) {
      const id = e.agentId
      const usage = res.usage
      await upsert($, id, r =>
        usage
          ? {
              ...r,
              model: usage.model || e.model,
              ctxTokens: ctxOf(usage),
              tokens: r.tokens + totalOf(usage),
              cost: r.cost + priceOf(usage.model || e.model, usage),
            }
          : { ...r, model: r.model || e.model },
        { model: e.model },
      )
      await titles($)
    }
    return res
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId) {
      await upsert($, e.agentId, r => ({ ...r, isDone: true, endedAt: Date.now() }))
      await titles($)
    }
    return next(e)
  })

  on('session.end', ($, e, next) => {
    timer?.cancel()
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = await read($, agents)
    const running = list.filter(r => !r.isDone)
    if (e.props.hasSurvey || list.length === 0 || running.length === 0 || (await read($, isBandHidden))) {
      return next(e)
    }
    const { Box, Button, Text } = $.ui.resolve(e)
    await read($, now)
    const cost = list.reduce((s, r) => s + r.cost, 0)
    const tokens = list.reduce((s, r) => s + r.tokens, 0)
    const fraction = (list.length - running.length) / list.length
    return (
      <Box>
        <Text color="claude">{bar(fraction, 12)} </Text>
        <Text dimColor>
          {list.length - running.length}/{list.length} agents · {fmtTokens(tokens)} · {fmtCost(cost)} · /agents-info{' '}
        </Text>
        <Button key="hide" label="Hide" onPress={() => update($, isBandHidden, () => true)} />
      </Box>
    )
  })

  on('prompt.submit', async ($, e, next) => {
    await update($, isBandHidden, () => false)
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const list = await read($, agents)
    const t = (await read($, now)) || Date.now()
    const cost = list.reduce((s, r) => s + r.cost, 0)
    const tokens = list.reduce((s, r) => s + r.tokens, 0)
    const first = list.reduce((m, r) => Math.min(m, r.startedAt), t)
    const last = list.every(r => r.isDone) ? list.reduce((m, r) => Math.max(m, r.endedAt ?? 0), 0) : t
    const width = Math.max(10, (e.props.bodyColumns ?? 40) - 4)

    const row = (r: AgentRow) => {
      const fill = r.isDone ? 1 : r.ctxTokens / windowOf(r.model)
      const ctxPct = Math.round((r.ctxTokens / windowOf(r.model)) * 100)
      return (
        <Box key={r.id} flexDirection="column" marginTop={1}>
          <Text bold>
            {r.isDone ? (r.isFailed ? '✗ ' : '✓ ') : '● '}
            {r.title}
          </Text>
          <Text dimColor>{r.model || 'model unknown'}</Text>
          <Text color={r.isFailed ? 'error' : r.isDone ? 'success' : 'claude'}>{bar(fill, width)}</Text>
          <Text dimColor>
            ctx {ctxPct}% · {fmtTokens(r.tokens)} {fmtCost(r.cost)} {fmtTime((r.endedAt ?? t) - r.startedAt)}
          </Text>
        </Box>
      )
    }

    const running = list.filter(r => !r.isDone)
    const done = list.filter(r => r.isDone)

    return (
      <Box flexDirection="column">
        <Text>
          <Text dimColor>Cost </Text>
          <Text bold>{fmtCost(cost)}</Text>
          <Text dimColor>  Tokens </Text>
          <Text bold>{fmtTokens(tokens)}</Text>
          <Text dimColor>  Time </Text>
          <Text bold>{list.length ? fmtTime(last - first) : '0:00'}</Text>
        </Text>
        {list.length === 0 && <Text dimColor>No subagents yet.</Text>}
        {running.length > 0 && <Text dimColor>Running · {running.length}</Text>}
        {running.map(row)}
        {done.length > 0 && <Text dimColor>Finished · {done.length}</Text>}
        {done.map(row)}
        <Text dimColor>Cost is an estimate from token counts, not your bill.</Text>
      </Box>
    )
  })
}
