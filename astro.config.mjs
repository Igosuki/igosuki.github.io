// @ts-check
import { readdirSync, readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';

const site = 'https://www.gepsens.com';
const postsDir = new URL('./src/content/posts/', import.meta.url);

/** @param {string} source */
function frontmatter(source) {
  const block = source.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '';
  /** @type {Record<string, string>} */
  const fields = {};
  for (const line of block.split(/\r?\n/)) {
    const m = line.match(/^(pubDate|updatedDate|permalink|draft):\s*(.*?)\s*$/);
    if (m) fields[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return fields;
}

/** @type {Map<string, Date>} */
const lastmods = new Map();
for (const file of readdirSync(postsDir).filter((f) => /\.mdx?$/.test(f))) {
  const fm = frontmatter(readFileSync(new URL(file, postsDir), 'utf8'));
  if (fm.draft === 'true') continue;
  const date = new Date(fm.updatedDate ?? fm.pubDate);
  if (Number.isNaN(date.valueOf())) continue;
  const path = (fm.permalink ?? basename(file, extname(file))).replace(/^\/|\/$/g, '');
  lastmods.set(`${site}/blog/${path}/`, date);
}

export default defineConfig({
  site,
  trailingSlash: 'ignore',
  integrations: [
    mdx(),
    sitemap({
      serialize(item) {
        const lastmod = lastmods.get(item.url);
        return lastmod ? { ...item, lastmod: lastmod.toISOString() } : item;
      },
    }),
  ],
  markdown: {
    shikiConfig: {
      themes: { light: 'github-light', dark: 'github-dark' },
    },
  },
});
