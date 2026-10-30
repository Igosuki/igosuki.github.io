import type { APIContext } from 'astro';
import { SITE } from '../config';
import { getPosts, postUrl } from '../lib';

export async function GET(context: APIContext) {
  const posts = (await getPosts()).filter((p) => !p.data.draft);
  const sections = posts.map((p) => {
    let inFence = false;
    const body = (p.body ?? '')
      .split('\n')
      .filter((line) => {
        if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
        // MDX imports and component-only lines (<Prompt>, <ModelViewer ... />) are noise outside the rendered page.
        return inFence || !/^(import|export)\s|^\s*<\/?[A-Z][\w.]*(\s[^>]*)?\/?>\s*$/.test(line);
      })
      .join('\n')
      .trim();
    return [
      `## ${p.data.title}`,
      `URL: ${new URL(postUrl(p), context.site).href}`,
      `Published: ${p.data.pubDate.toISOString().slice(0, 10)}`,
      `Description: ${p.data.description}`,
      '',
      body,
    ].join('\n');
  });
  const body = `# ${SITE.name}\n\n> ${SITE.description}\n\n${sections.join('\n\n---\n\n')}\n`;
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
