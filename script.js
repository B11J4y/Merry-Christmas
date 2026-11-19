/* =============================================================================
   ASCII Christmas Tree — procedural winter scene
   -----------------------------------------------------------------------------
   Pure canvas + JavaScript. No build step, no dependencies, no external assets.

   How the tree is built
   ---------------------
   Every visible mark is a character drawn on a monospaced grid. The tree is a
   3D model: whorls of drooping branches carry glyphs with (x, y, z) coordinates
   inside a cone. The model turns slowly about its vertical axis; each glyph is
   projected to a character cell and written through a depth buffer, so front
   branches hide back branches and nothing flickers in and out of order.

   Garlands are helices that wind around the same cone, ornaments are small
   clusters of glyphs pinned to its surface, and the lights sit on branch tips.
   Because all of them share the cone's coordinate space they rotate with the
   tree instead of floating in front of it.

   The scene is assembled once from a seeded random generator, so the
   composition is stable across frames and reloads.

   Timeline (seconds, wall clock)
   ------------------------------
     0.0 –  1.8  stars, snow, faint grid
     1.8 –  5.6  the tree grows from the tip downward, branch by branch
     6.3 –  9.3  gold garlands sweep up the cone in swags
     7.2 – 11.0  lights switch on, ornaments appear
     10.0 – 13.0 gifts materialise at the foot of the tree
     10.4 – 12.6 the golden star forms and settles
     12.5 – 15.1 MERRY CHRISTMAS is typed out
     15.1 +      the finished tree turns, glimmers and holds
   ========================================================================== */

(() => {
  'use strict';

  const TAU = Math.PI * 2;
  const INF = 1e9;

  const MONO = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, ' +
               '"Liberation Mono", "Courier New", monospace';
  const WEIGHT = '600';
  const fontString = (px) => `${WEIGHT} ${px}px ${MONO}`;

  /* =========================================================================
     1. Tunables — edit these first
     ========================================================================= */

  const CFG = {
    seed: 0x7a5eed,

    greeting: 'MERRY CHRISTMAS',

    tree: {
      rows: 68,          // height of the cone, in character rows
      whorls: 54,        // rings of branches from base to tip
      aspect: 0.58       // base width / height of the finished silhouette
    },

    growth: { start: 1.8, span: 3.4 },

    garland: {
      turns: 3.4,        // how many times the tinsel winds around the cone
      strands: 3,
      perStrand: 520,
      start: 6.3,
      span: 3.0,
      radius: 1.045      // slightly proud of the branches
    },

    lights: { count: 168, start: 7.2, span: 3.8 },

    baubles: { count: 46, start: 8.2, span: 2.6 },

    gifts: { start: 10.0, stagger: 0.42 },

    star: { start: 10.4, settle: 12.6 },

    message: { start: 12.5, duration: 2.6 },

    rotation: { delay: 0.3, degPerSec: 13 },

    fps: 30,

    finalTime: 17
  };

  /* =========================================================================
     2. Palette — four brightness levels per colour family
     ========================================================================= */

  const FAMILIES = [
    /* 0 green  */ ['#0d3324', '#19593c', '#2b9463', '#4ddb97'],
    /* 1 lime   */ ['#113a26', '#1f6b47', '#38a865', '#a6f5c0'],
    /* 2 mint   */ ['#143e2e', '#256f50', '#4cae7f', '#c8ffdc'],
    /* 3 jade   */ ['#0a3524', '#12603f', '#228f5d', '#3fd694'],
    /* 4 pine   */ ['#0b291e', '#134a35', '#1f6f52', '#39b58a'],
    /* 5 gold   */ ['#3a2a10', '#6b4a18', '#b3882b', '#ffd873'],
    /* 6 sun    */ ['#4a3410', '#8a611c', '#d4a83a', '#ffeda8'],
    /* 7 red    */ ['#2a0a0b', '#5c1718', '#a83132', '#ff6f62'],
    /* 8 cream  */ ['#3c3a2a', '#6d6849', '#b3b08f', '#fffce4'],
    /* 9 ice    */ ['#1d2740', '#31456b', '#6685b6', '#d8e6ff'],
    /* 10 cyan  */ ['#0d2b33', '#155059', '#2f9aa6', '#9cf4fb'],
    /* 11 blue  */ ['#0c1533', '#192b63', '#3a5fbd', '#82a4ff'],
    /* 12 bark  */ ['#1d1813', '#302620', '#4a3c2d', '#6a5842']
  ];

  const F = {
    green: 0, lime: 1, mint: 2, jade: 3, pine: 4,
    gold: 5, sun: 6, red: 7, cream: 8, ice: 9,
    cyan: 10, blue: 11, bark: 12
  };

  const PAL = [];
  FAMILIES.forEach((shades) => shades.forEach((css) => PAL.push(css)));

  /* =========================================================================
     3. Glyphs, weights and small helpers
     ========================================================================= */

  // Every character the scene is allowed to print.
  const GLYPHS = "W%&@VX#*+=-~^oO0wvx/\\|()[]'.,:;<>";
  const CH = Object.create(null);
  for (let i = 0; i < GLYPHS.length; i++) CH[GLYPHS[i]] = i;

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  function smoothstep(edge0, edge1, x) {
    const t = clamp((x - edge0) / (edge1 - edge0 || 1e-6), 0, 1);
    return t * t * (3 - 2 * t);
  }

  // Small, fast, seedable PRNG (mulberry32).
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function random() {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), 1 | t);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Weighted glyph table: [['%', 9], ['W', 8], ...]
  function weighted(pairs) {
    const items = [];
    const cumulative = [];
    let total = 0;
    for (const [ch, w] of pairs) {
      total += w;
      items.push(CH[ch]);
      cumulative.push(total);
    }
    return { items, cumulative, total };
  }

  function pickWeighted(table, r) {
    const target = r * table.total;
    let lo = 0;
    let hi = table.cumulative.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (table.cumulative[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    return table.items[lo];
  }

  const NEEDLE_CHARS = weighted([
    ['%', 10], ['W', 9], ['&', 9], ['#', 7], ['@', 5], ['V', 6], ['X', 6],
    ['*', 6], ['+', 5], ['=', 5], ['-', 4], ['~', 4], ['^', 4],
    ['o', 3], ['0', 3], ['O', 2], ['w', 3], ['v', 3], ['x', 3],
    ['/', 2], ['\\', 2], ['|', 2], ['(', 2], [')', 2], ['.', 2],
    ["'", 1], [',', 1], [':', 1]
  ]);

  const GARLAND_CHARS = weighted([
    ['*', 6], ['+', 6], ['=', 5], ['~', 5], ['-', 4], ['o', 3], ['0', 2], ['^', 2]
  ]);

  const BAUBLE_CHARS = weighted([
    ['#', 6], ['@', 5], ['%', 5], ['&', 4], ['O', 3], ['o', 3], ['*', 2]
  ]);

  const LIGHT_CHARS = weighted([
    ['*', 5], ['+', 5], ['o', 3], ['0', 2], ['^', 2], ['#', 1]
  ]);

  /* =========================================================================
     4. Canvas, view and buffers
     ========================================================================= */

  const stage = document.getElementById('stage');
  const canvas = document.getElementById('scene');
  const ctx = canvas.getContext('2d', { alpha: false });

  const hudClock = document.getElementById('clock-value');
  const hudRotation = document.getElementById('stat-rotation');
  const hudLights = document.getElementById('stat-lights');
  const hudLetters = document.getElementById('stat-letters');
  const btnPause = document.getElementById('btn-pause');
  const btnReplay = document.getElementById('btn-replay');

  const view = { w: 0, h: 0 };

  let dpr = 1;
  let cellW = 8;
  let cellH = 15;
  let cols = 0;
  let rows = 0;
  let centerCol = 0;
  let tipRow = 9;
  let groundRow = 53;
  let starRow = 5;

  // base radius of the cone, in character cells (set by layout())
  let treeRadius = 32;
  let sceneBuilt = false;

  let atlas = { canvas: null, tw: 1, th: 1 };
  let background = null;
  let starCells = [];
  let ambientGrad = null;
  let starGrad = null;

  let glyphBuf = null;
  let palBuf = null;
  let depthBuf = null;

  let snow = [];
  let twinklers = [];
  let bloom = null;
  let bloomCtx = null;

  /* =========================================================================
     5. The particle store (flat typed arrays, no per-frame allocation)
     ========================================================================= */

  const CAP = 26000;
  const P = {
    n: 0,
    x: new Float32Array(CAP),
    y: new Float32Array(CAP),
    z: new Float32Array(CAP),
    app: new Float32Array(CAP),
    phase: new Float32Array(CAP),
    speed: new Float32Array(CAP),
    bias: new Float32Array(CAP),
    ch: new Uint8Array(CAP),
    fam: new Uint8Array(CAP),
    kind: new Uint8Array(CAP),
    twinkle: new Uint8Array(CAP),
    flash: new Uint8Array(CAP)
  };

  function pushParticle(x, y, z, ch, fam, appear, opt) {
    if (P.n >= CAP) return;
    const i = P.n++;
    P.x[i] = x;
    P.y[i] = y;
    P.z[i] = z;
    P.ch[i] = ch;
    P.fam[i] = fam;
    P.app[i] = appear;
    P.kind[i] = opt.kind || 0;
    P.bias[i] = opt.bias || 0;
    P.twinkle[i] = opt.twinkle || 0;
    P.phase[i] = opt.phase || 0;
    P.speed[i] = opt.speed || 1;
    P.flash[i] = opt.flash == null ? 255 : opt.flash;
  }

  /* =========================================================================
     6. Geometry of the tree
     ========================================================================= */

  // Cone silhouette: widest at the base, tapering to the tip, with soft tiers.
  function envelopeAt(u) {
    // u = 0 at the base, 1 at the tip
    const taper = Math.pow(1 - u, 0.74);
    const tier = 0.965 + 0.035 * Math.cos(TAU * (u * 5.4 - 0.12));
    return taper * tier; // fraction of the base radius
  }

  function pickNeedleGlyph(tt, rng) {
    // branch tips get little starburst marks
    if (tt > 0.84 && rng() < 0.24) {
      const r = rng();
      return CH[r < 0.5 ? '*' : r < 0.8 ? '+' : 'x'];
    }
    return pickWeighted(NEEDLE_CHARS, rng());
  }

  function pickNeedleFamily(tt, rng) {
    const r = rng();
    const tip = tt > 0.76;

    if (tip) {
      if (r < 0.22) return F.lime;
      if (r < 0.36) return F.mint;
      if (r < 0.48) return F.sun;
      if (r < 0.56) return F.cream;
      if (r < 0.64) return F.gold;
      if (r < 0.82) return F.green;
      if (r < 0.94) return F.jade;
      return F.pine;
    }

    if (r < 0.31) return F.green;
    if (r < 0.49) return F.jade;
    if (r < 0.63) return F.lime;
    if (r < 0.75) return F.pine;
    if (r < 0.83) return F.mint;
    if (r < 0.89) return F.gold;
    if (r < 0.93) return F.sun;
    if (r < 0.96) return F.red;
    if (r < 0.985) return F.cream;
    return F.cyan;
  }

  let tipCandidates = [];

  function buildTree(rng) {
    const R = treeRadius;
    const rowsTall = CFG.tree.rows;
    const whorls = CFG.tree.whorls;
    const growth = CFG.growth;

    // Whorls of drooping branches, bottom to top.
    for (let i = 0; i < whorls; i++) {
      const u = 0.008 + (i / (whorls - 1)) * 0.978;
      const y = u * rowsTall;
      const env = R * envelopeAt(u);
      const branchCount = Math.round(9 + 16 * (1 - u));
      const spin = i * 2.39996; // golden angle keeps whorls from lining up

      for (let b = 0; b < branchCount; b++) {
        const a0 = spin + (b / branchCount) * TAU + (rng() - 0.5) * 0.5;
        const len = env * (0.66 + rng() * 0.46);
        const inner = Math.max(0.8, env * 0.13);
        const droop = (0.8 + 1.7 * (1 - u)) * (0.5 + rng() * 0.9);
        const bend = (rng() - 0.5) * 0.55;
        const count = Math.max(2, Math.round(len * 0.85));

        for (let k = 0; k < count; k++) {
          const tt = k / (count - 1);
          const rr = inner + (len - inner) * tt;
          const yy = y - droop * Math.pow(tt, 1.7) + (rng() - 0.5) * 0.6;
          const aa = a0 + bend * tt * tt;

          if (yy < 0.15) continue;              // ragged skirt at the ground
          if (rng() < 0.05) continue; // small holes keep the texture breathable

          const ch = pickNeedleGlyph(tt, rng);
          const fam = pickNeedleFamily(tt, rng);
          const appear =
            growth.start +
            growth.span * Math.pow(1 - u, 1.05) +
            0.55 * (rr / (env + 0.001)) +
            rng() * 0.22;

          pushParticle(Math.cos(aa) * rr, yy, Math.sin(aa) * rr, ch, fam, appear, {
            kind: 0,
            bias: 0.5,
            twinkle: rng() < 0.07 ? 1 : 0,
            phase: rng() * TAU,
            speed: 0.6 + rng() * 1.7,
            flash: rng() < 0.28 ? (rng() < 0.5 ? F.cream : F.ice) : 255
          });

          if (tt > 0.7 && tipCandidates.length < 1200) {
            tipCandidates.push({
              x: Math.cos(aa) * rr,
              y: yy,
              z: Math.sin(aa) * rr
            });
          }
        }

        // A short side twig makes the branch edge furrier.
        if (env > 2.5 && rng() < 0.5) {
          const tt = 0.45 + rng() * 0.4;
          const rr = inner + (len - inner) * tt;
          const aa = a0 + (rng() - 0.5) * 0.9;
          const yy = y - droop * Math.pow(tt, 1.7) + (rng() - 0.4) * 1.6;
          if (yy < 0.2) continue;
          pushParticle(Math.cos(aa) * rr, yy, Math.sin(aa) * rr,
            pickNeedleGlyph(0.5, rng),
            pickNeedleFamily(0.4, rng),
            growth.start + growth.span * Math.pow(1 - u, 1.05) + rng() * 0.3,
            { kind: 0, bias: 0.3, phase: rng() * TAU, speed: 0.8 + rng(), twinkle: rng() < 0.05 ? 1 : 0 }
          );
        }
      }
    }

    // A slender tip spike above the last whorl.
    for (let k = 0; k < 6; k++) {
      const uu = 0.99 + k * 0.007;
      const ang = k * 2.1;
      pushParticle(
        Math.cos(ang) * 0.7, uu * rowsTall, Math.sin(ang) * 0.7,
        CH[k < 2 ? '|' : k < 4 ? '*' : '^'],
        k < 3 ? F.lime : F.mint,
        growth.start + 0.15 + k * 0.05,
        { kind: 0, flash: F.cream }
      );
    }

    // Ragged skirt: branch tips that dip past the base line, so the tree does
    // not end on a ruler-straight edge.
    for (let i = 0; i < 280; i++) {
      const ang = rng() * TAU;
      const rr = R * (0.8 + rng() * 0.32);
      const yy = -1.3 + rng() * 1.8;
      pushParticle(Math.cos(ang) * rr, yy, Math.sin(ang) * rr,
        pickNeedleGlyph(0.9, rng),
        pickNeedleFamily(0.9, rng),
        CFG.growth.start + CFG.growth.span * 0.98 + rng() * 0.4,
        {
          kind: 0,
          bias: 0.2,
          twinkle: rng() < 0.06 ? 1 : 0,
          phase: rng() * TAU,
          speed: 1 + rng() * 1.6
        }
      );
    }

    // A few dark glyphs inside the cone so it reads as volume, not a shell.
    for (let i = 0; i < 220; i++) {
      const u = rng() * 0.95;
      const ang = rng() * TAU;
      const rr = R * envelopeAt(u) * rng() * 0.55;
      pushParticle(Math.cos(ang) * rr, u * rowsTall, Math.sin(ang) * rr,
        CH[rng() < 0.5 ? '.' : ':'],
        rng() < 0.6 ? F.pine : F.green,
        CFG.growth.start + CFG.growth.span * Math.pow(1 - u, 1.05),
        { kind: 0 }
      );
    }
  }

  // A dense field of glyphs over the cone's surface. This is what gives the
  // tree its solid mass: a fixed number of glyphs per cell of surface, from the
  // base all the way to the tip, with a little radial scatter for volume.
  function buildNeedleField(rng) {
    const R = treeRadius;
    const rowsTall = CFG.tree.rows;
    const growth = CFG.growth;

    for (let yRow = 0; yRow < rowsTall; yRow++) {
      const u = (yRow + 0.6) / rowsTall;
      const env = R * envelopeAt(u);
      if (env < 0.8) continue;

      const n = Math.round(TAU * env * 0.85);

      for (let k = 0; k < n; k++) {
        const ang = rng() * TAU;
        const rf = 0.84 + rng() * 0.24; // depth through the outer needles
        const rr = env * rf;
        const yy = yRow + (rng() - 0.5) * 1.2;
        if (yy < 0.2) continue;

        const ch = pickNeedleGlyph(rf * 0.8, rng);
        const fam = pickNeedleFamily(rf * 0.75, rng);
        const appear =
          growth.start +
          growth.span * Math.pow(1 - u, 1.05) +
          rng() * 0.3;

        pushParticle(Math.cos(ang) * rr, yy, Math.sin(ang) * rr, ch, fam, appear, {
          kind: 4,
          twinkle: rng() < 0.05 ? 1 : 0,
          phase: rng() * TAU,
          speed: 0.6 + rng() * 1.8,
          flash: rng() < 0.3 ? (rng() < 0.6 ? F.cream : F.lime) : 255
        });
      }
    }
  }

  function buildGarlands(rng) {
    const R = treeRadius;
    const rowsTall = CFG.tree.rows;
    const g = CFG.garland;

    for (let s = 0; s < g.strands; s++) {
      const phase = (s / g.strands) * TAU + 0.8;

      for (let i = 0; i < g.perStrand; i++) {
        const p = i / (g.perStrand - 1);
        const u = 0.03 + p * 0.93;

        if (rng() < 0.08) continue; // tinsel is dense but not solid

        const ang = phase + g.turns * TAU * u + 0.32 * Math.sin(u * TAU * 2.2 + s);
        const rr = R * envelopeAt(u) * g.radius + 0.7;
        const swag = -1.35 * Math.abs(Math.sin(ang * 0.85 + 0.4)); // hanging loops
        const yy = Math.max(0.4, u * rowsTall + swag + (rng() - 0.5) * 0.5);

        const fam = rng() < 0.72 ? F.gold : rng() < 0.55 ? F.sun : F.cream;
        pushParticle(Math.cos(ang) * rr, yy, Math.sin(ang) * rr,
          pickWeighted(GARLAND_CHARS, rng), fam,
          g.start + g.span * p + rng() * 0.14,
          {
            kind: 1,
            bias: 1.3,
            twinkle: 1,
            phase: rng() * TAU,
            speed: 1 + rng() * 2.4,
            flash: F.sun
          }
        );

        // occasional drop hanging below the strand
        if (i % 26 === 7 && yy > 1.4) {
          pushParticle(Math.cos(ang) * (rr + 0.2), yy - 1.2, Math.sin(ang) * (rr + 0.2),
            CH[rng() < 0.5 ? '.' : "'"],
            F.gold,
            g.start + g.span * p + 0.05,
            {             kind: 1, bias: 1.3, twinkle: 1, phase: rng() * TAU, speed: 1.4 }
          );
        }
      }
    }
  }

  function buildBaubles(rng) {
    const R = treeRadius;
    const rowsTall = CFG.tree.rows;
    const b = CFG.baubles;

    const families = [F.red, F.red, F.gold, F.cream, F.cyan, F.lime, F.sun];

    for (let i = 0; i < b.count; i++) {
      const u = 0.05 + Math.pow(rng(), 0.85) * 0.86;
      const ang = rng() * TAU;
      const rr = R * envelopeAt(u) * 1.02;
      const cx = Math.cos(ang) * rr;
      const cz = Math.sin(ang) * rr;
      const cy = u * rowsTall;

      const fam = families[(rng() * families.length) | 0];
      const pieces = 7 + ((rng() * 4) | 0);
      const appear = b.start + b.span * (i / b.count) + rng() * 0.15;

      for (let k = 0; k < pieces; k++) {
        const dx = (rng() - 0.5) * 3.0;
        const dy = (rng() - 0.5) * 3.0;
        // small offsets along the cone's tangent
        const tx = -Math.sin(ang) * dx;
        const tz = Math.cos(ang) * dx;
        pushParticle(cx + tx * 0.5, cy + dy, cz + tz * 0.5,
          pickWeighted(BAUBLE_CHARS, rng), fam, appear,
          {
            kind: 2,
            bias: 1.1,
            twinkle: rng() < 0.4 ? 1 : 0,
            phase: rng() * TAU,
            speed: 1 + rng() * 1.5,
            flash: F.cream
          }
        );
      }
    }
  }

  function buildLights(rng) {
    const l = CFG.lights;
    const pool = tipCandidates.slice();

    // Fisher–Yates shuffle with the seeded RNG, so light placement is stable.
    for (let i = pool.length - 1; i > 0; i--) {
      const j = (rng() * (i + 1)) | 0;
      const tmp = pool[i];
      pool[i] = pool[j];
      pool[j] = tmp;
    }

    const count = Math.min(l.count, pool.length);
    for (let i = 0; i < count; i++) {
      const t = pool[i];
      const r = rng();
      let fam;
      if (r < 0.42) fam = F.cream;
      else if (r < 0.66) fam = F.sun;
      else if (r < 0.81) fam = F.red;
      else if (r < 0.91) fam = F.lime;
      else if (r < 0.96) fam = F.cyan;
      else fam = F.gold;

      pushParticle(t.x, t.y, t.z, pickWeighted(LIGHT_CHARS, rng), fam,
        l.start + l.span * (i / count) + rng() * 0.25,
        {
          kind: 3,
          bias: 1.4,
          phase: rng() * TAU,
          speed: 0.8 + rng() * 2.4,
          flash: fam
        }
      );
    }
  }

  function buildScene() {
    P.n = 0;
    tipCandidates = [];
    buildTree(mulberry32(CFG.seed));
    buildNeedleField(mulberry32(CFG.seed ^ 0x6e21));
    buildGarlands(mulberry32(CFG.seed ^ 0x2b1d));
    buildBaubles(mulberry32(CFG.seed ^ 0x77c1));
    buildLights(mulberry32(CFG.seed ^ 0x4d0f));
  }

  /* =========================================================================
     7. Star (screen-space ASCII glyphs above the tree tip)
     ========================================================================= */

  function buildStar() {
    const rng = mulberry32(CFG.seed ^ 0x51a7);
    const cells = [];

    // Nine columns wide, seven rows tall: a compact five-pointed star with a
    // bright core and two lower legs, in the same spirit as the reference.
    const art = [
      '....*....',
      '...***...',
      '..**#**..',
      '*##@%@##*',
      '.**###**.',
      '..*###*..',
      '..*...*..'
    ];

    for (let r = 0; r < art.length; r++) {
      for (let c = 0; c < art[r].length; c++) {
        const glyph = art[r][c];
        if (glyph === '.') continue;

        const dx = c - 4;
        const dy = r - 3;
        const d = clamp(Math.hypot(dx, dy * 1.2) / 5.2, 0, 1);

        let fam = F.gold;
        let lvl = 3;
        if (glyph === '*') { fam = F.sun; lvl = 2; }
        else if (glyph === '%') { fam = F.gold; lvl = 2; }
        else if (glyph === '@') { fam = F.cream; lvl = 3; }

        cells.push({
          dx, dy, ch: CH[glyph], fam, lvl,
          order: d * 0.8 + rng() * 0.3
        });
      }
    }

    // Thin rays: bars above, slashes near the shoulders, sparkles to the sides.
    const rays = [
      [0, -4, '|', F.gold],
      [-2, -3, '\\', F.gold], [2, -3, '/', F.gold],
      [-3, -2, '\\', F.gold], [3, -2, '/', F.gold],
      [-5, 0, '-', F.gold], [5, 0, '-', F.gold],
      [-6, 0, '*', F.sun], [6, 0, '*', F.sun],
      [-3, 1, ',', F.gold], [3, 1, '.', F.gold]
    ];

    for (const [dx, dy, ch, fam] of rays) {
      if (CH[ch] === undefined) continue;
      cells.push({ dx, dy, ch: CH[ch], fam, lvl: 2, order: 0.9 + rng() * 0.4 });
    }

    starCells = cells;
  }

  /* =========================================================================
     8. Gifts (small ASCII sprites at the foot of the tree)
     ========================================================================= */

  const GIFT_THEMES = [
    { body: F.red,  ribbon: F.cream, bow: F.cream },
    { body: F.blue, ribbon: F.sun,   bow: F.sun },
    { body: F.lime, ribbon: F.cream, bow: F.red },
    { body: F.red,  ribbon: F.sun,   bow: F.cream },
    { body: F.blue, ribbon: F.cream, bow: F.sun },
    { body: F.gold, ribbon: F.red,   bow: F.cream },
    { body: F.lime, ribbon: F.sun,   bow: F.cream }
  ];

  // "frac" is the horizontal centre as a fraction of the tree's base radius.
  const GIFT_LAYOUT = [
    { frac: -1.02, row: -4, w: 11, h: 6, theme: 0 },
    { frac: -0.78, row: -5, w: 10, h: 7, theme: 1 },
    { frac: -0.54, row: -3, w: 10, h: 6, theme: 2 },
    { frac: -0.10, row: -4, w: 11, h: 6, theme: 3 },
    { frac: 0.52,  row: -5, w: 10, h: 7, theme: 4 },
    { frac: 0.78,  row: -3, w: 10, h: 6, theme: 5 },
    { frac: 1.00,  row: -4, w: 9,  h: 6, theme: 6 }
  ];

  function buildGift(rng, theme, w, h) {
    const cells = [];
    const mid = Math.floor(w / 2);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const edge = x === 0 || x === w - 1;
        const centre = x === mid;
        let ch;
        let fam;
        let lvl;

        if (y === 0) {
          // bow: a knot with two loops sitting on the lid
          if (centre) {
            ch = '*';
            fam = theme.bow;
            lvl = 3;
          } else if (Math.abs(x - mid) === 1) {
            ch = rng() < 0.55 ? 'o' : '+';
            fam = theme.bow;
            lvl = 3;
          } else if (Math.abs(x - mid) === 2) {
            ch = rng() < 0.5 ? '+' : '*';
            fam = theme.bow;
            lvl = 2;
          } else {
            continue;
          }
        } else if (y === 1) {
          // lid: one bright band across the whole box
          ch = centre ? '=' : '=';
          fam = centre ? theme.ribbon : theme.body;
          lvl = 3;
        } else if (y === h - 1) {
          // base row, a shade darker
          ch = centre ? '|' : '=';
          fam = centre ? theme.ribbon : theme.body;
          lvl = 2;
        } else if (y === 3) {
          // horizontal ribbon band, only on the taller boxes
          ch = centre ? '+' : '=';
          fam = theme.ribbon;
          lvl = 2;
        } else if (centre) {
          // vertical ribbon down the middle
          ch = '|';
          fam = theme.ribbon;
          lvl = 3;
        } else {
          // solid body of one glyph, so it reads as a wrapped parcel
          ch = '#';
          fam = theme.body;
          lvl = edge ? 2 : 3;
        }

        cells.push({ dx: x - mid, dy: y, ch: CH[ch], pal: fam * 4 + lvl });
      }
    }

    return { cells };
  }

  let gifts = [];

  function buildGifts() {
    const rng = mulberry32(CFG.seed ^ 0x9e37);
    gifts = GIFT_LAYOUT.map((spec, i) => {
      const theme = GIFT_THEMES[spec.theme % GIFT_THEMES.length];
      const sprite = buildGift(rng, theme, spec.w, spec.h);
      return {
        frac: spec.frac,
        row: spec.row,
        cells: sprite.cells,
        appear: CFG.gifts.start + i * CFG.gifts.stagger
      };
    });
  }

  /* =========================================================================
     9. Background (cached starfield, faint grid, haze, vignette)
     ========================================================================= */

  function buildBackground() {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(view.w * dpr));
    c.height = Math.max(1, Math.round(view.h * dpr));
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);

    // deep winter-night gradient
    const grad = g.createLinearGradient(0, 0, 0, view.h);
    grad.addColorStop(0, '#04070d');
    grad.addColorStop(0.55, '#050a13');
    grad.addColorStop(1, '#03060b');
    g.fillStyle = grad;
    g.fillRect(0, 0, view.w, view.h);

    // faint green lift behind the tree
    const treeCx = view.w / 2;
    const treeCy = groundRow * cellH - CFG.tree.rows * cellH * 0.52;
    const haze = g.createRadialGradient(
      treeCx, treeCy, 0,
      treeCx, treeCy, Math.max(view.w * 0.36, CFG.tree.rows * cellH * 0.66)
    );
    haze.addColorStop(0, 'rgba(24, 82, 60, 0.18)');
    haze.addColorStop(0.55, 'rgba(14, 46, 38, 0.08)');
    haze.addColorStop(1, 'rgba(0, 0, 0, 0)');
    g.fillStyle = haze;
    g.fillRect(0, 0, view.w, view.h);

    const rng = mulberry32(CFG.seed ^ 0x1f2e);

    // tiny stars / snow dust
    const dotCount = clamp(Math.round((view.w * view.h) / 400), 320, 2600);
    for (let i = 0; i < dotCount; i++) {
      const x = rng() * view.w;
      const y = rng() * view.h;
      const r = 0.35 + rng() * 1.0;
      const a = 0.14 + Math.pow(rng(), 1.2) * 0.82;
      const warm = rng() < 0.12;
      g.fillStyle = warm
        ? `rgba(255, 238, 200, ${a})`
        : `rgba(214, 232, 255, ${a})`;
      g.beginPath();
      g.arc(x, y, r, 0, TAU);
      g.fill();
    }

    // restrained '+' / '*' starbursts
    const starGlyphSize = Math.max(8, cellH * 0.95);
    g.font = fontString(starGlyphSize);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const glyphCount = clamp(Math.round((view.w * view.h) / 7800), 26, 260);
    for (let i = 0; i < glyphCount; i++) {
      const x = rng() * view.w;
      const y = rng() * view.h * 0.94;
      const a = 0.12 + rng() * 0.42;
      g.fillStyle = `rgba(214, 230, 255, ${a})`;
      g.fillText(rng() < 0.68 ? '+' : rng() < 0.8 ? '*' : '·', x, y);
    }

    // horizontal dotted field over the lower half, like an old terminal map
    g.fillStyle = 'rgba(104, 128, 158, 0.10)';
    const dashRows = Math.max(7, Math.floor(view.h / (cellH * 1.9)));
    for (let i = 0; i < dashRows; i++) {
      const y = view.h * (0.4 + 0.58 * (i / dashRows));
      const dashes = Math.max(4, Math.floor(view.w / 30));
      for (let d = 0; d < dashes; d++) {
        if (rng() < 0.3) continue;
        const x = rng() * view.w;
        g.globalAlpha = 0.25 + rng() * 0.75;
        g.fillRect(x, y, 2 + rng() * 6, 1);
      }
    }
    g.globalAlpha = 1;

    // sparse vertical dotted columns, even fainter
    g.fillStyle = 'rgba(96, 120, 150, 0.09)';
    for (let i = 0; i < 30; i++) {
      const x = rng() * view.w;
      const step = 5 + rng() * 9;
      for (let y = view.h * 0.35; y < view.h; y += step) {
        if (rng() < 0.55) continue;
        g.fillRect(x, y, 1, 1);
      }
    }

    // vignette keeps the eye on the tree
    const vig = g.createRadialGradient(
      view.w / 2, view.h * 0.46, Math.min(view.w, view.h) * 0.24,
      view.w / 2, view.h * 0.5, Math.max(view.w, view.h) * 0.78
    );
    vig.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vig.addColorStop(1, 'rgba(0, 0, 0, 0.55)');
    g.fillStyle = vig;
    g.fillRect(0, 0, view.w, view.h);

    background = c;

    // live elements: drifting snow and a few twinkling background stars
    snow = [];
    const flakes = clamp(Math.round((view.w * view.h) / 12000), 26, 120);
    for (let i = 0; i < flakes; i++) {
      snow.push({
        x: rng(),
        y: rng(),
        speed: 0.25 + rng() * 1.15,
        phase: rng() * TAU,
        size: rng() < 0.22 ? 1.6 : 1,
        alpha: 0.12 + rng() * 0.35
      });
    }

    twinklers = [];
    for (let i = 0; i < 26; i++) {
      twinklers.push({
        x: rng() * view.w,
        y: rng() * view.h * 0.9,
        phase: rng() * TAU,
        speed: 0.5 + rng() * 1.4,
        ch: rng() < 0.5 ? '+' : '*'
      });
    }
  }

  /* =========================================================================
     10. Atlas — every glyph pre-rendered in every palette colour
     ========================================================================= */

  function buildAtlas(fontPx) {
    const tw = Math.max(3, Math.ceil(cellW * dpr));
    const th = Math.max(5, Math.ceil(cellH * dpr));

    const c = document.createElement('canvas');
    c.width = tw * GLYPHS.length;
    c.height = th * PAL.length;

    const g = c.getContext('2d');
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = fontString(fontPx * dpr);

    for (let p = 0; p < PAL.length; p++) {
      const y = p * th + th / 2;
      g.fillStyle = PAL[p];
      for (let gi = 0; gi < GLYPHS.length; gi++) {
        g.fillText(GLYPHS[gi], gi * tw + tw / 2, y);
      }
    }

    atlas = { canvas: c, tw, th };
  }

  /* =========================================================================
     11. Layout
     ========================================================================= */

  const SCENE_ROWS = 11 + CFG.tree.rows + 5.4 + 1.2; // star + tree + gifts + greeting

  function measureCell(fontPx) {
    ctx.font = fontString(fontPx);
    const w = ctx.measureText('M').width;
    return w > 0 ? w : fontPx * 0.6;
  }

  function layout() {
    const rect = stage.getBoundingClientRect();
    view.w = Math.max(240, Math.round(rect.width));
    view.h = Math.max(240, Math.round(rect.height));
    dpr = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = Math.round(view.w * dpr);
    canvas.height = Math.round(view.h * dpr);
    canvas.style.width = view.w + 'px';
    canvas.style.height = view.h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const hudReserve = clamp(view.h * 0.1, 52, 96);
    const availH = Math.max(180, view.h - hudReserve);
    const availW = view.w * 0.96;

    // Height drives the character size; the tree's radius is then derived from
    // the real glyph metrics so the silhouette keeps its proportions whatever
    // monospaced font the platform supplies.
    const cellHt = (availH * 0.98) / SCENE_ROWS;
    let fontPx = clamp(cellHt * 1.16, 6, 28);

    cellH = cellHt;
    cellW = measureCell(fontPx);

    // base width / height = (2R * cellW) / (rows * cellH)
    const wantedRadius = (CFG.tree.aspect * CFG.tree.rows * cellH) / (2 * cellW);
    let radius = Math.round(clamp(wantedRadius, 10, 64));

    // The gifts spread a little beyond the cone; shrink type if they would not fit.
    const neededCols = 2 * (radius * 1.05 + 7);
    if (neededCols * cellW > availW) {
      const shrink = availW / (neededCols * cellW);
      fontPx = Math.max(6, fontPx * shrink);
      cellH = cellHt * shrink;
      cellW = measureCell(fontPx);
      radius = Math.round(clamp((CFG.tree.aspect * CFG.tree.rows * cellH) / (2 * cellW), 10, 64));
    }

    cols = Math.max(40, Math.floor(view.w / cellW));
    rows = Math.max(30, Math.floor(view.h / cellH));
    centerCol = Math.floor(cols / 2);

    const blockH = SCENE_ROWS * cellH;
    const top = Math.max(cellH * 1.8, (availH - blockH) / 2);

    tipRow = top / cellH + 11;
    groundRow = tipRow + CFG.tree.rows;
    starRow = tipRow - 4.6;

    const radiusChanged = radius !== treeRadius || !sceneBuilt;
    treeRadius = radius;

    glyphBuf = new Uint8Array(cols * rows);
    palBuf = new Uint8Array(cols * rows);
    depthBuf = new Float32Array(cols * rows);

    buildAtlas(fontPx);
    buildStar();
    buildBackground();

    // low-resolution copy of the frame, used for a soft bloom pass
    bloom = document.createElement('canvas');
    bloom.width = Math.max(1, Math.round(view.w / 4));
    bloom.height = Math.max(1, Math.round(view.h / 4));
    bloomCtx = bloom.getContext('2d');

    if (radiusChanged) {
      buildScene();
      sceneBuilt = true;
    }

    // cached radial gradients
    const treeCx = view.w / 2;
    const treeCy = groundRow * cellH - CFG.tree.rows * cellH * 0.55;

    const ambient = ctx.createRadialGradient(
      treeCx, treeCy, 0,
      treeCx, treeCy, Math.max(CFG.tree.rows * cellH * 0.74, view.w * 0.32)
    );
    ambient.addColorStop(0, 'rgba(42, 128, 88, 0.15)');
    ambient.addColorStop(0.5, 'rgba(18, 66, 48, 0.07)');
    ambient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ambientGrad = ambient;

    const starX = (centerCol + 0.5) * cellW;
    const starY = (starRow + 0.2) * cellH;
    const glow = ctx.createRadialGradient(
      starX, starY, 0,
      starX, starY, Math.max(cellW * 8, cellH * 5)
    );
    glow.addColorStop(0, 'rgba(255, 224, 150, 0.6)');
    glow.addColorStop(0.36, 'rgba(255, 196, 96, 0.18)');
    glow.addColorStop(1, 'rgba(255, 180, 80, 0)');
    starGrad = glow;
  }

  /* =========================================================================
     12. Composition into the character buffer (with depth test)
     ========================================================================= */

  function rotationAt(time) {
    const t = Math.max(0, time - CFG.rotation.delay);
    return (t * CFG.rotation.degPerSec * Math.PI) / 180;
  }

  function compose(time) {
    glyphBuf.fill(0);
    depthBuf.fill(INF);

    const rad = rotationAt(time);
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const R = treeRadius;

    for (let i = 0; i < P.n; i++) {
      const appear = P.app[i];
      if (appear > time) continue;

      const X = P.x[i];
      const Y = P.y[i];
      const Z = P.z[i];

      const sx = X * cos + Z * sin;
      const sz = -X * sin + Z * cos;

      const col = Math.round(centerCol + sx);
      if (col < 0 || col >= cols) continue;

      const row = Math.round(groundRow - Y);
      if (row < 0 || row >= rows) continue;

      const idx = row * cols + col;
      const d = sz - P.bias[i];
      if (d >= depthBuf[idx]) continue;

      const kind = P.kind[i];
      const age = time - appear;
      let fam = P.fam[i];
      let lvl;

      if (kind === 3) {
        // blinking bulb: brightness swings on a per-light phase
        const tw = 0.5 + 0.5 * Math.sin(time * P.speed[i] * 2.1 + P.phase[i]);
        lvl = tw > 0.74 ? 3 : tw > 0.44 ? 2 : 1;
        if (age < 0.35) lvl = 3;
      } else {
        // cylindrical shading: front of the cone bright, edges and back dark
        const dt = clamp((sz + R) / (2 * R), 0, 1);
        lvl = dt < 0.42 ? 3 : dt < 0.72 ? 2 : 1;

        if (P.twinkle[i] && Math.sin(time * P.speed[i] * 1.7 + P.phase[i]) > 0.93) {
          lvl = Math.min(3, lvl + 1);
        }
        if (kind === 1 || kind === 2) lvl = Math.max(2, lvl);
        if (kind === 4) lvl = Math.min(lvl, 2); // interior mass sits behind the needles
        if (age < 0.4 && P.flash[i] !== 255) fam = P.flash[i];
      }

      glyphBuf[idx] = P.ch[i] + 1;
      palBuf[idx] = fam * 4 + lvl;
      depthBuf[idx] = d;
    }
  }

  /* =========================================================================
     13. Drawing
     ========================================================================= */

  function drawSnow(time) {
    ctx.fillStyle = '#dbe8ff';
    for (let i = 0; i < snow.length; i++) {
      const f = snow[i];
      const x = f.x * view.w + Math.sin(time * 0.35 + f.phase) * 9;
      const y = ((f.y + time * f.speed * 0.018) % 1) * view.h;
      ctx.globalAlpha = f.alpha;
      ctx.fillRect(x, y, f.size, f.size);
    }
    ctx.globalAlpha = 1;

    ctx.font = fontString(Math.max(7, cellH * 0.62));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < twinklers.length; i++) {
      const s = twinklers[i];
      const a = 0.1 + 0.22 * (0.5 + 0.5 * Math.sin(time * s.speed + s.phase));
      ctx.globalAlpha = a;
      ctx.fillStyle = '#cfdff8';
      ctx.fillText(s.ch, s.x, s.y);
    }
    ctx.globalAlpha = 1;
  }

  function drawGrid() {
    const ac = atlas.canvas;
    const tw = atlas.tw;
    const th = atlas.th;

    visibleCells = 0;

    for (let row = 0; row < rows; row++) {
      const y = row * cellH;
      const base = row * cols;
      for (let col = 0; col < cols; col++) {
        const g = glyphBuf[base + col];
        if (g === 0) continue;
        visibleCells++;
        ctx.drawImage(
          ac,
          (g - 1) * tw, palBuf[base + col] * th, tw, th,
          col * cellW, y, cellW, cellH
        );
      }
    }
  }

  function drawGifts(time) {
    const ac = atlas.canvas;
    const tw = atlas.tw;
    const th = atlas.th;

    const shadowCh = CH['#'];
    const shadowPal = F.bark * 4; // darkest bark tone

    for (let i = 0; i < gifts.length; i++) {
      const gift = gifts[i];
      const age = time - gift.appear;
      if (age <= 0) continue;

      const fade = smoothstep(0, 0.42, age);
      const rise = (1 - fade) * 1.4; // drifts up into place

      ctx.globalAlpha = fade * 0.9;

      const baseCol = centerCol + Math.round(gift.frac * treeRadius);
      const baseRow = groundRow + gift.row;

      // one-cell ASCII shadow offset down-right, so parcels separate from the tree
      for (let k = 0; k < gift.cells.length; k++) {
        const c = gift.cells[k];
        ctx.drawImage(
          ac,
          shadowCh * tw, shadowPal * th, tw, th,
          (baseCol + c.dx + 1) * cellW,
          (baseRow + c.dy + rise + 1) * cellH,
          cellW, cellH
        );
      }

      ctx.globalAlpha = fade;
      for (let k = 0; k < gift.cells.length; k++) {
        const c = gift.cells[k];
        ctx.drawImage(
          ac,
          c.ch * tw, c.pal * th, tw, th,
          (baseCol + c.dx) * cellW,
          (baseRow + c.dy + rise) * cellH,
          cellW, cellH
        );
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawStar(time) {
    const age = time - CFG.star.start;
    if (age <= 0) return;

    const settle = smoothstep(0, 1.9, age);

    // warm halo
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = (0.18 + 0.22 * settle) * (0.92 + 0.08 * Math.sin(time * 2.1));
    ctx.fillStyle = starGrad;
    ctx.fillRect(0, 0, view.w, view.h);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    const ac = atlas.canvas;
    const tw = atlas.tw;
    const th = atlas.th;

    // The star is drawn a little larger than the tree's text grid so it holds
    // its own against the wide cone.
    const scale = 1.25;
    const sw = cellW * scale;
    const sh = cellH * scale;
    const originX = (centerCol + 0.5) * cellW - sw / 2;
    const originY = (starRow + 0.5) * cellH - sh / 2;

    for (let i = 0; i < starCells.length; i++) {
      const c = starCells[i];
      const a = age - c.order * 0.55;
      if (a < 0) continue;

      const alpha = Math.min(1, a / 0.14);
      const flicker = 0.86 + 0.14 * Math.sin(time * 12 + c.order * 23);
      ctx.globalAlpha = alpha * flicker;

      ctx.drawImage(
        ac,
        c.ch * tw, (c.fam * 4 + c.lvl) * th, tw, th,
        originX + c.dx * sw,
        originY + c.dy * sh,
        sw, sh
      );
    }
    ctx.globalAlpha = 1;
  }

  const TINTS = ['#e07a61', '#e8c579', '#9fd3a5'];

  let visibleCells = 0;

  function drawGreeting(time) {
    const p = time - CFG.message.start;
    if (p <= 0) return;

    const words = CFG.greeting.split(/\s+/);
    const letters = words.join('').split('');
    const shown = clamp(p / CFG.message.duration, 0, 1) * letters.length;
    if (shown <= 0) return;

    const size = Math.max(10, cellH * 1.02);
    ctx.font = fontString(size);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    const advance = ctx.measureText('M').width;
    if (!advance) return;

    // Spread the greeting about as wide as the tree, like the reference.
    const treeWidth = 2 * treeRadius * cellW;
    const targetWidth = Math.min(view.w * 0.92, treeWidth * 1.05);
    const gap = clamp((targetWidth - letters.length * advance) / (letters.length - 1),
      size * 0.4, size * 2.4);
    const wordGap = gap + size * 0.6;

    // positions, including the wider gap between the two words
    const pos = [];
    let cursor = 0;
    let acc = 0;
    for (let w = 0; w < words.length; w++) {
      if (w > 0) cursor += wordGap;
      for (let c = 0; c < words[w].length; c++) {
        pos[acc++] = cursor;
        cursor += advance + gap;
      }
    }
    const total = cursor - gap;
    const startX = (view.w - total) / 2;
    const y = (groundRow + 4.7) * cellH;

    for (let i = 0; i < letters.length; i++) {
      if (i >= shown) break;

      const tint = TINTS[(Math.floor(i / 2) + Math.floor(time * 0.7)) % TINTS.length];
      const newborn = shown - i < 1;
      const breathe = 0.88 + 0.12 * Math.sin(time * 1.2 + i * 0.55);

      ctx.globalAlpha = Math.min(1, breathe + 0.08);
      ctx.shadowColor = tint;
      ctx.shadowBlur = newborn ? 15 : 8;
      ctx.fillStyle = newborn ? '#fff3d2' : tint;
      ctx.fillText(letters[i], startX + pos[i], y);
    }

    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }

  function paint(time) {
    compose(time);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    if (background) ctx.drawImage(background, 0, 0, view.w, view.h);

    drawSnow(time);

    // soft ambient bloom behind the glyphs
    if (ambientGrad) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.8;
      ctx.fillStyle = ambientGrad;
      ctx.fillRect(0, 0, view.w, view.h);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }

    drawGrid();
    drawGifts(time);

    // Soft bloom: shrink the frame, then add it back with additive blending.
    // Text stays crisp because the greeting and star rays are drawn after.
    if (bloom && bloomCtx) {
      bloomCtx.clearRect(0, 0, bloom.width, bloom.height);
      bloomCtx.drawImage(canvas, 0, 0, bloom.width, bloom.height);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.24;
      ctx.drawImage(bloom, 0, 0, view.w, view.h);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }

    drawStar(time);
    drawGreeting(time);

    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }

  /* =========================================================================
     14. HUD
     ========================================================================= */

  let lastHud = 0;

  function activeLights(time) {
    let n = 0;
    for (let i = 0; i < P.n; i++) {
      if (P.kind[i] === 3 && P.app[i] <= time) n++;
    }
    return n;
  }

  function activeLetters(time) {
    // glyphs that are actually on screen this frame, plus the overlays
    let n = visibleCells;
    for (let i = 0; i < gifts.length; i++) {
      if (time >= gifts[i].appear) n += gifts[i].cells.length;
    }
    if (time >= CFG.star.start) n += starCells.length;
    return n;
  }

  function updateHud(time) {
    const deg = ((rotationAt(time) * 180) / Math.PI) % 360;

    hudClock.textContent = time.toFixed(2);
    hudRotation.textContent = deg.toFixed(2) + '\u00b0';
    hudLights.textContent = String(activeLights(time));
    hudLetters.textContent = activeLetters(time).toLocaleString('en-US');
  }

  /* =========================================================================
     15. Clock, controls and lifecycle
     ========================================================================= */

  let elapsed = 0;
  let running = true;
  let rafId = 0;
  let lastNow = 0;
  let lastPaintAt = 0;
  let reduceMotion = false;

  function startLoop() {
    if (rafId) return;
    lastNow = performance.now();
    lastPaintAt = 0;
    rafId = requestAnimationFrame(tick);
  }

  function stopLoop() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  function tick(now) {
    rafId = requestAnimationFrame(tick);

    if (document.hidden) {
      lastNow = now;
      return;
    }
    if (!running) {
      lastNow = now;
      return;
    }

    const dt = Math.min((now - lastNow) / 1000, 0.1);
    lastNow = now;

    // Wall-clock driven; the frame gate only limits drawing, not time.
    elapsed += dt;

    if (now - lastPaintAt < 1000 / CFG.fps - 1) return;
    lastPaintAt = now;

    paint(elapsed);

    if (now - lastHud > 140) {
      lastHud = now;
      updateHud(elapsed);
    }
  }

  function setPaused(paused) {
    running = !paused;
    btnPause.setAttribute('aria-pressed', paused ? 'true' : 'false');
    btnPause.setAttribute('aria-label', paused ? 'Resume animation' : 'Pause animation');
    btnPause.textContent = paused ? 'resume' : 'pause';
    if (paused) stopLoop();
    else startLoop();
  }

  function replay() {
    if (reduceMotion) {
      // no motion: replay simply redraws the finished scene
      elapsed = CFG.finalTime;
      paint(elapsed);
      updateHud(elapsed);
      return;
    }
    elapsed = 0;
    paint(0);
    updateHud(0);
    if (!running) setPaused(false);
    else startLoop();
  }

  function applyMotionPreference() {
    reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    stage.classList.toggle('is-static', reduceMotion);

    if (reduceMotion) {
      stopLoop();
      setPaused(true);
      elapsed = CFG.finalTime;
      paint(elapsed);
      updateHud(elapsed);
    } else if (elapsed >= CFG.finalTime || elapsed === 0) {
      startLoop();
    }
  }

  btnPause.addEventListener('click', () => setPaused(running));
  btnReplay.addEventListener('click', replay);

  window.addEventListener('keydown', (e) => {
    const onButton = document.activeElement && document.activeElement.tagName === 'BUTTON';

    if (e.code === 'Space' && !onButton && !reduceMotion) {
      e.preventDefault();
      setPaused(running);
    } else if (e.key === 'r' || e.key === 'R') {
      e.preventDefault();
      replay();
    }
  });

  // Debounced relayout — rebuilding the atlas is the only expensive part.
  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      layout();
      paint(elapsed);
      updateHud(elapsed);
    }, 160);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    } else if (!reduceMotion && running) {
      startLoop();
    }
  });

  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (motionQuery.addEventListener) {
    motionQuery.addEventListener('change', applyMotionPreference);
  }

  /* =========================================================================
     16. Boot
     ========================================================================= */

  function boot() {
    const params = new URLSearchParams(window.location.search);
    const seek = parseFloat(params.get('t'));

    buildGifts();
    layout();          // measures the font, sets treeRadius, builds the scene

    elapsed = Number.isFinite(seek) ? clamp(seek, 0, 3600) : 0;

    if (reduceMotion) {
      elapsed = Math.max(elapsed, CFG.finalTime);
      paint(elapsed);
      updateHud(elapsed);
    } else {
      paint(elapsed);
      updateHud(elapsed);
      startLoop();
    }
  }

  reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  boot();
  applyMotionPreference();

  // A small, documented hook so the scene can be inspected or embedded.
  window.asciiTree = {
    seek(seconds) {
      elapsed = clamp(Number(seconds) || 0, 0, 3600);
      paint(elapsed);
      updateHud(elapsed);
    },
    pause() { if (running) setPaused(true); },
    resume() { if (!running) setPaused(false); },
    get time() { return elapsed; }
  };
})();
