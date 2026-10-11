declare module 'claude-code' {
  interface PluginState {
    'cache-tax': {
      /** ms epoch of last main-loop model response; 0 = none seen */
      lastResponseAt: number
      model: string
      guard: 'refuse' | 'warn'
      keepwarmUntil: number
      coldWrites: number
      coldPaid: number
      heldText: string
      pings: number
    }
  }
}
