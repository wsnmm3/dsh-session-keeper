/**
 * Reports how this machine's dsh instance is reachable, so a verification run
 * does not have to guess a port.
 *
 * The GUI advertises one URL, but that is not necessarily the port the running
 * host actually binds — a stale window can keep showing an address whose
 * listener has already gone away. This script instead reads the live process
 * table and the profile's own runtime files.
 */
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

function run(command) {
  try {
    return execFileSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return ''
  }
}

console.log('=== listening TCP ports ===')
const netstat = run('netstat -ano -p tcp')
for (const line of netstat.split(/\r?\n/)) {
  if (!line.includes('LISTENING')) continue
  const parts = line.trim().split(/\s+/)
  const local = parts[1] ?? ''
  const pid = parts[4] ?? ''
  if (!local.startsWith('127.0.0.1') && !local.startsWith('0.0.0.0')) continue
  console.log(`  ${local.padEnd(24)} pid=${pid}`)
}

console.log('\n=== DSH Desktop processes ===')
const tasks = run('tasklist /FI "IMAGENAME eq DSH Desktop.exe" /FO CSV /NH')
console.log(tasks.trim() || '  (none)')

console.log('\n=== candidate runtime files under %USERPROFILE%\\.dsh ===')
const dshHome = path.join(os.homedir(), '.dsh')
for (const rel of ['host.json', 'web.json', 'runtime.json', 'instance.json', 'run']) {
  const full = path.join(dshHome, rel)
  if (fs.existsSync(full)) {
    try {
      const stat = fs.statSync(full)
      console.log(`  ${rel}  (${stat.size} bytes)`)
      if (stat.isFile() && stat.size < 4000) {
        console.log('    ' + fs.readFileSync(full, 'utf8').trim().replace(/\n/g, '\n    '))
      }
    } catch (error) {
      console.log(`  ${rel}  unreadable: ${error.message}`)
    }
  }
}
