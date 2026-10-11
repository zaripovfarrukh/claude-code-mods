export type Proposal = { rule: string; isEditing: boolean; note: string }

declare module 'claude-code' {
  interface PluginState {
    reflect: { proposal: Proposal | null }
  }
}
