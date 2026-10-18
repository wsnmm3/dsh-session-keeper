/**
 * Reconcile the archive set against what is actually on disk.
 *
 * An archived id whose log directory no longer exists under sessions/ is an
 * orphan: it renders a ghost row in the archive section (the host list may
 * still cache it), and deleting it fails with `session-log-not-found`.
 *
 * Default is a dry run; pass --apply to remove orphan ids from
 * global.archivedSessionIds in storages/workspace.json (a timestamped backup
 * is written first).
 *
 * SAFETY: writes profile configuration. Run with DSH fully closed, or accept
 * that a running host may overwrite the file on its next persist.
 */
import fs from 'node:fs'
import path from 'node:path'

const apply = process.argv.includes('--apply')
const home = process.env.DSH_HOME ?? 'C:\\Users\\ASUS 98\\.dsh'
const wsFile = path.join(home, 'storages', 'workspace.json')
const sessionsRoot = path.join(home, 'sessions')

const raw = fs.readFileSync(wsFile, 'utf8')
const data = JSON.parse(raw)
const archived = data.global?.archivedSessionIds ?? []

console.log(`archive set: ${archived.length} id(s)`)

const logExists = (id) => {
  if (!fs.existsSync(sessionsRoot)) return false
  for (const ws of fs.readdirSync(sessionsRoot)) {
    if (fs.existsSync(path.join(sessionsRoot, ws, id))) return true
  }
  return false
}

const orphans = []
const alive = []
for (const id of archived) {
  if (logExists(id)) alive.push(id)
  else orphans.push(id)
}

console.log(`alive (log on disk): ${alive.length}`)
console.log(`orphans (log missing): ${orphans.length}`)
for (const id of orphans) {
  // A missing log usually means the id sits in a recycle batch (deleted but
  // still archived) or the log was cleaned externally.
  console.log(`  - ${id}`)
}

if (!apply) {
  console.log('\ndry run; pass --apply to remove the orphans from the archive set')
  process.exit(0)
}

if (orphans.length === 0) {
  console.log('nothing to do')
  process.exit(0)
}

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '')
const backup = `${wsFile}.bak-orphan-${stamp}`
fs.copyFileSync(wsFile, backup)
console.log(`backup -> ${path.basename(backup)}`)

data.global.archivedSessionIds = alive
fs.writeFileSync(wsFile, JSON.stringify(data, null, 2) + '\n', 'utf8')

const after = JSON.parse(fs.readFileSync(wsFile, 'utf8'))
const ok = (after.global.archivedSessionIds.length === alive.length)
  && orphans.every(id => !after.global.archivedSessionIds.includes(id))
console.log(`applied; archive set now ${after.global.archivedSessionIds.length}; verify=${ok ? 'OK' : 'FAILED'}`)
if (!ok) process.exitCode = 1
