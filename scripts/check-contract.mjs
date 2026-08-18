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

if (missing.length === 0 && stale.length === 0) {
  console.log('[check-contract] OK — harness api-remotes bundle is in sync with this repo.')
  process.exit(0)
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
