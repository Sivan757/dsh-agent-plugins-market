/**
 * Source acquisition and source CRUD.
 *
 * A source is a configured Git repository, archive URL, or local directory the
 * catalog reads suites from. This module owns everything that touches the
 * `.sources/` storage: adoption of pre-existing checkouts, id selection,
 * clone/archive/download, refresh, removal, and the progress state the market
 * page polls while a long acquisition runs.
 */
import { mkdir, readdir, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { archiveInstall } from '../catalog/archive.js'
import { gitClone, gitCurrentBranch, gitHead, gitRemoteUrl, gitRemove, gitSetRemoteUrl, gitSync } from '../catalog/git.js'
import { repoName } from '../catalog/manifests.js'
import { deriveSourceIdCandidates, expandHome, sanitizeId, sourceCheckoutDir, sourcesDir } from '../catalog/paths.js'
import { isDirectory, pathExists } from '../catalog/fs-probes.js'
import { canonicalGitUrl } from '../catalog/scan-resolvers.js'
import { readLocalePreference } from '../runtime/host-locale.js'
import { githubCloneUrl, resolveRegion } from '../runtime/regions.js'
import type { SourceOverview, SourceProgress, UnmanagedSource } from '../contracts/market.js'
import { resolveSourceKind, type SourceRef } from '../model/types.js'
import type { CatalogContext } from './catalog-context.js'
import type { CatalogPorts, SourceInput, SourcePatch } from './ports.js'
import type { CatalogSnapshot } from './snapshot-cache.js'

/** Checkout status of one source, as the market overview reports it. */
export interface SourceCheckoutStatus {
  cloned: boolean
  lockCommit?: string
  error?: string
}

export class SourceStore {
  private readonly headCache = new Map<string, string>()
  /** Progress snapshot of the source mutation currently in flight. */
  private currentSourceState: { sourceId: string; step: string; cloned: boolean; head?: string } | undefined

  constructor(
    private readonly context: CatalogContext,
    private readonly ports: CatalogPorts
  ) {}

  /**
   * Add a source and acquire it immediately (clone, download, or in-place).
   *
   * Git sources with an already-present checkout whose `origin` matches the
   * input URL are adopted in place — the manual-clone repair path — so no
   * second clone is made and no `-2` suffixed id is invented. Adopted
   * checkouts are never deleted on source removal.
   */
  async add(input: SourceInput): Promise<SourceRef> {
    return this.context.enqueue(async () => {
      const kind = input.local === true ? ('local' as const) : resolveSourceKind({ url: input.url, kind: input.kind })
      if (kind === 'git') {
        // Adoption first: a pre-existing checkout with a matching origin URL
        // is registered as-is, skipping the clone entirely.
        const adoptable = await this.findAdoptableCheckout(input.url, deriveSourceIdCandidates(input.url))
        if (adoptable !== undefined) {
          const source: SourceRef = {
            id: adoptable,
            url: input.url,
            ...(input.branch === undefined ? {} : { branch: input.branch }),
            kind: 'git',
            adopted: true
          }
          const head = await tryHead(sourceCheckoutDir(this.context.userRoot, adoptable))
          if (head !== undefined) this.headCache.set(source.id, head)
          await this.context.commit({ ...this.context.state, sources: [...this.context.state.sources, source] })
          await this.context.notifyChanged()
          return source
        }
      }
      const baseId = await this.pickSourceId(deriveSourceIdCandidates(input.url), kind === 'local')
      const source: SourceRef = {
        id: baseId,
        url: input.url,
        ...(input.branch === undefined ? {} : { branch: input.branch }),
        ...(kind === 'local' ? { local: true as const } : { kind }),
        ...(input.kind === 'archive' && input.sha256 !== undefined && input.sha256 !== '' ? { sha256: input.sha256 } : {})
      }
      let checkout = this.checkoutPath(source)
      if (kind === 'local') {
        if (!(await isDirectory(checkout))) throw new Error(`local source directory ${checkout} is missing`)
      } else {
        this.beginSourceState(baseId, kind === 'archive' ? 'downloading' : 'cloning', false)
        try {
          const lock = await this.acquire(source)
          if (lock !== undefined) this.headCache.set(source.id, lock)
        } catch (error) {
          this.endSourceState()
          throw error
        }
        this.updateSourceStep('reading')
      }
      // The repo's own manifest names the source; move the checkout along so
      // the registered id and its `.sources/` directory stay coherent. URL
      // derived candidates stay as readable fallbacks before numeric suffixes.
      const named = [...new Set([sanitizeId(await repoName(checkout)), ...deriveSourceIdCandidates(input.url)])]
      const finalId = await this.pickSourceId(named, kind === 'local', kind === 'local' ? undefined : checkout)
      if (kind !== 'local' && finalId !== baseId) {
        const targetDir = sourceCheckoutDir(this.context.userRoot, finalId)
        await rename(checkout, targetDir)
        checkout = targetDir
      }
      source.id = finalId
      if (resolveSourceKind(source) === 'git') {
        const head = await tryHead(checkout)
        if (head !== undefined) this.headCache.set(source.id, head)
      }
      this.endSourceState()
      await this.context.commit({ ...this.context.state, sources: [...this.context.state.sources, source] })
      await this.context.notifyChanged()
      return source
    })
  }

  /** Register one unmanaged `.sources/` checkout as a source without touching its files. */
  async adopt(id: string): Promise<SourceRef> {
    return this.context.enqueue(async () => {
      if (this.context.state.sources.some(source => source.id === id)) throw new Error(`source "${id}" is already registered`)
      // The id becomes one path segment under `.sources/`: only flat safe
      // names qualify. Anything else (separators, `..`, leading dots) could
      // traverse out of the checkouts root and register an outside directory.
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id) || id.includes('..')) {
        throw new Error(`invalid checkout id "${id}" — use letters, digits, dots, dashes, or underscores`)
      }
      const dir = sourceCheckoutDir(this.context.userRoot, id)
      if (!(await isDirectory(dir))) throw new Error(`no checkout directory at ${dir}`)
      let source: SourceRef
      try {
        const origin = await gitRemoteUrl(dir)
        source = { id, url: origin, kind: 'git', adopted: true }
        const head = await tryHead(dir)
        if (head !== undefined) this.headCache.set(id, head)
      } catch {
        // Not a git checkout: read it in place, like a local source.
        source = { id, url: dir, local: true, adopted: true }
      }
      await this.context.commit({ ...this.context.state, sources: [...this.context.state.sources, source] })
      await this.context.notifyChanged()
      return source
    })
  }

  /** Unmanaged `.sources/` checkouts: present on disk, absent from state. */
  async unmanaged(): Promise<UnmanagedSource[]> {
    const checkoutRoot = sourcesDir(this.context.userRoot)
    let entries: import('node:fs').Dirent[]
    try {
      entries = await readdir(checkoutRoot, { withFileTypes: true })
    } catch {
      return []
    }
    const registered = new Set(this.context.state.sources.map(source => source.id))
    const unmanaged: UnmanagedSource[] = []
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || registered.has(entry.name)) continue
      const dir = join(checkoutRoot, entry.name)
      try {
        unmanaged.push({ id: entry.name, url: await gitRemoteUrl(dir) })
      } catch {
        unmanaged.push({ id: entry.name })
      }
    }
    return unmanaged
  }

  /** Update one source's URL, branch, kind, or archive digest. */
  async update(sourceId: string, patch: SourcePatch): Promise<void> {
    return this.context.enqueue(async () => {
      const index = this.context.state.sources.findIndex(source => source.id === sourceId)
      if (index === -1) throw new Error(`unknown source "${sourceId}"`)
      const current = this.context.state.sources[index]!
      const nextLocal = patch.local !== undefined ? patch.local : current.local === true
      // A local source carries the legacy flag only; `kind` stays unwritten
      // so the persisted shape matches the pre-kind records.
      const nextKind = nextLocal ? undefined : (patch.kind ?? current.kind)
      const next: SourceRef = {
        id: sourceId,
        url: patch.url ?? current.url,
        ...(patch.branch !== undefined ? { branch: patch.branch } : current.branch === undefined ? {} : { branch: current.branch }),
        ...(nextLocal ? { local: true } : {}),
        ...(nextKind === undefined ? {} : { kind: nextKind }),
        ...(patch.sha256 !== undefined ? (patch.sha256 === '' ? {} : { sha256: patch.sha256 }) : current.sha256 === undefined ? {} : { sha256: current.sha256 }),
        ...(current.adopted === true ? { adopted: true } : {})
      }
      const urlChanged = patch.url !== undefined && patch.url !== current.url
      // A URL change invalidates the old checkout — except for adopted (user
      // cloned) and local sources, whose directories we never own.
      if (urlChanged && current.local !== true && current.adopted !== true) {
        this.headCache.delete(sourceId)
        await gitRemove(sourceCheckoutDir(this.context.userRoot, sourceId))
      }
      await this.context.commit({ ...this.context.state, sources: this.context.state.sources.map((source, i) => (i === index ? next : source)) })
      await this.context.notifyChanged()
    })
  }

  /**
   * Remove a source and its install entries. `deleteCheckout` (the UI's
   * "also delete the managed market directory" option) physically removes the
   * `.sources/<id>` checkout — including an adopted one, since a directory
   * under `.sources` is manager-owned storage. A `local` source whose URL
   * points outside `.sources` is registration-only: its directory is never
   * touched. Deleting the checkout is what keeps a removed source from
   * reappearing as an unmanaged entry.
   */
  async remove(sourceId: string, deleteCheckout = false): Promise<void> {
    return this.context.enqueue(async () => {
      const source = this.context.state.sources.find(entry => entry.id === sourceId)
      await this.context.commit({
        ...this.context.state,
        sources: this.context.state.sources.filter(entry => entry.id !== sourceId),
        installed: Object.fromEntries(Object.entries(this.context.state.installed).filter(([key]) => !key.startsWith(`${sourceId}/`)))
      })
      this.headCache.delete(sourceId)
      // A checkout under `.sources` is manager-owned even when it was first
      // discovered/adopted. Only an explicit local path points outside the
      // manager's storage and must remain untouched.
      const externalLocal = source?.local === true && source.url !== sourceCheckoutDir(this.context.userRoot, sourceId)
      if (!externalLocal && deleteCheckout) await gitRemove(sourceCheckoutDir(this.context.userRoot, sourceId))
      await this.context.notifyChanged()
    })
  }

  /** Refresh one source checkout, or every source when sourceId is omitted. */
  async refresh(sourceId?: string): Promise<void> {
    return this.context.enqueue(async () => {
      const targets = sourceId === undefined ? this.context.state.sources : this.context.state.sources.filter(source => source.id === sourceId)
      for (const source of targets) {
        const kind = resolveSourceKind(source)
        if (kind === 'local') {
          if (!(await isDirectory(expandHome(source.url)))) throw new Error(`local source directory ${expandHome(source.url)} is missing`)
          continue
        }
        const checkout = sourceCheckoutDir(this.context.userRoot, source.id)
        this.headCache.delete(source.id)
        if (kind === 'archive') {
          // Re-download and swap; the fresh digest becomes the lock value.
          const lock = await this.acquire(source)
          if (lock !== undefined) this.headCache.set(source.id, lock)
          continue
        }
        // Adopted checkouts are user-owned working trees: no `reset --hard`
        // (it would destroy uncommitted work), and no re-acquire either —
        // a broken HEAD means the user repairs the checkout, not that the
        // manager may clone or extract over their directory.
        if (source.adopted === true) {
          try {
            this.headCache.set(source.id, await gitHead(checkout))
          } catch {
            // A failed HEAD read means the next overview re-probes.
          }
          continue
        }
        try {
          await gitHead(checkout)
        } catch {
          const lock = await this.acquire(source)
          if (lock !== undefined) {
            this.headCache.set(source.id, lock)
          } else {
            try {
              this.headCache.set(source.id, await gitHead(checkout))
            } catch {
              // A failed HEAD read means the next overview re-probes.
            }
          }
          continue
        }
        // Shallow-friendly sync: fetch depth 1 into FETCH_HEAD, hard reset.
        const branch = source.branch ?? (await gitCurrentBranch(checkout).catch(() => undefined))
        // Keep origin on the region's route: a clone made before a region
        // switch (or an explicit flip) re-points origin so the fetch follows.
        // Only origins this plugin itself wrote (the direct or proxied
        // source.url) are re-pointed — a foreign remote is left untouched.
        if (source.kind === 'git' || (source.kind === undefined && source.local !== true)) {
          try {
            const region = resolveRegion(await this.ports.downloadRegion(), await readLocalePreference())
            const routed = githubCloneUrl(region, source.url)
            const origin = await gitRemoteUrl(checkout)
            if (origin !== routed && (origin === source.url || origin === githubCloneUrl('china', source.url))) {
              await gitSetRemoteUrl(checkout, routed)
            }
          } catch {
            // Origin reconciliation is best effort; plain sync still runs.
          }
        }
        await gitSync(checkout, branch, this.context.git)
        try {
          this.headCache.set(source.id, await gitHead(checkout))
        } catch {
          // A failed HEAD read means the next overview re-probes.
        }
      }
      await this.context.notifyChanged()
    })
  }

  /** Progress snapshot for the progress route. */
  progress(): SourceProgress {
    const state = this.currentSourceState
    return state === undefined ? { active: false, sourceId: '', step: '' } : { active: true, sourceId: state.sourceId, step: state.step }
  }

  /**
   * Checkout status of one source for the market overview. A mutation owning
   * the source right now short-circuits the probe: a Git read raced against
   * that mutation's checkout would report a half-swapped directory.
   */
  async describeCheckout(source: SourceRef): Promise<SourceCheckoutStatus> {
    const inFlight = this.currentSourceState?.sourceId === source.id ? this.currentSourceState : undefined
    const checkout = this.checkoutPath(source)
    const kind = resolveSourceKind(source)
    let cloned = false
    let lockCommit: string | undefined
    let error: string | undefined
    if (kind === 'local') {
      cloned = await isDirectory(checkout)
      if (!cloned) error = `local source directory ${checkout} is missing`
    } else if (kind === 'archive') {
      cloned = await isDirectory(checkout)
      lockCommit = this.headCache.get(source.id)
    } else if (inFlight !== undefined) {
      // A mutation owns this source right now: do not race git against its checkout.
      cloned = inFlight.cloned || (await isDirectory(checkout))
      lockCommit = inFlight.head
    } else {
      const cachedHead = this.headCache.get(source.id)
      if (cachedHead !== undefined && (await isDirectory(checkout))) {
        cloned = true
        lockCommit = cachedHead
      } else {
        try {
          lockCommit = await gitHead(checkout)
          cloned = true
          this.headCache.set(source.id, lockCommit)
        } catch {
          // Not cloned yet or a broken checkout; refresh reports the actionable error.
        }
      }
    }
    return { cloned, ...(lockCommit === undefined ? {} : { lockCommit }), ...(error === undefined ? {} : { error }) }
  }

  /** Per-source rows of the market overview for one user-dimension snapshot. */
  async overviewRows(snapshot: CatalogSnapshot): Promise<SourceOverview[]> {
    const rows: SourceOverview[] = []
    for (const source of snapshot.sources) {
      const status = await this.describeCheckout(source)
      const sourceSuites = snapshot.suites.filter(suite => suite.sourceId === source.id)
      const scanNotes = snapshot.scanNotes?.[source.id]
      rows.push({
        id: source.id,
        url: source.url,
        ...(source.branch === undefined ? {} : { branch: source.branch }),
        ...(source.local === true ? { local: true } : {}),
        kind: resolveSourceKind(source),
        ...(source.adopted === true ? { adopted: true } : {}),
        cloned: status.cloned,
        ...(status.lockCommit === undefined ? {} : { lockCommit: status.lockCommit }),
        ...(status.error === undefined ? {} : { error: status.error }),
        ...(scanNotes === undefined ? {} : { scanNotes }),
        suiteIds: sourceSuites.map(suite => suite.id)
      })
    }
    return rows
  }

  /**
   * Acquire one source's content by kind: clone (git), download+extract
   * (archive), or an in-place existence check (local). Returns a lock value
   * when the acquisition yields one (archive SHA-256, tarball fallback
   * digest); git HEAD is read separately by the callers.
   */
  async acquire(source: SourceRef): Promise<string | undefined> {
    const kind = resolveSourceKind(source)
    if (kind === 'local') {
      if (!(await isDirectory(expandHome(source.url)))) throw new Error(`local source directory ${expandHome(source.url)} is missing`)
      return undefined
    }
    const checkout = sourceCheckoutDir(this.context.userRoot, source.id)
    await mkdir(sourcesDir(this.context.userRoot), { recursive: true })
    if (kind === 'archive') {
      const { sha256 } = await archiveInstall(source.url, checkout, {
        ...(source.sha256 === undefined ? {} : { sha256: source.sha256 }),
        ...(this.context.git.timeoutMs === undefined ? {} : { timeoutMs: this.context.git.timeoutMs }),
        ...(this.context.git.allowHttpArchives === true ? { allowHttp: true } : {})
      })
      return sha256
    }
    try {
      // The region routes github.com clones through the China mirror prefix;
      // the proxied URL becomes `origin`, so refreshes follow the same route.
      const region = resolveRegion(await this.ports.downloadRegion(), await readLocalePreference())
      await gitClone(githubCloneUrl(region, source.url), source.branch, checkout, this.context.git)
      return undefined
    } catch (error) {
      if (this.context.git.fallbackTarball !== true) throw error
      const tarballUrl = codeloadTarballUrl(source.url, source.branch)
      if (tarballUrl === undefined) throw error
      // The codeload URL ends in a branch path, not `.tar.gz`, so the format
      // must be stated explicitly — extension detection cannot see it.
      const { sha256 } = await archiveInstall(tarballUrl, checkout, {
        ...(this.context.git.timeoutMs === undefined ? {} : { timeoutMs: this.context.git.timeoutMs }),
        format: 'targz'
      })
      return sha256
    }
  }

  /** The filesystem location of one source. */
  checkoutPath(source: SourceRef): string {
    return source.local === true ? expandHome(source.url) : sourceCheckoutDir(this.context.userRoot, source.id)
  }

  /** The last HEAD this store observed for one source, when it cached one. */
  knownHead(sourceId: string): string | undefined {
    return this.headCache.get(sourceId)
  }

  /**
   * First candidate id whose `.sources/` checkout already exists and whose
   * `origin` remote matches the input URL (canonical-form equality) — the
   * signature of a manual clone of the very same repository. Registered ids
   * and checkouts of differently-origined directories never adopt.
   */
  private async findAdoptableCheckout(url: string, candidates: string[]): Promise<string | undefined> {
    const registered = new Set(this.context.state.sources.map(source => source.id))
    for (const candidate of candidates) {
      if (registered.has(candidate)) continue
      const dir = sourceCheckoutDir(this.context.userRoot, candidate)
      if (!(await isDirectory(dir))) continue
      let origin: string | undefined
      try {
        origin = await gitRemoteUrl(dir)
      } catch {
        continue
      }
      if (origin !== '' && canonicalGitUrl(origin) === canonicalGitUrl(url)) return candidate
    }
    return undefined
  }

  /**
   * First candidate id not claimed by a registered source; for git candidates
   * the checkout directory must also be free, so a stale or foreign directory
   * under `.sources/` is never cloned over (it would fail `git clone` with a
   * confusing "destination exists" error). `ownedCheckout` marks the directory
   * the in-flight mutation already controls, keeping a rename onto it legal.
   * Local sources skip the disk check: they read their own path in place and
   * never occupy `.sources/`.
   */
  private async pickSourceId(candidates: string[], skipDisk: boolean, ownedCheckout?: string): Promise<string> {
    const free = async (id: string): Promise<boolean> => {
      if (this.context.state.sources.some(source => source.id === id)) return false
      if (skipDisk) return true
      const dir = sourceCheckoutDir(this.context.userRoot, id)
      return dir === ownedCheckout || !(await pathExists(dir))
    }
    for (const candidate of candidates) {
      if (await free(candidate)) return candidate
    }
    for (let suffix = 2; ; suffix++) {
      const candidate = `${candidates[0]}-${suffix}`
      if (await free(candidate)) return candidate
    }
  }

  /** Begin reporting progress for a source mutation. */
  beginSourceState(sourceId: string, step: string, cloned: boolean): void {
    this.currentSourceState = { sourceId, step, cloned }
  }

  /** Advance the in-flight source mutation step. */
  updateSourceStep(step: string): void {
    if (this.currentSourceState !== undefined) this.currentSourceState = { ...this.currentSourceState, step }
  }

  /** Stop reporting source mutation progress. */
  endSourceState(): void {
    this.currentSourceState = undefined
  }
}

/** Read a checkout's HEAD when it is a Git repository. */
export async function tryHead(dir: string): Promise<string | undefined> {
  try {
    return await gitHead(dir)
  } catch {
    return undefined
  }
}

/**
 * The codeload tarball URL of a GitHub repository, or undefined for any
 * other host. `https://github.com/<owner>/<repo>` maps to
 * `https://codeload.github.com/<owner>/<repo>/tar.gz/refs/heads/<branch>`
 * (or `/tar.gz/HEAD` for the default branch) — the git-protocol fallback
 * when a clone cannot get through but plain HTTPS file download can.
 */
export function codeloadTarballUrl(url: string, branch: string | undefined): string | undefined {
  const match = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(url.trim())
  if (match === null) return undefined
  const [, owner, repo] = match
  return `https://codeload.github.com/${owner}/${repo}/tar.gz/${branch === undefined ? 'HEAD' : `refs/heads/${branch}`}`
}
