/**
 * Shadow smoke test for the DSH web service: boots a one-shot web instance
 * on a free port, polls HTTP until it answers (or times out), then shuts it
 * down. Run BEFORE a live restart to catch boot-time failures (module
 * resolution, plugin apply errors, config mistakes) while the live service
 * is untouched.
 *
 * Readiness is detected by HTTP polling, NOT by stdout: node buffers console
 * output when it is redirected to a pipe, so the `dsh web:` line may not
 * arrive until exit.
 *
 * Usage: node scripts/smoke-web.mjs [extra args...]
 * Exit code 0 = smoke passed; 1 = failed (reason printed, log tail included).
 */

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createServer } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const READY_TIMEOUT_MS = 120_000
const CANDIDATE_PORTS = Array.from({ length: 10 }, (_, i) => 3101 + i)

/** Find a free local port. */
async function freePort(candidates) {
  for (const port of candidates) {
    const free = await new Promise(resolve => {
      const server = createServer()
      server.once('error', () => resolve(false))
      server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)))
    })
    if (free) return port
  }
  throw new Error('no free smoke port in 3101..3110')
}

/** Probe the root path of the candidate service. */
async function probe(port) {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)
    const response = await fetch(`http://127.0.0.1:${port}/`, { signal: controller.signal })
    clearTimeout(timer)
    return response.ok
  } catch {
    return false
  }
}

const port = await freePort(CANDIDATE_PORTS)
// Isolated DSH_HOME: the smoke instance must not share sessions/storage with
// the live service, or boot can stall on concurrent state access.
const scratchHome = mkdtempSync(join(tmpdir(), 'dsh-smoke-'))
const child = spawn(
  process.execPath,
  ['--import', 'tsx/esm', 'apps/cli/src/bin.ts', 'web', '--port', String(port), ...process.argv.slice(2)],
  { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, DSH_HOME: scratchHome } },
)

let output = ''
let settled = false
child.stdout.on('data', chunk => { output += chunk.toString() })
child.stderr.on('data', chunk => { output += chunk.toString() })

const exit = new Promise(resolve => child.on('exit', code => { settled = true; resolve(code ?? null) }))

// Poll until ready, the child exits early, or the deadline passes.
let ready = false
const deadline = Date.now() + READY_TIMEOUT_MS
while (Date.now() < deadline) {
  if (settled) break
  if (await probe(port)) { ready = true; break }
  await new Promise(r => setTimeout(r, 2000))
}

if (ready) {
  // Prove stability for a few seconds, then stop.
  await new Promise(r => setTimeout(r, 3000))
  if (!settled) child.kill('SIGTERM')
  await exit
  rmSync(scratchHome, { recursive: true, force: true })
  console.log(`smoke-web: PASS on port ${port}`)
  process.exit(0)
}

const exitCode = await Promise.race([exit, new Promise(r => setTimeout(() => r('alive'), 1000))])
console.log(`smoke-web: FAIL port=${port} earlyExit=${String(exitCode)} ready=${ready}`)
if (!settled) child.kill('SIGKILL')
rmSync(scratchHome, { recursive: true, force: true })
const tail = output.split('\n').filter(Boolean).slice(-25).join('\n')
if (tail !== '') {
  console.log('--- output tail ---')
  console.log(tail)
}
process.exit(1)
