import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

type Skin = {
  label: string
  fg: string
  dim: string
  accent: string
  name: string
  add: string
  del: string
  addBg: string
  delBg: string
  border: string
  ok: string
  err: string
}

const SKINS: Record<string, Skin> = {
  noir: { label: 'Noir', fg: '#e6e6e6', dim: '#7a7a7a', accent: '#ffffff', name: '#f2f2f2', add: '#8fd18f', del: '#e08a8a', addBg: '#1f2d1f', delBg: '#341f1f', border: '#555555', ok: '#8fd18f', err: '#e06c6c' },
  'tokyo-night': { label: 'Tokyo Night', fg: '#c0caf5', dim: '#565f89', accent: '#7aa2f7', name: '#c0caf5', add: '#9ece6a', del: '#f7768e', addBg: '#1f2d28', delBg: '#37222c', border: '#3b4261', ok: '#9ece6a', err: '#f7768e' },
  dracula: { label: 'Dracula', fg: '#f8f8f2', dim: '#6272a4', accent: '#bd93f9', name: '#f8f8f2', add: '#50fa7b', del: '#ff5555', addBg: '#1f3a2a', delBg: '#432a30', border: '#44475a', ok: '#50fa7b', err: '#ff5555' },
  catppuccin: { label: 'Catppuccin', fg: '#cdd6f4', dim: '#6c7086', accent: '#cba6f7', name: '#cdd6f4', add: '#a6e3a1', del: '#f38ba8', addBg: '#233a2c', delBg: '#3d2733', border: '#45475a', ok: '#a6e3a1', err: '#f38ba8' },
  nord: { label: 'Nord', fg: '#eceff4', dim: '#6b7790', accent: '#88c0d0', name: '#eceff4', add: '#a3be8c', del: '#bf616a', addBg: '#2a3a2c', delBg: '#3d2a2e', border: '#4c566a', ok: '#a3be8c', err: '#bf616a' },
  gruvbox: { label: 'Gruvbox', fg: '#ebdbb2', dim: '#928374', accent: '#fabd2f', name: '#ebdbb2', add: '#b8bb26', del: '#fb4934', addBg: '#2f3319', delBg: '#412622', border: '#504945', ok: '#b8bb26', err: '#fb4934' },
  solarized: { label: 'Solarized', fg: '#eee8d5', dim: '#657b83', accent: '#268bd2', name: '#eee8d5', add: '#859900', del: '#dc322f', addBg: '#1d3a2a', delBg: '#3a2326', border: '#586e75', ok: '#859900', err: '#dc322f' },
}

const DEFAULT = 'noir'
const skinOf = (key: string | undefined): Skin | undefined =>
  key === 'off' ? undefined : SKINS[key ?? DEFAULT] ?? SKINS[DEFAULT]

const skinRef = atom({ plugin: 'skins', key: 'skin' } as const, DEFAULT)
const durationsRef = atom({ plugin: 'skins', key: 'durations' } as const, {})

const ICONS: Record<string, string> = {
  Bash: '❯', Read: '▤', Edit: '✎', MultiEdit: '✎', Write: '✚', Grep: '⌕', Glob: '⌕',
  Task: '◈', Agent: '◈', WebFetch: '◍', WebSearch: '◍', TodoWrite: '☰',
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

function summarize(input: unknown): string {
  if (typeof input !== 'object' || input === null) return ''
  const o = input as Record<string, unknown>
  for (const k of ['command', 'file_path', 'path', 'pattern', 'url', 'query', 'description', 'prompt']) {
    if (typeof o[k] === 'string') return clip((o[k] as string).replace(/\s+/g, ' '), 70)
  }
  for (const v of Object.values(o)) if (typeof v === 'string') return clip(v.replace(/\s+/g, ' '), 70)
  return ''
}

const fmtMs = (ms: number) => (ms < 1000 ? `${ms}ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`)

type Patch = { oldStart: number; newStart: number; lines: string[] }
function patchOf(output: unknown): Patch[] | undefined {
  if (typeof output !== 'object' || output === null) return undefined
  const o = output as { structuredPatch?: unknown; staged?: boolean }
  if (o.staged || !Array.isArray(o.structuredPatch)) return undefined
  return o.structuredPatch as Patch[]
}
function counts(p: Patch[]) {
  let add = 0, del = 0
  for (const h of p) for (const l of h.lines) { if (l[0] === '+') add++; else if (l[0] === '-') del++ }
  return { add, del }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'skin', description: 'Switch colour skin: /skin <name>, or /skin to list' })
    const saved = await $.store.get('skin')
    if (typeof saved === 'string' && (saved === 'off' || SKINS[saved])) {
      await update($, skinRef, () => saved)
    }
    return next(e)
  })

  on('command.run', { command: 'skin' }, async ($, e) => {
    const name = e.args.trim().toLowerCase().replace(/\s+/g, '-')
    const current = (await read($, skinRef)) ?? DEFAULT
    if (name === '') {
      const rows = Object.entries(SKINS).map(([k, s]) => `${k === current ? '*' : ' '} ${k} (${s.label})`)
      return { text: `Skins (current marked *):\n${rows.join('\n')}\n  off (engine defaults)\nUse /skin <name>.` }
    }
    if (name !== 'off' && !SKINS[name]) {
      return { text: `Unknown skin "${name}". Try: ${Object.keys(SKINS).join(', ')}, off.` }
    }
    await update($, skinRef, () => name)
    await $.store.set('skin', name)
    return { text: name === 'off' ? 'Skin off: engine defaults.' : `Skin: ${SKINS[name].label}.` }
  })

  // Timing: the ToolUse props carry no duration, so measure it here.
  on('tool.call', async ($, e, next) => {
    const t0 = Date.now()
    const ran = await next(e)
    const id = e.tool_use_id
    if (id) await update($, durationsRef, d => ({ ...d, [id]: Date.now() - t0 }))
    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const skin = skinOf(await read($, skinRef))
    if (!skin) return next(e)
    const ms = (await read($, durationsRef))?.[e.props.tool_use_id]
    const { Box, Text } = $.ui.resolve(e)
    const p = e.props
    const state = p.isErrored || p.isInterrupted ? skin.err : p.isRunning ? skin.accent : skin.ok
    const patch = p.tool === 'Edit' || p.tool === 'MultiEdit' ? patchOf(p.output) : undefined
    const c = patch ? counts(patch) : undefined
    return (
      <Box flexDirection="row" gap={1}>
        <Text color={state}>{ICONS[p.tool] ?? '●'}</Text>
        <Text bold color={skin.name}>{p.tool}</Text>
        <Text color={skin.dim} wrap="truncate-end">{summarize(p.input)}</Text>
        {c && <Text color={skin.add}>+{c.add}</Text>}
        {c && <Text color={skin.del}>-{c.del}</Text>}
        <Text color={p.isErrored ? skin.err : skin.dim}>
          {p.isInterrupted ? 'interrupted' : p.isErrored ? 'failed' : p.isRunning ? '…' : ms === undefined ? '' : fmtMs(ms)}
        </Text>
      </Box>
    )
  })

  // Edit result -> diff card. Anything else falls back to the engine.
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    const skin = skinOf(await read($, skinRef))
    const p = e.props
    if (!skin || p.isErrored || p.tool !== 'Edit') return next(e)
    const patch = patchOf(p.output)
    const file = (p.output as { filePath?: unknown })?.filePath
    if (!patch || patch.length === 0 || typeof file !== 'string') return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const c = counts(patch)
    const rows: { k: string; n: number; t: string }[] = []
    for (const h of patch) {
      let o = h.oldStart, n = h.newStart
      for (const l of h.lines) {
        const k = l[0] ?? ' '
        if (k === '-') rows.push({ k, n: o++, t: l.slice(1) })
        else if (k === '+') rows.push({ k, n: n++, t: l.slice(1) })
        else { rows.push({ k: ' ', n, t: l.slice(1) }); o++; n++ }
      }
    }
    const MAX = 16
    const shown = rows.slice(0, MAX)
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={skin.border} paddingX={1}>
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold color={skin.name}>✎ {file}</Text>
          <Text><Text color={skin.add}>+{c.add}</Text> <Text color={skin.del}>-{c.del}</Text></Text>
        </Box>
        {shown.map(r => (
          <Text
            color={r.k === '+' ? skin.add : r.k === '-' ? skin.del : skin.dim}
            backgroundColor={r.k === '+' ? skin.addBg : r.k === '-' ? skin.delBg : undefined}
            wrap="truncate-end"
          >
            {String(r.n).padStart(4)} {r.k} {r.t}
          </Text>
        ))}
        {rows.length > MAX && <Text color={skin.dim}>… {rows.length - MAX} more lines</Text>}
      </Box>
    )
  })

  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    const skin = skinOf(await read($, skinRef))
    if (!skin) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="row" gap={1}>
        <Text color={skin.accent}>✻</Text>
        <Text color={skin.fg}>{e.props.message ?? e.props.word}{e.props.suffix}</Text>
        <Text color={skin.dim}>esc to interrupt</Text>
      </Box>
    )
  })

  // Not restyled, on purpose: AssistantMessage, UserMessage, ToolGroup, ToolProgress,
  // TurnDuration, AbovePrompt, Pane fall through to the engine unchanged.
}
