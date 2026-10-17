/**
 * Globals the suites assign on `globalThis`.
 *
 * `globalThis` carries no index signature under `strict`, so a flag that only
 * exists because a test sets it has to be declared once here rather than cast
 * at every assignment site. `IS_REACT_ACT_ENVIRONMENT` is React's own test
 * switch: `act()` warns unless the renderer is told it is running under a test.
 */
declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

export {}
