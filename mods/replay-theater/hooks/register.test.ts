import { test, expect } from 'claude-code/testing'

test('the pane says so when no edits were recorded', async $ => {
  const ui = await $.ui.mount({
    plugin: 'replay-theater',
    surface: 'terminal',
    component: 'Pane',
    props: { title: 'Replay Theater', isFocused: true, bodyColumns: 60, placement: 'dock' },
    requestId: 'replay-theater',
  } as never)
  expect(await ui.find({ type: 'Text', text: /No edits recorded/ })).toBeDefined()
  await ui.unmount()
})
