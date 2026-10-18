/**
 * Wire types for the Session recycle methods.
 *
 * These mirror the shape of `./recycle.ts` but stay JSON-serializable and
 * free of filesystem detail, because they travel over the typert Remote
 * channel to the Web client. The client never learns an absolute path from
 * these values; it receives identities and byte counts only.
 *
 * @module
 */

/** Sessions to move into the recycle bin. */
export interface SessionRecycleDeleteRequest {
  /** Stored Session ids, e.g. `session-<uuid>`. */
  sessionIds: readonly string[]
  /** Owning Workspace, used to record where the Session came from. */
  workspaceId?: string
  /** Free-form note stored with the batch, e.g. the UI action that ran it. */
  reason?: string
}

/** Outcome of one delete. */
export type SessionRecycleDeleteResult =
  | {
      ok: true
      value: {
        /** Pass this to `undoDeleteSessions`. */
        batchId: string
        /** ISO timestamp the batch was created. */
        deletedAt: string
        /** Sessions that were moved, in the order they were processed. */
        sessionIds: readonly string[]
        /** Bytes moved out of the live tree. */
        reclaimedBytes: number
      }
    }
  | { ok: false; error: { code: string; sessionId?: string } }

/** Which batch to put back. */
export interface SessionRecycleUndoRequest {
  /** Omitted restores the most recent batch. */
  batchId?: string
}

/** Outcome of one undo. */
export type SessionRecycleUndoResult =
  | {
      ok: true
      value: {
        batchId: string
        /** Sessions returned to their original location. */
        restored: readonly string[]
        /** Sessions that could not return, with the reason for each. */
        failed: readonly { sessionId: string; reason: string }[]
      }
    }
  | { ok: false; error: { code: string } }

/** One undoable batch, as reported to the client. */
export interface RecycledBatchSummary {
  batchId: string
  deletedAt: string
  sessionIds: readonly string[]
  bytes: number
}

/** The recycle bin's current contents. */
export type SessionRecycleListResult =
  | { ok: true; value: { batches: readonly RecycledBatchSummary[] } }

/** Retention overrides for the sweep. */
export interface SessionRecycleSweepRequest {
  /** Keep at most this many batches. Defaults to 20. */
  maxBatches?: number
  /** Drop batches older than this many days. Defaults to 30. */
  maxAgeDays?: number
}

/** Outcome of one retention sweep. */
export type SessionRecycleSweepResult =
  | { ok: true; value: { removedBatchIds: readonly string[]; reclaimedBytes: number } }
