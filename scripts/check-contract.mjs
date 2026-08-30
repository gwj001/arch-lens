/**
 * Remote contract check: repo @Remote wires vs the inlined codec table of the
 * standalone client bundle that actually serves the desk.
 * When to run and how to sync: see scripts/scripts.md. Exit 0 = in sync.
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

// The real runtime contract carrier: the browser bundle inlines the generated
// typert remote-client (zod codecs). The harness no longer carries archLens.
const backendSrc = join(root, 'packages', 'arch-lens-backend', 'src', 'index.ts')
const clientBundle = join(root, 'packages', 'client-arch-lens', 'lib', 'client.js')

function remoteWires(src) {
  const set = new Set()
  const re = /@Remote\(\s*'([A-Za-z0-9_$-]+)'\s*\)/g
  let m
  while ((m = re.exec(src)) !== null) set.add(m[1])
  return set
}

/** Methods present in the client bundle's inlined archLens codec table. */
function inlinedMethods(bundle) {
  const set = new Set()
  const re = /_deepseek_ai_dsh_arch_lens_backend_archLens_([A-Za-z0-9_$-]+)_(?:parameter_0|result)\$schema/g
  let m
  while ((m = re.exec(bundle)) !== null) set.add(m[1])
  return set
}

if (!existsSync(backendSrc)) {
  console.error(`[check-contract] backend src not found: ${backendSrc}`)
  process.exit(2)
}
if (!existsSync(clientBundle)) {
  console.error(`[check-contract] client bundle not found: ${clientBundle}`)
  console.error('  run pnpm build first (the client face emits lib/client.js).')
  process.exit(2)
}

const wires = remoteWires(readFileSync(backendSrc, 'utf8'))
const inlined = inlinedMethods(readFileSync(clientBundle, 'utf8'))

const missing = [...wires].filter(w => !inlined.has(w)) // bundle lags
const stale = [...inlined].filter(m => !wires.has(m)) // bundle carries dead methods

console.log(`[check-contract] src @Remote wires : ${[...wires].sort().join(', ') || '(none)'}`)
console.log(`[check-contract] client bundle     : ${[...inlined].sort().join(', ') || '(none)'}`)

// Schema-shape spot check: a Remote's VALUE STRUCTURE change (not just a
// rename) also lands in the bundle — the archLens_*_result$schema constants
// are inlined at build time, so e.g. a result that became { source, messages }
// still validates against the old array schema on the wire and the client
// silently drops the data. Probe one known structure: the sequence result
// must carry the `source` provenance field.
const schemaProbe = /archLens_sequence_result\$schema = union\(([\s\S]*?)\);\n\s*const _deepseek_ai_dsh_arch_lens_backend_archLens_setSession/
  .exec(readFileSync(clientBundle, 'utf8'))
const schemaLag = schemaProbe !== null && schemaProbe[1] !== undefined && !schemaProbe[1].includes('"source"')

if (missing.length === 0 && stale.length === 0 && !schemaLag) {
  console.log('[check-contract] OK - the client bundle is in sync with this repo.')
  process.exit(0)
}

if (schemaLag) {
  console.error('[check-contract] LAG - the inlined archLens_sequence result schema is stale (missing the "source" field).')
  console.error('  Value-structure changes need the repo rebuild, not just the wire names.')
}

if (missing.length > 0) {
  console.error(`[check-contract] LAG - client bundle lacks: ${missing.join(', ')}`)
  console.error('  The desk will crash with "archLens.<method> is not a function".')
}
if (stale.length > 0) {
  console.warn(`[check-contract] STALE - client bundle still carries: ${stale.join(', ')}`)
}

console.error(`
[check-contract] To sync: rebuild the repo (regenerates the typert artifacts
  and the client bundle that inlines them):
    cd ${root} && pnpm build
  then re-run this check.`)
process.exit(1)