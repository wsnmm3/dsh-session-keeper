/**
 * Assemble the publishable package and pack it.
 *
 * The release structure is NOT what `tsdown` emits straight out of this build
 * workspace: the shipped package carries a prebuilt `lib/types/` tree, a
 * `lib/typert.host.js`, and thin re-export entry points, while the build
 * workspace inlines everything into `lib/index.js` / `lib/spec.js`. The
 * installed profile copy is the known-good release layout, so this script
 * takes it as the structural baseline and swaps in the freshly built client
 * bundle — the only artifact this branch changes today.
 *
 * Usage: node scripts/pack-release.mjs
 *   -> dist/dsh-session-categories-<version>.tgz
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
const root = path.resolve(import.meta.dirname, '..')
const dist = path.join(root, 'dist')
const stage = path.join(dist, 'package')

// The installed profile copy defines the release layout (see BUILD.md). This
// fork ships as its own package (dsh-session-keeper) and the upstream
// dsh-session-categories directory is gone from this profile, so the default
// points at the fork's own installed copy. It carries the same release layout:
// prebuilt lib/types, thin re-export entries, seed-owned typert.host.js.
const reference = process.env.DSH_PLUGIN_INSTALLED
  ?? 'C:\\Users\\ASUS 98\\.dsh\\profiles\\desktop\\node_modules\\dsh-session-keeper'

const copy = async (from, to) => {
  await fs.mkdir(path.dirname(to), { recursive: true })
  await fs.copyFile(from, to)
}

const exists = p => fs.access(p).then(() => true, () => false)

const copyDir = async (from, to) => {
  await fs.mkdir(to, { recursive: true })
  for (const entry of await fs.readdir(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name)
    const dst = path.join(to, entry.name)
    if (entry.isDirectory()) await copyDir(src, dst)
    else await copy(src, dst)
  }
}

if (!await exists(reference)) {
  console.error(`release layout reference not found: ${reference}`)
  console.error('set DSH_PLUGIN_INSTALLED to an installed dsh-session-categories directory')
  process.exit(1)
}

// Version comes from the release manifest this fork maintains.
const manifest = JSON.parse(await fs.readFile(path.join(root, 'package.upstream.json'), 'utf8'))
const version = manifest.version

await fs.rm(stage, { recursive: true, force: true })
await fs.mkdir(stage, { recursive: true })

// 1. The release manifest, carrying this fork's version.
await fs.writeFile(path.join(stage, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')

// 2. The installed layout's lib/ tree, minus build backups and the old bundle.
const libSrc = path.join(reference, 'lib')
const libDst = path.join(stage, 'lib')
await copyDir(libSrc, libDst)
for (const name of await fs.readdir(libDst)) {
  if (name.includes('.bak')) await fs.rm(path.join(libDst, name), { force: true })
}

// 3. The freshly built client bundle replaces the reference one.
await copy(path.join(root, 'lib', 'client.js'), path.join(libDst, 'client.js'))
await copy(path.join(root, 'lib', 'client.js.map'), path.join(libDst, 'client.js.map'))

// 3b. `lib/typert.host.js` names the package it belongs to, and
//     `dsh-typert-loader` refuses a manifest whose `package` differs from the
//     package that exports it:
//
//       typert-loader: <pkg> TYPERT manifest names package "<other>" — the
//       manifest must be owned by the package that exports it
//
//     The reference copy in the installed profile still carries the upstream
//     name, so the renamed seed has to overwrite it or the published package
//     mounts without any Remote methods at all.
//
// The seed carries the recycle invocations that scripts/inject-recycle-descriptors.mjs
// rebuilds from the service source; without them the gateway rejects every
// /session-recycle verb before the service is reached.
const hostSeed = path.join(root, 'seed', 'typert.host.js')
if (await exists(hostSeed)) await copy(hostSeed, path.join(libDst, 'typert.host.js'))

// 3c. Same story for the Remote manifest: every descriptor id and typeSymbol
//     is `<package>#<service>/<method>` / `<package>/types#<Type>`. Shipping the
//     reference copy would advertise the old package on the wire, so the built
//     one (which carries the injected recycle descriptors) wins.
await copy(path.join(root, 'lib', 'typert.remote-client.js'), path.join(libDst, 'typert.remote-client.js'))

// 3d. The `lib/types/` tree is a prebuilt release artefact carried over from the
//     reference copy, so it still spells the package the old way. Two of those
//     strings are more than cosmetic:
//
//       - `PACKAGE_NAME` in types/invariant.js is the key the plugin registers
//         with `ctx.invariants.register()`, and that key must be unique per
//         package. A stale key collides if the upstream package is ever
//         co-installed.
//       - `... from 'dsh-session-categories/types'` in the .d.ts files is a
//         type-only import, so it breaks consumers' typecheck rather than the
//         runtime.
//
//     Rewrite the distribution name there and leave every `@deepseek-ai/...`
//     specifier alone: those are internal build-time module names, aliased by
//     tsdown and never resolved at install time.
const RENAMES = [
  ["'dsh-session-categories#", "'dsh-session-keeper#"],
  ['"dsh-session-categories#', '"dsh-session-keeper#'],
  ["'dsh-session-categories/types", "'dsh-session-keeper/types"],
  ['"dsh-session-categories/types', '"dsh-session-keeper/types'],
  ["'dsh-session-categories/invariant", "'dsh-session-keeper/invariant"],
  ['"dsh-session-categories/invariant', '"dsh-session-keeper/invariant'],
  ["'dsh-session-categories/src/", "'dsh-session-keeper/src/"],
  ['"dsh-session-categories/src/', '"dsh-session-keeper/src/'],
  ["PACKAGE_NAME = 'dsh-session-categories'", "PACKAGE_NAME = 'dsh-session-keeper'"],
  // lib/invariant.js spells the register() key with double quotes and the
  // upstream scope, which none of the single-quoted rules above match.
  ['"@deepseek-ai/dsh-session-categories"', '"dsh-session-keeper"'],
  ["PACKAGE_NAME = \"@deepseek-ai/dsh-session-categories\"", "PACKAGE_NAME = 'dsh-session-keeper'"],
]
let rewritten = 0
const walkStaged = async (dir) => {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) { await walkStaged(full); continue }
    if (entry.name.includes('.bak')) continue
    if (!entry.name.endsWith('.js') && !entry.name.endsWith('.d.ts')) continue
    const before = await fs.readFile(full, 'utf8')
    let after = before
    for (const [from, to] of RENAMES) if (after.includes(from)) after = after.split(from).join(to)
    if (after === before) continue
    await fs.writeFile(full, after)
    rewritten += 1
  }
}
await walkStaged(libDst)
console.log(`identity rewritten in ${rewritten} staged file(s)`)

// 4. Docs, license and the patch travel with the package.
for (const extra of ['README.md', 'README.zh.md', 'LICENSE', 'CHANGELOG.md', 'FORK-NOTES.md', 'BUILD.md', 'cordis.patch.yml']) {
  const src = path.join(root, extra)
  if (await exists(src)) await copy(src, path.join(stage, extra))
}
if (await exists(path.join(root, 'docs'))) await copyDir(path.join(root, 'docs'), path.join(stage, 'docs'))

// 5. Confirm every path the manifest promises actually shipped.
const listed = []
for (const entry of manifest.files) {
  if (!entry.includes('*')) { listed.push(entry); continue }
  const dir = path.posix.dirname(entry)
  const ext = path.posix.extname(entry)
  const names = await fs.readdir(path.join(stage, dir)).catch(() => [])
  for (const name of names) if (name.endsWith(ext)) listed.push(path.posix.join(dir, name))
}
const missing = []
for (const rel of listed) if (!await exists(path.join(stage, rel))) missing.push(rel)

console.log(`release layout: ${path.basename(reference)} -> ${version}`)
console.log(`manifest lists ${listed.length} files; staged under ${path.relative(root, stage)}`)
if (missing.length > 0) {
  console.log('NOT PRESENT:')
  for (const rel of missing) console.log('  - ' + rel)
}

// 6. Pack. On Windows npm is a .cmd shim, so the shell is required; the
//    DEP0190 advisory npm prints to stderr is harmless and is filtered below.
await fs.mkdir(dist, { recursive: true })
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const packResult = await run(npmCmd, ['pack', '--pack-destination', dist, '--silent'], { cwd: stage, shell: true })
const tarball = path.join(dist, `${manifest.name}-${version}.tgz`)
const stat = await fs.stat(tarball)
console.log(`packed ${path.relative(root, tarball)} (${stat.size} bytes, npm said ${packResult.stdout.trim()})`)

// 7. Verify the tarball carries what the loader needs.
// GNU tar on Windows reads "E:\..." as an rsh host spec and dies with
// "Cannot connect to E" — pass the bare filename with cwd instead.
const { stdout: listing } = await run('tar', ['-tzf', path.basename(tarball)], { shell: true, cwd: dist })
const entries = listing.split(/\r?\n/).filter(Boolean)
const required = [
  'package/package.json',
  'package/lib/client.js',
  'package/lib/index.js',
  'package/lib/typert.host.js',
  'package/lib/types/index.js',
  'package/cordis.patch.yml',
]
const absent = required.filter(name => !entries.includes(name))
console.log(`tarball entries: ${entries.length}`)
if (absent.length > 0) {
  console.log('MISSING FROM TARBALL:', absent.join(', '))
  process.exitCode = 1
} else {
  console.log('tarball carries the manifest, host entry, typert host, types tree, client bundle and patch')
}
if (missing.length > 0) process.exitCode = 1
