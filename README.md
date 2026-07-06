# Duo marketing site — source

The public landing page, served via GitHub Pages at
**https://dudgeon.github.io/duo/**.

## What's here

- `index.html` — the whole site. Single file, inline CSS, no build step, no
  external dependencies (a strict-CSP-friendly static page). Uses Duo's
  Atelier visual kernel (cream paper / ochre accent / serif headings — see
  [`skill/references/atelier-css.md`](../../skill/references/atelier-css.md)),
  hand-rolled for a marketing layout rather than the decision-playground
  class library.
- `assets/` — screenshots (resized copies of the ones in
  `docs/images/about-duo/`, via `sips -Z`) + a small favicon derived from
  `build/icon.png`.

Copy is adapted from [`docs/about-duo.md`](../about-duo.md) — that doc is
the canonical longer narrative; this page is the punchier public-facing cut
of it, audience-first for the PM / knowledge-worker reader (see
`docs/DECISIONS.md` if that framing ever needs to change).

## How it's deployed

This folder is the **source of truth**, tracked on `main` like any other
doc. GitHub Pages serves a separate `gh-pages` branch (repo root = this
folder's contents, promoted). There's no CI job wiring the two together —
after editing anything here, redeploy by hand:

```bash
# from the repo root, in a scratch location (not this worktree):
git worktree add /tmp/duo-gh-pages-deploy gh-pages
rm -rf /tmp/duo-gh-pages-deploy/*
cp -r docs/site/* /tmp/duo-gh-pages-deploy/
cd /tmp/duo-gh-pages-deploy
git add -A
git commit -m "site: redeploy from docs/site/"
git push origin gh-pages
cd -
git worktree remove /tmp/duo-gh-pages-deploy
```

If a future sprint wants this automated, the natural fix is a small GitHub
Actions workflow triggered on push-to-`main` when `docs/site/**` changes,
publishing to `gh-pages` — not yet built (kept manual deliberately, so a
docs-only cleanup pass didn't also have to design and land CI).

## Local preview

`.claude/launch.json`'s `duo-site` config serves this folder alone (so
relative asset paths resolve exactly like the deployed site does):

```bash
npx serve docs/site -p 8766
```

(The existing `roadmap` config serves all of `docs/`, which works for
`roadmap.html` but breaks this page's relative paths once nested under
`/site/` — use `duo-site` for this folder specifically.)
