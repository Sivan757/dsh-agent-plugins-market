import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';

/**
 * The user guide is authored in \`docs/user/\` and ships as an English/Chinese
 * pair. The site renders those files instead of restating them, so one edit
 * updates the repository view and the published site together.
 */
const userGuide = defineCollection({
  loader: glob({ pattern: '*.md', base: '../docs/user' }),
});

export const collections = { userGuide };
