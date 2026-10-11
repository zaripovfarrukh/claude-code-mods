import { test, expect } from 'claude-code/testing'

test('a prompt passes through unchanged even when the check fails', async ($, on) => {
  on('prompt.submit', (_$, e) => ({ ...e, text: e.text }) as never)
  on('model.complete', () => {
    throw new Error('model down')
  })
  const r = await $.prompt.submit({ text: 'no - in this repo we always use pnpm, not npm' } as never)
  expect(JSON.stringify(r)).not.toContain('deny')
})
