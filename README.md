# ASCII Christmas Tree

A fully procedural ASCII Christmas tree for the web: thousands of individually
colored characters arranged in a real 3D cone, gold tinsel garlands winding
around it, blinking lights, ornaments, wrapped gifts, a golden star, and
`MERRY CHRISTMAS` typed out underneath — all in a starry winter night.

It is a static site: **HTML + CSS + plain JavaScript on a canvas**. No build
step, no framework, no server, no external images, fonts, or API keys.

## Files

```
ascii-christmas-tree/
├── index.html     page, canvas, accessible description, terminal HUD
├── styles.css     full-bleed night background, quiet HUD, responsive rules
├── script.js      the whole animation engine (no dependencies)
└── README.md      this file
```

## Run it locally

Any static file server works. From inside this folder:

```bash
# Python 3
python3 -m http.server 8000

# or Node
npx serve .
```

Open <http://localhost:8000>. Opening `index.html` directly from disk also works
in most browsers, but a local server is closer to GitHub Pages.

## Publish it on GitHub Pages

```bash
# 1. create an empty repository on github.com, then from this folder:
git init
git add .
git commit -m "Procedural ASCII Christmas tree"
git branch -M main
git remote add origin https://github.com/USERNAME/CHRISTMAS_REPO.git
git push -u origin main
```

Then, in the repository: **Settings → Pages → Build and deployment →
Source: Deploy from a branch → Branch: `main` → Folder: `/ (root)` → Save**.

After a minute the site is live at:

```
https://USERNAME.github.io/CHRISTMAS_REPO/
```

All links in the project are relative (`styles.css`, `script.js`), so the site
works from a sub-path such as `USERNAME.github.io/CHRISTMAS_REPO/`, not only
from a domain root. Nothing needs to be rebuilt or configured.

## How the artwork is made

**Data model.** Every visible mark is one character placed on a monospaced
grid. The tree is a 3D model: whorls of drooping branches carry glyphs with
`(x, y, z)` coordinates inside a cone, and a dense field of glyphs covers the
cone surface so the tree has mass rather than a wireframe look. On every frame
the model is rotated about its vertical axis, each glyph is projected onto a
character cell, and it is written through a depth buffer. That depth test is
what makes front branches hide back branches, keeps the tree from flickering,
and keeps ornaments and garlands attached to the same surface as the branches.
Garlands are helices around the same cone (with hanging swags), ornaments are
clusters pinned to the cone surface, and lights sit on branch tips.

Shading comes from depth: glyphs near the front of the cone use the brightest
palette level, glyphs at the silhouette and behind use darker levels. A seeded
random generator (`CFG.seed`) fixes the composition, glyph choices and light
phases so the scene is stable across frames and reloads.

**Timeline** (wall-clock seconds, not frame counts, capped at 30 fps):

| time | what happens |
| --- | --- |
| 0.0 – 1.8 | stars, snow and the faint dotted field only |
| 1.8 – 5.6 | the tree grows from the tip downward, branch by branch |
| 6.3 – 9.3 | gold garlands sweep up the cone in swags |
| 7.2 – 11.0 | lights switch on and baubles appear, all asynchronously |
| 10.0 – 13.0 | gifts materialise at the foot of the tree |
| 10.4 – 12.6 | the golden star forms, then settles into a glow |
| 12.5 – 15.1 | `MERRY CHRISTMAS` is typed out, letter by letter |
| 15.1 + | the finished tree turns slowly, sparkles and holds |

The character size is chosen from the viewport and the real monospace font
metrics; the cone's radius in cells is derived from that so the silhouette keeps
roughly the same width-to-height ratio on a phone, a tablet and a desktop. High
DPI screens render at up to 2× device pixels.

## Things you can change

Everything lives at the top of `script.js` unless noted.

| What | Where | Notes |
| --- | --- | --- |
| Greeting | `CFG.greeting` | Any text; the letters are spaced to about the width of the tree. |
| Greeting timing | `CFG.message.start`, `CFG.message.duration` | Speed of the reveal. |
| Tree height | `CFG.tree.rows` | Height in character rows (68 by default). More rows means finer, denser glyphs. |
| Tree fullness | `CFG.tree.whorls`, `CFG.tree.aspect` | `aspect` is silhouette width ÷ height (0.58 by default). |
| Branch texture | `envelopeAt()`, `buildTree()`, `buildNeedleField()` | Cone profile, branch droop, needle density. |
| Rotation | `CFG.rotation.degPerSec` | Degrees per second; set `0` to stop turning. |
| Speed of growth | `CFG.growth.start`, `CFG.growth.span` | 1.8 s + 3.4 s by default. |
| Garland wraps | `CFG.garland.turns`, `strands`, `perStrand`, `start`, `span`, `radius` | Number of times the tinsel winds around the cone. |
| Lights | `CFG.lights.count`, `start`, `span` | Plus the color mix in `buildLights()`. |
| Ornaments | `CFG.baubles.count`, `start`, `span` | Colors in the `families` list inside `buildBaubles()`. |
| Gifts | `GIFT_LAYOUT` | Each entry: `frac` (position as a fraction of the tree radius), `row`, `w`, `h`, `theme`. Add or remove entries to change how many presents appear. |
| Gift colors | `GIFT_THEMES` | Body, ribbon and bow, using palette families: `F.red`, `F.blue`, `F.lime`, `F.gold`, `F.cream`, `F.sun`. |
| Palette | `FAMILIES` | Four brightness levels per color family. Bigger index = brighter. |
| Composition | `CFG.seed` | Any integer; a new seed gives a different arrangement of branches and lights. |
| Frame cap | `CFG.fps` | 30 by default. |

Reduced motion (`prefers-reduced-motion: reduce`) shows the finished scene
without rotation and hides the pause control. `?t=16.5` in the URL starts the
scene at that time (handy for screenshots), and `window.asciiTree.seek(seconds)`,
`.pause()`, `.resume()` are available in the console.

## Controls and accessibility

- `pause` / `resume` button, or press **Space** (when a button is not focused)
- `replay` button, or press **R**
- The canvas has an `aria-label` and a hidden, full text description of the scene.
- The animation pauses itself while the tab is hidden.

## QA matrix

Checks actually run for this build (headless Chromium through Playwright at
375×667, 768×1024 and 1440×900):

| Check | Result |
| --- | --- |
| `node --check script.js` | passes |
| Console errors / warnings | none |
| Network requests | `index.html`, `styles.css`, `script.js` all 200 (304 on reload); no external requests |
| Screenshots at 0, 3, 6, 9, 12, 16 and 19 s | growth, garlands, lights, gifts, star and greeting all appear in order; verified visually |
| Phone 375×667 | full tree, star with rays, gifts, greeting and HUD all fit; nothing clipped |
| Tablet 768×1024 | full scene fits with margins |
| Desktop 1440×900 | full scene fits, tree centred with wide starfield |
| Resize while running | scene is rebuilt, time continues, no errors |
| Pause / resume | clock stops and resumes; button label and `aria-pressed` update |
| Replay (button and R key) | resets to 0 and rebuilds the growth |
| `prefers-reduced-motion: reduce` | finished tree at 17 s, no rotation, pause hidden, replay still renders |
| Paint cost | ≈22 ms per frame at 1440×900, ≈13 ms at 375×667 (capped at 30 fps) |
| Hidden tab | loop stops; no runaway timers |

Not run / not verified here:

- Real Firefox, Safari, iOS Safari or Android devices (desktop Chromium only).
- Lighthouse or a formal accessibility audit.
- Deployment to GitHub Pages itself — the steps above are the standard flow and
  the site uses only relative paths, but the live URL was not exercised.
- Long-session battery/GPU profiling on low-end phones.

Bugs found and fixed during the build, worth knowing about if you edit it:

1. The tree came out too skinny on fonts with a narrow advance width — the cone
   radius is now derived from measured glyph metrics instead of a fixed column
   count.
2. The star clipped at the top on phones — star scale and its reserved rows were
   retuned.
3. Gifts and the greeting collided — gifts now sit on the base line and the
   greeting is placed below them.
4. The base of the tree ended on a ruler-straight line — added a ragged skirt of
   dipping branch tips.
5. The upper cone looked empty — added a surface-wide needle field so density is
   even from base to tip at any viewport.
6. Several glyphs were nearly black at the silhouette — brighter palette and a
   shading floor; bold glyphs and a small bloom pass bring it closer to the
   reference look.
7. Reduced-motion “replay” restarted the animation — it now redraws the static
   finished scene instead.
8. The HUD “letters” counter reported every particle including hidden ones — it
   now counts the glyphs actually drawn.

Known caveats: the exact glyph shapes and spacing depend on the monospace font
installed on the viewer's machine (the layout adapts to its metrics, but a
different font will look slightly different). The star is a hand-made ASCII
star, not a photographic one. The bloom is produced by downscaling and re-adding
the frame, which every current browser supports but which costs a little GPU
time on very old phones.
