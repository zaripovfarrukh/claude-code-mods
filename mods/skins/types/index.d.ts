declare module 'claude-code' {
  interface PluginState {
    'skins': { skin: string; durations: Record<string, number> }
  }
}
