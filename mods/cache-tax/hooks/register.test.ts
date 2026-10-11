import { test, expect, mock } from 'claude-code/testing'

const usage = {
  startedAt: 0,
  context: { tokens: 100_000, window: 200_000 },
  rateLimits: [],
}

test('/cache-tax guard switches mode and rejects junk', async ($, on) => {
  mock.clock(on)
  const ok = await $.command.run({ command: 'cache-tax', args: 'guard warn' } as never)
  expect(ok.text).toContain('guard set to warn')
  const bad = await $.command.run({ command: 'cache-tax', args: 'guard maybe' } as never)
  expect(bad.text).toContain('Usage')
})

test('/keepwarm parses durations and off', async ($, on) => {
  mock.clock(on)
  const onCmd = await $.command.run({ command: 'keepwarm', args: '90m' } as never)
  expect(onCmd.text).toContain('keepwarm on for 1h 30m')
  const off = await $.command.run({ command: 'keepwarm', args: 'off' } as never)
  expect(off.text).toContain('keepwarm off')
  const bad = await $.command.run({ command: 'keepwarm', args: 'soon' } as never)
  expect(bad.text).toContain('Usage')
})

test('a cold prompt is held once, the identical resend goes through', async ($, on) => {
  const clock = mock.clock(on, { now: 10_000_000_000 })
  on('session.usage', async () => ({ value: usage }) as never)
  on('prompt.submit', async (_$, e) => ({ text: e.text }))
  on('turn.complete', async (_$, e) => ({ text: e.answer }))
  await $.turn.complete({ answer: 'hi', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as never)
  await clock.advance(2 * 60 * 60 * 1000)
  const args = { text: 'hello', wait: false, origin: { kind: 'composer' } } as never
  const first = await $.prompt.submit(args)
  expect(first.drop).toContain('cache went cold')
  expect(first.drop).toContain('$0.375')
  const second = await $.prompt.submit(args)
  expect(second.drop).toBeUndefined()
})
