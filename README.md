# gepsens.com

Personal site of Guillaume Balaine: startup ideas, each with a working prototype, plus notes.
Built with [Astro](https://astro.build), deployed to GitHub Pages at https://www.gepsens.com.

## Run it

```sh
npm install
npm run dev      # http://localhost:4321, drafts included
npm run build    # production build into dist/, drafts excluded
npm run preview  # serve the production build
```

## Write a post

Posts live in `src/content/posts/`. The file name is the URL: `my-idea.mdx` becomes `/blog/my-idea/`.

- **Idea post**: copy `templates/idea.mdx`. Set `kind: idea` and a `status`. The "Want to build this?" box is added at
  the end automatically.
- **Note**: any other post. `kind: note` (the default).
- **Draft**: `draft: true` shows the post in `npm run dev` only. Set it to `false` to publish.

Frontmatter fields are defined in `src/content.config.ts`.

### 3D models

Put STL or GLB files in `public/models/` and embed them in an `.mdx` post:

```mdx
import ModelViewer from '../../components/ModelViewer.astro';

<ModelViewer src="/models/table.stl" caption="Drag to rotate, scroll to zoom." />
```

Props: `src`, `caption`, `height` (default `26rem`), `color` (STL only), `autoRotate` (default `true`).
STL files are assumed Z-up, as most CAD tools export them.

## Settings to fill in

`src/config.ts`:

- `email`: the address on every call-to-action button (currently a placeholder).
- `buttondown`: your Buttondown username. The newsletter form stays hidden until it's set.
- `links`: social profiles shown in the footer.

Also fill in the TODOs in `src/pages/about.astro`.

## Deploy

Pushing to `master` runs `.github/workflows/deploy.yml`, which builds the site and publishes it to GitHub Pages.

One-time setup: in the repo's **Settings → Pages**, set **Source** to **GitHub Actions**. The custom domain comes from
`public/CNAME` (`www.gepsens.com`).

## Old site

This replaces a 2013 Octopress build. The one real post, `/blog/2013/06/23/chain-promises/`, keeps its URL via the
`permalink` frontmatter field. The old feed URL `/atom.xml` serves the new RSS feed. Everything else from the old site
was placeholder pages and was dropped; it's still in git history on `master` before this change.

## Analytics 
https://igosuki.goatcounter.com/
