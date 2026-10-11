/**
 * What the band above the prompt is showing, or null for nothing:
 * a context threshold this session crossed, or a handoff loaded at start.
 */
export type HandoffBand =
  | { kind: 'threshold'; percent: number }
  | { kind: 'loaded' }

declare module 'claude-code' {
  interface PluginState {
    handoff: {
      /** What the AbovePrompt band shows, or null while it shows nothing. */
      band: HandoffBand | null
      /** The handoff text to append to this session's system prompt, or null. */
      resume: string | null
      /** The thresholds already fired this session, so each fires once. */
      fired: number[]
      /** Whether the automatic band is on for this session (`/handoff off`). */
      isAuto: boolean
      /** True while a handoff is being written, so two presses write once. */
      isWriting: boolean
    }
  }
}
