import type { Translate } from '../../packages/market-ui/src/index.js'

/** Identity translator: every rendered label surfaces as its own locale key, which is enough for a render or wiring assertion. */
export const stubTranslate: Translate = key => key
