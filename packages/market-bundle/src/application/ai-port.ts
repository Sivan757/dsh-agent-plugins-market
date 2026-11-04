/**
 * The model call the remaining AI surfaces need.
 *
 * Three surfaces still ask a model for something: the preset suggester (which suites to install,
 * which faces a preset should switch on), the failure explainer, and the hook form. All three
 * need exactly one capability, a text answer from the deployment's default route, so the
 * composition root supplies it here and each service decides what it asks for.
 *
 * @module application/ai-port
 */
import type { AiAnswer } from '../../../market-contracts/src/contracts/ai-draft.js'

/** The model call this composition root supplies to every AI surface. */
export interface AiPort {
  /**
   * Ask the deployment's default model for one answer.
   * @param prompt - the two messages to send.
   * @param signal - cancellation, honoured between chunks.
   * @returns the answer text and the route that produced it.
   */
  complete(prompt: { system: string; user: string }, signal?: AbortSignal): Promise<AiAnswer>
}
