/**
 * 方案 B quantified: the parameterized index summary. These tests pin both
 * the field-selection behavior AND the token budget the shared-analysis
 * redesign relies on (character counts proxy token counts, since prompt
 * size is what the model actually consumes).
 */
import { describe, it, expect, vi } from 'vitest'
vi.mock('@deepseek-ai/dsh-llm', () => ({ createUserMessage: () => ({}) }))
import type { CodeIndexResult, CodePackage } from '@deepseek-ai/dsh-code-index'
import { indexSummary } from '../src/docsgen.ts'

/** 60-package fixture with realistic long npm dependency names. */
function largeIndex(): CodeIndexResult {
  const packages: CodePackage[] = []
  for (let i = 0; i < 60; i += 1) {
    const id = `pkg-${i}`
    packages.push({
      id,
      path: `/ws/packages/${id}`,
      language: 'typescript',
      deps: [
        `@deepseek-ai/dsh-very-long-package-name-${i}`,
        `@scope/reasonably-long-dep-${i}`,
        `some-toolkit-${i}`,
        `another-dependency-${i}`,
        `yet-another-module-${i}`,
        `final-dependency-${i}`,
      ],
      entities: ['Service', 'Runner', 'Store', 'Client', 'Handler', 'Engine', 'Parser', 'Resolver'].map(name => ({
        name, kind: 'class' as const, file: `packages/${id}/src/index.ts`, line: 1,
      })),
      imports: [],
      entryFiles: i === 0 ? [`packages/${id}/src/index.ts`] : [],
    })
  }
  return { root: '/ws', language: 'typescript', packages }
}

describe('indexSummary field selection', () => {
  const index = largeIndex()

  it('includes all three fields by default (docs sections still need deps)', () => {
    const summary = indexSummary(index)
    expect(summary).toContain('依赖:')
    expect(summary).toContain('顶层实体:')
    expect(summary).toContain('入口:')
  })

  it('drops the deps field on demand (core/seq/interaction/flow calls)', () => {
    const summary = indexSummary(index, { fields: { deps: false } })
    expect(summary).not.toContain('依赖:')
    expect(summary).toContain('顶层实体:')
    expect(summary).toContain('入口:')
  })

  it('filters to an explicit package subset (figures call = core only)', () => {
    const summary = indexSummary(index, { packages: ['pkg-0', 'pkg-1'], fields: { deps: false } })
    expect(summary).toContain('pkg-0')
    expect(summary).toContain('pkg-1')
    expect(summary).not.toContain('pkg-2')
  })

  it('caps lines at maxPackages', () => {
    const summary = indexSummary(index, { maxPackages: 3 })
    expect(summary.split('\n').length).toBe(3)
  })

  it('caps deps per package at maxDeps', () => {
    const summary = indexSummary(index, { maxDeps: 2 })
    for (const line of summary.split('\n')) {
      const deps = /依赖: ([^；]*)/.exec(line)?.[1] ?? ''
      expect(deps.split(', ').length).toBeLessThanOrEqual(2)
    }
  })
})

describe('indexSummary method-level mode (🔬 switch)', () => {
  it('adds per-class method names and the real call-edge block', () => {
    const index: CodeIndexResult = {
      root: '/ws', language: 'typescript',
      packages: [{
        id: 'svc', path: '/ws/packages/svc', language: 'typescript',
        deps: [], imports: [], entryFiles: ['src/index.ts'],
        entities: [
          { name: 'Api', kind: 'class', file: 'packages/svc/src/api.ts', line: 1, children: [
            { name: 'handle', kind: 'method', file: 'packages/svc/src/api.ts', line: 5 },
            { name: 'validate', kind: 'method', file: 'packages/svc/src/api.ts', line: 9 },
          ] },
        ],
      }],
      calls: [
        { fromFile: 'packages/svc/src/api.ts', from: 'Api.handle', to: 'Repo.save', line: 6 },
      ],
    }
    const base = indexSummary(index, { fields: { deps: false } })
    expect(base).not.toContain('方法:')
    expect(base).not.toContain('真实调用边')

    const detailed = indexSummary(index, { fields: { deps: false }, methods: true })
    expect(detailed).toContain('方法:')
    expect(detailed).toContain('Api{handle, validate}')
    expect(detailed).toContain('真实调用边')
    expect(detailed).toContain('Api.handle → Repo.save（packages/svc/src/api.ts:6）')
  })

  it('drops call edges without a resolvable caller symbol', () => {
    const index: CodeIndexResult = {
      root: '/ws', language: 'typescript',
      packages: [{
        id: 'svc', path: '/ws/packages/svc', language: 'typescript',
        deps: [], imports: [], entryFiles: ['src/index.ts'], entities: [],
      }],
      calls: [
        { fromFile: 'packages/svc/src/a.ts', to: 'dynamicCall' }, // no `from`
      ],
    }
    const detailed = indexSummary(index, { fields: { deps: false }, methods: true })
    expect(detailed).not.toContain('真实调用边')
  })
})

describe('方案 A+B token budget (character-count proxy)', () => {
  it('shared-analysis prompts cost well under half of the legacy per-chain summaries', () => {
    const index = largeIndex()
    const full = indexSummary(index)
    const trimmed = indexSummary(index, { fields: { deps: false } })
    const coreOnly = indexSummary(index, { packages: ['pkg-0', 'pkg-1', 'pkg-2', 'pkg-3'], fields: { deps: false } })

    // New scheme: one structure call over the trimmed 60-package summary +
    // one figures call over the core-only subset (≤25 packages).
    const newChars = trimmed.length + coreOnly.length

    // Legacy scheme: the same full summary was re-sent by every independent
    // LLM context on the automatic load path — seq (×2, code and flow views),
    // flow induction, core pick, interaction induction (5 calls); the concept
    // fallback used entryLines (~30 packages ≈ 0.5 full) instead, which this
    // baseline conservatively OMITS so the legacy figure is understated.
    const legacyCalls = 5
    const legacyChars = legacyCalls * full.length

    // eslint-disable-next-line no-console
    console.log(`[summary-budget] full=${full.length} trimmed=${trimmed.length} coreOnly=${coreOnly.length}`)
    // eslint-disable-next-line no-console
    console.log(`[summary-budget] legacy≈${legacyChars} chars over ${legacyCalls} calls; shared≈${newChars} chars over 2 calls; saving=${Math.round((1 - newChars / legacyChars) * 100)}%`)

    expect(trimmed.length).toBeLessThan(full.length * 0.6) // 依赖字段占大头
    expect(coreOnly.length).toBeLessThan(full.length * 0.1) // 4/60 包子集
    expect(newChars).toBeLessThan(legacyChars * 0.5) // 总体省 >50%，实际约 90%
  })

  it('legacy summary re-sent per chain while the shared one is sent once', () => {
    const index = largeIndex()
    const full = indexSummary(index)
    const trimmed = indexSummary(index, { fields: { deps: false } })
    // Per-LLM-call budget: legacy sends the whole summary every time; the
    // structure call sends the trimmed summary and the figures call only the
    // core subset — each call must stay strictly below one full summary.
    expect(trimmed.length).toBeLessThan(full.length)
    const coreOnly = indexSummary(index, { packages: ['pkg-0', 'pkg-1', 'pkg-2', 'pkg-3'], fields: { deps: false } })
    expect(coreOnly.length).toBeLessThan(full.length)
  })
})
