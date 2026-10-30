import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { slug as githubSlug } from 'github-slugger';
import satori from 'satori';
import { parse } from 'yaml';
import { SITE, STATUS_LABEL } from '../src/config.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const postsDir = join(root, 'src/content/posts');
const fontsDir = join(root, 'node_modules/@fontsource');
const outDir = join(root, 'public/og');

const W = 1200;
const H = 630;
const PAD = 80;
const color = { paper: '#e9ece6', ink: '#18202b', graphite: '#5a6371', rule: '#c9cec6', cobalt: '#2340c8' };

const font = (path: string) => readFile(join(fontsDir, path));
const fonts = [
  { name: 'Familjen Grotesk', data: await font('familjen-grotesk/files/familjen-grotesk-latin-600-normal.woff'), weight: 600 as const },
  { name: 'Familjen Grotesk', data: await font('familjen-grotesk/files/familjen-grotesk-latin-400-normal.woff'), weight: 400 as const },
  { name: 'Newsreader', data: await font('newsreader/files/newsreader-latin-400-normal.woff'), weight: 400 as const },
];

interface Meta {
  title: string;
  description: string;
  kind?: string;
  status?: string;
  draft?: boolean;
  image?: string;
  permalink?: string;
}

// Must equal the page's postPath(), or the build guard won't find the PNG.
function slugFor(file: string, permalink?: string): string {
  const id = file
    .replace(/\.[^.]+$/, '')
    .split('/')
    .map((s) => githubSlug(s))
    .join('/')
    .replace(/\/index$/, '');
  return (permalink ?? id).replace(/^\/|\/$/g, '');
}

async function listPosts(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true });
  return entries.filter((e) => /\.(md|mdx)$/.test(e)).map((e) => e.split('\\').join('/')).sort();
}

async function listPngs(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { recursive: true });
    return entries.filter((e) => e.endsWith('.png')).map((e) => join(dir, e));
  } catch {
    return [];
  }
}

const titleSizes = [68, 60, 54, 48];
const maxTitleLines = 3;

type Node = { type: string; props: Record<string, unknown> };
const el = (type: string, style: Record<string, unknown>, children?: unknown): Node => ({
  type,
  props: { style: { display: 'flex', ...style }, children },
});

function titleNode(title: string, size: number): Node {
  return el('div', {
    fontFamily: 'Familjen Grotesk',
    fontWeight: 600,
    fontSize: size,
    lineHeight: 1.1,
    letterSpacing: '-0.02em',
    color: color.ink,
    width: W - PAD * 2,
  }, title);
}

// Satori exposes no layout metrics; with embedFont off each laid-out line is a <text> with its own y.
async function lineCount(title: string, size: number): Promise<number> {
  const svg = await satori(titleNode(title, size) as never, { width: W, height: H, fonts, embedFont: false });
  return new Set([...svg.matchAll(/<text[^>]*\sy="([^"]+)"/g)].map((m) => m[1])).size;
}

async function fitTitle(title: string): Promise<number> {
  for (const size of titleSizes) {
    if ((await lineCount(title, size)) <= maxTitleLines) return size;
  }
  throw new Error(`Title too long for a card: ${title}`);
}

async function fitDescription(text: string): Promise<string> {
  const words = text.trim().split(/\s+/);
  const probe = async (s: string) => {
    const node = el('div', { fontFamily: 'Newsreader', fontSize: 30, lineHeight: 1.4, width: W - PAD * 2 }, s);
    const svg = await satori(node as never, { width: W, height: H, fonts, embedFont: false });
    return new Set([...svg.matchAll(/<text[^>]*\sy="([^"]+)"/g)].map((m) => m[1])).size;
  };
  if ((await probe(text)) <= 2) return text;
  let n = words.length;
  while (n > 1) {
    n--;
    const candidate = `${words.slice(0, n).join(' ').replace(/[,;:.\s]+$/, '')}…`;
    if ((await probe(candidate)) <= 2) return candidate;
  }
  return words[0];
}

async function card(meta: Meta): Promise<Buffer> {
  const size = await fitTitle(meta.title);
  const description = await fitDescription(meta.description);
  const label = meta.kind === 'idea' && meta.status ? STATUS_LABEL[meta.status] : undefined;

  const tree = el('div', {
    width: W,
    height: H,
    boxSizing: 'border-box',
    background: color.paper,
    padding: PAD,
    flexDirection: 'column',
  }, [
    el('div', { flexDirection: 'column', flexGrow: 1 }, [
      el('div', { width: 64, height: 6, background: color.cobalt }),
      label
        ? el('div', { fontFamily: 'Familjen Grotesk', fontWeight: 600, fontSize: 24, color: color.cobalt, marginTop: 28 }, label)
        : null,
      el('div', { marginTop: label ? 16 : 36 }, [titleNode(meta.title, size)]),
      el('div', {
        fontFamily: 'Newsreader',
        fontSize: 30,
        lineHeight: 1.4,
        color: color.graphite,
        marginTop: 28,
        width: W - PAD * 2,
      }, description),
    ].filter(Boolean)),
    el('div', {
      justifyContent: 'space-between',
      borderTop: `2px solid ${color.rule}`,
      paddingTop: 24,
      fontFamily: 'Familjen Grotesk',
      fontWeight: 400,
      fontSize: 24,
      color: color.graphite,
    }, [el('div', {}, SITE.name), el('div', {}, 'gepsens.com')]),
  ]);

  const svg = await satori(tree as never, { width: W, height: H, fonts });
  return new Resvg(svg, { fitTo: { mode: 'width', value: W } }).render().asPng();
}

const wanted = new Set<string>();
for (const file of await listPosts(postsDir)) {
  const raw = await readFile(join(postsDir, file), 'utf8');
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
  if (!fm) throw new Error(`${file}: no frontmatter`);
  const meta = parse(fm[1]) as Meta;
  if (meta.draft || meta.image) continue;

  const out = join(outDir, `${slugFor(file, meta.permalink)}.png`);
  wanted.add(out);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, await card(meta));
  console.log(relative(root, out));
}

for (const stale of await listPngs(outDir)) {
  if (!wanted.has(stale)) {
    await rm(stale);
    console.log(`removed ${relative(root, stale)}`);
  }
}
