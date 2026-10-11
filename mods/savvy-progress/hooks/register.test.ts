import { test, expect } from 'claude-code/testing'

test('the pane says so when no subagent has run', async $ => {
  const ui = await $.ui.mount({
    plugin: 'savvy-progress',
    surface: 'terminal',
    component: 'Pane',
    props: { title: 'Agents', isFocused: true, bodyColumns: 60, placement: 'dock' },
    requestId: 'agents-info',
  } as never)
  expect(await ui.find({ type: 'Text', text: /No subagents yet/ })).toBeDefined()
  await ui.unmount()
})
