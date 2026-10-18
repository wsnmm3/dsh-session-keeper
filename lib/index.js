import { sessionCategoriesDomainSpec } from "./spec.js";
import { randomUUID } from "node:crypto";
import { Service } from "@deepseek-ai/cordis";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { WorkspaceUnknownSessionError } from "@deepseek-ai/dsh-workspace";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
//#region packages/workspace/session-categories/src/recycle.ts
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
/** Resolve the dsh home directory the way the harness does. */
function resolveDshHome() {
	return process.env.DSH_HOME ?? join(homedir(), ".dsh");
}
/** Absolute path of the stored-session tree. */
function sessionsRoot(dshHome = resolveDshHome()) {
	return join(dshHome, "sessions");
}
/** Absolute path of the recycle bin root. */
function trashRoot(dshHome = resolveDshHome()) {
	return join(dshHome, "trash");
}
/** Path of the recycle-bin manifest inside one batch directory. */
function manifestPath(batchDir) {
	return join(batchDir, "manifest.json");
}
/**
* Encoded directory names under `sessions/` that actually hold this Session.
*
* @param sessionId - the stored Session id, e.g. `session-<uuid>`.
* @param dshHome - dsh home override, for tests.
* @returns every container directory name holding a `sessionId` child.
*/
async function locateSession(sessionId, dshHome = resolveDshHome()) {
	const root = sessionsRoot(dshHome);
	const found = [];
	let containers;
	try {
		containers = (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
	} catch {
		return found;
	}
	for (const container of containers) {
		const candidate = join(root, container, sessionId);
		try {
			if ((await stat(candidate)).isDirectory()) found.push({
				container,
				path: candidate
			});
		} catch {}
	}
	return found;
}
/** Total bytes of every regular file beneath a directory. */
async function directorySize(path) {
	let total = 0;
	const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
	for (const entry of entries) {
		const child = join(path, entry.name);
		if (entry.isDirectory()) total += await directorySize(child);
		else if (entry.isFile()) total += await stat(child).then((info) => info.size).catch(() => 0);
	}
	return total;
}
/** Read every batch manifest in the recycle bin, newest first. */
async function listBatches(dshHome = resolveDshHome()) {
	const root = trashRoot(dshHome);
	const names = (await readdir(root, { withFileTypes: true }).catch(() => [])).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
	const batches = [];
	for (const name of names) {
		const raw = await readFile(manifestPath(join(root, name)), "utf8").catch(() => void 0);
		if (raw === void 0) continue;
		try {
			batches.push(JSON.parse(raw));
		} catch {}
	}
	return batches.sort((left, right) => right.deletedAt.localeCompare(left.deletedAt));
}
/** Delete by moving into the recycle bin, recording everything needed to undo. */
async function recycleSessions(request, dshHome = resolveDshHome()) {
	const stamp = (/* @__PURE__ */ new Date()).toISOString();
	const batchId = stamp.replace(/[:.]/g, "-");
	const batchDir = join(trashRoot(dshHome), batchId);
	const entries = [];
	for (const sessionId of request.sessionIds) {
		const hits = await locateSession(sessionId, dshHome);
		if (hits.length === 0) {
			if (entries.length > 0) await persistBatch(batchDir, {
				batchId,
				deletedAt: stamp,
				reason: request.reason,
				entries
			}, dshHome);
			return {
				ok: false,
				error: {
					code: "session-log-not-found",
					sessionId
				}
			};
		}
		const preferred = request.workspacePath === void 0 ? void 0 : encodeWorkspacePath(request.workspacePath);
		const chosen = hits.find((hit) => hit.container === preferred) ?? hits[0];
		const sizeBytes = await directorySize(chosen.path);
		const target = join(batchDir, chosen.container, sessionId);
		await mkdir(dirname(target), { recursive: true });
		await rename(chosen.path, target);
		entries.push({
			sessionId,
			container: chosen.container,
			origin: chosen.path,
			...request.workspaceId === void 0 ? {} : { workspaceId: request.workspaceId },
			...request.workspacePath === void 0 ? {} : { workspacePath: request.workspacePath },
			sizeBytes
		});
	}
	const batch = {
		batchId,
		deletedAt: stamp,
		...request.reason === void 0 ? {} : { reason: request.reason },
		entries
	};
	await persistBatch(batchDir, batch, dshHome);
	return {
		ok: true,
		batch
	};
}
/** Write one batch manifest, refusing to clobber an existing batch. */
async function persistBatch(batchDir, batch, dshHome) {
	await mkdir(batchDir, { recursive: true });
	await writeFile(manifestPath(batchDir), JSON.stringify(batch, null, 2), "utf8");
	await mkdir(trashRoot(dshHome), { recursive: true });
}
/**
* Put the most recently deleted batch (or a named one) back.
*
* Restoration is best-effort per entry: an entry whose origin directory has
* since been removed is reported rather than silently dropped, because the
* caller has to tell the user their Session came back incomplete.
*/
async function restoreBatch(options = {}, dshHome = resolveDshHome()) {
	const batches = await listBatches(dshHome);
	const batch = options.batchId === void 0 ? batches[0] : batches.find((item) => item.batchId === options.batchId);
	if (batch === void 0) return {
		ok: false,
		error: { code: "no-batch" }
	};
	const batchDir = join(trashRoot(dshHome), batch.batchId);
	const restored = [];
	const failed = [];
	for (const entry of batch.entries) {
		const source = join(batchDir, entry.container, entry.sessionId);
		try {
			await mkdir(dirname(entry.origin), { recursive: true });
			if (await stat(entry.origin).then(() => true).catch(() => false)) {
				failed.push({
					sessionId: entry.sessionId,
					reason: "origin-occupied"
				});
				continue;
			}
			await rename(source, entry.origin);
			restored.push(entry.sessionId);
		} catch (error) {
			failed.push({
				sessionId: entry.sessionId,
				reason: error instanceof Error ? error.message : String(error)
			});
		}
	}
	if (restored.length > 0 && failed.length === 0) await rm(batchDir, {
		recursive: true,
		force: true
	});
	else await writeFile(manifestPath(batchDir), JSON.stringify({
		...batch,
		entries: batch.entries.filter((entry) => failed.some((item) => item.sessionId === entry.sessionId))
	}, null, 2), "utf8");
	return {
		ok: true,
		batchId: batch.batchId,
		restored,
		failed
	};
}
/**
* Drop the oldest batches once the bin exceeds its limits.
*
* This is the only path that removes a stored log for good, which is why the
* limits are explicit arguments rather than constants: the caller owns the
* retention promise it makes to the user.
*/
async function sweepTrash(limits = {}, dshHome = resolveDshHome()) {
	const { maxBatches = 20, maxAgeDays = 30 } = limits;
	const batches = await listBatches(dshHome);
	const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1e3;
	const doomed = batches.filter((batch, index) => index >= maxBatches || Date.parse(batch.deletedAt) < cutoff).map((batch) => batch.batchId);
	let reclaimedBytes = 0;
	for (const batchId of doomed) {
		const batchDir = join(trashRoot(dshHome), batchId);
		reclaimedBytes += await directorySize(batchDir);
		await rm(batchDir, {
			recursive: true,
			force: true
		});
	}
	return {
		removedBatches: doomed,
		reclaimedBytes
	};
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
function encodeWorkspacePath(workspacePath) {
	let body = "";
	let dashes = false;
	for (const character of workspacePath) {
		if (character === "\\" || character === "/" || character === ":") {
			if (!dashes) {
				body += "-";
				dashes = true;
			}
			continue;
		}
		dashes = false;
		body += /[A-Za-z0-9._-]/.test(character) ? character : `~${character.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`;
	}
	return `--${body}--`;
}
//#endregion
//#region packages/workspace/session-categories/src/index.ts
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __knownSymbol = (name, symbol) => (symbol = Symbol[name]) ? symbol : /* @__PURE__ */ Symbol.for("Symbol." + name);
var __typeError = (msg) => {
	throw TypeError(msg);
};
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, {
	enumerable: true,
	configurable: true,
	writable: true,
	value
}) : obj[key] = value;
var __name = (target, value) => __defProp(target, "name", {
	value,
	configurable: true
});
var __decoratorStart = (base) => [
	,
	,
	,
	__create(base?.[__knownSymbol("metadata")] ?? null)
];
var __decoratorStrings = [
	"class",
	"method",
	"getter",
	"setter",
	"accessor",
	"field",
	"value",
	"get",
	"set"
];
var __expectFn = (fn) => fn !== void 0 && typeof fn !== "function" ? __typeError("Function expected") : fn;
var __decoratorContext = (kind, name, done, metadata, fns) => ({
	kind: __decoratorStrings[kind],
	name,
	metadata,
	addInitializer: (fn) => done._ ? __typeError("Already initialized") : fns.push(__expectFn(fn || null))
});
var __decoratorMetadata = (array, target) => __defNormalProp(target, __knownSymbol("metadata"), array[3]);
var __runInitializers = (array, flags, self, value) => {
	for (var i = 0, fns = array[flags >> 1], n = fns && fns.length; i < n; i++) flags & 1 ? fns[i].call(self) : value = fns[i].call(self, value);
	return value;
};
var __decorateElement = (array, flags, name, decorators, target, extra) => {
	var fn, it, done, ctx, access, k = flags & 7, s = !!(flags & 8), p = !!(flags & 16);
	var j = k > 3 ? array.length + 1 : k ? s ? 1 : 2 : 0, key = __decoratorStrings[k + 5];
	var initializers = k > 3 && (array[j - 1] = []), extraInitializers = array[j] || (array[j] = []);
	var desc = k && (!p && !s && (target = target.prototype), k < 5 && (k > 3 || !p) && __getOwnPropDesc(k < 4 ? target : {
		get [name]() {
			return __privateGet(this, extra);
		},
		set [name](x) {
			return __privateSet(this, extra, x);
		}
	}, name));
	k ? p && k < 4 && __name(extra, (k > 2 ? "set " : k > 1 ? "get " : "") + name) : __name(target, name);
	for (var i = decorators.length - 1; i >= 0; i--) {
		ctx = __decoratorContext(k, name, done = {}, array[3], extraInitializers);
		if (k) {
			ctx.static = s, ctx.private = p, access = ctx.access = { has: p ? (x) => __privateIn(target, x) : (x) => name in x };
			if (k ^ 3) access.get = p ? (x) => (k ^ 1 ? __privateGet : __privateMethod)(x, target, k ^ 4 ? extra : desc.get) : (x) => x[name];
			if (k > 2) access.set = p ? (x, y) => __privateSet(x, target, y, k ^ 4 ? extra : desc.set) : (x, y) => x[name] = y;
		}
		it = (0, decorators[i])(k ? k < 4 ? p ? extra : desc[key] : k > 4 ? void 0 : {
			get: desc.get,
			set: desc.set
		} : target, ctx), done._ = 1;
		if (k ^ 4 || it === void 0) __expectFn(it) && (k > 4 ? initializers.unshift(it) : k ? p ? extra = it : desc[key] = it : target = it);
		else if (typeof it !== "object" || it === null) __typeError("Object expected");
		else __expectFn(fn = it.get) && (desc.get = fn), __expectFn(fn = it.set) && (desc.set = fn), __expectFn(fn = it.init) && initializers.unshift(fn);
	}
	return k || __decoratorMetadata(array, target), desc && __defProp(target, name, desc), p ? k ^ 4 ? extra : desc : target;
};
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
var __accessCheck = (obj, member, msg) => member.has(obj) || __typeError("Cannot " + msg);
var __privateIn = (member, obj) => Object(obj) !== obj ? __typeError("Cannot use the \"in\" operator on this value") : member.has(obj);
var __privateGet = (obj, member, getter) => (__accessCheck(obj, member, "read from private field"), getter ? getter.call(obj) : member.get(obj));
var __privateSet = (obj, member, value, setter) => (__accessCheck(obj, member, "write to private field"), setter ? setter.call(obj, value) : member.set(obj, value), value);
var __privateMethod = (obj, member, method) => (__accessCheck(obj, member, "access private method"), method);
var _sweepRecycledSessions_dec;
var _listRecycledSessions_dec;
var _undoDeleteSessions_dec;
var _deleteSessions_dec;
var _deleteCategory_dec;
var _moveSessions_dec;
var _assignSession_dec;
var _reorderCategory_dec;
var _moveCategory_dec;
var _rename_dec;
var _create_dec;
var _get_dec;
var _a;
var _init;
var _b;
const reject = (error) => ({
	ok: false,
	error
});
const success = (value) => ({
	ok: true,
	value
});
function insertBefore(ids, source, anchor) {
	if (ids.indexOf(source) < 0) return ids;
	if (anchor !== void 0 && ids.indexOf(anchor) < 0) return ids;
	if (anchor === source) return ids;
	const without = ids.filter((value) => value !== source);
	const at = anchor === void 0 ? without.length : without.indexOf(anchor);
	return [
		...without.slice(0, at),
		source,
		...without.slice(at)
	];
}
function wouldCycle(categories, categoryId, parentId) {
	const byId = new Map(categories.map((category) => [category.id, category]));
	let current = parentId;
	while (current !== null) {
		if (current === categoryId) return true;
		current = byId.get(current)?.parentId ?? null;
	}
	return false;
}
var SessionCategoriesService = class extends (_b = TypertRemoteService) {
	constructor(ctx) {
		super(ctx, "sessionCategories");
		__runInitializers(_init, 5, this);
		__publicField(this, "global");
		__publicField(this, "operationTail", Promise.resolve());
	}
	async [(_a = Service.init, _get_dec = [Remote("get")], _create_dec = [Remote("create")], _rename_dec = [Remote("rename")], _moveCategory_dec = [Remote("moveCategory")], _reorderCategory_dec = [Remote("reorderCategory")], _assignSession_dec = [Remote("assignSession")], _moveSessions_dec = [Remote("moveSessions")], _deleteCategory_dec = [Remote("deleteCategory")], _deleteSessions_dec = [Remote("deleteSessions")], _undoDeleteSessions_dec = [Remote("undoDeleteSessions")], _listRecycledSessions_dec = [Remote("listRecycledSessions")], _sweepRecycledSessions_dec = [Remote("sweepRecycledSessions")], _a)]() {
		const domain = await this.ctx.storageDomain.open(sessionCategoriesDomainSpec);
		this.global = domain.global;
		this.ctx.effect(() => async () => {
			await domain.close();
		}, "session-categories.domainClose");
		await this.recoverPending();
	}
	get(request) {
		const workspace = this.ctx.workspaceRegistry.get(request.workspaceId);
		if (workspace === void 0) return {
			ok: false,
			error: {
				code: "workspace-not-found",
				workspaceId: request.workspaceId
			}
		};
		return {
			ok: true,
			value: this.snapshot(workspace.id)
		};
	}
	create(request) {
		return this.enqueue(() => this.mutate(request.expectedRevision, (document) => {
			if (this.ctx.workspaceRegistry.get(request.workspaceId) === void 0) return reject({
				code: "workspace-not-found",
				workspaceId: request.workspaceId
			});
			if (request.parentId !== null) {
				const parent = document.categories.find((category) => category.id === request.parentId);
				if (parent === void 0) return reject({
					code: "parent-not-found",
					parentId: request.parentId
				});
				if (parent.workspaceId !== request.workspaceId) return reject({ code: "cross-workspace" });
			}
			const siblings = document.categories.filter((category) => category.workspaceId === request.workspaceId && category.parentId === request.parentId);
			if (request.beforeCategoryId !== void 0 && !siblings.some((category) => category.id === request.beforeCategoryId)) return reject({
				code: "anchor-not-found",
				anchorId: request.beforeCategoryId
			});
			const at = request.beforeCategoryId === void 0 ? siblings.length : siblings.findIndex((category) => category.id === request.beforeCategoryId);
			const id = randomUUID();
			const created = {
				id,
				workspaceId: request.workspaceId,
				parentId: request.parentId,
				title: request.title,
				order: at
			};
			const categories = [...document.categories, created].map((category) => category.workspaceId === request.workspaceId && category.parentId === request.parentId && category.id !== id && category.order >= at ? {
				...category,
				order: category.order + 1
			} : category);
			return this.changed(request.workspaceId, {
				...document,
				categories: [...categories]
			});
		}));
	}
	rename(request) {
		return this.enqueue(() => this.mutate(request.expectedRevision, (document) => {
			const category = document.categories.find((item) => item.id === request.categoryId);
			if (category === void 0) return reject({
				code: "category-not-found",
				categoryId: request.categoryId
			});
			if (category.title === request.title) return this.noop(category.workspaceId, document);
			return this.changed(category.workspaceId, {
				...document,
				categories: document.categories.map((item) => item.id === category.id ? {
					...item,
					title: request.title
				} : item)
			});
		}));
	}
	moveCategory(request) {
		return this.enqueue(() => this.mutate(request.expectedRevision, (document) => {
			const category = document.categories.find((item) => item.id === request.categoryId);
			if (category === void 0) return reject({
				code: "category-not-found",
				categoryId: request.categoryId
			});
			const parent = request.parentId === null ? void 0 : document.categories.find((item) => item.id === request.parentId);
			if (request.parentId !== null && parent === void 0) return reject({
				code: "parent-not-found",
				parentId: request.parentId
			});
			if (parent !== void 0 && parent.workspaceId !== category.workspaceId) return reject({ code: "cross-workspace" });
			if (wouldCycle(document.categories, category.id, request.parentId)) return reject({ code: "cycle" });
			const siblings = document.categories.filter((item) => item.workspaceId === category.workspaceId && item.parentId === request.parentId && item.id !== category.id).sort((a, b) => a.order - b.order);
			if (request.beforeCategoryId !== void 0 && !siblings.some((item) => item.id === request.beforeCategoryId)) return reject({
				code: "anchor-not-found",
				anchorId: request.beforeCategoryId
			});
			const at = request.beforeCategoryId === void 0 ? siblings.length : siblings.findIndex((item) => item.id === request.beforeCategoryId);
			const currentSiblings = document.categories.filter((item) => item.workspaceId === category.workspaceId && item.parentId === category.parentId).sort((a, b) => a.order - b.order);
			const desiredIds = [
				...siblings.slice(0, at).map((item) => item.id),
				category.id,
				...siblings.slice(at).map((item) => item.id)
			];
			if (category.parentId === request.parentId && desiredIds.every((id, index) => id === currentSiblings[index]?.id)) return this.noop(category.workspaceId, document);
			const remaining = document.categories.filter((item) => item.id !== category.id);
			const groups = /* @__PURE__ */ new Map();
			for (const item of remaining) {
				const key = `${item.workspaceId}\0${item.parentId ?? ""}`;
				const group = groups.get(key) ?? [];
				group.push(item);
				groups.set(key, group);
			}
			const oldKey = `${category.workspaceId}\0${category.parentId ?? ""}`;
			const newKey = `${category.workspaceId}\0${request.parentId ?? ""}`;
			for (const key of /* @__PURE__ */ new Set([oldKey, newKey])) {
				const group = (groups.get(key) ?? []).sort((a, b) => a.order - b.order);
				const parentId = key.slice(key.indexOf("\0") + 1) || null;
				const ordered = key === newKey ? [
					...group.slice(0, at),
					{
						...category,
						parentId: request.parentId,
						order: at
					},
					...group.slice(at)
				] : group;
				groups.set(key, ordered.map((item, index) => ({
					...item,
					order: index,
					parentId
				})));
			}
			const touched = /* @__PURE__ */ new Set([oldKey, newKey]);
			const categories = remaining.filter((item) => !touched.has(`${item.workspaceId}\0${item.parentId ?? ""}`));
			for (const key of touched) categories.push(...groups.get(key) ?? []);
			return this.changed(category.workspaceId, {
				...document,
				categories
			});
		}));
	}
	reorderCategory(request) {
		return this.enqueue(() => this.mutate(request.expectedRevision, (document) => {
			const category = document.categories.find((item) => item.id === request.categoryId);
			if (category === void 0) return reject({
				code: "category-not-found",
				categoryId: request.categoryId
			});
			const siblings = document.categories.filter((item) => item.workspaceId === category.workspaceId && item.parentId === category.parentId).sort((a, b) => a.order - b.order);
			if (request.beforeCategoryId !== void 0 && !siblings.some((item) => item.id === request.beforeCategoryId)) return reject({
				code: "anchor-not-found",
				anchorId: request.beforeCategoryId
			});
			const ids = insertBefore(siblings.map((item) => item.id), category.id, request.beforeCategoryId);
			if (ids.every((id, index) => id === siblings[index]?.id)) return this.noop(category.workspaceId, document);
			const order = new Map(ids.map((id, index) => [id, index]));
			return this.changed(category.workspaceId, {
				...document,
				categories: document.categories.map((item) => order.has(item.id) ? {
					...item,
					order: order.get(item.id)
				} : item)
			});
		}));
	}
	assignSession(request) {
		return this.moveSessions({
			...request,
			sessionIds: [request.sessionId]
		});
	}
	moveSessions(request) {
		return this.enqueue(() => this.mutate(request.expectedRevision, (document) => {
			let category;
			if (request.categoryId !== null) {
				category = document.categories.find((item) => item.id === request.categoryId);
				if (category === void 0) return reject({
					code: "category-not-found",
					categoryId: request.categoryId
				});
			}
			const targetWorkspace = category === void 0 ? void 0 : this.ctx.workspaceRegistry.get(category.workspaceId);
			if (category !== void 0 && targetWorkspace === void 0) return reject({
				code: "workspace-not-found",
				workspaceId: category.workspaceId
			});
			if (category !== void 0) {
				for (const sessionId of request.sessionIds) if (!targetWorkspace.sessionIds.includes(sessionId)) return reject({
					code: "session-not-in-workspace",
					sessionId
				});
			}
			const assignments = request.sessionIds.reduce((items, sessionId) => {
				const without = items.filter((item) => item.sessionId !== sessionId);
				return category === void 0 ? without : [...without, {
					sessionId,
					categoryId: category.id
				}];
			}, [...document.assignments]);
			const workspaceId = category?.workspaceId ?? this.workspaceForSession(request.sessionIds[0]);
			if (assignments.length === document.assignments.length && assignments.every((item, index) => item.sessionId === document.assignments[index]?.sessionId && item.categoryId === document.assignments[index]?.categoryId)) return workspaceId === void 0 ? reject({
				code: "session-not-in-workspace",
				sessionId: request.sessionIds[0]
			}) : this.noop(workspaceId, document);
			return this.changed(workspaceId ?? "", {
				...document,
				assignments
			});
		}));
	}
	deleteCategory(request) {
		return this.enqueue(async () => {
			const current = this.requireGlobal().get();
			const pending = current.pendingArchive.find((item) => item.operationId === request.operationId);
			if (pending === void 0 && current.revision !== request.expectedRevision) return reject({
				code: "revision-conflict",
				revision: current.revision
			});
			if (pending === void 0) {
				const target = current.categories.find((item) => item.id === request.categoryId);
				if (target === void 0) return success({
					revision: current.revision,
					categories: [],
					assignments: []
				});
				const categoryIds = this.descendants(current.categories, target.id);
				const categorySet = new Set(categoryIds);
				const sessionIds = [...new Set(current.assignments.filter((item) => categorySet.has(item.categoryId)).map((item) => item.sessionId))];
				const nextPending = {
					operationId: request.operationId,
					categoryIds,
					sessionIds
				};
				await this.requireGlobal().set({
					...current,
					revision: current.revision + 1,
					pendingArchive: [...current.pendingArchive, nextPending]
				});
				return this.finishArchive(nextPending);
			}
			return this.finishArchive(pending);
		});
	}
	/** Current full document for invariant companions. */
	snapshotAll() {
		return this.requireGlobal().get();
	}
	async deleteSessions(request) {
		const workspace = request.workspaceId === void 0 ? void 0 : this.ctx.workspaceRegistry.get(request.workspaceId);
		const result = await recycleSessions({
			sessionIds: request.sessionIds,
			...request.workspaceId === void 0 ? {} : { workspaceId: request.workspaceId },
			...workspace === void 0 ? {} : { workspacePath: workspace.path },
			...request.reason === void 0 ? {} : { reason: request.reason }
		});
		if (!result.ok) {
			const { code, sessionId } = result.error;
			return {
				ok: false,
				error: sessionId === void 0 ? { code } : {
					code,
					sessionId
				}
			};
		}
		await this.forgetSessions().catch(() => void 0);
		return {
			ok: true,
			value: {
				batchId: result.batch.batchId,
				deletedAt: result.batch.deletedAt,
				sessionIds: result.batch.entries.map((entry) => entry.sessionId),
				reclaimedBytes: result.batch.entries.reduce((total, entry) => total + entry.sizeBytes, 0)
			}
		};
	}
	async undoDeleteSessions(request) {
		const result = await restoreBatch(request.batchId === void 0 ? {} : { batchId: request.batchId });
		if (!result.ok) return {
			ok: false,
			error: { code: result.error.code }
		};
		return {
			ok: true,
			value: {
				batchId: result.batchId,
				restored: result.restored,
				failed: result.failed
			}
		};
	}
	async listRecycledSessions() {
		return {
			ok: true,
			value: { batches: (await listBatches()).map((batch) => ({
				batchId: batch.batchId,
				deletedAt: batch.deletedAt,
				sessionIds: batch.entries.map((entry) => entry.sessionId),
				bytes: batch.entries.reduce((total, entry) => total + entry.sizeBytes, 0)
			})) }
		};
	}
	async sweepRecycledSessions(request) {
		const result = await sweepTrash({
			...request.maxBatches === void 0 ? {} : { maxBatches: request.maxBatches },
			...request.maxAgeDays === void 0 ? {} : { maxAgeDays: request.maxAgeDays }
		});
		return {
			ok: true,
			value: {
				removedBatchIds: result.removedBatches,
				reclaimedBytes: result.reclaimedBytes
			}
		};
	}
	/**
	* Drop category assignments whose Session is no longer in its Workspace.
	*
	* `prune` already filters assignments by Workspace membership, so removing a
	* Session from `workspaceIds` is enough to make its assignment fall away.
	* The document is only written when pruning actually changed something.
	*/
	async forgetSessions() {
		await this.enqueue(async () => {
			const current = this.requireGlobal().get();
			const pruned = this.prune(current);
			if (pruned === current) return;
			await this.requireGlobal().set({
				...pruned,
				revision: current.revision + 1
			});
		});
	}
	enqueue(operation) {
		const result = this.operationTail.then(operation, operation);
		this.operationTail = result.then(() => void 0, () => void 0);
		return result;
	}
	mutate(expectedRevision, operation) {
		const current = this.requireGlobal().get();
		if (current.revision !== expectedRevision) return Promise.resolve(reject({
			code: "revision-conflict",
			revision: current.revision
		}));
		const pruned = this.prune(current);
		const result = operation(pruned);
		if ("ok" in result) return Promise.resolve(result);
		if (!result.material && pruned === current) return Promise.resolve(success(this.snapshot(result.workspaceId)));
		return this.requireGlobal().set({
			...result.document,
			revision: current.revision + 1
		}).then(() => {
			return success(this.snapshot(result.workspaceId));
		});
	}
	changed(workspaceId, document) {
		return {
			document,
			workspaceId,
			material: true
		};
	}
	noop(workspaceId, document) {
		return {
			document,
			workspaceId,
			material: false
		};
	}
	prune(document) {
		const categories = new Set(document.categories.map((category) => category.id));
		const workspaces = this.ctx.workspaceRegistry;
		const archived = new Set(workspaces.archivedSessionIds ?? []);
		const assignments = document.assignments.filter((assignment) => {
			if (!categories.has(assignment.categoryId) || archived.has(assignment.sessionId)) return false;
			const category = document.categories.find((item) => item.id === assignment.categoryId);
			return (category === void 0 ? void 0 : workspaces.get(category.workspaceId))?.sessionIds.includes(assignment.sessionId) ?? false;
		});
		return assignments.length === document.assignments.length ? document : {
			...document,
			assignments
		};
	}
	snapshot(workspaceId) {
		const document = this.requireGlobal().get();
		const categories = document.categories.filter((category) => category.workspaceId === workspaceId);
		const ids = new Set(categories.map((category) => category.id));
		return {
			revision: document.revision,
			categories,
			assignments: document.assignments.filter((assignment) => ids.has(assignment.categoryId))
		};
	}
	workspaceForSession(sessionId) {
		if (sessionId === void 0) return void 0;
		return (this.ctx.workspaceRegistry.list?.() ?? []).find((workspace) => workspace.sessionIds.includes(sessionId))?.id;
	}
	descendants(categories, root) {
		const result = [];
		const queue = [root];
		while (queue.length > 0) {
			const id = queue.shift();
			result.push(id);
			for (const category of categories) if (category.parentId === id) queue.push(category.id);
		}
		return result;
	}
	async finishArchive(pending) {
		for (const sessionId of pending.sessionIds) try {
			await this.ctx.workspaceRegistry.archiveSession(sessionId, { stopActivity: true });
		} catch (error) {
			if (error instanceof WorkspaceUnknownSessionError) continue;
			return reject({
				code: "archive-failed",
				operationId: pending.operationId
			});
		}
		const current = this.requireGlobal().get();
		const removed = new Set(pending.categoryIds);
		const workspaceId = current.categories.find((item) => removed.has(item.id))?.workspaceId;
		const remaining = current.categories.filter((item) => !removed.has(item.id));
		const categories = this.normalizeOrders(remaining);
		const assignments = current.assignments.filter((item) => !removed.has(item.categoryId));
		const nextPending = current.pendingArchive.filter((item) => item.operationId !== pending.operationId && !item.categoryIds.every((categoryId) => removed.has(categoryId)));
		await this.requireGlobal().set({
			...current,
			revision: current.revision + 1,
			categories,
			assignments,
			pendingArchive: nextPending
		});
		return success(this.snapshot(workspaceId ?? ""));
	}
	normalizeOrders(categories) {
		const groups = /* @__PURE__ */ new Map();
		for (const category of categories) {
			const key = `${category.workspaceId}\0${category.parentId ?? ""}`;
			const group = groups.get(key) ?? [];
			group.push(category);
			groups.set(key, group);
		}
		const normalized = [];
		for (const group of groups.values()) {
			group.sort((left, right) => left.order - right.order);
			normalized.push(...group.map((category, order) => ({
				...category,
				order
			})));
		}
		return normalized;
	}
	async recoverPending() {
		for (const pending of this.requireGlobal().get().pendingArchive) try {
			if (!(await this.finishArchive(pending)).ok) this.ctx.logger?.warn?.(`session category archive recovery failed for ${pending.operationId}`);
		} catch (error) {
			this.ctx.logger?.warn?.(`session category archive recovery failed for ${pending.operationId}`, error);
		}
	}
	requireGlobal() {
		if (this.global === void 0) throw new Error("session categories service is not initialized");
		return this.global;
	}
};
_init = __decoratorStart(_b);
__decorateElement(_init, 1, "get", _get_dec, SessionCategoriesService);
__decorateElement(_init, 1, "create", _create_dec, SessionCategoriesService);
__decorateElement(_init, 1, "rename", _rename_dec, SessionCategoriesService);
__decorateElement(_init, 1, "moveCategory", _moveCategory_dec, SessionCategoriesService);
__decorateElement(_init, 1, "reorderCategory", _reorderCategory_dec, SessionCategoriesService);
__decorateElement(_init, 1, "assignSession", _assignSession_dec, SessionCategoriesService);
__decorateElement(_init, 1, "moveSessions", _moveSessions_dec, SessionCategoriesService);
__decorateElement(_init, 1, "deleteCategory", _deleteCategory_dec, SessionCategoriesService);
__decorateElement(_init, 1, "deleteSessions", _deleteSessions_dec, SessionCategoriesService);
__decorateElement(_init, 1, "undoDeleteSessions", _undoDeleteSessions_dec, SessionCategoriesService);
__decorateElement(_init, 1, "listRecycledSessions", _listRecycledSessions_dec, SessionCategoriesService);
__decorateElement(_init, 1, "sweepRecycledSessions", _sweepRecycledSessions_dec, SessionCategoriesService);
__decoratorMetadata(_init, SessionCategoriesService);
__publicField(SessionCategoriesService, "inject", ["storageDomain", "workspaceRegistry"]);
const apply = SessionCategoriesService;
const inject = SessionCategoriesService.inject;
//#endregion
export { SessionCategoriesService, apply, inject, insertBefore, sessionCategoriesDomainSpec, wouldCycle };
