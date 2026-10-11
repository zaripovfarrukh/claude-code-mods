import { test, expect } from 'claude-code/testing'

test('the pane shows a placeholder before files load', async $ => {
  const ui = await $.ui.mount({
    plugin: 'filetree',
    surface: 'terminal',
    component: 'Pane',
    props: { title: 'Files', isFocused: true, bodyColumns: 60, placement: 'dock' },
    requestId: 'filetree',
  } as never)
  expect(await ui.find({ type: 'Text', text: /Loading files/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /selected:/ })).toBeDefined()
  await ui.unmount()
})
