/**
 * Unit tests for client-side explain-prompt assembly helpers (pure functions,
 * no React): repository naming, core-candidate ranking, config defaults,
 * language/evidence clauses, and template placeholder substitution.
 */
import { describe, it, expect } from 'vitest'
import {
  coreCandidates,
  defaultOverview,
  defaultStyle,
  evidenceClause,
  languageClause,
  overviewQuestion,
  repoName,
  useDefaultsConfig,
} from '../src/client/explain.ts'
import type { ArchLensGraph } from '@deepseek-ai/dsh-arch-lens-backend'

describe('repoName', () => {
  it('takes the last path segment', () => {
    expect(repoName('C:/a/b')).toBe('b')
    expect(repoName('C:/a/b/')).toBe('b')
    expect(repoName('D:\\ws\\arch-lens')).toBe('arch-lens')
    expect(repoName('')).toBe('当前代码库')
  })
})

describe('coreCandidates', () => {
  it('ranks by in-degree and respects the limit', () => {
    const graph: ArchLensGraph = {
      root: '/ws', groups: ['x'], nodes: [
        { id: 'a', short: 'a', group: 'x', blurb: '', files: [], deps: [], path: '', detail: { id: 'a', short: 'a', group: 'x', blurb: '', files: [], deps: [], dependents: [], snippet: '', keyLines: [] } },
        { id: 'b', short: 'b', group: 'x', blurb: '', files: [], deps: [], path: '', detail: { id: 'b', short: 'b', group: 'x', blurb: '', files: [], deps: [], dependents: [], snippet: '', keyLines: [] } },
        { id: 'c', short: 'c', group: 'x', blurb: '', files: [], deps: [], path: '', detail: { id: 'c', short: 'c', group: 'x', blurb: '', files: [], deps: [], dependents: [], snippet: '', keyLines: [] } },
      ],
      edges: [{ from: 'a', to: 'b' }, { from: 'c', to: 'b' }, { from: 'a', to: 'c' }],
    }
    expect(coreCandidates(graph)).toEqual(['b', 'c', 'a'])
    expect(coreCandidates(graph, 2)).toEqual(['b', 'c'])
  })
})

describe('config defaults', () => {
  it('uses defaults when no override exists and explicit useDefaults wins', () => {
    expect(useDefaultsConfig({})).toBe(true)
    expect(useDefaultsConfig({ overviewPrompt: 'x' })).toBe(false)
    expect(useDefaultsConfig({ overviewPrompt: 'x', useDefaults: true })).toBe(true)
  })

  it('switches templates by language', () => {
    expect(defaultOverview('中文')).toContain('上帝视角')
    expect(defaultOverview('English')).toContain('bird\'s-eye')
    expect(defaultStyle('中文')).toContain('只讲流程与职责')
    expect(defaultStyle('English')).toContain('flow and responsibility only')
  })
})

describe('clauses', () => {
  it('languageClause is empty for the default language', () => {
    expect(languageClause('中文')).toBe('')
    expect(languageClause('English')).toContain('English')
  })

  it('evidenceClause is empty without entries and lists them with provenance when present', () => {
    expect(evidenceClause()).toBe('')
    expect(evidenceClause([])).toBe('')
    const clause = evidenceClause([{ label: '图数据', ref: 'docs/x.md#y', text: '内容' }])
    expect(clause).toContain('【事实依据】')
    expect(clause).toContain('docs/x.md#y')
    expect(clause).toContain('内容')
  })
})

describe('overviewQuestion', () => {
  it('substitutes {root} and {core} placeholders', () => {
    const graph: ArchLensGraph = {
      root: '/ws/repo', groups: ['x'], nodes: [
        { id: 'b', short: 'b', group: 'x', blurb: '', files: [], deps: [], path: '', detail: { id: 'b', short: 'b', group: 'x', blurb: '', files: [], deps: [], dependents: [], snippet: '', keyLines: [] } },
      ], edges: [],
    }
    const q = overviewQuestion(graph, '仓库：{root}，核心：{core}', '中文')
    expect(q).toContain('仓库：repo')
    expect(q).toContain('核心：b')
  })
})
