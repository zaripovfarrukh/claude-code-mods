export type AgentRow = {
  id: string
  title: string
  model: string
  isDone: boolean
  isFailed: boolean
  ctxTokens: number
  tokens: number
  cost: number
  startedAt: number
  endedAt: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'savvy-progress': { agents: AgentRow[]; now: number; isBandHidden: boolean }
  }
}
