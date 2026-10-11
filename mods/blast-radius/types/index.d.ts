export type Held = {
  command: string
  headline: string
  lines: string[]
  paths: string[]
  more: number
  isMeasured: boolean
  isBand: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'blast-radius': { held: Held | null }
  }
}
