import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const posts = defineCollection({
  loader: glob({ base: './src/content/posts', pattern: '**/*.{md,mdx}' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    // "idea" posts are startup ideas with a prototype; "note" is everything else.
    kind: z.enum(['idea', 'note']).default('note'),
    // Only used for ideas: where the idea stands today.
    status: z.enum(['exploring', 'prototype', 'looking-for-partners', 'building', 'shelved']).optional(),
    // Override the URL (used to keep old Octopress links working).
    permalink: z.string().optional(),
    // Drafts show up in `npm run dev` but are left out of the production build.
    draft: z.boolean().default(false),
  }),
});

export const collections = { posts };
