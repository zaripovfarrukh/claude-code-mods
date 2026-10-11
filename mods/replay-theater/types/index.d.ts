export type EditRecord = {
  tool: 'Edit' | 'Write' | 'MultiEdit'
  path: string
  /** Unified-diff hunk text built from the old/new strings or the written content. */
  diff: string
  added: number
  removed: number
}

declare module 'claude-code' {
  interface PluginState {
    'replay-theater': { edits: EditRecord[]; step: number }
  }
}
