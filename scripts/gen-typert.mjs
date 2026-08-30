/**
 * Standalone typert artifact generation (bypasses the tsdown integration),
 * emitting lib/typert.host.js + lib/typert.remote-client.js.
 * When to use: see scripts/scripts.md. Usage: node scripts/gen-typert.mjs
 */
import { WorkspaceTypertGenerator } from '@deepseek-ai/dsh-typert-generator'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const pkgRoot = join(root, 'packages/arch-lens-backend')
const outDir = join(pkgRoot, 'lib')

const generator = new WorkspaceTypertGenerator(root)
const t0 = Date.now()

// discover() finds packages contributing Typert/Remote exports; filter to ours.
const packages = generator.discover(['host'])
  .filter(candidate => candidate.package === '@deepseek-ai/dsh-arch-lens-backend')
  .map(candidate => candidate.package)

if (packages.length === 0) {
  console.error('gen-typert: backend package not discovered')
  process.exit(1)
}

const artifacts = generator.generate(packages, ['host'])
mkdirSync(outDir, { recursive: true })
for (const artifact of artifacts) {
  writeFileSync(join(outDir, `typert.${artifact.face}.js`), artifact.js)
  writeFileSync(join(outDir, `typert.${artifact.face}.d.ts`), artifact.dts)
  if (artifact.remote !== undefined) {
    writeFileSync(join(outDir, 'typert.remote-client.js'), artifact.remote.js)
    writeFileSync(join(outDir, 'typert.remote-client.d.ts'), artifact.remote.dts)
    writeFileSync(join(outDir, 'typert.remote-client.d.ts.map'), artifact.remote.dtsMap)
  }
}
console.log(`gen-typert: wrote ${artifacts.length} artifact(s) in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
