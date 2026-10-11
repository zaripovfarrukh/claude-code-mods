// Pure helpers: split a shell command line, find the risky parts. No engine calls.
export type Risk = {
  kind: 'rm' | 'find' | 'push' | 'reset' | 'clean' | 'sql'
  argv: string[]
  cwd: string | undefined
  isCwdUnknown: boolean
}

export function tokenize(line: string): string[][] {
  const segments: string[][] = []
  let cur: string[] = []
  let word = ''
  let has = false
  let quote = ''
  const endWord = () => {
    if (has) cur.push(word)
    word = ''
    has = false
  }
  const endSeg = () => {
    endWord()
    if (cur.length) segments.push(cur)
    cur = []
  }
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quote) {
      if (c === quote) quote = ''
      else if (c === '\\' && quote === '"' && i + 1 < line.length) word += line[++i]
      else word += c
      continue
    }
    if (c === "'" || c === '"') {
      quote = c
      has = true
    } else if (c === '\\' && i + 1 < line.length) {
      word += line[++i]
      has = true
    } else if (c === ' ' || c === '\t') endWord()
    else if (c === ';' || c === '\n' || c === '&' || c === '|' || c === '(' || c === ')') endSeg()
    else {
      word += c
      has = true
    }
  }
  endSeg()
  return segments
}

const WRAPPERS = new Set(['sudo', 'command', 'env', 'time', 'nice', 'nohup', 'exec'])
const base = (s: string) => s.replace(/^\\/, '').split('/').pop() ?? s

const hasShort = (args: string[], re: RegExp) =>
  args.some(a => /^-[A-Za-z]+$/.test(a) && re.test(a))

export function findRisks(line: string, startCwd?: string, depth = 0): Risk[] {
  const risks: Risk[] = []
  let cwd = startCwd
  let isCwdUnknown = false
  for (const seg of tokenize(line)) {
    let i = 0
    while (i < seg.length && (WRAPPERS.has(base(seg[i])) || /^[A-Za-z_]\w*=/.test(seg[i]))) i++
    const cmd = base(seg[i] ?? '')
    const args = seg.slice(i + 1)
    const make = (kind: Risk['kind']): Risk => ({ kind, argv: [cmd, ...args], cwd, isCwdUnknown })
    if (cmd === 'cd') {
      const t = args[0]
      if (!t || /[$`~]|^-$/.test(t)) isCwdUnknown = true
      else cwd = t.startsWith('/') || !cwd ? t : `${cwd}/${t}`
    } else if (cmd === 'rm') {
      if (hasShort(args, /[rR]/) || args.includes('--recursive')) risks.push(make('rm'))
    } else if (cmd === 'find') {
      if (args.includes('-delete')) risks.push(make('find'))
    } else if (cmd === 'git') {
      const sub = args.find(a => !a.startsWith('-'))
      const rest = args.slice(args.indexOf(sub ?? '') + 1)
      if (sub === 'push') {
        const isForce =
          rest.some(a => a === '--force' || a.startsWith('--force-with-lease') || a === '--force-if-includes' || a === '--mirror') ||
          hasShort(rest, /f/) ||
          rest.some(a => /^\+[^+]/.test(a))
        if (isForce) risks.push(make('push'))
      } else if (sub === 'reset') {
        if (rest.includes('--hard')) risks.push(make('reset'))
      } else if (sub === 'clean') {
        const isForce = hasShort(rest, /f/) || rest.includes('--force')
        const isDry = hasShort(rest, /n/) || rest.includes('--dry-run')
        if (isForce && !isDry) risks.push(make('clean'))
      }
    } else if ((cmd === 'bash' || cmd === 'sh' || cmd === 'zsh') && depth < 3) {
      const ci = args.indexOf('-c')
      if (ci >= 0 && args[ci + 1]) risks.push(...findRisks(args[ci + 1], cwd, depth + 1))
    }
  }
  if (/\b(drop\s+(table|database|schema|index|view)|truncate\s+(table\s+)?\w)/i.test(line)) {
    risks.push({ kind: 'sql', argv: [line], cwd, isCwdUnknown })
  }
  return risks
}

export const fmtSize = (bytes: number) =>
  bytes >= 1 << 30
    ? `${(bytes / (1 << 30)).toFixed(1)} GB`
    : bytes >= 1 << 20
      ? `${(bytes / (1 << 20)).toFixed(1)} MB`
      : bytes >= 1 << 10
        ? `${Math.round(bytes / (1 << 10))} KB`
        : `${bytes} B`
