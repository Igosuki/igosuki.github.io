import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { getContainerRenderer as mdxRenderer } from '@astrojs/mdx/container-renderer';
import { loadRenderers } from 'astro:container';
import { render } from 'astro:content';
import { SITE } from '../config';
import { getPosts, postUrl } from '../lib';

export async function GET(context: APIContext) {
  const site = context.site!;
  const posts = (await getPosts()).filter((p) => !p.data.draft);
  const container = await AstroContainer.create({ renderers: await loadRenderers([mdxRenderer()]) });
  // Interactive components can't run in a feed reader, and their scripts point at source paths.
  const forFeed = (html: string) =>
    html
      .replace(/<(script|button)\b[\s\S]*?<\/\1>/g, '')
      .replace(/\b(src|href)="\/(?!\/)([^"]*)"/g, (_, attr, rest) => `${attr}="${new URL(`/${rest}`, site).href}"`);

  const items = await Promise.all(
    posts.map(async (post) => {
      let content: string | undefined;
      try {
        const { Content } = await render(post);
        content = forFeed(await container.renderToString(Content));
      } catch (error) {
        console.warn(`rss: could not render ${post.id}, using description`, error);
      }
      return {
        title: post.data.title,
        description: post.data.description,
        pubDate: post.data.pubDate,
        link: postUrl(post),
        content,
      };
    }),
  );

  return rss({ title: SITE.title, description: SITE.description, site, items });
}
