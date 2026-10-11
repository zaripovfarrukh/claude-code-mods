import { test, expect, mock } from 'claude-code/testing'

const BAND = {
  plugin: 'handoff',
  surface: 'terminal',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 10, isAtTop: true, isAtBottom: true },
    view: {},
  },
} as never

const TURN = {
  answer: 'done',
  durationMs: 10,
  isAborted: false,
  turnId: 't1',
  reason: 'answer',
} as never

const COMPOSE = {
  model: 'claude-x',
  promptModel: 'claude-x',
  surfaces: ['terminal'],
  tools: [],
  outputStyle: null,
  traits: [],
} as never

const usageAt = (percent: number) => ({
  startedAt: 1_000,
  context: { tokens: percent * 2_000, window: 200_000, percent },
  rateLimits: [],
})

test('the band appears once the context passes the first threshold', async ($, on) => {
  on('session.usage', async () => ({ value: usageAt(74) }) as never)
  on('turn.complete', async (_$, e) => ({ text: e.answer }))
  await $.turn.complete(TURN)

  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ text: /handoff/ })).toBeDefined()
  expect(await ui.find({ text: /context 74%/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: 'Write handoff' })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: 'Compact instead' })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: 'Dismiss' })).toBeDefined()
  await ui.unmount()
})

test('the band stays away below the threshold', async ($, on) => {
  on('session.usage', async () => ({ value: usageAt(40) }) as never)
  on('turn.complete', async (_$, e) => ({ text: e.answer }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Text', props: {}, children: ['nothing here'] }) as never)
  await $.turn.complete(TURN)

  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ text: /handoff/ })).toBeUndefined()
  expect(await ui.find({ text: /nothing here/ })).toBeDefined()
  await ui.unmount()
})

test('Dismiss hides the band until the next threshold', async ($, on) => {
  let percent = 74
  on('session.usage', async () => ({ value: usageAt(percent) }) as never)
  on('turn.complete', async (_$, e) => ({ text: e.answer }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Text', props: {}, children: ['nothing here'] }) as never)

  await $.turn.complete(TURN)
  const first = await $.ui.mount(BAND)
  expect(await first.find({ text: /context 74%/ })).toBeDefined()
  await first.press({ key: 'dismiss' })
  expect(await first.find({ text: /handoff/ })).toBeUndefined()

  // the same threshold does not fire again
  await $.turn.complete(TURN)
  expect(await first.find({ text: /handoff/ })).toBeUndefined()

  // the second threshold does
  percent = 83
  await $.turn.complete(TURN)
  expect(await first.find({ text: /context 83%/ })).toBeDefined()
  await first.unmount()
})

test('a subagent turn never raises the band', async ($, on) => {
  on('session.usage', async () => ({ value: usageAt(95) }) as never)
  on('turn.complete', async (_$, e) => ({ text: e.answer }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Text', props: {}, children: ['nothing here'] }) as never)
  await $.turn.complete({ ...(TURN as object), agentId: 'agent-1' } as never)

  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ text: /handoff/ })).toBeUndefined()
  await ui.unmount()
})

test('an unconsumed HANDOFF.md is injected into the system prompt and marked consumed', async ($, on) => {
  const written: { key: string; value: unknown }[] = []
  on('store.get', async () => ({ value: { writtenAt: 1, isConsumed: false } }) as never)
  on('store.set', async (_$, e) => {
    written.push({ key: e.key, value: e.value })
    return { value: undefined } as never
  })
  on('fs.exists', async () => ({ value: true }) as never)
  on('fs.read', async () => ({ value: '## Goal\nShip the parser rewrite.' }) as never)
  on('prompt.compose', async () => ({ sections: [{ id: 'intro', text: 'core', scope: 'shared' }] }) as never)
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true } as never)

  const composed = await $.prompt.compose(COMPOSE)
  const added = composed.sections.filter(s => s.id === 'handoff:previous-session')
  expect(added).toHaveLength(1)
  expect(added[0]?.scope).toBe('session')
  expect(added[0]?.text).toContain('Ship the parser rewrite.')
  expect(composed.sections[composed.sections.length - 1]?.id).toBe('handoff:previous-session')
  expect(written).toEqual([{ key: 'pending:/work', value: { writtenAt: 1, isConsumed: true } }])

  const band = await $.ui.mount(BAND)
  expect(await band.find({ text: /loaded HANDOFF.md/ })).toBeDefined()
  await band.unmount()
})

test('a consumed handoff is never injected again', async ($, on) => {
  on('store.get', async () => ({ value: { writtenAt: 1, isConsumed: true } }) as never)
  on('store.set', async () => ({ value: undefined }) as never)
  on('fs.exists', async () => ({ value: true }) as never)
  on('fs.read', async () => ({ value: '## Goal\nShip the parser rewrite.' }) as never)
  on('prompt.compose', async () => ({ sections: [{ id: 'intro', text: 'core', scope: 'shared' }] }) as never)
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true } as never)

  const composed = await $.prompt.compose(COMPOSE)
  expect(composed.sections.filter(s => s.id === 'handoff:previous-session')).toHaveLength(0)
})

test('/handoff off silences the band for the session', async ($, on) => {
  on('session.usage', async () => ({ value: usageAt(90) }) as never)
  on('turn.complete', async (_$, e) => ({ text: e.answer }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Text', props: {}, children: ['nothing here'] }) as never)

  const off = await $.command.run({ command: 'handoff', args: 'off' } as never)
  expect(off.text).toContain('off for this session')

  await $.turn.complete(TURN)
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ text: /handoff/ })).toBeUndefined()
  await ui.unmount()
})

test('/handoff with junk arguments writes nothing and says how to use it', async ($, on) => {
  on('fs.write', async () => {
    throw new Error('nothing should be written')
  })
  const reply = await $.command.run({ command: 'handoff', args: 'sideways' } as never)
  expect(reply.text).toContain('usage is')
  void on
})

test('/handoff resume re-injects the current HANDOFF.md', async ($, on) => {
  on('fs.exists', async () => ({ value: true }) as never)
  on('fs.read', async () => ({ value: '## Goal\nFinish the migration.' }) as never)
  on('session.cwd', async () => ({ value: '/work' }) as never)
  on('prompt.compose', async () => ({ sections: [] }) as never)

  const reply = await $.command.run({ command: 'handoff', args: 'resume' } as never)
  expect(reply.text).toContain('re-injected')

  const composed = await $.prompt.compose(COMPOSE)
  expect(composed.sections.filter(s => s.id === 'handoff:previous-session')).toHaveLength(1)
})

test('Write handoff forks the transcript and writes HANDOFF.md with a header', async ($, on) => {
  const clock = mock.clock(on, { now: 1_700_000_000_000 })
  const written: { path: string; text: string }[] = []
  const recorded: { key: string; value: unknown }[] = []
  let forkedPrompt = ''

  on('session.usage', async () => ({ value: usageAt(74) }) as never)
  on('turn.complete', async (_$, e) => ({ text: e.answer }))
  on('session.cwd', async () => ({ value: '/work' }) as never)
  on('fs.exists', async () => ({ value: false }) as never)
  on('model.fork', async (_$, e) => {
    forkedPrompt = e.prompt
    return { value: { isAnswered: true, text: '## Goal\nShip it.' } } as never
  })
  on('process.run', async (_$, e) => ({
    value: {
      exitCode: 0,
      stdout: e.argv.includes('--porcelain') ? ' M src/a.ts\n?? b.ts\n' : 'feature/handoff\n',
      stderr: '',
    },
  }) as never)
  on('fs.write', async (_$, e) => {
    written.push({ path: e.path, text: e.text })
    return { value: undefined } as never
  })
  on('store.set', async (_$, e) => {
    recorded.push({ key: e.key, value: e.value })
    return { value: undefined } as never
  })
  on('ui.toast', async () => ({ value: undefined }) as never)
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Text', props: {}, children: ['nothing here'] }) as never)

  await $.turn.complete(TURN)
  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'write' })

  expect(forkedPrompt).toContain('## Next steps')
  expect(written).toHaveLength(1)
  expect(written[0]?.path).toBe('/work/.claude/handoffs/feature-handoff.md')
  expect(written[0]?.text).toContain('cwd: /work')
  expect(written[0]?.text).toContain('branch: feature/handoff')
  expect(written[0]?.text).toContain('git_status: 2 changed:')
  expect(written[0]?.text).toContain(new Date(1_700_000_000_000).toISOString())
  expect(written[0]?.text).toContain('Ship it.')
  expect(recorded).toEqual([{ key: 'pending:/work', value: { writtenAt: 1_700_000_000_000, isConsumed: false } }])

  // the band clears itself once the note is written
  expect(await ui.find({ text: /context 74%/ })).toBeUndefined()
  await ui.unmount()
  void clock
})

test('a failed fork writes nothing and leaves the turn alone', async ($, on) => {
  mock.clock(on, { now: 1_700_000_000_000 })
  const written: string[] = []
  on('session.usage', async () => ({ value: usageAt(74) }) as never)
  on('turn.complete', async (_$, e) => ({ text: e.answer }))
  on('session.cwd', async () => ({ value: '/work' }) as never)
  on('fs.exists', async () => ({ value: false }) as never)
  on('model.fork', async () => ({ value: { isAnswered: false, reason: 'api-error' } }) as never)
  on('fs.write', async (_$, e) => {
    written.push(e.path)
    return { value: undefined } as never
  })
  on('ui.toast', async () => ({ value: undefined }) as never)

  const reply = await $.command.run({ command: 'handoff', args: '' } as never)
  expect(written).toHaveLength(0)
  expect(reply.text).toContain('nothing was written')
})

test('a HANDOFF.md newer than the session is not clobbered without a yes', async ($, on) => {
  mock.clock(on, { now: 1_700_000_000_000 })
  const written: string[] = []
  let asked = ''
  on('session.usage', async () => ({ value: { startedAt: 1_000, context: { tokens: 1, window: 2, percent: 74 }, rateLimits: [] } }) as never)
  on('session.cwd', async () => ({ value: '/work' }) as never)
  on('fs.exists', async () => ({ value: true }) as never)
  on('fs.stat', async () => ({ value: { kind: 'file', size: 10, mtimeMs: 9_999_999, isLink: false } }) as never)
  on('tool.call', { tool: 'AskUserQuestion' }, async (_$, e) => {
    asked = JSON.stringify(e)
    return { result: { text: 'Keep the newer one' } } as never
  })
  on('model.fork', async () => {
    throw new Error('the fork must not run once the person kept the newer note')
  })
  on('fs.write', async (_$, e) => {
    written.push(e.path)
    return { value: undefined } as never
  })
  on('ui.toast', async () => ({ value: undefined }) as never)

  const reply = await $.command.run({ command: 'handoff', args: '' } as never)
  expect(asked).toContain('Overwrite')
  expect(written).toHaveLength(0)
  expect(reply.text).toContain('nothing was written')
})
