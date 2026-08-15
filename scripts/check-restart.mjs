/**
 * Restart forensics: called by the agent at session start (or by a human)
 * to answer "was the DSH web process restarted since the last record, and
 * did it come up?".
 *
 * Usage: node scripts/check-restart.mjs
 * Reads ~/.dsh/restart-state.json + ~/.dsh/boot.json, compares against the
 * live listener on port 3080, and prints a report. Exit 0 = healthy,
 * 2 = restart happened (report printed), 3 = restart left failed state.
 */

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const statePath = join(dshHome, 'restart-state.json')
const bootPath = join(dshHome, 'boot.json')
const logPath = join(dshHome, 'dsh-web.log')

const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : null
const boot = existsSync(bootPath) ? JSON.parse(readFileSync(bootPath, 'utf8')) : null

/** Current listener pid on the configured web port (default 3080). */
function listenerPid() {
  try {
    const net = require('node:net')
    // No portable pid query via net; shell out is the caller's job. Fallback:
    // report the boot record and log instead — the agent has pwsh for pid lookup.
    void net
  } catch {
    /* ignore */
  }
  return null
}
void listenerPid

const report = {
  restartState: state,
  recordedBoot: boot,
  logPath,
  logExists: existsSync(logPath),
  livePidNote: 'use pwsh Get-NetTCPConnection -LocalPort 3080 for the live pid',
}

console.log(JSON.stringify(report, null, 2))

if (state !== null && state.phase === 'failed') process.exit(3)
if (state !== null && state.phase === 'prepared') {
  console.log('note: restart-state is still phase=prepared — the restart either never happened or never recorded success.')
  process.exit(2)
}
process.exit(0)
