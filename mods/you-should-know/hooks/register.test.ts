import { test, expect } from 'claude-code/testing'

test('/should-know toggles the notes off and on', async $ => {
  const off = await $.command.run({ command: 'should-know', args: '' } as never)
  expect(JSON.stringify(off)).toContain('off')
  const on = await $.command.run({ command: 'should-know', args: '' } as never)
  expect(JSON.stringify(on)).toContain('on')
})
