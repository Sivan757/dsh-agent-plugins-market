/** Locale parameter interpolation shared by the market client surfaces. */

/**
 * Replace `{name}` placeholders with their parameter values.
 *
 * Kept local because hosts whose bound translator ignores params still return
 * the raw template; unknown placeholders pass through untouched.
 *
 * @param text - Localized template containing `{name}` placeholders.
 * @param params - Values keyed by placeholder name.
 * @returns The template with every known placeholder substituted.
 */
export function interpolate(text: string, params: Record<string, unknown>): string {
  return text.replace(/\{(\w+)\}/g, (match, key: string) => (key in params ? String(params[key]) : match))
}
