/**
 * Record restart intent BEFORE a live DSH web restart. The agent writes this
 * so the next session can detect "the process was restarted", read the log,
 * and report success or failure.
 *
 * Usage: node scripts/record-restart.mjs [launchCmd...]
 * Writes ~/.dsh/restart-state.json (phase=prepared) and ~/.dsh/boot.json
 * (the boot observed before the restart).
 */

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const home = homedir()
const dshHome = process.env.DSH_HOME ?? join(home, '.dsh')
mkdirSync(dshHome, { recursive: true })

const statePath = join(dshHome, 'restart-state.json')
const bootPath = join(dshHome, 'boot.json')
const logPath = join(dshHome, 'dsh-web.log')

/** Short build fingerprint of the arch-lens host artifacts. */
function buildFingerprint() {
  const candidates = [
    'packages/extensions/arch-lens-backend/lib/typert.remote-client.js',
    'packages/extensions/arch-lens-backend/lib/index.js',
    'packages/extensions/arch-lens-backend/lib/typert.host.js',
  ]
  const parts = []
  for (const rel of candidates) {
    const file = join(process.cwd(), rel)
    if (existsSync(file)) {
      const digest = createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 12)
      parts.push(`${rel.split('/').at(-1)}:${digest}`)
    }
  }
  return parts.join(' ')
}

const now = new Date()
const state = {
  phase: 'prepared',
  target: { build: buildFingerprint() },
  preflight: { smoke: 'to-be-run' },
  launchCmd: process.argv.slice(2).join(' '),
  logPath,
  attempts: 0,
  at: now.toISOString(),
}
writeFileSync(statePath, JSON.stringify(state, null, 2))

const boot = {
  pid: Number(process.env.DSH_WEB_PID ?? '0'),
  startedAt: now.toISOString(),
  build: buildFingerprint(),
}
writeFileSync(bootPath, JSON.stringify(boot, null, 2))

console.log(`record-restart: wrote ${statePath}`)
console.log(`  build: ${state.target.build}`)
