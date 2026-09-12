/**
 * The `jsdom` surface the client tests construct.
 *
 * `jsdom` ships no declarations. Rather than add a types-only dependency to
 * the manifest for one test file, this declares exactly the members the suite
 * constructs — a `JSDOM` instance, its `window`, and that window's
 * `localStorage` — so a test reaching for an undeclared jsdom API fails to
 * compile instead of silently widening to `any`. It is DOM-only, so the server
 * test project excludes this file on purpose.
 */
declare module 'jsdom' {
  export interface JSDOMOptions {
    url?: string
  }

  export class JSDOM {
    constructor(html?: string, options?: JSDOMOptions)
    readonly window: Window & typeof globalThis
  }
}
