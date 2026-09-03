/**
 * Integration tests for the language-aware workspace scan (scanWorkspace)
 * over the in-memory FakeFs: every layout the scan must partition —
 * TypeScript monorepo (byte-identical legacy shape) + root fallback, python
 * multi-dist / src-layout single-dist split / flat / uv-workspace, java
 * maven multi-module (aggregator excluded, pom dependency edges, feign
 * edges) + single-module Spring layers with the 1a annotation profile, and
 * the unknown single-node fallback. The original "no packages/ dir → scan
 * failed" report is covered by the TypeScript root-fallback case.
 */
import { describe, it, expect } from 'vitest'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import { FakeFs } from './fake-fs.ts'
import { scanWorkspace } from '../src/scan.ts'
import { computeChangedPackages } from '../src/change-pack.ts'
import type { ArchLensGraph } from '../src/types.ts'
import type { WorkspaceFileChanges } from '../src/manifest.ts'

/** Run scanWorkspace over a FakeFs seeded with `init` (rel keys under `root`). */
async function scan(init: Record<string, string>, root = 'ws'): Promise<ArchLensGraph> {
  const fs = new FakeFs(init)
  const result = await scanWorkspace(fs as unknown as FileSystem, root)
  expect('error' in result).toBe(false)
  return result as ArchLensGraph
}

const sorted = (items: readonly string[]): string[] => [...items].sort()
const sortedEdges = (graph: ArchLensGraph): string[] =>
  graph.edges.map(edge => `${edge.from}->${edge.to}`).sort()

describe('scanWorkspace · typescript (legacy layout untouched)', () => {
  it('grouped monorepo: identical ids/groups/blurbs/deps, NO lang field', async () => {
    const graph = await scan({
      'ws/package.json': JSON.stringify({ name: 'root', private: true }),
      'ws/packages/group-a/p1/package.json': JSON.stringify({
        name: '@deepseek-ai/dsh-p1', description: 'One', peerDependencies: { '@deepseek-ai/dsh-p2': '*' },
      }),
      'ws/packages/group-a/p1/src/index.ts': 'export const a = 1',
      'ws/packages/group-b/p2/package.json': JSON.stringify({ name: '@deepseek-ai/dsh-p2' }),
      'ws/packages/group-b/p2/src/index.ts': 'export const b = 2',
      'ws/packages/group-b/p2/README.md': '# P2\n\nSecond line',
    })
    expect(graph.lang).toBeUndefined()
    expect(sorted(graph.nodes.map(node => node.id))).toEqual(['p1', 'p2'])
    expect(graph.groups).toEqual(['group-a', 'group-b'])
    const p1 = graph.nodes.find(node => node.id === 'p1')!
    expect(p1.group).toBe('group-a')
    expect(p1.blurb).toBe('One')
    expect(p1.lang).toBeUndefined()
    expect(p1.deps).toEqual(['p2'])
    expect(p1.detail.snippet).toContain('export const a = 1')
    const p2 = graph.nodes.find(node => node.id === 'p2')!
    expect(p2.blurb).toBe('Second line') // README paragraph fallback (no description)
    expect(sortedEdges(graph)).toEqual(['p1->p2'])
  })

  it('flat packages/<pkg> layout: group empty', async () => {
    const graph = await scan({
      'ws/package.json': JSON.stringify({ name: 'root', private: true }),
      'ws/packages/pk/package.json': JSON.stringify({ name: '@deepseek-ai/dsh-pk', description: 'Pk' }),
      'ws/packages/pk/src/index.ts': 'export {}',
    })
    expect(graph.nodes.map(node => node.id)).toEqual(['pk'])
    expect(graph.nodes[0]!.group).toBe('')
    expect(graph.nodes[0]!.lang).toBeUndefined()
  })

  it('no packages/ dir, root package.json: single fallback node (was: scan failed)', async () => {
    const graph = await scan({
      'ws/package.json': JSON.stringify({ name: 'web-app', description: 'Single app' }),
      'ws/src/index.ts': 'console.log(1)',
    })
    expect(graph.nodes).toHaveLength(1)
    const node = graph.nodes[0]!
    expect(node.id).toBe('web-app')
    expect(node.lang).toBe('typescript')
    expect(graph.lang).toBe('typescript')
    expect(node.files).toEqual(['index.ts'])
  })
})

describe('scanWorkspace · python', () => {
  it('multi-distribution workspace (uv style, root config only): one node per dist', async () => {
    const graph = await scan({
      'ws/pyproject.toml': '[tool.uv]\nmembers = ["libs/*"]\n',
      'ws/libs/core/pyproject.toml': '[project]\nname = "core-lib"\n',
      'ws/libs/core/core_lib/__init__.py': 'x = 1',
      'ws/libs/core/core_lib/mod.py': 'def f(): pass',
      'ws/libs/a/pyproject.toml': '[project]\nname = "a-lib"\n',
      'ws/libs/a/a_lib/__init__.py': 'y = 2',
    })
    expect(graph.lang).toBe('python')
    expect(sorted(graph.nodes.map(node => node.id))).toEqual(['a-lib', 'core-lib'])
    expect(graph.nodes.every(node => node.group === '' && node.lang === 'python')).toBe(true)
  })

  it('single dist with ONE code unit NOT at root: that unit is the node', async () => {
    const graph = await scan({
      'ws/pyproject.toml': '[tool.uv]\n',
      'ws/libs/only/pyproject.toml': '[project]\nname = "only-lib"\n',
      'ws/libs/only/src/only/__init__.py': '',
      'ws/libs/only/src/only/work.py': 'def work(): pass',
    })
    expect(graph.nodes.map(node => node.id)).toEqual(['only-lib'])
  })

  it('src-layout single dist with import-package children (agent-framework style): split', async () => {
    const graph = await scan({
      'ws/pyproject.toml': '[project]\nname = "agents"\n',
      'ws/src/agents/__init__.py': '',
      'ws/src/agents/models/__init__.py': '',
      'ws/src/agents/models/llm.py': 'class LLM: pass',
      'ws/src/agents/run/__init__.py': '',
      'ws/src/agents/run/run.py': 'def run(): pass',
      'ws/src/agents/tools/__init__.py': '',
      'ws/src/agents/tools/search.py': 'def search(): pass',
      'ws/src/agents/guardrails/__init__.py': '',
      'ws/src/agents/guardrails/g.py': 'def guard(): pass',
    })
    expect(graph.lang).toBe('python')
    expect(sorted(graph.nodes.map(node => node.id))).toEqual(['guardrails', 'models', 'run', 'tools'])
    const models = graph.nodes.find(node => node.id === 'models')!
    expect(models.files).toEqual(['__init__.py', 'llm.py'])
  })

  it('flat single dist without import-package children: one node named from pyproject', async () => {
    const graph = await scan({
      'ws/pyproject.toml': '[project]\nname = "demo"\n',
      'ws/demo_pkg/__init__.py': '',
      'ws/demo_pkg/main.py': 'print(1)',
    })
    expect(graph.nodes).toHaveLength(1)
    expect(graph.nodes[0]!.id).toBe('demo')
    // Node files are relative to the node dir (the repo root here).
    expect(graph.nodes[0]!.files).toContain('demo_pkg/main.py')
  })
})

describe('scanWorkspace · java (Spring 生态)', () => {
  it('maven multi-module: aggregator excluded, module nodes, pom edges, no plugin/parent false edges', async () => {
    const graph = await scan({
      'ws/pom.xml': '<project><groupId>g</groupId><artifactId>parent</artifactId><packaging>pom</packaging>'
        + '<modules><module>gateway</module><module>order-service</module><module>common</module></modules></project>',
      'ws/gateway/pom.xml': '<project><parent><artifactId>parent</artifactId></parent><artifactId>gateway</artifactId>'
        + '<dependencies><dependency><groupId>x</groupId><artifactId>common</artifactId></dependency></dependencies>'
        + '<build><plugins><plugin><artifactId>spring-boot-maven-plugin</artifactId></plugin></plugins></build></project>',
      'ws/gateway/src/main/java/com/x/gateway/GatewayApplication.java':
        'package com.x.gateway;\n@SpringBootApplication\npublic class GatewayApplication {}',
      'ws/order-service/pom.xml': '<project><parent><artifactId>parent</artifactId></parent><artifactId>order-service</artifactId>'
        + '<dependencies><dependency><artifactId>common</artifactId></dependency></dependencies></project>',
      'ws/order-service/src/main/java/com/x/order/OrderApplication.java':
        'package com.x.order;\n@SpringBootApplication\npublic class OrderApplication {}',
      'ws/order-service/src/main/java/com/x/order/client/OrderClient.java':
        'package com.x.order.client;\n@FeignClient("gateway")\npublic interface OrderClient {}',
      'ws/common/pom.xml': '<project><artifactId>common</artifactId></project>',
      'ws/common/src/main/java/com/x/common/Util.java': 'package com.x.common;\npublic final class Util {}',
    })
    expect(graph.lang).toBe('java')
    expect(sorted(graph.nodes.map(node => node.id))).toEqual(['common', 'gateway', 'order-service'])
    expect(graph.nodes.every(node => node.group === '' && node.lang === 'java')).toBe(true)
    // plugin/parent ids must NOT create edges; common dependency edges do.
    expect(sortedEdges(graph)).toEqual(['gateway->common', 'order-service->common', 'order-service->gateway'])
    const gateway = graph.nodes.find(node => node.id === 'gateway')!
    expect(gateway.detail.files[0]!.name).toContain('GatewayApplication.java')
  })

  it('single-module Spring app: entry node + first-level layer nodes with 1a profile', async () => {
    const graph = await scan({
      'shop-app/pom.xml': '<project><artifactId>shop-app</artifactId></project>',
      'shop-app/README.md': '# Shop App\n\nShop backend service.',
      'shop-app/src/main/java/com/example/shop/ShopApplication.java':
        'package com.example.shop;\nimport org.springframework.boot.autoconfigure.SpringBootApplication;\n'
        + '@SpringBootApplication\npublic class ShopApplication { public static void main(String[] args) {} }',
      'shop-app/src/main/java/com/example/shop/config/SecurityConfig.java':
        'package com.example.shop.config;\n@Configuration\npublic class SecurityConfig {}',
      'shop-app/src/main/java/com/example/shop/controller/OrderController.java':
        'package com.example.shop.controller;\n@RestController\npublic class OrderController {\n'
        + '@GetMapping("/orders")\npublic String list() { return "ok"; }\n}',
      'shop-app/src/main/java/com/example/shop/service/OrderService.java':
        'package com.example.shop.service;\n@Service\npublic class OrderService {}',
      'shop-app/src/main/java/com/example/shop/repository/OrderRepository.java':
        'package com.example.shop.repository;\n@Repository\npublic interface OrderRepository {}',
      'shop-app/src/main/java/com/example/shop/event/OrderListener.java':
        'package com.example.shop.event;\n@EventListener\npublic class OrderListener {}',
    }, 'shop-app')
    expect(graph.lang).toBe('java')
    const ids = sorted(graph.nodes.map(node => node.id))
    expect(ids).toEqual(['config', 'controller', 'event', 'repository', 'service', 'shop-app'])
    expect(ids).toContain('shop-app')
    const app = graph.nodes.find(node => node.id === 'shop-app')!
    expect(app.spring?.main).toBe('ShopApplication')
    expect(app.files).toEqual(['ShopApplication.java'])
    const controller = graph.nodes.find(node => node.id === 'controller')!
    expect(controller.spring?.stereotypes).toContain('RestController')
    expect(controller.spring?.endpoints).toContain('/orders')
    const service = graph.nodes.find(node => node.id === 'service')!
    expect(service.spring?.stereotypes).toContain('Service')
    // Entry snippet carries the main class annotation line (keyLines sample).
    expect(app.detail.snippet).toContain('@SpringBootApplication')
  })
})

describe('scanWorkspace · unknown & regression', () => {
  it('unknown language (no manifests): single root node, never errors', async () => {
    const graph = await scan({
      'ws/README.md': '# Tools\n\nFirst paragraph.',
      'ws/tool/main.go': 'package main',
    })
    expect(graph.lang).toBe('unknown')
    expect(graph.nodes).toHaveLength(1)
    expect(graph.nodes[0]!.id).toBe('ws')
    expect(graph.nodes[0]!.blurb).toBe('First paragraph.')
  })
})

describe('computeChangedPackages · non-packages paths (python/java layers)', () => {
  const fileChanges = (modified: string[]): WorkspaceFileChanges => ({
    changed: modified.length > 0, changedFiles: [...modified], added: [], modified, removed: [],
  })

  it('maps java layer files to the deepest owning node', () => {
    const nodes = [
      { id: 'shop-app', path: '/ws/src/main/java/com/example/shop' },
      { id: 'config', path: '/ws/src/main/java/com/example/shop/config' },
      { id: 'controller', path: '/ws/src/main/java/com/example/shop/controller' },
    ]
    const changes = computeChangedPackages(
      fileChanges(['src/main/java/com/example/shop/config/SecurityConfig.java']),
      nodes.map(node => node.id), nodes.map(node => node.id),
      { root: '/ws', nodes },
    )
    expect(changes.changedPackages).toEqual(['config'])
    expect(changes.changedPackages).not.toContain('shop-app')
  })

  it('maps files directly under the app root to the entry node', () => {
    const nodes = [
      { id: 'shop-app', path: '/ws/src/main/java/com/example/shop' },
      { id: 'config', path: '/ws/src/main/java/com/example/shop/config' },
    ]
    const changes = computeChangedPackages(
      fileChanges(['src/main/java/com/example/shop/ShopApplication.java']),
      nodes.map(node => node.id), nodes.map(node => node.id),
      { root: '/ws', nodes },
    )
    expect(changes.changedPackages).toEqual(['shop-app'])
  })

  it('maps python src-layout files to the split child package', () => {
    const nodes = [
      { id: 'models', path: '/ws/src/agents/models' },
      { id: 'run', path: '/ws/src/agents/run' },
      { id: 'tools', path: '/ws/src/agents/tools' },
    ]
    const changes = computeChangedPackages(
      fileChanges(['src/agents/models/llm.py']),
      nodes.map(node => node.id), nodes.map(node => node.id),
      { root: '/ws', nodes },
    )
    expect(changes.changedPackages).toEqual(['models'])
  })

  it('legacy packages/ paths still resolve without context (unchanged behavior)', () => {
    const changes = computeChangedPackages(
      fileChanges(['packages/group-a/p1/src/index.ts']),
      ['p1', 'p2'], ['p1', 'p2'],
    )
    expect(changes.changedPackages).toEqual(['p1'])
  })
})
