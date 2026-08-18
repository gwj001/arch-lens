/**
 * Unit tests for mermaid diagram generation: package-level import edge
 * aggregation (relative/bare/normalized specifiers, self-import and external
 * filtering), group labels for flat layouts, and the pure diagram builders.
 */
import { describe, it, expect } from 'vitest'
import {
  coreErDiagram,
  coreFlowchart,
  dependencyFlowchart,
  entityErDiagram,
  importEdges,
  importFlowchart,
  packageErDiagram,
} from '../src/mermaid.ts'
import { groupLabel } from '../src/types.ts'
import type { ArchLensGraph } from '../src/types.ts'
import type { CodeIndexResult } from '@deepseek-ai/dsh-code-index'

function index(packages: CodeIndexResult['packages']): CodeIndexResult {
  return { root: '/ws', language: 'typescript', packages }
}

/** One package with imports, minimal shape. */
function pkg(id: string, imports: CodeIndexResult['packages'][number]['imports']): CodeIndexResult['packages'][number] {
  return { id, path: `/ws/packages/${id}`, language: 'typescript', deps: [], entities: [], entryFiles: [], imports }
}

describe('groupLabel', () => {
  it('maps the flat-layout empty group to packages', () => {
    expect(groupLabel('')).toBe('packages')
    expect(groupLabel('core')).toBe('core')
  })
})

describe('importEdges', () => {
  it('resolves relative and bare specifiers and drops externals', () => {
    const idx = index([
      pkg('a', [
        { from: 'packages/a/src/index.ts', to: 'packages/b', names: [] },
        { from: 'packages/a/src/util.ts', to: './b', names: [] },
        { from: 'packages/a/src/x.ts', to: 'external-lib', names: [] },
      ]),
      pkg('b', []),
    ])
    const edges = importEdges(idx)
    expect(edges.get('a')).toEqual(['b'])
    expect(edges.get('b')).toBeUndefined()
  })

  it('normalizes the dsh- prefix on bare specifiers', () => {
    const idx = index([
      pkg('a', [{ from: 'packages/a/src/index.ts', to: '@deepseek-ai/dsh-b', names: [] }]),
      pkg('b', []),
    ])
    expect(importEdges(idx).get('a')).toEqual(['b'])
  })

  it('filters self-imports', () => {
    const idx = index([
      pkg('a', [
        { from: 'packages/a/src/index.ts', to: './a', names: [] },
        { from: 'packages/a/src/index.ts', to: 'a', names: [] },
      ]),
    ])
    // The entry survives with an empty target list (self-edges filtered out).
    expect(importEdges(idx).get('a')).toEqual([])
  })
})

describe('dependencyFlowchart', () => {
  const graph: ArchLensGraph = {
    root: '/ws',
    groups: ['core', ''],
    nodes: [
      { id: 'a', short: 'a', group: 'core', blurb: '', files: [], deps: ['b'], path: '/ws/packages/core/a', detail: { id: 'a', short: 'a', group: 'core', blurb: '', files: [], deps: ['b'], dependents: [], snippet: '', keyLines: [] } },
      { id: 'b', short: 'b', group: '', blurb: '', files: [], deps: [], path: '/ws/packages/b', detail: { id: 'b', short: 'b', group: '', blurb: '', files: [], deps: [], dependents: [], snippet: '', keyLines: [] } },
    ],
    edges: [{ from: 'a', to: 'b' }],
  }

  it('groups by subgraph and renders the flat group as packages', () => {
    const src = dependencyFlowchart(graph)
    expect(src.startsWith('flowchart TD')).toBe(true)
    expect(src).toContain('subgraph g_core["core"]')
    expect(src).toContain('subgraph g_packages["packages"]')
    expect(src).toContain('a --> b')
  })

  it('deduplicates repeated edges', () => {
    const src = dependencyFlowchart({ ...graph, edges: [{ from: 'a', to: 'b' }, { from: 'a', to: 'b' }] })
    expect(src.match(/a --> b/g)).toHaveLength(1)
  })
})

describe('packageErDiagram', () => {
  it('emits entities with the flat group labelled packages', () => {
    const graph: ArchLensGraph = {
      root: '/ws', groups: [''], nodes: [
        { id: 'b', short: 'b', group: '', blurb: '', files: [], deps: [], path: '/ws/packages/b', detail: { id: 'b', short: 'b', group: '', blurb: '', files: [], deps: [], dependents: [], snippet: '', keyLines: [] } },
      ], edges: [],
    }
    const src = packageErDiagram(graph)
    expect(src.startsWith('erDiagram')).toBe(true)
    expect(src).toContain('string group "packages"')
  })
})

describe('indexed diagrams', () => {
  const idx = index([
    pkg('a', [{ from: 'packages/a/src/index.ts', to: 'b', names: [] }]),
    pkg('b', []),
  ])

  it('importFlowchart groups by language and draws edges', () => {
    const src = importFlowchart(idx)
    expect(src.startsWith('flowchart TD')).toBe(true)
    expect(src).toContain('subgraph g_typescript["typescript"]')
    expect(src).toContain('a --> b')
  })

  it('entityErDiagram draws package entities and imports relationships', () => {
    const src = entityErDiagram(idx)
    expect(src.startsWith('erDiagram')).toBe(true)
    expect(src).toContain('a ||--o{ b : imports')
  })

  it('core diagrams restrict edges and entities to the selected ids', () => {
    const flow = coreFlowchart(idx, ['a'])
    expect(flow).toContain('subgraph g_typescript["typescript"]') // a is selected, its group stays
    expect(flow).not.toContain('a --> b') // b not selected, so no edge
    const er = coreErDiagram(idx, ['a'])
    expect(er).toContain('a {')
    expect(er).not.toContain('b {')
  })
})
