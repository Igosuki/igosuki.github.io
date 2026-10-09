# CLAUDE.md

Astro static site for www.gepsens.com, deployed to GitHub Pages by `.github/workflows/deploy.yml` on push to `master`.

## Layout

- `src/content/posts/`: all posts (`.md` / `.mdx`). Schema in `src/content.config.ts`.
- `src/lib.ts`: post helpers. Use `getPosts()` (handles drafts and sorting) and `postUrl()`; don't call `getCollection` directly.
- `src/config.ts`: site name, contact email, Buttondown username, social links, status labels.
- `src/layouts/Base.astro`: page shell (header, footer, fonts, meta).
- `src/components/`: `PostList`, `Invite` (email box: on every `kind: idea` post, on notes that set `invite`), `Newsletter`, `ModelViewer` (three.js, STL/GLB).
- `src/styles/global.css`: design tokens and base typography.
- `templates/idea.mdx`: starting point for a new idea post.

## Conventions

- Posts: `kind: idea` needs a `status`. URLs are `/blog/<file name>/` unless `permalink` is set.
  Never change the `permalink` of an existing post; old links depend on it.
- Drafts (`draft: true`) appear in dev only. `wip: true` publishes a post marked as work in progress; `draft: true` keeps it dev-only.
- Design: one left-aligned column (`.col`, `--measure`), dates in a left margin column (`--gutter`) on wide screens.
  Colors only through the CSS variables in `global.css`; every color needs a dark-mode value.
  Yellow `--marker` is reserved for the idea call-to-action. Don't use it elsewhere.
- Copy: sentence case, plain verbs, no all-caps labels.
- Keep the site fully static: no server, no API keys in the client.

## Check before committing

`npm run build` must pass with no errors.
