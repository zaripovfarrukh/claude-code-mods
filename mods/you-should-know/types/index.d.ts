export type Note = { headline: string; body: string }

declare module 'claude-code' {
  interface PluginState {
    'you-should-know': { note: Note | null; isOn: boolean }
  }
}
