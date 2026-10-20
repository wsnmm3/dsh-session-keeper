/**
 * Adds the Session recycle methods to the generated typert Remote manifest.
 *
 * `lib/typert.remote-client.js` is emitted by `@deepseek-ai/dsh-typert-generator`
 * from the Host FaceModel, and that generator ships with the dsh monorepo
 * rather than with this standalone repository. The four recycle methods were
 * authored by hand in `packages/workspace/session-categories/src/index.ts`, so
 * their descriptors have to be written into the manifest by hand as well.
 *
 * This script performs that insertion mechanically instead of by editing the
 * generated file: it rebuilds each descriptor from the service source, appends
 * the zod schemas the descriptors reference, and is safe to run again because
 * it replaces its own previous output rather than stacking on top of it.
 *
 * Run: node scripts/inject-recycle-descriptors.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const target = path.join(root, 'lib', 'typert.remote-client.js')
const hostTarget = path.join(root, 'lib', 'typert.host.js')
const source = path.join(root, 'packages', 'workspace', 'session-categories', 'src', 'index.ts')

if (!fs.existsSync(target)) throw new Error(`missing generated manifest: ${target}`)
if (!fs.existsSync(source)) throw new Error(`missing service source: ${source}`)

const manifest = fs.readFileSync(target, 'utf8')
const service = fs.readFileSync(source, 'utf8')

// The Host-side manifest decides which Remote methods the gateway will accept:
// a method missing from its `invocations` array is rejected before the service
// is ever reached. It carries no recycle descriptors either, so the same
// rebuild is written there — into a *copy* of the reference manifest that this
// script owns (`lib/typert.host.js` when present, otherwise `seed/`).
const hostSeed = path.join(root, 'seed', 'typert.host.js')
const hostSource = fs.existsSync(hostTarget) ? hostTarget : hostSeed
const hostManifest = fs.existsSync(hostSource) ? fs.readFileSync(hostSource, 'utf8') : null

/**
 * The four methods this script owns, paired with the published type names the
 * manifest references and the field shapes needed to rebuild their schemas.
 *
 * `line` is resolved from the service source at run time rather than hardcoded
 * so the `sourceLocation` entries keep pointing at real decorators after the
 * file is edited again.
 */
const METHODS = [
  {
    method: 'deleteSessions',
    request: 'SessionRecycleDeleteRequest',
    result: 'SessionRecycleDeleteResult',
    requestShape: {
      sessionIds: { kind: 'array', of: { kind: 'string' } },
      workspaceId: { kind: 'optional-string' },
      reason: { kind: 'optional-string' },
      scope: { kind: 'optional-enum', values: ['record', 'artifacts', 'everything'] },
    },
    resultVariants: [
      {
        ok: true,
        fields: {
          batchId: { kind: 'string' },
          deletedAt: { kind: 'string' },
          sessionIds: { kind: 'array', of: { kind: 'string' } },
          bytes: { kind: 'number' },
          artifactCount: { kind: 'number' },
          artifactBytes: { kind: 'number' },
          releasedArchived: { kind: 'array', of: { kind: 'string' } },
          detachedFrom: { kind: 'array', of: { kind: 'string' } },
        },
      },
      {
        ok: false,
        errorVariants: [
          { code: 'session-log-not-found', fields: { sessionId: { kind: 'optional-string' } } },
        ],
        // The host echoes whatever code the recycle module reported, so the
        // failure branch accepts any string rather than a closed union.
        openCode: true,
      },
    ],
  },
  {
    method: 'undoDeleteSessions',
    request: 'SessionRecycleUndoRequest',
    result: 'SessionRecycleUndoResult',
    requestShape: { batchId: { kind: 'optional-string' } },
    resultVariants: [
      {
        ok: true,
        fields: {
          batchId: { kind: 'string' },
          restored: { kind: 'array', of: { kind: 'string' } },
          failed: {
            kind: 'array',
            of: {
              kind: 'object',
              fields: { sessionId: { kind: 'string' }, reason: { kind: 'string' } },
            },
          },
          reattached: { kind: 'array', of: { kind: 'string' } },
          rearchived: { kind: 'array', of: { kind: 'string' } },
        },
      },
      {
        ok: false,
        errorVariants: [{ code: 'no-batch', fields: {} }],
        openCode: true,
      },
    ],
  },
  {
    method: 'listRecycledSessions',
    request: null,
    result: 'SessionRecycleListResult',
    resultVariants: [
      {
        ok: true,
        fields: {
          batches: {
            kind: 'array',
            of: {
              kind: 'object',
              fields: {
                batchId: { kind: 'string' },
                deletedAt: { kind: 'string' },
                sessionIds: { kind: 'array', of: { kind: 'string' } },
                bytes: { kind: 'number' },
                reason: { kind: 'optional-string' },
                scope: { kind: 'optional-enum', values: ['record', 'artifacts', 'everything'] },
                artifactCount: { kind: 'optional-number' },
              },
            },
          },
          totalBytes: { kind: 'number' },
        },
      },
    ],
  },
  {
    method: 'sweepRecycledSessions',
    request: 'SessionRecycleSweepRequest',
    result: 'SessionRecycleSweepResult',
    requestShape: {
      maxBatches: { kind: 'optional-number' },
      maxAgeDays: { kind: 'optional-number' },
    },
    resultVariants: [
      {
        ok: true,
        fields: {
          removedBatches: { kind: 'array', of: { kind: 'string' } },
          reclaimedBytes: { kind: 'number' },
        },
      },
    ],
  },
  {
    method: 'scanSession',
    request: 'SessionRecycleScanRequest',
    result: 'SessionRecycleScanResult',
    requestShape: { sessionId: { kind: 'string' } },
    resultVariants: [
      {
        ok: true,
        fields: {
          sessionId: { kind: 'string' },
          cwd: { kind: 'string' },
          storeBytes: { kind: 'number' },
          directories: { kind: 'number' },
          artifacts: {
            kind: 'array',
            of: {
              kind: 'object',
              fields: {
                displayPath: { kind: 'string' },
                bytes: { kind: 'number' },
                ops: { kind: 'string' },
              },
            },
          },
          refused: {
            kind: 'array',
            of: {
              kind: 'object',
              fields: { path: { kind: 'string' }, reason: { kind: 'string' } },
            },
          },
          artifactBytes: { kind: 'number' },
          warnings: { kind: 'array', of: { kind: 'string' } },
        },
      },
    ],
  },
  {
    method: 'readTranscript',
    request: 'SessionRecycleTranscriptRequest',
    result: 'SessionRecycleTranscriptResult',
    requestShape: {
      sessionId: { kind: 'string' },
      limit: { kind: 'optional-number' },
    },
    resultVariants: [
      {
        ok: true,
        fields: {
          sessionId: { kind: 'string' },
          found: { kind: 'boolean' },
          trashed: { kind: 'boolean' },
          total: { kind: 'number' },
          toolCalls: { kind: 'number' },
          messages: {
            kind: 'array',
            of: {
              kind: 'object',
              fields: {
                role: { kind: 'enum', values: ['user', 'assistant', 'tool'] },
                type: { kind: 'string' },
                text: { kind: 'string' },
                time: { kind: 'optional-number' },
              },
            },
          },
        },
      },
    ],
  },
  {
    method: 'listTrashedSessions',
    request: null,
    result: 'SessionRecycleTrashedResult',
    resultVariants: [
      {
        ok: true,
        fields: {
          sessions: {
            kind: 'array',
            of: {
              kind: 'object',
              fields: {
                sessionId: { kind: 'string' },
                batchId: { kind: 'string' },
                deletedAt: { kind: 'string' },
                bytes: { kind: 'number' },
                container: { kind: 'string' },
              },
            },
          },
        },
      },
    ],
  },
  {
    method: 'purgeBatch',
    request: 'SessionRecyclePurgeRequest',
    result: 'SessionRecyclePurgeResult',
    requestShape: { batchId: { kind: 'string' } },
    resultVariants: [
      {
        ok: true,
        fields: {
          batchId: { kind: 'string' },
          reclaimedBytes: { kind: 'number' },
        },
      },
      {
        ok: false,
        errorVariants: [{ code: 'batch-not-found', fields: { batchId: { kind: 'optional-string' } } }],
        openCode: true,
      },
    ],
  },
]

/** Prefix the generator uses for schema bindings of this package. */
const BINDING = '_deepseek_ai_dsh_session_categories_sessionCategories'

/** Render one field as the zod expression the generator would emit. */
function renderField(field, indent) {
  const pad = ' '.repeat(indent)
  switch (field.kind) {
    case 'string':
      return `z.string().readonly()`
    case 'number':
      return `z.number().readonly()`
    case 'optional-string':
      return `z.intersection(z.string(), z.unknown()).readonly().optional()`
    case 'optional-number':
      return `z.number().readonly().optional()`
    case 'boolean':
      return `z.boolean().readonly()`
    case 'enum':
      return `z.union([${field.values.map(value => `z.literal(${JSON.stringify(value)})`).join(', ')}]).readonly()`
    case 'optional-enum':
      return `z.union([${field.values.map(value => `z.literal(${JSON.stringify(value)})`).join(', ')}]).readonly().optional()`
    case 'array':
      return `z.array(${renderField(field.of, indent)}).readonly()`
    case 'object': {
      const inner = Object.entries(field.fields)
        .map(([name, value]) => `${pad}  '${name}': ${renderField(value, indent + 2)},`)
        .join('\n')
      return `z.object({\n${inner}\n${pad}}).readonly()`
    }
    default:
      throw new Error(`unhandled field kind ${field.kind}`)
  }
}

/** Render the whole result schema for one method. */
function renderResultSchema(entry) {
  const variants = entry.resultVariants.map(variant => {
    const fields = Object.entries(variant.fields ?? {})
      .map(([name, value]) => `  '${name}': ${renderField(value, 2)},`)
      .join('\n')
    const value = `z.object({\n  'ok': z.literal(${variant.ok}).readonly(),\n${fields}\n})`

    if (variant.ok) {
      const wrapped = fields.length === 0 ? 'z.object({}).readonly()' : `z.object({\n${fields}\n}).readonly()`
      return `z.object({\n  'ok': z.literal(true).readonly(),\n  'value': ${wrapped},\n})`
    }

    const errors = variant.errorVariants.map(error => {
      const errorFields = Object.entries(error.fields ?? {})
        .map(([name, fieldValue]) => `  '${name}': ${renderField(fieldValue, 2)},`)
        .join('\n')
      // `code` is a literal when the host closes the union and a plain string
      // when it forwards an open-ended code from a lower layer.
      const code = variant.openCode ? `z.string().readonly()` : `z.literal(${JSON.stringify(error.code)}).readonly()`
      return `z.object({\n  'code': ${code}${errorFields.length === 0 ? '' : ',\n' + errorFields}\n})`
    })
    const union = errors.length === 1 ? errors[0] : `z.union([${errors.join(', ')}])`
    return `z.object({\n  'ok': z.literal(false).readonly(),\n  'error': ${union}.readonly(),\n})`
  })
  return variants.length === 1 ? variants[0] : `z.union([${variants.join(', ')}])`
}

/** Render the request schema, or null when the method takes no argument. */
function renderRequestSchema(entry) {
  if (entry.requestShape === null) return null
  const fields = Object.entries(entry.requestShape)
    .map(([name, value]) => `  '${name}': ${renderField(value, 2)},`)
    .join('\n')
  return `z.object({\n${fields}\n})`
}

/** Line number of the `@Remote('<method>')` decorator in the service source. */
function decoratorLine(method) {
  const lines = service.split(/\r?\n/)
  const index = lines.findIndex(line => line.includes(`@Remote('${method}')`))
  return index < 0 ? 1 : index + 1
}

// 1. Serialize one descriptor per method, matching the generated formatting.
const descriptors = METHODS.map(entry => {
  const parameters = entry.request === null ? '[]' : `[
        {
          name: 'request',
          wire: 'request',
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: 'dsh-session-keeper/types#${entry.request}',
            create: () => ${BINDING}_${entry.method}_parameter_0$schema,
          },
        },
      ]`
  return `    {
      id: 'dsh-session-keeper#sessionCategories/${entry.method}',
      service: 'sessionCategories',
      namespace: 'sessionCategories',
      method: '${entry.method}',
      invocation: { kind: 'direct' },
      parameters: ${parameters},
      result: {
        mode: 'strict',
        typeSymbol: 'dsh-session-keeper/types#${entry.result}',
        create: () => ${BINDING}_${entry.method}_result$schema,
      },
      sourceLocation: {"file":"packages/workspace/session-categories/src/index.ts","line":${decoratorLine(entry.method)},"column":3},
    },`
})

// 2. Serialize the zod bindings those descriptors reference.
const schemas = METHODS.flatMap(entry => {
  const parts = []
  if (entry.request !== null) {
    parts.push(`const ${BINDING}_${entry.method}_parameter_0$schema = ${renderRequestSchema(entry)}`)
  }
  parts.push(`const ${BINDING}_${entry.method}_result$schema = ${renderResultSchema(entry)}`)
  return parts
})

// 3. Start from the manifest with any previous run of this script removed, so
//    re-running replaces rather than duplicates.
//
//    A previous run left two things behind: a schema block above the
//    `TYPERT_REMOTE` literal and a descriptor block before the array close.
//    Both are removed by cutting from the marker to the literal, then trimming
//    the trailing descriptors this script appended.
const MARKER = '// --- session recycle methods (added by scripts/inject-recycle-descriptors.mjs) ---'
let next = manifest

// Drop the descriptor block appended by a previous run: everything between the
// last generated descriptor and the array close is this script's own output.
const OWN_METHODS = METHODS.map(entry => entry.method)
if (next.includes(`sessionCategories/${OWN_METHODS[0]}'`)) {
  const firstOwn = next.indexOf(`id: 'dsh-session-keeper#sessionCategories/${OWN_METHODS[0]}'`)
  // Walk back to the start of that descriptor object.
  const objectStart = next.lastIndexOf('    {\n', firstOwn)
  const arrayClose = next.indexOf('  ],\n}\n', firstOwn)
  if (objectStart >= 0 && arrayClose > objectStart) {
    next = next.slice(0, objectStart) + next.slice(arrayClose)
  }
}

// Drop the schema block a previous run inserted.
if (next.includes(MARKER)) {
  const markerAt = next.indexOf(MARKER)
  const literalAt = next.indexOf('const TYPERT_REMOTE = {')
  if (literalAt > markerAt) next = next.slice(0, markerAt) + next.slice(literalAt)
}

// 4. Append the schemas just above the descriptor array.
const schemaBlock = `${MARKER}\n${schemas.join('\n')}\n`
const descriptorsAt = next.indexOf('const TYPERT_REMOTE = {')
if (descriptorsAt < 0) throw new Error('could not find the TYPERT_REMOTE literal')
// Split any `export` keyword that sits directly above the declaration, so the
// emitted module reads `<schemas>\n\nexport const TYPERT_REMOTE = {` instead of
// a dangling `export` followed by the marker comment (a syntax error).
next = next.slice(0, descriptorsAt).replace(/export[ \t]*\n?[ \t]*$/, '')
  + schemaBlock
  + 'export '
  + next.slice(descriptorsAt)

// 5. Append the descriptors before the closing bracket of the descriptors array.
const closing = next.lastIndexOf('  ],\n}\n')
if (closing < 0) throw new Error('could not find the descriptors array close')
next = next.slice(0, closing) + descriptors.join('\n') + '\n' + next.slice(closing)

fs.writeFileSync(target, next)

console.log(`inject: added ${METHODS.length} descriptors (${METHODS.map(m => m.method).join(', ')})`)
console.log(`inject: manifest is now ${next.length} bytes`)

// 6. The Host face: same descriptors, same schemas, plus the model entries the
//    generator would have written for them. Nothing in this block is load
//    bearing for dispatch — `invocations` and `schemas` are — but a manifest
//    that advertises members it has no types for confuses the loader's
//    self-description, so the model is kept in step with the invocations.
function hostEntry(entry) {
  const parameters = entry.request === null ? '[]' : `[
        {
          name: 'request',
          wire: 'request',
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: 'dsh-session-keeper/types#${entry.request}',
            create: () => ${BINDING}_${entry.method}_parameter_0$schema,
          },
        },
      ]`
  return `    {
      id: 'dsh-session-keeper#sessionCategories/${entry.method}',
      service: 'sessionCategories',
      namespace: 'sessionCategories',
      method: '${entry.method}',
      invocation: { kind: 'direct' },
      parameters: ${parameters},
      result: {
        mode: 'strict',
        typeSymbol: 'dsh-session-keeper/types#${entry.result}',
        create: () => ${BINDING}_${entry.method}_result$schema,
      },
      sourceLocation: {"file":"packages/workspace/session-categories/src/index.ts","line":${decoratorLine(entry.method)},"column":3},
    },`
}

const MEMBERS_CLOSE = '        ],\n        "types": ['
const MEMBERS_MARKER = '        // --- session recycle members (added by scripts/inject-recycle-descriptors.mjs) ---'
const MEMBERS_MARKER_END = '        // --- end session recycle members ---'
const TYPES_MARKER = '        // --- session recycle types (added by scripts/inject-recycle-descriptors.mjs) ---'
const TYPES_MARKER_END = '        // --- end session recycle types ---'

if (hostManifest !== null) {
  let hostNext = hostManifest

  // Remove what an earlier run appended: the descriptors before the array
  // close, and the model members/types riding just above `"events": []`.
  for (const entry of METHODS) {
    const ownAt = hostNext.indexOf(`id: 'dsh-session-keeper#sessionCategories/${entry.method}'`)
    if (ownAt < 0) continue
    const objectStart = hostNext.lastIndexOf('    {\n', ownAt)
    const objectEnd = hostNext.indexOf('\n    },\n', ownAt)
    if (objectStart >= 0 && objectEnd > objectStart) {
      hostNext = hostNext.slice(0, objectStart) + hostNext.slice(objectEnd + '\n    },\n'.length)
    }
  }
  // A dangling `export` left ahead of the marker by an earlier version of this
  // script is stripped first, so re-running repairs the file instead of
  // inheriting the syntax error.
  hostNext = hostNext.replace(/export[ \t]*\n?[ \t]*(?=\/\/ --- session recycle methods)/, '')
  if (hostNext.includes(MARKER)) {
    const markerAt = hostNext.indexOf(MARKER)
    const literalAt = hostNext.indexOf('const TYPERT = {', markerAt)
    if (literalAt > markerAt) hostNext = hostNext.slice(0, markerAt) + hostNext.slice(literalAt)
  }
  if (hostNext.includes(MEMBERS_MARKER)) {
    const at = hostNext.indexOf(MEMBERS_MARKER)
    const end = at + MEMBERS_MARKER.length
    const closeAt = hostNext.indexOf(MEMBERS_MARKER_END, end)
    if (closeAt > end) hostNext = hostNext.slice(0, at) + hostNext.slice(closeAt + MEMBERS_MARKER_END.length)
  }
  if (hostNext.includes(TYPES_MARKER)) {
    const at = hostNext.indexOf(TYPES_MARKER)
    const end = at + TYPES_MARKER.length
    const closeAt = hostNext.indexOf(TYPES_MARKER_END, end)
    if (closeAt > end) hostNext = hostNext.slice(0, at) + hostNext.slice(closeAt + TYPES_MARKER_END.length)
  }

  const hostSchemas = schemas.join('\n')
  // Anchor on the bare declaration, then re-attach the export keyword the
  // generated file puts above it, so the emitted module always exports TYPERT.
  const hostLiteralAt = hostNext.indexOf('const TYPERT = {')
  if (hostLiteralAt < 0) throw new Error('could not find the TYPERT literal in the host manifest')
  // The schema block always goes *above* `export const TYPERT`. Anchoring the
  // insert on a bare `export` keyword is what once split it away from the
  // declaration and left a dangling `export` ahead of the marker comment — a
  // syntax error that made the whole host module fail to import. Inserting at
  // the declaration target instead can never consume the keyword.
  hostNext = hostNext.slice(0, hostLiteralAt)
    + `${MARKER}\n${hostSchemas}\n\n`
    + 'export '
    + hostNext.slice(hostLiteralAt)

  const hostArrayClose = hostNext.lastIndexOf('  ],\n  model: {')
  if (hostArrayClose < 0) throw new Error('could not find the host invocations array close')
  hostNext = hostNext.slice(0, hostArrayClose)
    + METHODS.map(hostEntry).join('\n') + '\n'
    + hostNext.slice(hostArrayClose)

  const membersAt = hostNext.indexOf('"members": [')
  const membersClose = hostNext.indexOf(MEMBERS_CLOSE, membersAt)
  if (membersAt < 0 || membersClose < 0) throw new Error('could not find the host model members array')
  const memberEntries = METHODS.map(entry => {
    const signature = entry.request === null
      ? `@Remote('${entry.method}') ${entry.method}(): Promise<${entry.result}>`
      : `@Remote('${entry.method}') ${entry.method}(request: ${entry.request}): Promise<${entry.result}>`
    return `          {
            "kind": "method",
            "name": "${entry.method}",
            "signature": ${JSON.stringify(signature)},
            "summary": "",
            "jsDoc": "/** Restored from the recycle route. */"
          },`
  }).join('\n')
  // Keep the original close of the members array and slip the new entries in
  // ahead of it. A previous run's marker pair is removed first, so the block
  // sits inside its own fences and the array never ends up with a doubled
  // comma or a trailing one.
  const rest = hostNext.slice(membersClose + MEMBERS_CLOSE.length)
  const membersHead = hostNext.slice(0, membersClose).trimEnd()
  const membersNeedComma = !membersHead.endsWith(',')
  hostNext = membersHead + (membersNeedComma ? ',' : '')
    + '\n' + MEMBERS_MARKER + '\n' + memberEntries + '\n' + MEMBERS_MARKER_END + '\n'
    + MEMBERS_CLOSE + rest

  const typesAt = hostNext.indexOf('        "types": [')
  const typesClose = hostNext.indexOf('\n        ]\n      }', typesAt)
  if (typesAt < 0 || typesClose < 0) throw new Error('could not find the host model types array')
  const typeEntries = METHODS.flatMap(entry => {
    const names = [entry.request, entry.result].filter(Boolean)
    return names.map(name => `          {
            "name": "${name}",
            "declaration": "export type ${name} = ImportedFromWire;"
          },`)
  }).join('\n')
  const typesHeadBlock = hostNext.slice(0, typesClose).trimEnd()
  const typesNeedComma = !typesHeadBlock.endsWith(',')
  hostNext = typesHeadBlock + (typesNeedComma ? ',' : '')
    + '\n' + TYPES_MARKER + '\n' + typeEntries + '\n' + TYPES_MARKER_END
    + hostNext.slice(typesClose)

  fs.writeFileSync(hostSource, hostNext)
  console.log(`inject: host manifest updated (${hostSource.endsWith('seed') ? 'seed copy' : 'lib copy'}) — ${hostNext.length} bytes, ${METHODS.length} invocations added`)
} else {
  console.log('inject: no host manifest to update (skipped)')
}
