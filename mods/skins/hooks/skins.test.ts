import { test, expect } from 'claude-code/testing'

test('a tool row shows icon, name and argument summary', async $ => {
  const ui = await $.ui.mount({
    plugin: 'skins',
    surface: 'terminal',
    component: 'ToolUse',
    props: { tool_use_id: 't1', tool: 'Bash', input: { command: 'pnpm test' }, isRunning: false, isErrored: false, isInterrupted: false },
    requestId: 't1',
  } as never)
  expect(await ui.find({ type: 'Text', text: /Bash/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /pnpm test/ })).toBeDefined()
  await ui.unmount()
})

test('an edit result draws a diff card with counts', async $ => {
  const ui = await $.ui.mount({
    plugin: 'skins',
    surface: 'terminal',
    component: 'ToolResult',
    props: {
      tool_use_id: 't2', tool: 'Edit', isErrored: false,
      output: { filePath: '/a/b.ts', structuredPatch: [{ oldStart: 1, newStart: 1, lines: [' x', '-old', '+new', '+more'] }] },
    },
    requestId: 't2',
  } as never)
  expect(await ui.find({ type: 'Text', text: /\+2/ })).toBeDefined()
  await ui.unmount()
})
