# AGENTS.md

## What this repo is

Static GitHub Pages site for the **Vulpin** programming language, served at
`vulpin.fluxcast.dev` (custom domain via the **root** `CNAME`). Pure HTML/CSS/vanilla-JS
with Bootstrap 5.3.8 + Bootstrap Icons from the jsdelivr CDN. **No build, no package
manager, no tests, no lint, no CI** — deploy is just push. There are no commands to run
beyond a static file server.

## Repo layout: three self-contained site copies

- **Root (`/`)** — original standalone site. Bootstrap + **inline** `<style>` and
  `<script>` blocks; no shared `site.css`/`site.js`. **No playground.** Root `vulpin.js`
  and `demo.js` are orphans: no page loads them.
- **`v2/`** — full site copy with shared `site.css` (styles), `site.js` (navbar scroll +
  active-link behavior), `scene.js` (decorative three.js WebGL hero canvas), and a working
  `playground.html`.
- **`v3-Latest/`** — the current version. Same structure as `v2/` but `motion.js`
  (IntersectionObserver reveals + CSS animations, **no WebGL**) replaces `scene.js`.

Rules that follow from this:

- Directories are fully independent: all links are relative and pages never reference a
  version directory. Edit the copy you're working in (`v3-Latest/` for current work) and
  decide explicitly whether the root/v2 copies need the same change.
- `CNAME` files inside `v2/` and `v3-Latest/` are **inert** — GitHub Pages only honors the
  root one. Don't "fix" or sync them.
- `pkg.json` (all three levels) lists external Vulpin packages; **nothing in this repo
  fetches it** (possibly consumed externally). Known bug: root `pkg.json` has a malformed
  URL `https://vulpin-lang/vulbeep` (missing `github.com`) that the v2/v3 copies got right.

## The playground / interpreter (the only "code" here)

- `vulpin.js` (`export class Vulpin`) is a JS port of the Vulpin language interpreter that
  **must mirror the real C VM's command set** (see its header comment for the full list:
  `G/g/P`, `K`, `E/-`, `A`, `S`, `?/:/;`, `@/&`, `O/&`, `W/V/N/Z`, `J/L`, `F/R/~`,
  `T/C/Y`, `U`, `D`, `Q`, string shortcuts `.U .L .S .T .C`).
- `demo.js` is an ES module (`import { Vulpin } from './vulpin.js'`) exporting `SAMPLES`
  and wiring the playground UI. Only `playground.html` loads it, via `<script type="module">`.
- ES modules require **HTTP** — preview with `python3 -m http.server` (or any static
  server) from the directory of interest; `file://` breaks the playground. Verify playground
  changes by opening `<dir>/playground.html` and running a sample.
- `run()` enforces a sandbox step cap (`maxSteps = 40000`) and a time budget so infinite
  loops die gracefully. Keep that guard intact.
- `vulpin.js`/`demo.js` exist as near-identical copies in each version dir and can drift —
  when changing the interpreter, check every copy you intend to affect (at minimum
  `v3-Latest/`).

## Docs ↔ interpreter sync (manual, easy to miss)

As of the V1.0 sync, `v3-Latest` mirrors the real repo's README (Vulpin 1.x): direct
assignment `x=10`, Lists/Dicts/Sets, `in` membership, string shortcuts `.U .L .S .T .C`,
`m`/`l` comparison shorthands, inline `;` commands, modules (`math`/`random`/`os`), and
`O`/`for` end-exclusive ranges. The docs table is **hand-maintained** (no generator exists).
When adding or changing a language command, update together:

1. `vulpin.js` (the interpreter)
2. `docs.html` (command reference table + built-ins list)
3. `demo.js` (add a `SAMPLES` entry exercising it)

`download.html` lists real release tags on `github.com/vulpin-lang/Vulpin`
(`V1.0.3` … `V0.6`) — update per copy when a release ships.

## Conventions and quirks

- Palette is orange (`bg-orange`, `bg-torange`, Bootstrap `text-warning`); logo is
  `logo.png` per directory.
- `motion.js` (v3) and `scene.js` (v2) are **deliberately defensive**: they fail silently
  and respect `prefers-reduced-motion`. Preserve both properties when editing.
- Navbar/scroll logic is duplicated as inline scripts in root pages but centralized in
  `site.js` for v2/v3 — don't mix the two styles within one version dir.
