// Deterministic song generator: same settings + seeds => same song (so transposing keeps the song).
import { makeKey, parseTok, makeChord, seventhOf, voiceChord, QUALITY, mod } from './theory.js';

export function rng(seed) {
  let a = seed >>> 0;
  const f = () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.int = n => Math.floor(f() * n);
  f.pick = arr => arr[Math.floor(f() * arr.length)];
  f.chance = p => f() < p;
  f.w = (items, ws) => {
    let s = 0; for (const w of ws) s += w;
    let x = f() * s;
    for (let i = 0; i < items.length; i++) { x -= ws[i]; if (x < 0) return items[i]; }
    return items[items.length - 1];
  };
  return f;
}
export function hash(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export const STYLES = {
  pop: { name:'Pop', bpm:[96,122], comp:'pop', bass:'pop', drums:'pop', ext:.2, density:.55,
    inst:{ keys:'epiano', melody:'lead', bass:'finger' },
    progs:{ verse:[[1,5,6,4],[6,4,1,5],[1,6,4,5],[1,4,6,5],[1,3,6,4]], pre:[[4,5],[2,4,5,5],[6,5,4,5]],
      chorus:[[4,1,5,6],[1,5,6,4],[6,4,1,5],[4,5,6,1]], bridge:[[6,4,1,5],[2,4,6,5],[4,4,5,5]] } },
  rock: { name:'Rock', bpm:[110,146], comp:'rock', bass:'eighths', drums:'rock', ext:0, density:.5,
    inst:{ keys:'dist', melody:'lead', bass:'synth' },
    progs:{ verse:[[1,'bVII','IV',1],[1,1,4,4],[6,4,1,5],[1,5,4,4]], pre:[[4,5],[6,5],['bVI','bVII']],
      chorus:[[4,5,1,1],[1,5,6,4],[1,'bVII','IV','IV'],[4,1,5,5]], bridge:[[6,5,4,4],['bVI','bVII',1,1],[4,4,6,5]] } },
  ballad: { name:'Ballad', bpm:[62,80], comp:'arp', bass:'roots', drums:'ballad', ext:.35, density:.45, soft:true,
    inst:{ keys:'piano', melody:'flute', bass:'finger' },
    progs:{ verse:[[1,5,6,4],[1,3,4,1],[1,6,2,5],[6,3,4,1]], pre:[[2,5],[4,5],[4,3,2,5]],
      chorus:[[4,5,3,6],[4,1,5,6],[1,5,6,4],[2,5,1,6]], bridge:[[6,3,4,1],[4,5,6,6],[2,3,4,5]] } },
  funk: { name:'Funk', bpm:[94,112], comp:'funk', bass:'funk', drums:'funk', ext:1, density:.7,
    inst:{ keys:'epiano', melody:'brass', bass:'synth' },
    progs:{ verse:[[1,1,4,4],[1,4],[1,1,1,4],[1,'bVII']], pre:[[2,5],[4,5]],
      chorus:[[4,5,1,1],[2,5,1,1],[4,4,1,1]], bridge:[[4,3,2,5],[6,2,5,5]] } },
  blues: { name:'Blues', bpm:[70,124], comp:'shuffle', bass:'walking', drums:'shuffle', swing:.66, dom7:true, form:'blues', density:.5,
    inst:{ keys:'organ', melody:'lead', bass:'finger' },
    progs:{ verse:[[1,1,1,1,4,4,1,1,5,4,1,5],[1,4,1,1,4,4,1,1,5,4,1,5],[1,4,1,1,4,4,1,6,2,5,1,5]],
      intro:[[5,4,1,5]], outro:[[5,4,1,1]] } },
  edm: { name:'Synth-pop', bpm:[116,128], comp:'sustain', bass:'offbeat', drums:'edm', ext:.15, density:.6,
    inst:{ keys:'pad', melody:'lead', bass:'synth' },
    progs:{ verse:[[6,4,1,5],[1,5,6,4],[6,6,4,5]], pre:[[4,5],[4,4,5,5]],
      chorus:[[6,4,1,5],[4,5,6,6],[4,1,5,6]], bridge:[[4,4,6,6],[2,2,5,5]] } },
  folk: { name:'Folk / Indie', bpm:[84,116], comp:'strum', bass:'folk', drums:'folk', ext:.15, density:.55,
    inst:{ keys:'guitar', melody:'flute', bass:'finger' },
    progs:{ verse:[[1,4,1,5],[1,1,4,1],[6,4,1,1],[1,5,4,1]], pre:[[4,5],[2,4]],
      chorus:[[4,1,5,1],[4,5,1,6],[1,4,5,5]], bridge:[[6,5,4,4],[4,1,4,5]] } },
};

const FORMS = {
  short:  [['Intro',4],['Verse',8],['Chorus',8],['Verse',8],['Chorus',8],['Outro',4]],
  medium: [['Intro',4],['Verse',8],['Pre-Chorus',4],['Chorus',8],['Verse',8],['Pre-Chorus',4],['Chorus',8],['Bridge',8],['Chorus',8],['Outro',4]],
  long:   [['Intro',8],['Verse',8],['Pre-Chorus',4],['Chorus',8],['Verse',8],['Pre-Chorus',4],['Chorus',8],['Solo',8],['Bridge',8],['Chorus',8],['Chorus',8],['Outro',4]],
};
const BLUES_FORMS = {
  short:  [['Intro',4],['Verse',12],['Verse',12],['Outro',4]],
  medium: [['Intro',4],['Verse',12],['Verse',12],['Solo',12],['Verse',12],['Outro',4]],
  long:   [['Intro',4],['Verse',12],['Verse',12],['Solo',12],['Solo',12],['Verse',12],['Verse',12],['Outro',4]],
};
export const SEC_COLOR = { Intro:'#7c8aa5', Verse:'#3d8bfd', 'Pre-Chorus':'#20c997', Chorus:'#f59f00', Bridge:'#e64980', Solo:'#9775fa', Outro:'#7c8aa5' };
const SEC_KEY = { Intro:'intro', Verse:'verse', 'Pre-Chorus':'pre', Chorus:'chorus', Bridge:'bridge', Solo:'solo', Outro:'outro' };
const SEC_VEL = { Intro:.75, Verse:.82, 'Pre-Chorus':.9, Chorus:1, Bridge:.88, Solo:.95, Outro:.8 };

function groupOf(type, style) {
  const k = SEC_KEY[type];
  if (style.progs[k]) return k;
  return { intro:'chorus', outro:'chorus', solo:'verse', pre:'verse', chorus:'verse', bridge:'verse' }[k] || 'verse';
}

const COMP = {
  pop:     [[0,1.5,.9],[1.5,1,.7],[2.5,1.5,.8]],
  rock:    [0,.5,1,1.5,2,2.5,3,3.5].map((s, i) => [s, .45, i % 2 ? .6 : .9]),
  funk:    [[0,.25,1],[.75,.25,.7],[1.5,.25,.8],[2.25,.25,.7],[2.5,.5,.9],[3.5,.25,.7]],
  sustain: [[0,4,.8]],
  shuffle: [[0,1.5,.85],[1.5,.5,.6],[2,1.5,.8],[3.5,.5,.6]],
  strum:   [[0,1,.9],[1,.5,.6],[1.5,1,.8],[2.5,.5,.6],[3,.5,.8],[3.5,.5,.6]],
};
const COMP3 = { sustain:[[0,3,.8]], default:[[0,1,.85],[1,.9,.6],[2,.9,.6]] };
const BASS = {
  pop:     [[0,1.5,'R'],[1.5,.5,'R'],[2,1,'5'],[3,.5,'8'],[3.5,.5,'A']],
  eighths: [0,.5,1,1.5,2,2.5,3,3.5].map(s => [s,.5,'R']),
  roots:   [[0,2,'R'],[2,2,'5']],
  funk:    [[0,.5,'R'],[.75,.25,'8'],[1.5,.25,'R'],[1.75,.25,'R'],[2.5,.5,'5'],[3.25,.25,'8'],[3.5,.5,'A']],
  walking: [[0,1,'R'],[1,1,'3'],[2,1,'5'],[3,1,'A']],
  offbeat: [[.5,.5,'R'],[1.5,.5,'R'],[2.5,.5,'R'],[3.5,.5,'R']],
  folk:    [[0,1.5,'R'],[1.5,.5,'R'],[2,2,'5']],
  waltz:   [[0,2,'R'],[2,1,'5']],
};
const DRUMS = {
  pop:     { k:'x.......x.x.....', s:'....x.......x...', h:'x.o.x.o.x.o.x.o.' },
  rock:    { k:'x.....x.x.....x.', s:'....x.......x...', h:'x.x.x.x.x.x.x.x.' },
  ballad:  { k:'x.........x.....', s:'....o.......x...', h:'o.g.o.g.o.g.o.g.' },
  funk:    { k:'x..x..x...x..x..', s:'....x..g.g..x..g', h:'xoxoxoxoxoxoxoxo' },
  shuffle: { k:'x.......x.......', s:'....x.......x...', h:'x.o.x.o.x.o.x.o.' },
  edm:     { k:'x...x...x...x...', p:'....x.......x...', o:'..x...x...x...x.', h:'g.g.g.g.g.g.g.g.' },
  folk:    { k:'x.....x...x.....', s:'....x.......x...', h:'x.o.x.o.x.o.x.o.' },
  waltz:   { k:'x...........', s:'....o...o...', h:'x.o.x.o.x.o.' },
};
const PIECE = { k:'kick', s:'snare', h:'hat', o:'ohat', p:'clap' };
const VEL = { x:1, o:.65, g:.32 };
const ARP = [0,1,2,3,2,1,2,3];
const MEL_RANGE = { verse:[-2,6], pre:[0,8], chorus:[2,10], bridge:[1,8], solo:[-3,11] };

const ADJ = ['Electric','Midnight','Golden','Broken','Neon','Silent','Wild','Velvet','Paper','Crimson','Lonely','Northern','Burning','Hollow','Bright','Faded','Hidden','Restless','Silver','Distant','Rusty','Summer','Cosmic','Lucky'];
const NOUN = ['Highway','Hearts','River','Ghosts','Signal','Garden','Skyline','Echo','Fire','Rain','Engine','Harbor','Machine','Satellite','Kingdom','Window','Avenue','Ocean','Thunder','Lanterns','Static','Horizon','Motel','Comet'];
export function randomName(seed) { const r = rng(seed ^ 0x9e3779b9); return r.pick(ADJ) + ' ' + r.pick(NOUN); }

function realizeProg(r, style, key, g, s) {
  const toks = r.pick(style.progs[g]);
  const extP = s.complexity === 'simple' ? 0 : s.complexity === 'rich' ? Math.min(1, style.ext * 2 + .3) : style.ext;
  return toks.map(tok => {
    const p = parseTok(key, tok);
    let q = p.q;
    const roll = r(), roll2 = r();
    if (style.dom7) q = q === 'maj' ? '7' : q === 'min' ? 'm7' : q;
    else if (roll < extP && q !== 'dim') {
      if (roll2 < .6) q = seventhOf(key, p);
      else if (roll2 < .8) q = (q === 'maj' && roll2 < .7) ? 'sus4' : 'sus2';
      else q = q === 'maj' ? 'add9' : q === 'min' ? 'madd9' : q;
    }
    return makeChord(key, p, q);
  });
}

export function generate(s) {
  const style = STYLES[s.style];
  const key = makeKey(s.tonic, s.mode);
  const bpb = s.bpb;
  const form = (style.form === 'blues' ? BLUES_FORMS : FORMS)[s.length];
  const seeds = s.seeds || {};
  const seedOf = (kind, g) => seeds[kind + ':' + g] ?? hash(s.seed + ':' + kind + ':' + g);

  // Sections
  const total = {}; form.forEach(([t]) => total[t] = (total[t] || 0) + 1);
  const cnt = {}; let bar = 0;
  const sections = form.map(([type, bars], i) => {
    cnt[type] = (cnt[type] || 0) + 1;
    const sec = { i, type, label: total[type] > 1 ? `${type} ${cnt[type]}` : type, n: cnt[type],
      start: bar * bpb, bars, len: bars * bpb, group: groupOf(type, style),
      mel: type === 'Solo' ? 'solo' : groupOf(type, style), color: SEC_COLOR[type] };
    bar += bars; return sec;
  });
  const totalBeats = bar * bpb;

  // Chord progressions per group
  const groups = {};
  for (const sec of sections) if (!groups[sec.group]) groups[sec.group] = realizeProg(rng(seedOf('ch', sec.group)), style, key, sec.group, s);
  const tonicP = parseTok(key, 1), tonicChord = makeChord(key, tonicP);

  const chords = [];
  for (const sec of sections) {
    const prog = groups[sec.group];
    let cd = style.form === 'blues' ? bpb : bpb * ({ slow:2, normal:1, fast:.5 }[s.hr] || 1);
    if (bpb === 3 && cd === 1.5) cd = 3;
    while (cd > bpb && prog.length * cd > sec.len) cd /= 2;
    const n = Math.max(1, Math.round(sec.len / cd));
    for (let j = 0; j < n; j++) {
      const c = (sec.type === 'Outro' && j === n - 1) ? tonicChord : prog[j % prog.length];
      const t = sec.start + j * cd, last = chords[chords.length - 1];
      if (last && last.sec === sec.i && last.c.name === c.name) last.d += cd;
      else chords.push({ t, d: cd, c, sec: sec.i });
    }
  }
  let prevV = null;
  for (const ch of chords) { ch.v = voiceChord(ch.c, prevV); prevV = ch.v; }
  const chordAt = makeChordAt(chords);

  const ev = [];
  const swing = style.swing || 0;
  const sw = t => { if (!swing) return t; const b = Math.floor(t + 1e-9); return Math.abs(t - b - .5) < 1e-6 ? b + swing : t; };

  // ---- Keys / comping
  const pat = bpb === 3 ? (COMP3[style.comp] || COMP3.default) : COMP[style.comp];
  for (const sec of sections) {
    const sv = SEC_VEL[sec.type];
    for (let b = 0; b < sec.bars; b++) {
      const bs = sec.start + b * bpb;
      if (sec.type === 'Outro' && b === sec.bars - 1) {
        const ch = chordAt(bs); ev.push({ tr:'keys', t:bs, d:bpb, n:ch.v, v:.9 * sv, root:ch.c.root }); continue;
      }
      if (style.comp === 'arp') {
        const c0 = chordAt(bs);
        ev.push({ tr:'keys', t:bs, d:bpb, n:[c0.v[0] - 12], v:.7 * sv, root:c0.c.root });
        for (let i = 0; i < bpb * 2; i++) {
          const t = bs + i * .5, ch = chordAt(t), tones = [...ch.v, ch.v[0] + 12];
          ev.push({ tr:'keys', t, d:.9, n:[tones[ARP[i % ARP.length] % tones.length]], v:(i % 2 ? .5 : .65) * sv, root:ch.c.root });
        }
        continue;
      }
      for (const [s0, d0, vv] of pat) {
        let cur = bs + s0; const end = cur + d0;
        while (cur < end - 1e-6) {
          const ch = chordAt(cur), e = Math.min(end, ch.t + ch.d);
          ev.push({ tr:'keys', t:sw(cur), d:e - cur, n:ch.v, v:vv * sv, root:ch.c.root, up: (cur % 1) > .01 });
          cur = e;
        }
      }
    }
  }

  // ---- Bass
  const bpat = bpb === 3 ? BASS.waltz : BASS[style.bass];
  const bassRoot = pc => 36 + pc > 45 ? 24 + pc : 36 + pc;
  for (const sec of sections) {
    if (style.soft && sec.type === 'Intro') continue;
    const sv = SEC_VEL[sec.type];
    for (let b = 0; b < sec.bars; b++) {
      const bs = sec.start + b * bpb;
      if (sec.type === 'Outro' && b === sec.bars - 1) { ev.push({ tr:'bass', t:bs, d:bpb, m:bassRoot(chordAt(bs).c.root), v:.9 * sv }); continue; }
      for (const [s0, d0, kind] of bpat) {
        const t = bs + s0, ch = chordAt(t), r = bassRoot(ch.c.root);
        let m = r;
        if (kind === '5') m = r + 7;
        else if (kind === '8') m = r + 12;
        else if (kind === '3') m = r + QUALITY[ch.c.q].iv[1];
        else if (kind === 'A') { const nx = chordAt(t + d0 + .01); m = nx !== ch ? bassRoot(nx.c.root) - 1 : r + 7; }
        ev.push({ tr:'bass', t:sw(t), d:d0 * .92, m, v:(s0 === 0 ? .95 : .78) * sv });
      }
    }
  }

  // ---- Drums
  const dp = bpb === 3 ? DRUMS.waltz : DRUMS[style.drums];
  const steps = bpb * 4;
  sections.forEach((sec, si) => {
    const dr = rng(seedOf('dr', si));
    const fillType = dr.pick(['snare','toms','simple']);
    const sv = SEC_VEL[sec.type];
    if (style.soft && sec.type === 'Intro') return;
    const light = sec.type === 'Intro' || (style.soft && sec.type === 'Verse' && sec.n === 1);
    const next = sections[si + 1];
    for (let b = 0; b < sec.bars; b++) {
      const bs = sec.start + b * bpb, lastBar = b === sec.bars - 1;
      if (sec.type === 'Outro' && lastBar) { ev.push({ tr:'drums', t:bs, k:'kick', v:1 }, { tr:'drums', t:bs, k:'crash', v:1 }); continue; }
      const crash = b === 0 && (['Chorus','Bridge','Solo','Outro'].includes(sec.type) || (si > 0 && sections[si - 1].type === 'Intro'));
      if (crash) ev.push({ tr:'drums', t:bs, k:'crash', v:.9 * sv });
      const edmRoll = style.drums === 'edm' && sec.type === 'Pre-Chorus' && lastBar;
      const fill = lastBar && next && !light ? (edmRoll ? 0 : bpb / 2) : -1;
      for (let st = 0; st < steps; st++) {
        const t = bs + st / 4;
        if (fill >= 0 && st / 4 >= fill) break;
        for (const [pc, p] of Object.entries(dp)) {
          const ch = p[st]; if (!ch || ch === '.') continue;
          if (light && pc !== 'k' && pc !== 'h') continue;
          if (crash && st === 0 && pc === 'h') continue;
          ev.push({ tr:'drums', t:sw(t), k:PIECE[pc], v:VEL[ch] * sv * (light ? .7 : 1) });
        }
      }
      if (sec.type === 'Chorus' && !dp.o && b % 2 === 1 && !(fill >= 0)) ev.push({ tr:'drums', t:sw(bs + bpb - .5), k:'ohat', v:.6 });
      if (fill >= 0) addFill(ev, bs + fill, bpb - fill, edmRoll ? 'roll' : fillType, sv);
    }
  });

  // ---- Melody
  const base = 60 + (mod(s.tonic + 6, 12) - 6);
  const degMidi = d => base + 12 * Math.floor(d / 7) + key.iv[mod(d, 7)];
  const degPc = d => mod(s.tonic + key.iv[mod(d, 7)], 12);
  const nearChord = (pcs, d) => { for (const o of [0,-1,1,-2,2,-3,3]) if (pcs.includes(degPc(d + o))) return d + o; return d; };
  const nearTonic = (pcs, d) => { for (const o of [0,-1,1,-2,2,-3,3,-4,4]) if (mod(d + o, 7) === 0 && pcs.includes(degPc(d + o))) return d + o; return nearChord(pcs, d); };
  const P = bpb * 2 * 4; // 16ths per 2-bar phrase
  const plans = {};
  const mkPlan = (r, dens) => {
    const rh = []; let pos = r.chance(.35) ? r.pick([2, 4]) : 0;
    while (pos < P - 4) {
      const dur = r.w([1,2,3,4,6,8], [dens > .65 ? 1.2 : .2, 4 * dens, 1, 4, 1.5 * (1 - dens), 1.5 * (1 - dens)]);
      if (rh.length && r.chance(.12)) { pos += r.pick([2, 4]); continue; }
      if (pos + dur > P - 2) break;
      rh.push({ s:pos, d:dur }); pos += dur;
    }
    if (!rh.length) rh.push({ s:0, d:8 });
    const last = rh[rh.length - 1]; last.d = Math.max(last.d, Math.min(8, P - 2 - last.s));
    const dl = rh.map(() => r.w([-3,-2,-1,0,1,2,3,4], [.3,1,4,1.2,4,1,.4,.2]));
    return { rh, dl, off: r.int(5) - 2 };
  };
  for (const sec of sections) {
    if (sec.type === 'Intro' || sec.type === 'Outro') continue;
    const sv = SEC_VEL[sec.type];
    const [lo, hi] = MEL_RANGE[sec.mel] || MEL_RANGE.verse;
    const mid = Math.round((lo + hi) / 2);
    const solo = sec.mel === 'solo';
    const dens = Math.min(.9, style.density + (solo ? .25 : sec.mel === 'chorus' ? .05 : 0));
    const pl = plans[sec.mel] ||= (() => { const r = rng(seedOf('mel', sec.mel)); return { A: mkPlan(r, dens), B: mkPlan(r, dens), r }; })();
    const nPh = Math.floor(sec.bars / 2);
    let order;
    if (style.form === 'blues') order = ['A','-','A','-','B','-'];
    else if (nPh <= 2) order = ['A','B'];
    else order = ['A','A','B','A'];
    if (solo) { pl.solo ||= []; while (pl.solo.length < nPh) pl.solo.push(mkPlan(pl.r, dens)); }
    for (let ph = 0; ph < nPh; ph++) {
      const which = order[ph % order.length];
      if (which === '-') continue;
      const plan = solo ? pl.solo[ph] : pl[which];
      const t0 = sec.start + ph * bpb * 2;
      const final = ph === nPh - 1 || (style.form === 'blues' && ph >= nPh - 2);
      let deg = null;
      plan.rh.forEach((n, i) => {
        const t = t0 + n.s / 4, ch = chordAt(t).c;
        deg = deg === null ? nearChord(ch.pcs, mid + plan.off) : deg + plan.dl[i];
        if (deg > hi) deg = 2 * hi - deg; if (deg < lo) deg = 2 * lo - deg;
        const strong = n.s % (bpb === 3 ? 12 : 8) === 0 || n.d >= 6;
        if (strong) deg = nearChord(ch.pcs, deg);
        if (final && i === plan.rh.length - 1) deg = nearTonic(ch.pcs, deg);
        ev.push({ tr:'melody', t:sw(t), d:n.d / 4 * .92, m:degMidi(deg), v:(strong ? .9 : .74) * sv });
      });
    }
  }

  ev.sort((a, b) => a.t - b.t);
  const byTrack = { keys:[], melody:[], bass:[], drums:[] };
  for (const e of ev) byTrack[e.tr].push(e);
  const range = arr => arr.length ? [Math.min(...arr.map(e => e.m)), Math.max(...arr.map(e => e.m))] : [60, 72];
  return { settings: s, style, key, bpb, sections, chords, events: ev, byTrack, totalBeats, chordAt,
    stats: { melody: range(byTrack.melody), bass: range(byTrack.bass) } };
}

function addFill(ev, t0, len, type, sv) {
  const n = Math.round(len * 4);
  ev.push({ tr:'drums', t:t0, k:'kick', v:.9 * sv });
  for (let i = 0; i < n; i++) {
    const t = t0 + i / 4, v = (.45 + .55 * i / n) * sv;
    if (type === 'roll') ev.push({ tr:'drums', t, k:'clap', v });
    else if (type === 'snare') ev.push({ tr:'drums', t, k:'snare', v });
    else if (type === 'toms') ev.push({ tr:'drums', t, k: i < n / 3 ? 'snare' : i < 2 * n / 3 ? 'tomH' : 'tomL', v });
    else if (i % 2 === 0 || i >= n - 2) ev.push({ tr:'drums', t, k:'snare', v });
  }
}

export function makeChordAt(chords) {
  return t => {
    let lo = 0, hi = chords.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (chords[m].t <= t + 1e-6) lo = m; else hi = m - 1; }
    return chords[lo];
  };
}
