/**
 * The user snapshot's keep-warm refresh.
 *
 * The TTL bounds how long an out-of-band working-tree edit stays invisible, and
 * a read that arrives after it lapses used to pay the whole discovery scan.
 * These tests pin the replacement: the cache refreshes itself off the read path
 * before the TTL lapses, the refresh re-reads the tree (so the bound still
 * holds), and the chain stops once the catalog has been idle for its window.
 *
 * Time is driven here, never waited for. The cache takes its clock from the
 * catalog's now option, and the two refresh cases move that clock by hand
 * alongside fake timers, so an ordering is asserted instead of raced. Only the
 * timers are faked there and the process clock is left real, which makes the
 * injected clock the cache's only time source: a TTL or window decision read
 * from the process clock would land on a different timeline and fail the case.
 * The last case fakes the process clock itself, covering the default clock a
 * deployment gets.
 */
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Catalog, type CatalogOptions } from '../packages/market-bundle/src/application/catalog.js'
import type { CatalogSnapshot } from '../packages/market-catalog/src/application/snapshot-cache.js'

/**
 * Scan volume by filesystem call: a discovery scan opens with stat on the
 * checkout and proceeds with readdir, while a read served from a warm snapshot
 * makes neither call. stat is counted because it is the first probe a scan
 * makes, so it reports that an armed refresh started from inside the timer
 * callback, before any I/O has to finish.
 */
const fsCounts = vi.hoisted(() => ({ readdir: 0, stat: 0 }))
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    stat: (...args: Parameters<typeof actual.stat>) => {
      fsCounts.stat += 1
      return actual.stat(...args)
    },
    readdir: (...args: Parameters<typeof actual.readdir>) => {
      fsCounts.readdir += 1
      return actual.readdir(...args)
    }
  }
})

/** The TTL these cases drive; every interval below derives from it. */
const TTL_MS = 1_000
/** When a read arms the refresh, as a fraction of the TTL (USER_REFRESH_LEAD_RATIO). */
const REFRESH_AFTER_MS = 800
/** How long the chain keeps refreshing after the last read (USER_KEEP_WARM_TTL_MULTIPLE TTLs). */
const IDLE_WINDOW_MS = TTL_MS * 10

const fixture = join(process.cwd(), 'tests', 'fixtures', 'v1-suite')
const roots: string[] = []

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

/** Fake the scheduling and leave the process clock real; see the file header. */
function fakeTimersOnly(): void {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
}

/**
 * A hand-driven clock for the cache, paired with the fake timers it schedules.
 *
 * advance moves the clock first and then the timers due inside the window, so a
 * callback observes the time it fires at — what a late timer sees on a loaded
 * machine — and the two stay one timeline. jump moves only the clock, which is
 * how a case expires a snapshot without also firing the timer that was armed
 * against it.
 */
function testClock(): { now: () => number; advance: (ms: number) => Promise<void>; jump: (ms: number) => void } {
  let now = 0
  return {
    now: () => now,
    advance: async (ms: number): Promise<void> => {
      now += ms
      await vi.advanceTimersByTimeAsync(ms)
    },
    jump: (ms: number): void => {
      now += ms
    }
  }
}

/** A temp user root with the v1-suite fixture checked out as local source demo. */
async function seededRoot(): Promise<string> {
  const userRoot = await mkdtemp(join(tmpdir(), 'market-keep-warm-'))
  roots.push(userRoot)
  await mkdir(join(userRoot, '.sources', 'demo'), { recursive: true })
  await cp(fixture, join(userRoot, '.sources', 'demo'), { recursive: true })
  return userRoot
}

/** Catalog options for one case; now is omitted to exercise the default clock. */
function catalogOptions(userRoot: string, now?: () => number): CatalogOptions {
  return {
    userRoot,
    dataRoot: join(userRoot, 'data'),
    agentsRoot: join(userRoot, 'agents'),
    onChanged: () => {},
    userSnapshotTtlMs: TTL_MS,
    ...(now === undefined ? {} : { now })
  }
}

/** The first suite's skill names, for the content assertions. */
function firstSuiteSkills(snapshot: CatalogSnapshot): string[] {
  return snapshot.suites[0]?.skills.map(skill => skill.name) ?? []
}

/** Check out one more skill in place, as an out-of-band working-tree edit. */
async function addLateSkill(userRoot: string): Promise<void> {
  await mkdir(join(userRoot, '.sources', 'demo', 'skills', 'late'), { recursive: true })
  await writeFile(join(userRoot, '.sources', 'demo', 'skills', 'late', 'SKILL.md'), '---\nname: late-skill\ndescription: late\n---\n')
}

describe('user snapshot keep-warm refresh', () => {
  it('re-reads the working tree when the refresh is armed, and serves the next read from it', async () => {
    fakeTimersOnly()
    const userRoot = await seededRoot()
    const clock = testClock()
    const catalog = new Catalog(catalogOptions(userRoot, clock.now))
    await catalog.load()
    await catalog.mergeSources([{ id: 'demo', url: 'https://example.test/demo.git' }])

    // The first read builds the snapshot at t=0 and arms the refresh for
    // 0.8 x TTL.
    const seeded = await catalog.readUserCatalog()
    expect(firstSuiteSkills(seeded)).not.toContain('late-skill')

    // An out-of-band edit. No read is issued from here to the boundary read
    // below, so only the armed refresh can look at the tree.
    await addLateSkill(userRoot)
    const probesBeforeRefresh = fsCounts.stat

    // The refresh fires inside the TTL; the scan's first probe lands while the
    // timer callback runs, so this assertion waits on no I/O.
    await clock.advance(REFRESH_AFTER_MS)
    expect(fsCounts.stat).toBeGreaterThan(probesBeforeRefresh)

    // The read landing on the TTL boundary is served from what the refresh
    // read: it sees the edit, and the read after it is handed the very same
    // snapshot without a scan of its own.
    await clock.advance(TTL_MS - REFRESH_AFTER_MS)
    const atBoundary = await catalog.readUserCatalog()
    expect(firstSuiteSkills(atBoundary)).toContain('late-skill')
    const scansBeforeProbe = fsCounts.readdir
    const probe = await catalog.readUserCatalog()
    expect(fsCounts.readdir).toBe(scansBeforeProbe)
    expect(probe).toBe(atBoundary)
    expect(firstSuiteSkills(probe)).toContain('late-skill')
    catalog.dispose()
  })

  it('holds the snapshot inside its TTL while reads arrive, and stops after the idle window', async () => {
    fakeTimersOnly()
    const userRoot = await seededRoot()
    const clock = testClock()
    const catalog = new Catalog(catalogOptions(userRoot, clock.now))
    await catalog.load()
    await catalog.mergeSources([{ id: 'demo', url: 'https://example.test/demo.git' }])

    await catalog.readUserCatalog()
    await addLateSkill(userRoot)

    // Two TTLs of traffic. The refresh armed by the previous read is what keeps
    // the snapshot inside its TTL: it re-reads the tree with no read in flight,
    // so a read landing on the boundary is served from a snapshot that already
    // carries the edit, and the read after it gets the same snapshot back.
    for (let ttl = 0; ttl < 2; ttl += 1) {
      const probesBeforeRefresh = fsCounts.stat
      await clock.advance(REFRESH_AFTER_MS)
      expect(fsCounts.stat).toBeGreaterThan(probesBeforeRefresh)
      await clock.advance(TTL_MS - REFRESH_AFTER_MS)
      const joined = await catalog.readUserCatalog()
      const scansBeforeProbe = fsCounts.readdir
      const atBoundary = await catalog.readUserCatalog()
      expect(fsCounts.readdir).toBe(scansBeforeProbe)
      expect(atBoundary).toBe(joined)
      expect(firstSuiteSkills(atBoundary)).toContain('late-skill')
    }

    // Reads stop. Past the idle window the armed refresh declines and does not
    // re-arm, so the chain ends instead of scanning a quiet catalog forever.
    await clock.advance(IDLE_WINDOW_MS + 1)
    const scansAtWindowEnd = fsCounts.readdir
    await clock.advance(IDLE_WINDOW_MS)
    expect(fsCounts.readdir).toBe(scansAtWindowEnd)
    expect(vi.getTimerCount()).toBe(0)

    // The lapsed snapshot is rebuilt by the next read: exactly the one scan
    // every read paid before the keep-warm window existed.
    const scansBeforeRebuild = fsCounts.readdir
    const rebuilt = await catalog.readUserCatalog()
    expect(fsCounts.readdir).toBeGreaterThan(scansBeforeRebuild)
    expect(rebuilt.suites.map(suite => suite.id)).toEqual(['v1-suite'])
    catalog.dispose()
  })

  it('keeps the chain down for good when teardown lands mid-refresh', async () => {
    fakeTimersOnly()
    const userRoot = await seededRoot()
    const clock = testClock()
    const catalog = new Catalog(catalogOptions(userRoot, clock.now))
    await catalog.load()
    await catalog.mergeSources([{ id: 'demo', url: 'https://example.test/demo.git' }])

    // Arm the keep-warm refresh, then let it fire. The timer callback starts its
    // scan synchronously, so the refresh is in flight on the next line — the
    // state a teardown races.
    await catalog.readUserCatalog()
    vi.advanceTimersByTime(REFRESH_AFTER_MS)
    catalog.dispose()

    // Expire the snapshot by the clock alone, so the next read joins the
    // in-flight refresh instead of answering from the cache, and await it: its
    // own `.finally()` is what used to re-arm the chain after teardown.
    clock.jump(TTL_MS + 1)
    const joined = await catalog.readUserCatalog()
    expect(joined.suites.map(suite => suite.id)).toEqual(['v1-suite'])
    // Let the refresh chain's last reactions land before asking about timers.
    await vi.advanceTimersByTimeAsync(0)
    expect(vi.getTimerCount()).toBe(0)

    // Nothing re-arms and nothing scans again, however long the process lives.
    const scansAfterTeardown = fsCounts.readdir
    await vi.advanceTimersByTimeAsync(IDLE_WINDOW_MS * 2)
    expect(fsCounts.readdir).toBe(scansAfterTeardown)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('takes the process clock when no clock is injected', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    // The case is only meaningful while the process clock is the virtual one.
    expect(vi.getMockedSystemTime()?.getTime()).toBe(0)

    const userRoot = await seededRoot()
    const catalog = new Catalog(catalogOptions(userRoot))
    await catalog.load()
    await catalog.mergeSources([{ id: 'demo', url: 'https://example.test/demo.git' }])

    const seeded = await catalog.readUserCatalog()
    expect(firstSuiteSkills(seeded)).not.toContain('late-skill')
    await addLateSkill(userRoot)
    const probesBeforeRefresh = fsCounts.stat

    await vi.advanceTimersByTimeAsync(REFRESH_AFTER_MS)
    expect(fsCounts.stat).toBeGreaterThan(probesBeforeRefresh)
    await vi.advanceTimersByTimeAsync(TTL_MS - REFRESH_AFTER_MS)
    const atBoundary = await catalog.readUserCatalog()
    expect(firstSuiteSkills(atBoundary)).toContain('late-skill')
    catalog.dispose()
  })
})
