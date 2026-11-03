/** Explicit cross-domain entry surface. Internal modules are not import targets for siblings. */
export { TranslationService } from './application/translation/service.js'
export { createLlmTranslator } from './runtime/host/llm-translator.js'
// Only what another package calls. The rest of the module stays inside this package: its
// text collector is the translator's own reading of a stream, and its route types are
// internal shape rather than a contract.
export { auxiliaryFinishError, auxiliaryLlmOf, chooseOffEffort, readDefaultModelRoute, type AuxiliaryCallHost } from './runtime/host/auxiliary-model-call.js'
export { createTranslationProviders } from './runtime/host/translation-providers.js'
