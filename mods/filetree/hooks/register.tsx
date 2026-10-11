import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Entry } from '../types'

const PANE = 'filetree'
const SHIMMER_MS = 3000
const MAX_PER_DIR = 300
const IGNORED = ['node_modules', '.git']
const EDIT_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']
const FILE_TOOLS = ['Read', ...EDIT_TOOLS]

const dirs = atom({ plugin: 'filetree', key: 'dirs' } as const, {})
const expanded = atom({ plugin: 'filetree', key: 'expanded' } as const, [''])
const touched = atom({ plugin: 'filetree', key: 'touched' } as const, {})
const status = atom({ plugin: 'filetree', key: 'status' } as const, {})
const porcelain = atom({ plugin: 'filetree', key: 'porcelain' } as const, {})
const branch = atom({ plugin: 'filetree', key: 'branch' } as const, '')
const selected = atom({ plugin: 'filetree', key: 'selected' } as const, '')
const now = atom({ plugin: 'filetree', key: 'now' } as const, 0)

const parentsOf = (rel: string) => {
  const parts = rel.split('/')
  const out: string[] = ['']
  for (let i = 1; i < parts.length; i++) out.push(parts.slice(0, i).join('/'))
  return out
}

async function loadDir($: EngineInterface, rel: string) {
  try {
    const list = await $.fs.list(rel === '' ? undefined : rel)
    const entries: Entry[] = list
      .filter(f => !IGNORED.includes(f.name))
      .map(f => ({ name: f.name, kind: f.kind }))
      .sort((a, b) =>
        a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1,
      )
      .slice(0, MAX_PER_DIR)
    await update($, dirs, d => ({ ...d, [rel]: entries }))
  } catch {
    await update($, dirs, d => ({ ...d, [rel]: [] }))
  }
}

async function toggle($: EngineInterface, rel: string) {
  const open = await read($, expanded)
  if (open.includes(rel)) {
    await update($, expanded, l => l.filter(p => p !== rel))
  } else {
    await update($, expanded, l => [...l, rel])
    await loadDir($, rel)
  }
}

function select($: EngineInterface, rel: string) {
  return update($, selected, () => rel)
}

async function refreshGit($: EngineInterface) {
  try {
    const top = (await $.process.run(['git', 'rev-parse', '--show-toplevel'])).stdout.trim()
    const root = await $.session.cwd()
    const b = await $.process.run(['git', 'branch', '--show-current'])
    const st = await $.process.run(['git', 'status', '--porcelain'])
    const prefix = top && root.startsWith(top) ? root.slice(top.length + 1) : ''
    const map: Record<string, string> = {}
    for (const line of st.stdout.split('\n')) {
      if (line.length < 4) continue
      let p = line.slice(3).replace(/^.* -> /, '').replace(/^"|"$/g, '')
      if (prefix) {
        if (!p.startsWith(prefix + '/')) continue
        p = p.slice(prefix.length + 1)
      }
      map[p] = line.slice(0, 2).trim() === '??' ? '?' : 'M'
    }
    await update($, branch, () => b.stdout.trim() || '(detached)')
    await update($, porcelain, () => map)
    const edited = Object.keys(await read($, touched))
    await update($, status, old => {
      const next = { ...old }
      for (const p of edited) {
        if (!(p in (editedSet.s))) continue
        const isDirty = Object.keys(map).some(k => k === p || (k.endsWith('/') && p.startsWith(k)))
        if (isDirty) next[p] = 'dirty'
        else if (old[p] === 'dirty') next[p] = 'committed'
      }
      return next
    })
  } catch {
    /* not a git repo or git missing: tree still works */
  }
}

// paths edited (not merely read) this session; a module-level record, rebuilt on reload
const editedSet: { s: Record<string, true> } = { s: {} }
let lastTouch = 0

export const register: Register = on => {
  let isOpen = false
  let timer: { cancel: () => void } | undefined

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'filetree',
      description: 'Open or close the project file tree pane',
    })
    timer = $.clock.every(400, () => {
      if (isOpen && Date.now() - lastTouch < SHIMMER_MS + 600) {
        void update($, now, () => Date.now())
      }
    })
    return next(e)
  })

  on('command.run', { command: 'filetree' }, async $ => {
    if (isOpen) {
      isOpen = false
      await $.ui.close({ id: PANE })
      return { text: 'File tree closed.' }
    }
    isOpen = true
    await $.ui.open({ id: PANE, title: 'Files' })
    await loadDir($, '')
    await refreshGit($)
    return { text: 'File tree opened.' }
  })

  on('tool.call', async ($, e, next) => {
    const input = e as unknown as { tool: string; file_path?: string; notebook_path?: string }
    const isFile = FILE_TOOLS.includes(input.tool)
    const isBash = input.tool === 'Bash'
    let rel = ''
    if (isFile) {
      const abs = input.file_path ?? input.notebook_path ?? ''
      const root = await $.session.cwd()
      if (abs.startsWith(root + '/')) rel = abs.slice(root.length + 1)
      if (rel) {
        if (EDIT_TOOLS.includes(input.tool)) editedSet.s[rel] = true
        lastTouch = Date.now()
        await update($, touched, t => ({ ...t, [rel]: Date.now() }))
        await update($, now, () => Date.now())
        await update($, selected, () => rel)
        if (isOpen && !rel.split('/').some(p => IGNORED.includes(p))) {
          const parents = parentsOf(rel)
          await update($, expanded, l => [...new Set([...l, ...parents])])
          for (const d of parents) await loadDir($, d)
        }
      }
    }
    const ran = await next(e)
    if (isOpen && (isBash || (isFile && EDIT_TOOLS.includes(input.tool)))) {
      await refreshGit($)
      if (rel) {
        const parent = parentsOf(rel).pop() ?? ''
        await loadDir($, parent)
      }
    }
    return ran
  })

  on('turn.complete', async ($, e, next) => {
    if (isOpen) await refreshGit($)
    return next(e)
  })

  on('session.end', ($, e, next) => {
    timer?.cancel()
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const tree = await read($, dirs)
    const open = await read($, expanded)
    const hot = await read($, touched)
    const state = await read($, status)
    const dirty = await read($, porcelain)
    const br = await read($, branch)
    const sel = await read($, selected)
    const t = await read($, now)

    const isDirtyPath = (p: string) =>
      Object.keys(dirty).some(k => k === p || (k.endsWith('/') && p.startsWith(k)))
    const dirtyUnder = (p: string) =>
      Object.keys(dirty).filter(k => (p === '' ? true : k.startsWith(p + '/'))).length

    type Row = { rel: string; name: string; depth: number; kind: string }
    const rows: Row[] = []
    const walk = (rel: string, depth: number) => {
      for (const en of tree[rel] ?? []) {
        const p = rel === '' ? en.name : `${rel}/${en.name}`
        rows.push({ rel: p, name: en.name, depth, kind: en.kind })
        if (en.kind === 'dir' && open.includes(p)) walk(p, depth + 1)
        if (rows.length > 1200) return
      }
    }
    walk('', 0)

    const tick = Math.floor(t / 400) % 2 === 0
    const total = dirtyUnder('')

    return (
      <Box flexDirection="column">
        <Text bold>
          ⎇ {br || '(no git)'}
          {total > 0 ? `   ${total} changed` : ''}
        </Text>
        {rows.length === 0 && <Text dimColor>Loading files…</Text>}
        {rows.map(r => {
          const isDir = r.kind === 'dir'
          const isDot = r.name.startsWith('.')
          const age = t - (hot[r.rel] ?? 0)
          const isHot = !isDir && hot[r.rel] !== undefined && age < SHIMMER_MS
          const isGreen = !isDir && state[r.rel] === 'committed' && !isHot
          const isMod = !isDir && isDirtyPath(r.rel)
          const marker = isDir
            ? dirtyUnder(r.rel) > 0 && !open.includes(r.rel)
              ? ` M:${dirtyUnder(r.rel)}`
              : ''
            : isMod
              ? ` ${dirty[r.rel] ?? 'M'}`
              : ''
          const icon = isDir ? (open.includes(r.rel) ? '▾ ' : '▸ ') : '  '
          const label = `${'  '.repeat(r.depth)}${icon}${r.name}${marker}`
          return (
            <Button
              plain
              onPress={() => (isDir ? toggle($, r.rel) : select($, r.rel))}
            >
              <Text
                dimColor={isDot && !isHot && !isGreen}
                bold={isHot || r.rel === sel}
                color={isHot ? 'warning' : isGreen ? 'success' : isMod ? 'suggestion' : undefined}
                inverse={isHot && tick}
              >
                {label}
              </Text>
            </Button>
          )
        })}
        <Text dimColor>selected: {sel || '-'}</Text>
      </Box>
    )
  })
}
