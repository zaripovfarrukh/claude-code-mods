import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

const lastResponseAt = atom({ plugin: 'cache-tax', key: 'lastResponseAt' } as const, 0)
const model = atom({ plugin: 'cache-tax', key: 'model' } as const, '')
const guard = atom({ plugin: 'cache-tax', key: 'guard' } as const, 'refuse' as 'refuse' | 'warn')
const keepwarmUntil = atom({ plugin: 'cache-tax', key: 'keepwarmUntil' } as const, 0)
const coldWrites = atom({ plugin: 'cache-tax', key: 'coldWrites' } as const, 0)
const coldPaid = atom({ plugin: 'cache-tax', key: 'coldPaid' } as const, 0)
const heldText = atom({ plugin: 'cache-tax', key: 'heldText' } as const, '')
const pings = atom({ plugin: 'cache-tax', key: 'pings' } as const, 0)

const MIN = 60_000
const DEFAULT_KEEPWARM = 6 * 60 * MIN

// USD per million tokens, input. Estimates from a built-in table, not a bill.
const INPUT_PRICE: [string, number][] = [
  ['opus', 5],
  ['sonnet', 3],
  ['haiku', 1],
]
const priceOf = (m: string) => INPUT_PRICE.find(([k]) => m.includes(k))?.[1] ?? 3

const fmtUsd = (n: number) => `$${n.toFixed(n < 1 ? 3 : 2)}`
const fmtTok = (n: number) => n.toLocaleString('en-US')
const fmtAge = (ms: number) => {
  const m = Math.max(0, Math.floor(ms / MIN))
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m % 60}m`
  return `${m}m`
}

// "90m", "6h", "1h30m", "2d", "off" -> ms, 0 for off, undefined when unreadable
function parseDuration(s: string): number | undefined {
  const t = s.trim().toLowerCase()
  if (t === 'off' || t === 'stop' || t === '0') return 0
  if (t === '') return DEFAULT_KEEPWARM
  let total = 0
  let rest = t
  while (rest.length > 0) {
    const m = /^(\d+(?:\.\d+)?)\s*([mhd])\s*/.exec(rest)
    if (!m) return undefined
    total += parseFloat(m[1] ?? '0') * (m[2] === 'd' ? 1440 : m[2] === 'h' ? 60 : 1) * MIN
    rest = rest.slice(m[0].length)
  }
  return total > 0 ? total : undefined
}

type Figures = { tokens: number; write: number; warm: number; price: number; mdl: string }

async function figures($: EngineInterface): Promise<Figures> {
  const u = await $.session.usage()
  const mdl = await read($, model)
  const tokens = u.context.tokens ?? 0
  const price = priceOf(mdl)
  return {
    tokens,
    mdl,
    price: price * 1.25,
    write: (tokens * price * 1.25) / 1e6,
    warm: (tokens * price * 0.1) / 1e6,
  }
}

async function refreshStatus($: EngineInterface, ttlMs: number) {
  const last = await read($, lastResponseAt)
  if (last === 0) {
    await $.ui.status(undefined)
    return
  }
  const now = await $.clock.now()
  const idle = now - last
  const f = await figures($)
  if (idle > ttlMs) {
    await $.ui.status(`cache LAPSED ${fmtAge(idle)} ago · next msg re-writes ~${Math.round(f.tokens / 1000)}k ≈ ${fmtUsd(f.write)}`)
  } else {
    const left = Math.max(0, Math.ceil((ttlMs - idle) / MIN))
    await $.ui.status(`cache warm ~${left}m · next msg ≈ ${fmtUsd(f.warm)}`)
  }
}

async function ping($: EngineInterface, ttlMs: number) {
  const until = await read($, keepwarmUntil)
  const now = await $.clock.now()
  if (until === 0) return
  if (now >= until) {
    await update($, keepwarmUntil, () => 0)
    await $.ui.toast('cache-tax: keepwarm finished.')
    await refreshStatus($, ttlMs)
    return
  }
  const last = await read($, lastResponseAt)
  // ping only once 80% of the TTL has passed since the last response, so a busy session pays nothing
  if (last !== 0 && now - last >= ttlMs * 0.8 && now - last < ttlMs * 3) {
    const r = await $.model.fork({ prompt: 'Reply with the single word: ok' })
    if (r.isAnswered) {
      await update($, lastResponseAt, () => now)
      await update($, pings, n => n + 1)
    }
  }
  await refreshStatus($, ttlMs)
}

async function describe($: EngineInterface, ttlMs: number): Promise<string> {
  const f = await figures($)
  const g = await read($, guard)
  const until = await read($, keepwarmUntil)
  const now = await $.clock.now()
  const n = await read($, coldWrites)
  const paid = await read($, coldPaid)
  const np = await read($, pings)
  const breakEven = f.warm > 0 ? Math.floor(f.write / f.warm) : 0
  return [
    `keepwarm   ${until > now ? `on, ${fmtAge(until - now)} left (${np} pings sent)` : 'off (/keepwarm to arm it for 6h)'}`,
    `break-even about ${breakEven} pings at the read rate cost one cold write (estimate)`,
    `guard      ${g === 'refuse' ? 'refuse once (/cache-tax guard warn to only show the price)' : 'warn only (/cache-tax guard refuse to hold once)'}`,
    `cache TTL  ${Math.round(ttlMs / MIN)}m (userConfig cacheTtlMinutes)`,
    `session    ${n} cold writes paid, ${fmtUsd(paid)} (estimate; model ${f.mdl || 'unknown'})`,
  ].join('\n')
}

async function onPrompt($: EngineInterface, text: string, ttlMs: number) {
  const last = await read($, lastResponseAt)
  if (last === 0) return { kind: 'pass' as const }
  const now = await $.clock.now()
  if (now - last <= ttlMs) {
    await update($, heldText, () => '')
    return { kind: 'pass' as const }
  }
  const f = await figures($)
  const held = await read($, heldText)
  const mode = await read($, guard)
  const paid = async () => {
    await update($, coldWrites, n => n + 1)
    await update($, coldPaid, n => n + f.write)
    await update($, heldText, () => '')
  }
  if (held === text) {
    await paid()
    return { kind: 'pass' as const }
  }
  const msg =
    `cache-tax: the prompt cache went cold ${fmtAge(now - last)} ago. Sending this re-writes ${fmtTok(f.tokens)} tokens ` +
    `at $${f.price}/MTok = ${fmtUsd(f.write)} (a warm turn would have cost ${fmtUsd(f.warm)}). All figures are estimates.`
  if (mode === 'warn') {
    await paid()
    await $.ui.toast(msg)
    return { kind: 'pass' as const }
  }
  await update($, heldText, () => text)
  return { kind: 'hold' as const, msg: `${msg} Send it again to pay it, or /clear and start from a note.` }
}

let timer: { cancel: () => void } | undefined

function arm($: EngineInterface, ttlMs: number) {
  timer?.cancel()
  timer = $.clock.every(MIN, () => {
    void ping($, ttlMs)
  })
}

export const register: Register = (on, options) => {
  const ttlMin = Number(options.cacheTtlMinutes)
  const ttlMs = (Number.isFinite(ttlMin) && ttlMin > 0 ? ttlMin : 60) * MIN

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'keepwarm',
      description: 'Keep the prompt cache warm with tiny pings: /keepwarm [90m|6h|off]',
    })
    await $.command.register({
      name: 'cache-tax',
      description: 'Cache tax status, or /cache-tax guard warn|refuse',
    })
    arm($, ttlMs)
    return next(e)
  })

  on('session.end', ($, e, next) => {
    timer?.cancel()
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const res = yield* next(e)
    if (!e.agentId) {
      const now = await $.clock.now()
      await update($, lastResponseAt, () => now)
      await update($, model, () => res.usage?.model || e.model)
    }
    return res
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) {
      const now = await $.clock.now()
      await update($, lastResponseAt, () => now)
      await update($, heldText, () => '')
      await refreshStatus($, ttlMs)
    }
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind !== 'composer' && e.origin.kind !== 'bridge') return next(e)
    const r = await onPrompt($, e.text, ttlMs)
    if (r.kind === 'hold') return { drop: r.msg }
    return next(e)
  }).catch(($, e, next) => next(e)) // fail open: a broken guard must never block the prompt

  on('command.run', { command: 'keepwarm' }, async ($, e) => {
    const ms = parseDuration(e.args)
    if (ms === undefined) return { text: 'Usage: /keepwarm [duration like 90m, 6h, 1h30m | off]' }
    if (ms === 0) {
      await update($, keepwarmUntil, () => 0)
      return { text: 'keepwarm off.' }
    }
    const now = await $.clock.now()
    await update($, keepwarmUntil, () => now + ms)
    arm($, ttlMs)
    return {
      text:
        `keepwarm on for ${fmtAge(ms)}. Pings use a tiny prompt over the cached prefix (about the cache-read rate, an estimate) ` +
        `and only run while Claude Code stays open. /keepwarm off stops it.`,
    }
  })

  on('command.run', { command: 'cache-tax' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg.startsWith('guard')) {
      const mode = arg.slice(5).trim()
      if (mode !== 'warn' && mode !== 'refuse') return { text: 'Usage: /cache-tax guard warn|refuse' }
      await update($, guard, () => mode)
      return { text: `guard set to ${mode}.` }
    }
    return { text: await describe($, ttlMs) }
  })
}
