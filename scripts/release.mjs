/**
 * Rebuild every artifact this package ships and pack the release tarball.
 * One command for the whole release cycle:
 *
 *   node scripts/release.mjs
 *
 * Steps: client bundle -> CSS inline -> build verification -> host bundle ->
 * release tarball. Stops at the first failure.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'

const run = promisify(execFile)
const root = path.resolve(import.meta.dirname, '..')
const npmCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx'
const node = process.execPath

async function step(label, file, args, { shell = false } = {}) {
  process.stdout.write(`\n=== ${label} ===\n`)
  const { stdout, stderr } = await run(file, args, { cwd: root, shell })
  if (stdout.trim() !== '') process.stdout.write(stdout)
  // npm/tsdown emit harmless advisories on stderr; surface only real failures.
  if (stderr.trim() !== '') process.stdout.write(stderr)
}

// Script paths are absolute: execFile resolves relative arguments against its
// own process, not the `cwd` option, and Windows rejects that combination.
const script = name => path.join(root, 'scripts', name)
// `node` runs without a shell (its path contains a space); the npm shims need
// one on Windows to be executable at all.
const winShell = process.platform === 'win32'

await step('client bundle', npmCmd, ['tsdown'], { shell: winShell })
await step('inline CSS', node, [script('inline-css.mjs')])
await step('verify client build', node, [script('verify-build.cjs')])
await step('host bundle', npmCmd, ['tsdown', '--config', 'tsdown.host.config.ts'], { shell: winShell })
await step('pack release', node, [script('pack-release.mjs')])

process.stdout.write('\nrelease artifacts ready under dist/\n')
