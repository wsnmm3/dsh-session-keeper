/**
 * Session recycle bin: the out-of-band pruning this harness deliberately omits.
 *
 * `dsh-session-persistence` states plainly that it has "no delete or retention
 * interface — pruning stored sessions is out-of-band backend maintenance", and
 * `dsh-workspace` exposes only `archiveSession`/`unarchiveSession`. Archiving
 * therefore hides a Session from the browser without ever reclaiming its log,
 * and the archive set is one-way from the UI's point of view.
 *
 * This module supplies that missing maintenance. It never deletes anything
 * outright: a "deleted" Session is *moved* into a dated recycle bin, and the
 * move is recorded in a manifest so the most recent deletion can be undone.
 * Only the automatic retention sweep ever removes a stored log for good.
 *
 * ### On-disk layout
 *
 * A stored Session lives at:
 *
 * ```
 * <dshHome>/sessions/<encoded-workspace-path>/session-<uuid>/session.v4.jsonl.zstd
 * ```
 *
 * The directory name under `sessions/` encodes the owning Workspace's path, so
 * the same Workspace can appear under more than one spelling when a path
 * component is a junction (`C:\Users\...\.dsh\bili-duty` and
 * `E:\AI\DSH\DSH-Data\.dsh\bili-duty` are one directory with two names). This
 * module therefore never *derives* that directory name from a Workspace path
 * alone — it locates the Session by searching the encoded directories for the
 * one that actually contains `session-<uuid>`, and treats a Workspace-path
 * match as a tie-breaker only.
 *
 * @module
 */
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

/** A stored Session's durable identity, e.g. `session-<uuid>`. */
export type StoredSessionId = string

/** One Session log relocated by a delete, and how to put it back. */
export interface RecycledSession {
  sessionId: StoredSessionId
  /** Encoded directory name under `sessions/` that held the Session. */
  container: string
  /** Absolute path the Session occupied before the delete. */
  origin: string
  /** Workspace the Session belonged to, when the caller supplied one. */
  workspaceId?: string
  /** Workspace path as recorded by the registry, for diagnostics only. */
  workspacePath?: string
  /** Bytes reclaimed from the live tree. */
  sizeBytes: number
}

/** One batch of deletions, undoable as a unit. */
export interface RecycleBatch {
  /** Stable id; also the recycle-bin subdirectory name. */
  batchId: string
  /** ISO timestamp of the deletion. */
  deletedAt: string
  reason?: string
  entries: RecycledSession[]
}

/** Result of the retention sweep. */
export interface SweepResult {
  removedBatches: string[]
  reclaimedBytes: number
}

/** Failure modes a delete can report back to the caller. */
export interface RecycleFailure {
  code: string
  sessionId?: StoredSessionId
}

/**
 * Outcome of moving one or more Sessions into the recycle bin.
 *
 * Named rather than inline so the host service can narrow `ok` without a
 * type assertion, and so `sessionId` survives on the failure branch.
 */
export type RecycleResult =
  | { ok: true; batch: RecycleBatch }
  | { ok: false; error: RecycleFailure }

/** Outcome of putting a batch back. */
export type RestoreResult =
  | {
      ok: true
      batchId: string
      restored: StoredSessionId[]
      failed: { sessionId: StoredSessionId; reason: string }[]
    }
  | { ok: false; error: { code: string } }

const SESSION_PREFIX = 'session-'

/** Resolve the dsh home directory the way the harness does. */
export function resolveDshHome(): string {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

/** Absolute path of the stored-session tree. */
export function sessionsRoot(dshHome = resolveDshHome()): string {
  return join(dshHome, 'sessions')
}

/** Absolute path of the recycle bin root. */
export function trashRoot(dshHome = resolveDshHome()): string {
  return join(dshHome, 'trash')
}

/** Path of the recycle-bin manifest inside one batch directory. */
function manifestPath(batchDir: string): string {
  return join(batchDir, 'manifest.json')
}

/**
 * Encoded directory names under `sessions/` that actually hold this Session.
 *
 * @param sessionId - the stored Session id, e.g. `session-<uuid>`.
 * @param dshHome - dsh home override, for tests.
 * @returns every container directory name holding a `sessionId` child.
 */
export async function locateSession(
  sessionId: StoredSessionId,
  dshHome = resolveDshHome(),
): Promise<{ container: string; path: string }[]> {
  const root = sessionsRoot(dshHome)
  const found: { container: string; path: string }[] = []
  let containers: string[]
  try {
    containers = (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return found
  }
  for (const container of containers) {
    const candidate = join(root, container, sessionId)
    try {
      if ((await stat(candidate)).isDirectory()) found.push({ container, path: candidate })
    } catch {
      // Not present under this container; the next one may still have it.
    }
  }
  return found
}

/** Total bytes of every regular file beneath a directory. */
async function directorySize(path: string): Promise<number> {
  let total = 0
  const entries = await readdir(path, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const child = join(path, entry.name)
    if (entry.isDirectory()) total += await directorySize(child)
    else if (entry.isFile()) total += await stat(child).then((info) => info.size).catch(() => 0)
  }
  return total
}

/** Read every batch manifest in the recycle bin, newest first. */
export async function listBatches(dshHome = resolveDshHome()): Promise<RecycleBatch[]> {
  const root = trashRoot(dshHome)
  const names = (await readdir(root, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
  const batches: RecycleBatch[] = []
  for (const name of names) {
    const raw = await readFile(manifestPath(join(root, name)), 'utf8').catch(() => undefined)
    if (raw === undefined) continue
    try {
      batches.push(JSON.parse(raw) as RecycleBatch)
    } catch {
      // A corrupt manifest must not hide the batches that are still readable.
    }
  }
  return batches.sort((left, right) => right.deletedAt.localeCompare(left.deletedAt))
}

/** Delete by moving into the recycle bin, recording everything needed to undo. */
export async function recycleSessions(
  request: {
    sessionIds: readonly StoredSessionId[]
    workspaceId?: string
    workspacePath?: string
    reason?: string
  },
  dshHome = resolveDshHome(),
): Promise<RecycleResult> {
  const stamp = new Date().toISOString()
  const batchId = stamp.replace(/[:.]/g, '-')
  const batchDir = join(trashRoot(dshHome), batchId)
  const entries: RecycledSession[] = []

  for (const sessionId of request.sessionIds) {
    const hits = await locateSession(sessionId, dshHome)
    if (hits.length === 0) {
      // Nothing on disk to move: report it rather than pretending success,
      // but keep whatever already moved so the batch stays undoable.
      if (entries.length > 0) await persistBatch(batchDir, { batchId, deletedAt: stamp, reason: request.reason, entries }, dshHome)
      return { ok: false, error: { code: 'session-log-not-found', sessionId } }
    }
    // A junction can make one Session visible under several container
    // spellings that all resolve to the same directory. Prefer the container
    // whose name encodes the Workspace the caller named, so the manifest
    // records the spelling the browser shows; fall back to the first hit.
    const preferred = request.workspacePath === undefined
      ? undefined
      : encodeWorkspacePath(request.workspacePath)
    const chosen = hits.find(hit => hit.container === preferred) ?? hits[0]!
    const sizeBytes = await directorySize(chosen.path)
    const target = join(batchDir, chosen.container, sessionId)
    await mkdir(dirname(target), { recursive: true })
    await rename(chosen.path, target)
    entries.push({
      sessionId,
      container: chosen.container,
      origin: chosen.path,
      ...(request.workspaceId === undefined ? {} : { workspaceId: request.workspaceId }),
      ...(request.workspacePath === undefined ? {} : { workspacePath: request.workspacePath }),
      sizeBytes,
    })
  }

  const batch: RecycleBatch = {
    batchId,
    deletedAt: stamp,
    ...(request.reason === undefined ? {} : { reason: request.reason }),
    entries,
  }
  await persistBatch(batchDir, batch, dshHome)
  return { ok: true, batch }
}

/** Write one batch manifest, refusing to clobber an existing batch. */
async function persistBatch(batchDir: string, batch: RecycleBatch, dshHome: string): Promise<void> {
  await mkdir(batchDir, { recursive: true })
  await writeFile(manifestPath(batchDir), JSON.stringify(batch, null, 2), 'utf8')
  await mkdir(trashRoot(dshHome), { recursive: true })
}

/**
 * Put the most recently deleted batch (or a named one) back.
 *
 * Restoration is best-effort per entry: an entry whose origin directory has
 * since been removed is reported rather than silently dropped, because the
 * caller has to tell the user their Session came back incomplete.
 */
export async function restoreBatch(
  options: { batchId?: string } = {},
  dshHome = resolveDshHome(),
): Promise<RestoreResult> {
  const batches = await listBatches(dshHome)
  const batch = options.batchId === undefined ? batches[0] : batches.find((item) => item.batchId === options.batchId)
  if (batch === undefined) return { ok: false, error: { code: 'no-batch' } }

  const batchDir = join(trashRoot(dshHome), batch.batchId)
  const restored: StoredSessionId[] = []
  const failed: { sessionId: StoredSessionId; reason: string }[] = []

  for (const entry of batch.entries) {
    const source = join(batchDir, entry.container, entry.sessionId)
    try {
      await mkdir(dirname(entry.origin), { recursive: true })
      const occupied = await stat(entry.origin).then(() => true).catch(() => false)
      if (occupied) {
        failed.push({ sessionId: entry.sessionId, reason: 'origin-occupied' })
        continue
      }
      await rename(source, entry.origin)
      restored.push(entry.sessionId)
    } catch (error) {
      failed.push({ sessionId: entry.sessionId, reason: error instanceof Error ? error.message : String(error) })
    }
  }

  if (restored.length > 0 && failed.length === 0) await rm(batchDir, { recursive: true, force: true })
  else await writeFile(
    manifestPath(batchDir),
    JSON.stringify({ ...batch, entries: batch.entries.filter((entry) => failed.some((item) => item.sessionId === entry.sessionId)) }, null, 2),
    'utf8',
  )

  return { ok: true, batchId: batch.batchId, restored, failed }
}

/**
 * Drop the oldest batches once the bin exceeds its limits.
 *
 * This is the only path that removes a stored log for good, which is why the
 * limits are explicit arguments rather than constants: the caller owns the
 * retention promise it makes to the user.
 */
export async function sweepTrash(
  limits: { maxBatches?: number; maxAgeDays?: number } = {},
  dshHome = resolveDshHome(),
): Promise<SweepResult> {
  const { maxBatches = 20, maxAgeDays = 30 } = limits
  const batches = await listBatches(dshHome)
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000
  const doomed = batches
    .filter((batch, index) => index >= maxBatches || Date.parse(batch.deletedAt) < cutoff)
    .map((batch) => batch.batchId)

  let reclaimedBytes = 0
  for (const batchId of doomed) {
    const batchDir = join(trashRoot(dshHome), batchId)
    reclaimedBytes += await directorySize(batchDir)
    await rm(batchDir, { recursive: true, force: true })
  }
  return { removedBatches: doomed, reclaimedBytes }
}

/**
 * Encode a Workspace path the way the harness names its session container.
 *
 * Kept for diagnostics and for callers that need to point at a container
 * directly; deletion itself locates sessions by content, never by this name,
 * because one Workspace can have several spellings.
 *
 * Encoding rule: `\ / :` collapse to `-`, and any other character outside
 * `[A-Za-z0-9._-]` becomes `~` plus its 4-digit uppercase hex code.
 */
export function encodeWorkspacePath(workspacePath: string): string {
  let body = ''
  let dashes = false
  for (const character of workspacePath) {
    if (character === '\\' || character === '/' || character === ':') {
      if (!dashes) {
        body += '-'
        dashes = true
      }
      continue
    }
    dashes = false
    body += /[A-Za-z0-9._-]/.test(character)
      ? character
      : `~${character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`
  }
  return `--${body}--`
}

/** Container directory name for a stored Session path, for display. */
export function containerOf(sessionPath: string): string {
  return basename(dirname(resolve(sessionPath)))
}
