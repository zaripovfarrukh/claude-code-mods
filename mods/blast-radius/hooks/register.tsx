import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Held } from '../types'
import { findRisks, fmtSize } from './analyze'
import type { Risk } from './analyze'

const PANE = 'blast-radius'
const PROCEED = 'Proceed'
const CANCEL = 'Cancel'
const MAX_PATHS = 15
const held = atom({ plugin: 'blast-radius', key: 'held' } as const, null)

type Measured = { headline: string; lines: string[]; paths: string[]; isMeasured: boolean; count: number }
const UNKNOWN = (why: string): Measured => ({ headline: `could not measure (${why})`, lines: [], paths: [], isMeasured: false, count: 0 })
const hasGlob = (s: string) => /[*?[]/.test(s)

async function measureRm($: EngineInterface, r: Risk): Promise<Measured> {
  if (r.isCwdUnknown) return UNKNOWN('working directory not known')
  const targets = r.argv.slice(1).filter(a => !a.startsWith('-') || a === '-')
  const dashdash = r.argv.indexOf('--')
  const all = dashdash >= 0 ? [...targets, ...r.argv.slice(dashdash + 1)] : targets
  const uniq = [...new Set(all)]
  if (uniq.length === 0) return UNKNOWN('no path given')
  if (uniq.some(t => /[$`~]/.test(t))) return UNKNOWN('path uses a variable or ~')
  const paths: string[] = []
  let kb = 0
  let missing = 0
  for (const t of uniq) {
    const q = hasGlob(t) ? '$1' : '"$1"'
    const script = `find ${q} \\( -type f -o -type l \\) -print 2>/dev/null; echo @@DU; du -sk ${q} 2>/dev/null`
    const out = await $.process.run(['sh', '-c', script, '_', t], { cwd: r.cwd, timeoutMs: 20_000 })
    const [files = '', du = ''] = out.stdout.split('@@DU\n')
    const list = files.split('\n').filter(Boolean)
    paths.push(...list)
    const sized = du.split('\n').filter(Boolean)
    for (const l of sized) kb += Number(l.split(/\s+/)[0]) || 0
    if (list.length === 0 && sized.length === 0) missing++
  }
  const note = missing === uniq.length ? ' (nothing matches those paths)' : ''
  return {
    headline: `Would delete ${paths.length} files (${fmtSize(kb * 1024)})${note}`,
    lines: [],
    paths,
    isMeasured: true,
    count: paths.length,
  }
}

async function measureFind($: EngineInterface, r: Risk): Promise<Measured> {
  if (r.isCwdUnknown) return UNKNOWN('working directory not known')
  if (r.argv.some(a => a === '-exec' || a === '-ok')) return UNKNOWN('find with -exec')
  const dry = r.argv.slice(1).map(a => (a === '-delete' ? '-print' : a))
  const out = await $.process.run(['find', ...dry], { cwd: r.cwd, timeoutMs: 20_000 })
  const list = out.stdout.split('\n').filter(Boolean)
  if (out.exitCode !== 0 && list.length === 0) return UNKNOWN('find failed')
  return { headline: `Would delete ${list.length} paths (find -delete)`, lines: [], paths: list, isMeasured: true, count: list.length }
}

async function git($: EngineInterface, r: Risk, args: string[]) {
  return $.process.run(['git', ...args], { cwd: r.cwd, timeoutMs: 20_000 })
}

async function measureGit($: EngineInterface, r: Risk): Promise<Measured> {
  if (r.isCwdUnknown) return UNKNOWN('working directory not known')
  if (r.kind === 'reset') {
    const st = await git($, r, ['status', '--porcelain'])
    if (st.exitCode !== 0) return UNKNOWN('not a git repository')
    const rows = st.stdout.split('\n').filter(l => l && !l.startsWith('??'))
    const stat = await git($, r, ['diff', '--stat', 'HEAD'])
    const last = stat.stdout.trim().split('\n').pop() ?? ''
    return {
      headline: `Would discard changes in ${rows.length} tracked files`,
      lines: last ? [last.trim()] : [],
      paths: rows.map(l => l.slice(3)),
      isMeasured: true,
      count: rows.length,
    }
  }
  if (r.kind === 'clean') {
    const flags = r.argv.slice(2).filter(a => a !== '--force' && !/^-[A-Za-z]+$/.test(a)).length
    const dry = ['clean', '-n', ...r.argv.slice(2).map(a => (/^-[A-Za-z]+$/.test(a) ? a.replace(/f/g, '') : a)).filter(a => a !== '-' && a !== '--force' && a !== '--dry-run')]
    void flags
    const out = await git($, r, dry)
    if (out.exitCode !== 0) return UNKNOWN('git clean dry run failed')
    const rows = out.stdout.split('\n').filter(Boolean).map(l => l.replace(/^Would remove /, ''))
    return { headline: `Would delete ${rows.length} untracked items`, lines: [], paths: rows, isMeasured: true, count: rows.length }
  }
  // push --force: what the local branch would send over the remote's history
  const out = await git($, r, ['log', '--oneline', 'origin..HEAD'])
  if (out.exitCode !== 0) return UNKNOWN('no origin to compare with')
  const rows = out.stdout.split('\n').filter(Boolean)
  return {
    headline: `Force push: ${rows.length} local commits vs origin; remote-only commits would be overwritten`,
    lines: ['Remote commits not in your branch are not listed here.'],
    paths: rows,
    isMeasured: true,
    count: rows.length,
  }
}

async function measure($: EngineInterface, r: Risk): Promise<Measured> {
  try {
    if (r.kind === 'rm') return await measureRm($, r)
    if (r.kind === 'find') return await measureFind($, r)
    if (r.kind === 'sql') return UNKNOWN('SQL effect depends on the database')
    return await measureGit($, r)
  } catch {
    return UNKNOWN('the measuring command failed')
  }
}

async function view($: EngineInterface, e: Parameters<EngineInterface['ui']['resolve']>[0]) {
  const h = await read($, held)
  if (!h) return null
  const { Box, Text } = $.ui.resolve(e)
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="warning" paddingX={1}>
      <Text bold color="warning">Blast Radius: command held</Text>
      <Text dimColor>Command</Text>
      <Text>{h.command}</Text>
      <Text color={h.isMeasured ? 'error' : 'warning'}>{h.headline}</Text>
      {h.lines.map((l, i) => <Text key={`l${i}`} dimColor>{l}</Text>)}
      {h.paths.map((p, i) => <Text key={`p${i}`}>  {p}</Text>)}
      {h.more > 0 && <Text dimColor>  ...and {h.more} more</Text>}
      <Box marginTop={1}>
        <Text dimColor>Claude is waiting on your answer in the dialog ({CANCEL} is the safe one).</Text>
      </Box>
    </Box>
  )
}


export const register: Register = on => {
  let queue: Promise<void> = Promise.resolve()

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const risks = findRisks(e.command)
    if (risks.length === 0) return next(e)

    // One hold at a time: parallel risky calls wait their turn.
    const before = queue
    let release: () => void = () => {}
    queue = new Promise<void>(r => (release = r))
    await before
    try {
      const parts = await Promise.all(risks.map(r => measure($, r)))
      const paths = parts.flatMap(p => p.paths)
      const view: Held = {
        command: e.command.length > 300 ? `${e.command.slice(0, 300)}...` : e.command,
        headline: parts.map(p => p.headline).join(' | '),
        lines: parts.flatMap(p => p.lines),
        paths: paths.slice(0, MAX_PATHS),
        more: Math.max(0, paths.length - MAX_PATHS),
        isMeasured: parts.every(p => p.isMeasured),
        isBand: false,
      }
      await update($, held, () => view)
      const opened = await $.ui.open({ id: PANE, title: 'Blast Radius' })
      if (!opened.isPlaced) await update($, held, () => ({ ...view, isBand: true }))

      // The decision is asked through $.ui.ask, never awaited on our own promise:
      // a hook's budget counts its OWN time (10s), but stops while a $ call is in
      // flight, so only this form can wait for a person.
      const answer = await $.ui
        .ask(`Blast Radius: run this command? ${view.headline}`, {
          options: [CANCEL, PROCEED],
          header: 'Blast radius',
        })
        .catch(() => CANCEL)
      const isOk = answer === PROCEED
      await update($, held, () => null)
      await $.ui.close({ id: PANE })
      return isOk
        ? next(e)
        : { deny: `blast-radius: the user cancelled this risky command: ${view.headline}` }
    } finally {
      release()
    }
  }).catch(($, e, next) =>
    // a failure in the hook itself never silently runs the command nor blocks safe ones
    next.called ? next(e) : { deny: 'blast-radius: the guard failed, so the risky command was not run.' },
  )

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => (await view($, e)) ?? <></>)

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const h = await read($, held)
    if (!h || !h.isBand || e.props.hasSurvey) return next(e)
    return (await view($, e)) ?? next(e)
  })
}
