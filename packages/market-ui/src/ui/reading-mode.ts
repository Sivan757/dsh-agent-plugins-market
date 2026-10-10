/**
 * The reading mode every expanded document shares.
 *
 * One header belongs to one document, but the choice belongs to the reader: a
 * mode that reset per document would make the same click mean different things
 * on two rows of the same panel. The store is module-level for the reason the
 * panel caches are — the workspace renders only the active tab and remounts on
 * every switch — so a mode the user picked survives that remount.
 *
 * The starting mode is the authored text. Translation is a deliberate request,
 * not something a reader triggers by opening a file.
 * @module ui/reading-mode
 */
import { useSyncExternalStore } from 'react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'

/** How one expanded document renders: authored text, translation, or both. */
export type ReadingMode = 'original' | 'translated' | 'bilingual'

/** The mode a reader starts in: authored text, translation on demand. */
export const DEFAULT_READING_MODE: ReadingMode = 'original'

const state = createSnapshotStore<ReadingMode>(DEFAULT_READING_MODE)

/** Shared read and write API; every document control reads one value. */
export const readingMode = {
  getSnapshot: (): ReadingMode => state.getSnapshot(),
  subscribe: (listener: () => void): (() => void) => state.subscribe(listener),
  set: (next: ReadingMode): void => state.set(next)
}

/** Read the shared mode; a click on one control changes every document's view. */
export function useReadingMode(): ReadingMode {
  return useSyncExternalStore(readingMode.subscribe, readingMode.getSnapshot, () => DEFAULT_READING_MODE)
}
