/** Per-source discovery documents. Managed checkouts survive process restarts; mutable trees refresh only on reads. */
import { createHash } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import { join, resolve } from 'node:path'
import { readFile, realpath } from 'node:fs/promises'
import { MANIFEST_ALIASES, MARKETPLACE_PATHS, PLUGIN_LAYOUTS } from '../../../market-contracts/src/model/layouts.js'
import { gitHead } from '../scanning/git.js'
import { isWithin } from '../scanning/paths.js'
import { isDirectory } from '../scanning/fs-probes.js'
import { scanSourceCheckout, type SourceCheckout } from '../scanning/source-catalog.js'
import { marketplaceEntryHint, readSuite, resolveMarketplaceEntry } from '../scanning/scan-resolvers.js'
import { readMarketplaces } from '../scanning/manifests.js'
import type { DiscoveredSuite, SuiteDimension } from '../../../market-contracts/src/model/types.js'
import { readJsonFile, writeJsonDocument } from './json-file.js'
import { SOURCE_INDEX_VERSION, sourceBindingsSchema, sourceIndexSchema, type SourceBindingsDocument } from './source-index-schema.js'

type Discovery = { suites: DiscoveredSuite[]; notes: string[]; expiresAt?: number }
interface ResidentIndex {
  identity: string
  sourceKey: string
  result: Discovery
}
type SourceBindings = Omit<SourceBindingsDocument, 'version'>
const MAX_RESIDENT_SOURCES = 64

export class SourceIndexStore {
  private readonly resident = new Map<string, ResidentIndex>()
  private readonly bindings = new Map<string, SourceBindings>()
  private readonly pending = new Map<string, Promise<Discovery>>()
  private readonly generations = new Map<string, number>()
  private readonly invalidated = new Set<string>()
  private readonly writes = new Map<string, Promise<void>>()
  private readonly changes = new Map<string, { done: Promise<void>; release: () => void }>()
  private readonly changing = new AsyncLocalStorage<ReadonlySet<string>>()
  private disposed = false

  constructor(
    private readonly dataRoot: string,
    private readonly now: () => number
  ) {}

  /** Reuse managed content indefinitely in-process; an explicit content mutation invalidates its generation. */
  async read(
    entry: SourceCheckout,
    dimension: SuiteDimension,
    dimensionRoot: string,
    mutableTtlMs: number,
    force = false,
    installedSuiteIds?: readonly string[]
  ): Promise<Discovery> {
    const key = this.key(entry.sourceId, dimension, dimensionRoot)
    if (this.changing.getStore()?.has(key)) throw new Error('read a changing source through the index refresh owner')
    for (let change = this.changes.get(key); change !== undefined; change = this.changes.get(key)) await change.done
    return this.readIndex(entry, dimension, dimensionRoot, mutableTtlMs, force, installedSuiteIds)
  }

  /** The source mutation owner rebuilds after its file changes, before releasing readers. */
  async refresh(entry: SourceCheckout, dimension: SuiteDimension, dimensionRoot: string, mutableTtlMs: number): Promise<Discovery> {
    return this.readIndex(entry, dimension, dimensionRoot, mutableTtlMs, true)
  }

  private async readIndex(
    entry: SourceCheckout,
    dimension: SuiteDimension,
    dimensionRoot: string,
    mutableTtlMs: number,
    force: boolean,
    installedSuiteIds?: readonly string[]
  ): Promise<Discovery> {
    if (this.disposed) throw new Error('catalog is disposed')
    const key = this.key(entry.sourceId, dimension, dimensionRoot)
    const identity = JSON.stringify([resolve(entry.checkout), entry.source ?? null, entry.sourceUrl ?? null])
    const mutable = dimension === 'project' || entry.source === undefined || entry.source.local === true || entry.source.kind === 'local' || entry.source.adopted === true
    const wanted = mutable && installedSuiteIds !== undefined ? [...new Set(installedSuiteIds)].sort() : undefined
    const cacheKey = wanted === undefined ? key : JSON.stringify([key, 'installed', wanted])
    const exists = await isDirectory(entry.checkout)
    if (this.disposed) throw new Error('catalog is disposed')
    if (!exists) {
      await this.invalidate([entry.sourceId], dimension, dimensionRoot)
      return { suites: [], notes: ['source checkout directory is unavailable; refresh the source to restore it'], expiresAt: this.now() + mutableTtlMs }
    }
    const cached = this.resident.get(cacheKey)
    if (!force && cached?.identity === identity && (!mutable || this.now() < (cached.result.expiresAt ?? 0))) {
      this.resident.delete(cacheKey)
      this.resident.set(cacheKey, cached)
      return cached.result
    }
    const generation = this.generations.get(key) ?? 0
    const workKey = JSON.stringify([cacheKey, identity, generation])
    const inFlight = this.pending.get(workKey)
    if (inFlight !== undefined) return inFlight
    const work =
      wanted === undefined
        ? this.load(entry, dimension, key, identity, generation, mutable, force)
        : this.loadInstalled(entry, dimension, dimensionRoot, key, identity, generation, mutableTtlMs, wanted, force)
    const promise = work
      .then(discovered => {
        const result = mutable ? { ...discovered, expiresAt: discovered.expiresAt ?? this.now() + mutableTtlMs } : discovered
        if (!this.disposed && generation === (this.generations.get(key) ?? 0)) {
          this.resident.delete(cacheKey)
          this.resident.set(cacheKey, { identity, sourceKey: key, result })
          while (this.resident.size > MAX_RESIDENT_SOURCES) this.resident.delete(this.resident.keys().next().value!)
        }
        return result
      })
      .finally(() => {
        if (this.pending.get(workKey) === promise) this.pending.delete(workKey)
      })
    this.pending.set(workKey, promise)
    return promise
  }

  /** Serialize source changes and hold readers until the owner publishes or fails. Nested acquisition shares ownership. */
  async change<T>(sourceIds: readonly string[], dimension: SuiteDimension, dimensionRoot: string, action: () => Promise<T>): Promise<T> {
    if (this.disposed) throw new Error('catalog is disposed')
    const parent = this.changing.getStore() ?? new Set<string>()
    const owned: Array<{ key: string; sourceId: string; gate: { done: Promise<void>; release: () => void } }> = []
    try {
      for (const sourceId of [...new Set(sourceIds)].sort()) {
        const key = this.key(sourceId, dimension, dimensionRoot)
        if (parent.has(key)) continue
        const prior = this.changes.get(key)
        let release!: () => void
        const done = new Promise<void>(resolve => {
          release = resolve
        })
        const gate = { done, release }
        this.changes.set(key, gate)
        owned.push({ key, sourceId, gate })
        await prior?.done
      }
      if (this.disposed) throw new Error('catalog is disposed')
      await this.invalidate(
        owned.map(entry => entry.sourceId),
        dimension,
        dimensionRoot
      )
      return await this.changing.run(new Set([...parent, ...owned.map(entry => entry.key)]), action)
    } finally {
      for (const { key, gate } of owned) {
        if (this.changes.get(key) === gate) this.changes.delete(key)
        gate.release()
      }
    }
  }

  /** Persist the invalidation before changing a checkout, including archives and non-Git legacy checkouts. */
  async invalidate(sourceIds: readonly string[], dimension: SuiteDimension, dimensionRoot: string): Promise<void> {
    await Promise.all(
      sourceIds.map(async sourceId => {
        const key = this.key(sourceId, dimension, dimensionRoot)
        const generation = (this.generations.get(key) ?? 0) + 1
        this.generations.set(key, generation)
        for (const [residentKey, value] of this.resident) if (value.sourceKey === key) this.resident.delete(residentKey)
        this.bindings.delete(key)
        this.invalidated.add(key)
        await this.write(key, generation, { version: SOURCE_INDEX_VERSION, invalidated: true })
      })
    )
  }

  /** Stop new reads and join scans and their atomic writes before the storage owner tears down. */
  async dispose(): Promise<void> {
    this.disposed = true
    await Promise.allSettled([...this.changes.values()].map(change => change.done))
    await Promise.allSettled(this.pending.values())
    await Promise.allSettled(this.writes.values())
    this.resident.clear()
    this.bindings.clear()
  }

  private key(sourceId: string, dimension: SuiteDimension, dimensionRoot: string): string {
    return JSON.stringify([dimension, resolve(dimensionRoot), sourceId])
  }

  private path(key: string): string {
    return join(this.dataRoot, 'catalog-index', createHash('sha256').update(key).digest('hex') + '.json')
  }

  private async load(entry: SourceCheckout, dimension: SuiteDimension, key: string, identity: string, generation: number, mutable: boolean, force: boolean): Promise<Discovery> {
    // HEAD checks occur only when loading a managed source into this process, not on runtime reads.
    const revision = mutable ? undefined : entry.source?.kind === 'archive' ? entry.source.sha256 : await gitHead(entry.checkout).catch(() => undefined)
    if (!mutable && !force && !this.invalidated.has(key)) {
      let raw: unknown
      try {
        raw = await readJsonFile(this.path(key))
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error
      }
      const parsed = sourceIndexSchema.safeParse(raw)
      if (parsed.success && parsed.data.identity === identity && parsed.data.revision === revision && this.contained(parsed.data.suites, entry, dimension)) {
        return { suites: parsed.data.suites, notes: parsed.data.notes }
      }
    }
    const routingSignature = mutable && dimension === 'user' ? await this.routingSignature(entry.checkout) : undefined
    const result = await scanSourceCheckout(entry, dimension)
    if (!this.disposed && dimension === 'user' && generation === (this.generations.get(key) ?? 0)) {
      const roots = result.bindings ?? result.suites.filter(suite => suite.remote === undefined).map(suite => ({ id: suite.id, root: suite.root }))
      // Mutable content contributes routing hints, never authoritative cached declarations.
      const document = mutable
        ? sourceBindingsSchema.parse({ version: SOURCE_INDEX_VERSION, identity, routingSignature, marketplacePath: result.marketplacePath, roots })
        : sourceIndexSchema.parse({ version: SOURCE_INDEX_VERSION, identity, revision, suites: result.suites, notes: result.notes })
      if (!this.contained(result.suites, entry, dimension)) throw new Error('source index contains resources outside its checkout')
      await this.write(key, generation, document)
      if (generation === (this.generations.get(key) ?? 0)) {
        this.invalidated.delete(key)
        if (mutable && routingSignature !== undefined) this.rememberBindings(key, { identity, routingSignature, roots, marketplacePath: result.marketplacePath })
      }
    }
    return { suites: result.suites, notes: result.notes }
  }

  private async loadInstalled(
    entry: SourceCheckout,
    dimension: SuiteDimension,
    dimensionRoot: string,
    key: string,
    identity: string,
    generation: number,
    ttl: number,
    wanted: readonly string[],
    force: boolean
  ): Promise<Discovery> {
    const full = this.resident.get(key)
    const selected = new Set(wanted)
    if (!force && full?.identity === identity && this.now() < (full.result.expiresAt ?? 0))
      return { ...full.result, suites: full.result.suites.filter(suite => selected.has(suite.id)) }
    let bindings = this.bindings.get(key)
    if (bindings?.identity !== identity) bindings = undefined
    if (bindings === undefined && !this.invalidated.has(key)) {
      let raw: unknown
      try {
        raw = await readJsonFile(this.path(key))
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error
      }
      const parsed = sourceBindingsSchema.safeParse(raw)
      if (parsed.success && parsed.data.identity === identity && parsed.data.roots.every(hint => hint.root !== '' && isWithin(resolve(entry.checkout), resolve(hint.root)))) {
        bindings = parsed.data
        if (generation === (this.generations.get(key) ?? 0)) this.rememberBindings(key, bindings)
      }
    }
    if (bindings !== undefined && bindings.routingSignature === (await this.routingSignature(entry.checkout)) && wanted.every(id => bindings.roots.some(hint => hint.id === id))) {
      const checkout = await realpath(entry.checkout).catch(() => undefined)
      const marketplace = bindings.marketplacePath === undefined ? undefined : (await readMarketplaces(entry.checkout)).find(market => market.path === bindings.marketplacePath)
      const roots = bindings.roots.filter(hint => selected.has(hint.id))
      const results = await Promise.all(
        roots.map(async binding => {
          const canonical = await realpath(binding.root).catch(() => undefined)
          if (checkout === undefined || canonical === undefined || !isWithin(checkout, canonical)) return { suites: [], notes: [] }
          const declaredEntry = binding.entryIndex === undefined ? undefined : marketplace?.entries[binding.entryIndex]
          if (binding.entryIndex !== undefined) {
            if (declaredEntry === undefined) return { suites: [], notes: [] }
            const route = await resolveMarketplaceEntry(entry.checkout, declaredEntry, entry.sourceUrl)
            if (route.kind !== 'local' || !isWithin(route.dir, binding.root)) return { suites: [], notes: [] }
          }
          const notes: string[] = []
          const suite = await readSuite(binding.root, entry.sourceId, dimension, declaredEntry === undefined ? undefined : marketplaceEntryHint(declaredEntry), notes)
          return { suites: suite === undefined ? [] : [suite], notes }
        })
      )
      const suites = results.flatMap(result => result.suites).filter(suite => selected.has(suite.id))
      // A moved root or marketplace alias needs the full resolver to recover its canonical identity.
      if (wanted.every(id => suites.some(suite => suite.id === id))) return { suites, notes: results.flatMap(result => result.notes) }
    }
    const discovered = await this.read(entry, dimension, dimensionRoot, ttl, force)
    return { ...discovered, suites: discovered.suites.filter(suite => selected.has(suite.id)) }
  }

  /** Hash only recognized root routing files; unchanged installed reads never enumerate unrelated directories. */
  private async routingSignature(checkout: string): Promise<string> {
    const paths = [...new Set([...MARKETPLACE_PATHS, ...PLUGIN_LAYOUTS.flatMap(layout => [layout.manifest, ...(MANIFEST_ALIASES[layout.kind] ?? [])])])].sort()
    const documents = await Promise.all(
      paths.map(async path => {
        try {
          return await readFile(join(checkout, path))
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code
          if (code === 'ENOENT' || code === 'ENOTDIR') return undefined
          throw error
        }
      })
    )
    const hash = createHash('sha256')
    paths.forEach((path, index) => {
      const bytes = documents[index]
      hash.update(JSON.stringify([path, bytes === undefined ? null : bytes.length]))
      if (bytes !== undefined) hash.update(bytes)
    })
    return hash.digest('hex')
  }

  private rememberBindings(key: string, bindings: SourceBindings): void {
    this.bindings.delete(key)
    this.bindings.set(key, bindings)
    while (this.bindings.size > MAX_RESIDENT_SOURCES) this.bindings.delete(this.bindings.keys().next().value!)
  }

  /** Serialize writes for a key so an older scan cannot overwrite a later durable invalidation. */
  private async write(key: string, generation: number, document: unknown): Promise<void> {
    const prior = this.writes.get(key) ?? Promise.resolve()
    const pending = prior
      .catch(() => {})
      .then(async () => {
        if (generation === (this.generations.get(key) ?? 0)) await writeJsonDocument(this.path(key), document)
      })
    this.writes.set(key, pending)
    try {
      await pending
    } finally {
      if (this.writes.get(key) === pending) this.writes.delete(key)
    }
  }

  private contained(suites: readonly DiscoveredSuite[], entry: SourceCheckout, dimension: SuiteDimension): boolean {
    return suites.every(suite => {
      if (suite.sourceId !== entry.sourceId || suite.dimension !== dimension) return false
      if (suite.remote !== undefined) return suite.root === '' && suite.skills.length === 0 && suite.mcp === undefined && suite.lsp === undefined && suite.hooks === undefined
      const paths = [
        suite.root,
        suite.manifest.path,
        suite.manifest.systemPromptPath,
        suite.mcp?.root,
        suite.hooks?.projectRoot,
        ...suite.skills.flatMap(skill => [skill.directory, skill.file]),
        ...Object.values(suite.resources ?? {}).flatMap(resources => resources.map(resource => resource.file)),
        ...(suite.styles ?? []).map(style => style.file)
      ]
      return paths.every(path => path === undefined || path === '' || isWithin(resolve(entry.checkout), resolve(path)))
    })
  }
}
