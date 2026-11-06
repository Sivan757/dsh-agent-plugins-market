/**
 * The support window every consumer-facing host pin carries.
 *
 * A caret range is an anchor, not a contract: `^0.2.1-rc.5` excludes the `0.2.1-rc.4` candidate
 * the host shipped the day before, and a host that refuses an unmet peer range marks the plugin
 * incompatible on its own plugin page. The window states the two facts a consumer needs — the
 * oldest host release this code runs on, and the major line it never crosses — so a candidate
 * between them keeps working without a release here.
 *
 * The floor is the version this repository builds and tests against. It moves only when the
 * plugin drops a release line on purpose; a floor older than anything CI builds is a claim with
 * no evidence behind it. `baselineFrom` in the gate still decides which exact version this
 * repository builds against.
 *
 * Both the gate and the repository tests read the window from here, so a floor move edits one
 * place and the tests follow.
 */
export const HOST_SUPPORT_FLOOR = '0.2.2-rc.1'
export const HOST_SUPPORT_CEILING = '0.3.0-0'
export const HOST_SUPPORT_RANGE = `>=${HOST_SUPPORT_FLOOR} <${HOST_SUPPORT_CEILING}`
