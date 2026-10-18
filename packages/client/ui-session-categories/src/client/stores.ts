/**
 * The workspace browser's viewing store: the session-list grouping mode,
 * persisted across reloads. Module level exports the factory only (a
 * module-level handle would pin the store identity across plugin reloads);
 * register() receives the factory and the browser derives its PropsStore
 * share from the return type.
 */
import { defineStore } from '@deepseek-ai/dsh-client-store'

/**
 * The store handle this module hands to the slot registration. `defineStore`
 * returns the spec, its bound actions, and the subscription surface in one
 * object; the browser treats it as opaque, so the local alias only has to name
 * that shape for the declaration below.
 */
export type EngineStoreHandle<State, Actions> = ReturnType<typeof defineStore<State, Actions>>


/** Browser-local order account for the hierarchy-free flat Session list. */
export const FLAT_SESSION_ORDER_KEY = '__flat_session_order__'

/**
 * Prefix for a category's own Session-order account key.
 *
 * A category keeps a manual order separate from the Workspace account: a drag
 * inside a category must not reshuffle the Workspace's unclassified tail. The
 * prefix also keeps these keys out of the UUID / {@link FLAT_SESSION_ORDER_KEY}
 * / `''` namespaces that already share the one `sessionOrderByAccount` map.
 */
export const CATEGORY_ORDER_PREFIX = 'category:'

/**
 * Build one category's Session-order account key.
 * @param categoryId - Host-assigned category id.
 * @returns the key to store that category's manual order under.
 */
export function categoryOrderKey(categoryId: string): string {
  return `${CATEGORY_ORDER_PREFIX}${categoryId}`
}

/**
 * Session-list grouping mode:
 * - `workspace` — one flat section per Workspace;
 * - `workspace-tree` — Workspace sections nest by their directory paths;
 * - `flat` — one recency list with no grouping.
 */
export type SessionGroupBy = 'workspace' | 'workspace-tree' | 'flat'
/** Session order: user-arranged only, or user-arranged plus activity promotion. */
export type SessionOrderBy = 'manual' | 'updated'

/** Session category browser viewing state persisted across surface remounts and reloads. */
type WorkspaceViewState = {
  groupBy: SessionGroupBy
  orderBy: SessionOrderBy
  /**
   * Archived-row visibility, mirroring the official browser's three-state
   * filter: default hides the archive section entirely, show gathers the
   * archived rows into their own (expanded) section, only shows nothing but
   * the archive section.
   */
  archivedFilter: 'default' | 'show' | 'only'
  /** Explicit zero-or-five-session state keyed by Workspace group identity. */
  groupExpansion: Record<string, boolean>
  /** Explicit expansion state keyed by durable category identity. */
  categoryExpansion: Record<string, boolean>
  /** Shared editable order per Workspace group plus the browser-local flat-list account. */
  sessionOrderByAccount: Record<string, string[]>
  /** Last observed update timestamps per order account for one-time promotion events. */
  sessionUpdatedAtByAccount: Record<string, Record<string, number>>
  /**
   * Whether the session-manager dialog is open.
   *
   * Deliberately NOT persisted (see the `persist` allow-list below): a dialog
   * that reopens itself on the next launch is a trap, not a convenience. It
   * lives in the shared store only so the footer button (which owns the click)
   * and the dialog (which owns the data) can be one surface.
   */
  managerOpen: boolean
}

/**
 * Annotation twin of the actions literal below (the export needs a declared
 * return type); drift fails assignability at the defineStore call.
 */
type WorkspaceViewActions = {
  setGroupBy: (draft: WorkspaceViewState, mode: SessionGroupBy) => void
  setOrderBy: (draft: WorkspaceViewState, mode: SessionOrderBy) => void
  setArchivedFilter: (draft: WorkspaceViewState, filter: 'default' | 'show' | 'only') => void
  setGroupExpanded: (draft: WorkspaceViewState, key: string, expanded: boolean) => void
  setCategoryExpanded: (draft: WorkspaceViewState, key: string, expanded: boolean) => void
  retainCategoryKeys: (draft: WorkspaceViewState, categoryKeys: readonly string[]) => void
  retainAccountKeys: (draft: WorkspaceViewState, workspaceKeys: readonly string[]) => void
  syncSessionOrderAccount: (
    draft: WorkspaceViewState,
    accountKey: string,
    order: string[],
    updatedAt: Record<string, number>,
  ) => void
  setSessionOrder: (draft: WorkspaceViewState, accountKey: string, order: string[]) => void
  openManager: (draft: WorkspaceViewState) => void
  closeManager: (draft: WorkspaceViewState) => void
}

/**
 * Create the workspace browser viewing store handle.
 * @returns the store handle (spec + type + identity + factory in one).
 */
export function createWorkspaceViewStore(): EngineStoreHandle<WorkspaceViewState, WorkspaceViewActions> {
  return defineStore({
    init: (): WorkspaceViewState => ({
      groupBy: 'workspace',
      orderBy: 'updated',
      // Archived rows start hidden, matching the official browser's default.
      archivedFilter: 'default',
      groupExpansion: {},
      categoryExpansion: {},
      sessionOrderByAccount: {},
      sessionUpdatedAtByAccount: {},
      managerOpen: false,
    }),
    persist: 'dsh.session-categories.view.v2',
    actions: {
      setGroupBy: (d, mode: SessionGroupBy) => { d.groupBy = mode },
      setOrderBy: (d, mode: SessionOrderBy) => { d.orderBy = mode },
      setArchivedFilter: (d, filter: 'default' | 'show' | 'only') => { d.archivedFilter = filter },
      setGroupExpanded: (d, key: string, expanded: boolean) => { d.groupExpansion[key] = expanded },
      setCategoryExpanded: (d, key: string, expanded: boolean) => { d.categoryExpansion[key] = expanded },
      retainCategoryKeys: (d, categoryKeys: readonly string[]) => {
        const retained = new Set(categoryKeys)
        d.categoryExpansion = Object.fromEntries(
          Object.entries(d.categoryExpansion).filter(([key]) => retained.has(key)),
        )
      },
      retainAccountKeys: (d, workspaceKeys: readonly string[]) => {
        const retained = new Set(workspaceKeys)
        // Category accounts are exempt from pruning on purpose. This effect runs
        // as soon as the Workspace phase is ready, which can be BEFORE the
        // category snapshots have loaded — filtering against a not-yet-known
        // category list would erase every category's manual order on the first
        // render after a reload. A stale key left behind by a deleted category
        // costs a few strings and nothing else.
        const keep = (key: string): boolean => retained.has(key) || key.startsWith(CATEGORY_ORDER_PREFIX)
        d.groupExpansion = Object.fromEntries(
          Object.entries(d.groupExpansion).filter(([key]) => retained.has(key)),
        )
        d.sessionOrderByAccount = Object.fromEntries(
          Object.entries(d.sessionOrderByAccount).filter(([key]) => keep(key)),
        )
        d.sessionUpdatedAtByAccount = Object.fromEntries(
          Object.entries(d.sessionUpdatedAtByAccount).filter(([key]) => retained.has(key)),
        )
      },
      syncSessionOrderAccount: (d, accountKey: string, order: string[], updatedAt: Record<string, number>) => {
        d.sessionOrderByAccount[accountKey] = order
        d.sessionUpdatedAtByAccount[accountKey] = updatedAt
      },
      setSessionOrder: (d, accountKey: string, order: string[]) => {
        d.sessionOrderByAccount[accountKey] = order
      },
      openManager: (d) => { d.managerOpen = true },
      closeManager: (d) => { d.managerOpen = false },
    },
  })
}
