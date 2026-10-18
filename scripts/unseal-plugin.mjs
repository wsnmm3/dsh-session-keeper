/**
 * Re-enable the dsh-session-categories plugin after the bundle-id mismatch
 * was fixed.
 *
 * A previous rescue disabled this plugin (cordis.patch.yml `disabled: true`
 * plus removal from `dsh.profile.bundles`) because the built client bundle
 * declared an id that no longer matched the installed package directory, so
 * the module loader could not resolve it and the renderer booted into
 * recovery mode. The id is corrected now, so the seal can come off.
 *
 * SAFETY: this writes profile configuration. Run it with DSH fully closed,
 * then start DSH and check the sidebar. Backups are written before any edit,
 * and every change is verified after the fact.
 *
 * Usage: node scripts/unseal-plugin.mjs
 */
import fs from 'node:fs/promises'
import path from 'node:path'

const profileDir = process.env.DSH_PROFILE_DIR ?? 'C:\\Users\\ASUS 98\\.dsh\\profiles\\desktop'
const patchPath = path.join(profileDir, 'cordis.patch.yml')
const manifestPath = path.join(profileDir, 'package.json')
const BUNDLE = 'dsh-session-categories'
const ENTRY_ID = 'session-categories'

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '')
const backup = async (file) => {
  const target = `${file}.bak-unseal-${stamp}`
  await fs.copyFile(file, target)
  console.log(`  backup -> ${path.basename(target)}`)
}

console.log('1. cordis.patch.yml')
const patchText = await fs.readFile(patchPath, 'utf8')
const patchLines = patchText.split(/\r?\n/)
const kept = []
let skipped = 0
for (let i = 0; i < patchLines.length; i += 1) {
  const line = patchLines[i]
  // Drop the `disabled: true` that follows our entry id, and the entry's
  // whole block only if it exists solely to disable it.
  if (line.trim() === `- id: ${ENTRY_ID}` && /disabled:\s*true/.test(patchLines[i + 1] ?? '')) {
    skipped += 1
    // Remove the two lines (id + disabled).
    i += 1
    continue
  }
  kept.push(line)
}
await backup(patchPath)
await fs.writeFile(patchPath, kept.join('\n'), 'utf8')
console.log(`  removed ${skipped} disabled block(s) for "${ENTRY_ID}"`)

console.log('2. package.json bundles')
const manifestText = await fs.readFile(manifestPath, 'utf8')
const manifest = JSON.parse(manifestText)
const bundles = manifest?.dsh?.profile?.bundles
if (!Array.isArray(bundles)) throw new Error('manifest has no dsh.profile.bundles array')
if (!bundles.includes(BUNDLE)) {
  await backup(manifestPath)
  bundles.push(BUNDLE)
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  console.log(`  added "${BUNDLE}" (now ${bundles.length} bundles)`)
} else {
  console.log(`  "${BUNDLE}" already present (${bundles.length} bundles)`)
}

console.log('3. verify')
const afterPatch = await fs.readFile(patchPath, 'utf8')
const afterManifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
const disabledStill = new RegExp(`- id: ${ENTRY_ID}\\s*\\n\\s*disabled:\\s*true`).test(afterPatch)
console.log(`  patch still disables it : ${disabledStill} (want false)`)
console.log(`  bundle listed           : ${afterManifest.dsh.profile.bundles.includes(BUNDLE)} (want true)`)
console.log(`  dependency retained     : ${BUNDLE in (afterManifest.dependencies ?? {})} (want true)`)

if (disabledStill || !afterManifest.dsh.profile.bundles.includes(BUNDLE)) {
  console.error('\nVERIFY FAILED — restore from the .bak-unseal-* backups above')
  process.exitCode = 1
} else {
  console.log('\nunsealed. Now start DSH and confirm the sidebar renders.')
}
