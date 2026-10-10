/** Explicit cross-domain entry surface. Internal modules are not import targets for siblings. */
export { TranslationService } from './application/translation/service.js'
export { createLlmTranslator } from './runtime/host/llm-translator.js'
export { createTranslationProviders } from './runtime/host/translation-providers.js'
