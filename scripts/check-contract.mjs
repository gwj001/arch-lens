/**
 * Contract consistency check for the standalone arch-lens repo vs the harness
 * build it feeds.
 *
 * The browser-side `ctx.remote.archLens` method table comes from the typert
 * remote-client that the HARNESS build inlines into
 * `packages/api/remotes/lib/client.js` — generated from the harness's own
 * `packages/extensions/arch-lens-backend` COPY of this repo's backend. If you
 * rename/add/remove a `@Remote` method here but the harness copy (and its
 * api-remotes bundle) is stale, the desk crashes at runtime with
 * `archLens.<method> is not a function`.
 *
 * Run this after ANY Remote contract change (before asking the user to
 * restart the harness):
 *
 *   node scripts/check-contract.mjs
 *
 * Exit 0 = contract in sync; non-zero = harness bundle lags, follow the
 * printed sync steps.
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const harnessDefault = 'D:\\dev\\project\\agent\\deepseek\\deepseek-harness'
const harness = process.argv[2] ?? harnessDefault

const backendSrc = join(root, 'packages', 'arch-lens-backend', 'src', 'index.ts')
const apiRemotesClient = join(harness, 'packages', 'api', 'remotes', 'lib', 'client.js')

function remoteWires(src) {
  const set = new Set()
  const re = /@Remote\(\s*'([A-Za-z0-9_$-]+)'\s*\)/g
  let m
  while ((m = re.exec(src)) !== null) set.add(m[1])
  return set
}

/** Methods present in the harness-inlined archLens codec table. */
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
if (!existsSync(apiRemotesClient)) {
  console.error(`[check-contract] harness api-remotes bundle not found: ${apiRemotesClient}`)
  console.error(`  pass the harness dir as argv[2] if it is not at ${harnessDefault}`)
  process.exit(2)
}

const wires = remoteWires(readFileSync(backendSrc, 'utf8'))
const inlined = inlinedMethods(readFileSync(apiRemotesClient, 'utf8'))

const missing = [...wires].filter(w => !inlined.has(w)) // harness lags
const stale = [...inlined].filter(m => !wires.has(m)) // harness carries dead methods

console.log(`[check-contract] src @Remote wires : ${[...wires].sort().join(', ') || '(none)'}`)
console.log(`[check-contract] harness inlined   : ${[...inlined].sort().join(', ') || '(none)'}`)

// Schema-shape spot check: a Remote's VALUE STRUCTURE change (not just a
// rename) also lands in the harness bundle — the archLens_*_result$schema
// constants are inlined at harness build time, so e.g. a result that became
// { source, messages } still validates against the old array schema on the
// wire and the client silently drops the data. Probe one known structure:
// the sequence result must carry the `source` provenance field.
const schemaProbe = /archLens_sequence_result\$schema = union\(([\s\S]*?)\);\n\s*const _deepseek_ai_dsh_arch_lens_backend_archLens_setSession/
  .exec(readFileSync(apiRemotesClient, 'utf8'))
const schemaLag = schemaProbe !== null && schemaProbe[1] !== undefined && !schemaProbe[1].includes('"source"')

if (missing.length === 0 && stale.length === 0 && !schemaLag) {
  console.log('[check-contract] OK — harness api-remotes bundle is in sync with this repo.')
  process.exit(0)
}

if (schemaLag) {
  console.error('[check-contract] LAG — the inlined archLens_sequence result schema is stale (missing the "source" field).')
  console.error('  Value-structure changes need the harness typert + api-remotes rebuild, not just the wire names:')
  console.error('    cd <harness> && pnpm exec tsdown --env.DSH_BUILD_FACE host && pnpm --filter @deepseek-ai/dsh-api-remotes bundle')
}

if (missing.length > 0) {
  console.error(`[check-contract] LAG — harness bundle lacks: ${missing.join(', ')}`)
  console.error('  The desk will crash with "archLens.<method> is not a function".')
}
if (stale.length > 0) {
  console.warn(`[check-contract] STALE — harness bundle still carries: ${stale.join(', ')}`)
}

console.error(`
[check-contract] To sync (in ${harness}):
  1. copy the backend src to the harness copy:
       robocopy ${join(root, 'packages', 'arch-lens-backend', 'src')} ${join(harness, 'packages', 'extensions', 'arch-lens-backend', 'src')} /MIR
  2. rebuild the harness contract + consumer bundle:
       cd ${harness} && pnpm --filter @deepseek-ai/dsh-arch-lens-backend build && pnpm --filter @deepseek-ai/dsh-api-remotes bundle
  3. restart pnpm dsh web, then re-run this check.
`)
process.exit(1)
