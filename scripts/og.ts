import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';
import { Resvg } from '@resvg/resvg-js';
import { slug as githubSlug } from 'github-slugger';
import satori from 'satori';
import { chromium, type Browser } from 'playwright-core';
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
  ogFigure?: number;
}

// Must equal the page's postPath(), or the build guard won't find the PNG.
export function slugFor(file: string, permalink?: string): string {
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

export type Layout = 'top' | 'side';

const titleSizes = [88, 76, 66, 58];
const lineHeight = 1.05;

type Node = { type: string; props: Record<string, unknown> };
const el = (type: string, style: Record<string, unknown>, children?: unknown): Node => ({
  type,
  props: { style: { display: 'flex', ...style }, children },
});

function titleNode(title: string, size: number, width: number): Node {
  return el('div', {
    fontFamily: 'Familjen Grotesk',
    fontWeight: 600,
    fontSize: size,
    lineHeight,
    letterSpacing: '-0.025em',
    color: color.ink,
    width,
  }, title);
}

// Satori exposes no layout metrics; with embedFont off each laid-out line is a <text> with its own y.
async function countLines(node: Node): Promise<number> {
  const svg = await satori(node as never, { width: W, height: H, fonts, embedFont: false });
  return new Set([...svg.matchAll(/<text[^>]*\sy="([^"]+)"/g)].map((m) => m[1])).size;
}

async function fitTitle(title: string, width: number, maxHeight: number, sizes = titleSizes): Promise<number> {
  for (const size of sizes) {
    if ((await countLines(titleNode(title, size, width))) * size * lineHeight <= maxHeight) return size;
  }
  throw new Error(`Title too long for a card: ${title}`);
}

const descNode = (text: string): Node =>
  el('div', { fontFamily: 'Newsreader', fontSize: 30, lineHeight: 1.4, color: color.graphite, width: W - PAD * 2 }, text);

async function fitDescription(text: string): Promise<string> {
  if ((await countLines(descNode(text))) <= 2) return text;
  const words = text.trim().split(/\s+/);
  for (let n = words.length - 1; n > 0; n--) {
    const candidate = `${words.slice(0, n).join(' ').replace(/[,;:.\s]+$/, '')}…`;
    if ((await countLines(descNode(candidate))) <= 2) return candidate;
  }
  return words[0];
}

const bar = () => el('div', { width: 64, height: 6, background: color.cobalt });

const statusLabel = (meta: Meta, marginTop: number) =>
  meta.kind === 'idea' && meta.status
    ? el('div', { fontFamily: 'Familjen Grotesk', fontWeight: 600, fontSize: 24, color: color.cobalt, marginTop }, STATUS_LABEL[meta.status])
    : null;

const footer = () =>
  el('div', {
    justifyContent: 'space-between',
    borderTop: `2px solid ${color.rule}`,
    paddingTop: 24,
    fontFamily: 'Familjen Grotesk',
    fontWeight: 400,
    fontSize: 24,
    color: color.graphite,
  }, [el('div', {}, SITE.name), el('div', {}, 'gepsens.com')]);

const frame = (children: unknown[], pad = PAD) =>
  el('div', { width: W, height: H, boxSizing: 'border-box', background: color.paper, padding: pad, flexDirection: 'column' }, children);

async function toPng(tree: Node): Promise<Buffer> {
  const svg = await satori(tree as never, { width: W, height: H, fonts });
  return new Resvg(svg, { fitTo: { mode: 'width', value: W } }).render().asPng();
}

// Vertical budget for the title: content height minus bar, description, footer and minimum gaps.
const TEXT_TITLE_BUDGET = H - PAD * 2 - 42 - 84 - 24 - 80;

export async function textCard(meta: Meta): Promise<Buffer> {
  const label = statusLabel(meta, 28);
  const size = await fitTitle(meta.title, W - PAD * 2, TEXT_TITLE_BUDGET - (label ? 40 : 0));
  const description = await fitDescription(meta.description);
  return toPng(frame([
    el('div', { flexDirection: 'column', flexGrow: 1 }, [
      bar(),
      label,
      el('div', { marginTop: label ? 16 : 36 }, [titleNode(meta.title, size, W - PAD * 2)]),
      el('div', { flexGrow: 1 }),
      el('div', { marginBottom: 28 }, [descNode(description)]),
    ].filter(Boolean)),
    footer(),
  ]));
}

function pngSize(png: Buffer): { w: number; h: number } {
  return { w: png.readUInt32BE(16), h: png.readUInt32BE(20) };
}

const dataUri = (png: Buffer) => `data:image/png;base64,${png.toString('base64')}`;

function figureNode(png: Buffer, maxW: number, maxH: number): Node {
  const { w, h } = pngSize(png);
  const scale = Math.min(maxW / w, maxH / h);
  return {
    type: 'img',
    props: { src: dataUri(png), width: Math.round(w * scale), height: Math.round(h * scale), style: { display: 'flex' } },
  };
}

// The figure needs every pixel it can get to stay legible at thumbnail size, so these cards use a tighter margin.
const FIG_PAD = 56;

export async function figureCard(meta: Meta, figure: Buffer, layout: Layout): Promise<Buffer> {
  const inner = W - FIG_PAD * 2;
  const innerH = H - FIG_PAD * 2;
  if (layout === 'top') {
    const titleH = 2 * 56 * lineHeight;
    const size = await fitTitle(meta.title, inner, titleH, [56]);
    return toPng(frame([
      bar(),
      el('div', { marginTop: 24 }, [titleNode(meta.title, size, inner)]),
      el('div', { flexGrow: 1, marginTop: 24, alignItems: 'center' }, [
        figureNode(figure, inner, innerH - 6 - 24 - titleH - 24),
      ]),
    ], FIG_PAD));
  }
  const figW = Math.round(inner * 0.62);
  const gap = 48;
  const textW = inner - figW - gap;
  const label = statusLabel(meta, 28);
  const size = await fitTitle(meta.title, textW, innerH - 42 - 40, [48, 44, 40, 36]);
  return toPng(frame([
    el('div', { flexGrow: 1, flexDirection: 'row' }, [
      el('div', { width: figW, alignItems: 'center' }, [figureNode(figure, figW, innerH)]),
      el('div', { width: textW, marginLeft: gap, flexDirection: 'column' }, [
        bar(),
        label,
        el('div', { marginTop: label ? 16 : 36 }, [titleNode(meta.title, size, textW)]),
      ].filter(Boolean)),
    ]),
  ], FIG_PAD));
}

const DEV_URL = 'http://localhost:4321';

async function isUp(): Promise<boolean> {
  try {
    return (await fetch(DEV_URL, { signal: AbortSignal.timeout(1500) })).ok;
  } catch {
    return false;
  }
}

// Reuses a running dev server (Astro allows one); otherwise starts one and returns it for the caller to stop.
async function ensureDevServer(): Promise<ChildProcess | undefined> {
  if (await isUp()) return undefined;
  const child = spawn('npx', ['astro', 'dev', '--port', '4321'], { cwd: root, stdio: 'ignore' });
  for (let i = 0; i < 120; i++) {
    if (await isUp()) return child;
    await new Promise((r) => setTimeout(r, 500));
  }
  child.kill();
  throw new Error('astro dev did not come up on :4321');
}

export class FigureCapture {
  private browser: Browser;
  private server?: ChildProcess;

  private constructor(browser: Browser, server?: ChildProcess) {
    this.browser = browser;
    this.server = server;
  }

  // Needs a Chromium matching playwright-core; `npx playwright install chromium` provides one.
  static async open(): Promise<FigureCapture> {
    const server = await ensureDevServer();
    return new FigureCapture(await chromium.launch(), server);
  }

  // `index` is the 1-based position of the <figure> among the post's figures.
  async shoot(slug: string, index: number): Promise<Buffer> {
    const ctx = await this.browser.newContext({
      colorScheme: 'light',
      viewport: { width: 1000, height: 900 },
      deviceScaleFactor: 2,
    });
    try {
      const page = await ctx.newPage();
      await page.goto(`${DEV_URL}/blog/${slug}/`, { waitUntil: 'networkidle' });
      await page.addStyleTag({ content: 'astro-dev-toolbar{display:none!important} article figure figcaption{display:none!important}' });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(800);
      const figure = page.locator('article figure').nth(index - 1);
      if ((await figure.count()) === 0) throw new Error(`${slug}: no figure #${index}`);
      return await figure.screenshot();
    } finally {
      await ctx.close();
    }
  }

  async close(): Promise<void> {
    await this.browser.close();
    this.server?.kill();
  }
}

async function main(): Promise<void> {
  const wanted = new Set<string>();
  let capture: FigureCapture | undefined;
  try {
    for (const file of await listPosts(postsDir)) {
      const raw = await readFile(join(postsDir, file), 'utf8');
      const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
      if (!fm) throw new Error(`${file}: no frontmatter`);
      const meta = parse(fm[1]) as Meta;
      if (meta.draft || meta.image) continue;

      const slug = slugFor(file, meta.permalink);
      const out = join(outDir, `${slug}.png`);
      wanted.add(out);
      await mkdir(dirname(out), { recursive: true });
      if (meta.ogFigure) {
        capture ??= await FigureCapture.open();
        await writeFile(out, await figureCard(meta, await capture.shoot(slug, meta.ogFigure), 'top'));
      } else {
        await writeFile(out, await textCard(meta));
      }
      console.log(relative(root, out));
    }
  } finally {
    await capture?.close();
  }

  for (const stale of await listPngs(outDir)) {
    if (!wanted.has(stale)) {
      await rm(stale);
      console.log(`removed ${relative(root, stale)}`);
    }
  }
}

if (import.meta.main) await main();
