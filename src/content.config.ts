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
    status: z.enum(['exploring', 'prototype', 'building', 'shelved']).optional(),
    tags: z.array(z.string()).default([]),
    // Override the URL (used to keep old Octopress links working).
    permalink: z.string().optional(),
    // Drafts show up in `npm run dev` but are left out of the production build.
    draft: z.boolean().default(false),
    // Published, but marked as unfinished. Ignored when `draft` is set.
    wip: z.boolean().default(false),
    // Email invitation at the end of the post. Ideas get one by default; this overrides its text.
    invite: z.object({ heading: z.string().optional(), ask: z.string() }).optional(),
  }),
});

export const collections = { posts };
