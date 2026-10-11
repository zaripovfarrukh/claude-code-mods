export type Entry = { name: string; kind: 'file' | 'dir' | 'other' }

declare module 'claude-code' {
  interface PluginState {
    filetree: {
      dirs: Record<string, Entry[]>
      expanded: string[]
      touched: Record<string, number>
      status: Record<string, 'dirty' | 'committed'>
      porcelain: Record<string, string>
      branch: string
      selected: string
      now: number
    }
  }
}
