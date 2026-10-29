import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Row } from '../types'

const rows = atom({ plugin: 'agent-tree', key: 'rows' } as const, [] as Row[])

// where the subagent status line reads parent links from
const PARENTS_PATH = '.claude/statusline/agent-parents.json'
const LIVE = new Set(['pending', 'running', 'waiting', 'idle'])
const ICON: Record<string, string> = { pending: '○', running: '●', waiting: '◐', idle: '◌' }

const familyOf = (m: string) => (/opus|sonnet|haiku|fable/i.exec(m)?.[0] ?? m).toLowerCase()

type Line = { id: string; prefix: string; row: Row }

// Depth-first walk: roots are agents whose parent is absent (main) or no longer live.
const layout = (all: Row[]): Line[] => {
  const ids = new Set(all.map(r => r.id))
  const kids = new Map<string, Row[]>()
  const roots: Row[] = []

  for (const r of all) {
    if (r.parentId && ids.has(r.parentId)) {
      kids.set(r.parentId, [...(kids.get(r.parentId) ?? []), r])
    } else {
      roots.push(r)
    }
  }

  const out: Line[] = []
  const walk = (r: Row, indent: string, isLast: boolean, isRoot: boolean) => {
    out.push({ id: r.id, prefix: isRoot ? '' : indent + (isLast ? '└── ' : '├── '), row: r })
    const next = isRoot ? '' : indent + (isLast ? '    ' : '│   ')
    const list = kids.get(r.id) ?? []
    list.forEach((k, i) => walk(k, next, i === list.length - 1, false))
  }
  roots.forEach(r => walk(r, '', true, true))

  return out
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    let last = ''
    let lastParents = ''
    const parentsFile = `${(await $.env.get('HOME')) ?? ''}/${PARENTS_PATH}`

    $.clock.every(1000, async () => {
      const list = await $.agent.list()
      // Bridge for the subagent status line, which gets no parent ids of its own.
      const parents = JSON.stringify(Object.fromEntries(list.filter(a => a.parentId).map(a => [a.id, a.parentId])))

      if (parents !== lastParents) {
        lastParents = parents
        await $.fs.write(parentsFile, parents)
      }

      const live = new Set(list.filter(a => LIVE.has(a.status)).map(a => a.id))
      // A finished parent stays in the tree while one of its descendants is still live.
      const byId = new Map(list.map(a => [a.id, a]))
      const keep = new Set(live)
      for (const id of live) {
        let p = byId.get(id)?.parentId
        while (p && !keep.has(p)) {
          keep.add(p)
          p = byId.get(p)?.parentId
        }
      }
      const snapshot: Row[] = list
        .filter(a => keep.has(a.id))
        .map(a => ({
          id: a.id,
          parentId: a.parentId,
          label: a.name ?? a.description ?? a.type,
          type: a.type,
          model: a.model ? familyOf(a.model) : 'inherit',
          status: a.status,
        }))
      const key = JSON.stringify(snapshot)

      if (key !== last) {
        last = key
        await update($, rows, () => snapshot)
      }
    })

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const all = await read($, rows)

    if (e.props.hasSurvey || all.length === 0) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)
    const lines = layout(all)

    return (
      <Box flexDirection="column">
        {lines.map(l => (
          <Text key={l.id}>
            <Text dimColor>{l.prefix}</Text>
            <Text bold>{ICON[l.row.status] ?? '·'} {l.row.label}</Text>
            <Text dimColor> {l.row.type} · {l.row.model}{LIVE.has(l.row.status) ? '' : ' · ' + l.row.status}</Text>
          </Text>
        ))}
      </Box>
    )
  })
}
