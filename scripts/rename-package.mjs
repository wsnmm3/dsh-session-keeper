/**
 * Rename the package across the build tree, safely.
 *
 * The first attempt at this used PowerShell's Get-Content/Set-Content round
 * trip, which re-decoded the UTF-8 sources as the console code page and
 * mangled every Chinese comment. This script reads and writes with an explicit
 * UTF-8 codec and reports every file it touched, so a rename cannot silently
 * corrupt prose again.
 *
 * Usage: node scripts/rename-package.mjs <new-name>
 */
import fs from 'node:fs/promises'
import path from 'node:path'

const next = process.argv[2]
if (!next || !/^[a-z0-9-]+$/.test(next)) {
  console.error('usage: node scripts/rename-package.mjs <kebab-case-name>')
  process.exit(1)
}

const root = path.resolve(import.meta.dirname, '..')
const previous = ['dsh-session-hub', 'dsh-session-categories']

// Only sources, manifests and scripts move; build output is regenerated.
const SKIP = new Set(['node_modules', 'lib', 'dist', '.git'])
const EXTS = new Set(['.ts', '.tsx', '.mjs', '.cjs', '.json', '.yml', '.yaml', '.md'])

async function walk(dir) {
  const out = []
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...await walk(full))
    else if (EXTS.has(path.extname(entry.name))) out.push(full)
  }
  return out
}

const files = await walk(root)
let changed = 0

for (const file of files) {
  const rel = path.relative(root, file).replace(/\\/g, '/')
  // This script and the publishing notes name the candidates on purpose.
  if (rel === 'scripts/rename-package.mjs' || rel === 'PUBLISHING.md') continue

  const before = await fs.readFile(file, 'utf8')
  let after = before
  for (const old of previous) {
    if (old === next) continue
    after = after.split(old).join(next)
  }
  if (after === before) continue

  await fs.writeFile(file, after, 'utf8')
  console.log(`  ${rel}`)
  changed += 1
}

console.log(`\nrenamed to ${next} in ${changed} file(s)`)

// A rename is only safe if no CJK character was mangled into a replacement
// or a mojibake sequence. Fail loudly rather than ship corrupted prose.
//
// Written as escapes on purpose: the check must not itself contain the damaged
// bytes it looks for, and a broad pattern set is useless here — ordinary words
// like 错/误 are Chinese, not damage. Only the readings that appear when UTF-8
// em dash (E2 80 94) and arrow (E2 86 92) bytes are decoded as GBK are
// unambiguous: U+9225 and U+922B.
const suspicious = /[\uFFFD\u9225\u922B]/u
const broken = []
for (const file of files) {
  const text = await fs.readFile(file, 'utf8')
  if (suspicious.test(text)) broken.push(path.relative(root, file))
}
if (broken.length > 0) {
  console.error('\nENCODING DAMAGE detected in:')
  for (const rel of broken) console.error('  ' + rel)
  process.exitCode = 1
} else {
  console.log('encoding check: clean (no mojibake, no replacement characters)')
}
