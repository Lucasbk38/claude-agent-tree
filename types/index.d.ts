export type Row = {
  id: string
  parentId?: string
  label: string
  type: string
  model: string
  status: string
}

declare module 'claude-code' {
  interface PluginState {
    'agent-tree': { rows: Row[] }
  }
}
