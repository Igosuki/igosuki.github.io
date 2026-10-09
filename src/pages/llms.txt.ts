import type { APIContext } from 'astro';
import { SITE } from '../config';
import { getPosts, postUrl } from '../lib';

export async function GET(context: APIContext) {
  const posts = (await getPosts()).filter((p) => !p.data.draft);
  const lines = posts.map(
    (p) => `- [${p.data.title}](${new URL(postUrl(p), context.site).href}): ${p.data.description}`,
  );
  const body = `# ${SITE.name}\n\n> ${SITE.description}\n\n## Posts\n\n${lines.join('\n')}\n`;
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
