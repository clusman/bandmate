// Music theory helpers: keys, modes, chords, numerals, voicings.
export const SHARP = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
export const FLAT  = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
export const KEY_LABELS = ['C','C#/Db','D','Eb','E','F','F#/Gb','G','Ab','A','Bb','B'];
export const MAJ = [0,2,4,5,7,9,11];
const LETTERS = 'CDEFGAB';
const LETTER_PC = [0,2,4,5,7,9,11];
const ROM = ['I','II','III','IV','V','VI','VII'];

export const mod = (n, m) => ((n % m) + m) % m;

export const MODES = {
  major:      { name:'Major',      iv:[0,2,4,5,7,9,11], off:0, info:'Bright and stable. Most pop / rock / country.' },
  minor:      { name:'Minor',      iv:[0,2,3,5,7,8,10], off:9, info:'Natural minor (Aeolian). Dark, emotional.' },
  dorian:     { name:'Dorian',     iv:[0,2,3,5,7,9,10], off:2, info:'Minor with a major 6th. Funky, soulful, jam-friendly.' },
  mixolydian: { name:'Mixolydian', iv:[0,2,4,5,7,9,10], off:7, info:'Major with a flat 7th. Bluesy classic rock.' },
  lydian:     { name:'Lydian',     iv:[0,2,4,6,7,9,11], off:5, info:'Major with a #4. Dreamy, floating, film-like.' },
  phrygian:   { name:'Phrygian',   iv:[0,1,3,5,7,8,10], off:4, info:'Minor with a b2. Dark, Spanish / metal flavour.' },
};

export const QUALITY = {
  maj:  { iv:[0,4,7],    sfx:'' },
  min:  { iv:[0,3,7],    sfx:'m' },
  dim:  { iv:[0,3,6],    sfx:'dim' },
  aug:  { iv:[0,4,8],    sfx:'aug' },
  '7':  { iv:[0,4,7,10], sfx:'7' },
  maj7: { iv:[0,4,7,11], sfx:'maj7' },
  m7:   { iv:[0,3,7,10], sfx:'m7' },
  m7b5: { iv:[0,3,6,10], sfx:'m7b5' },
  dim7: { iv:[0,3,6,9],  sfx:'dim7' },
  sus2: { iv:[0,2,7],    sfx:'sus2' },
  sus4: { iv:[0,5,7],    sfx:'sus4' },
  add9: { iv:[0,4,7,14], sfx:'add9' },
  madd9:{ iv:[0,3,7,14], sfx:'m(add9)' },
};
const MINORISH = new Set(['min','m7','dim','m7b5','dim7','madd9']);
const FLAT_MAJORS = new Set([5,10,3,8,1,6]);
const SIG = {0:0,7:1,2:2,9:3,4:4,11:5,6:-6,5:-1,10:-2,3:-3,8:-4,1:-5};
export const FN = ['Tonic','Subdominant','Tonic','Subdominant','Dominant','Tonic','Dominant'];

function spell(tonicName, iv) {
  const l0 = LETTERS.indexOf(tonicName[0]);
  const tpc = mod(LETTER_PC[l0] + (tonicName.includes('#') ? 1 : tonicName.includes('b') ? -1 : 0), 12);
  return iv.map((s, i) => {
    const li = (l0 + i) % 7;
    let d = mod(tpc + s - LETTER_PC[li], 12);
    if (d > 6) d -= 12;
    return LETTERS[li] + (d > 0 ? '#'.repeat(d) : 'b'.repeat(-d));
  });
}

export function makeKey(tonic, mode) {
  const m = MODES[mode];
  const parent = mod(tonic - m.off, 12);
  const flat = FLAT_MAJORS.has(parent);
  const tonicName = (flat ? FLAT : SHARP)[tonic];
  return {
    tonic, mode, modeName: m.name, info: m.info, iv: m.iv,
    pcs: m.iv.map(x => mod(tonic + x, 12)),
    names: spell(tonicName, m.iv),
    flat, tonicName, parent, sig: SIG[parent],
    parentName: (flat ? FLAT : SHARP)[parent],
    minorish: m.iv[2] === 3,
    label: tonicName + ' ' + m.name,
  };
}

export function pcName(key, pc, pref) {
  const i = key.pcs.indexOf(pc);
  if (i >= 0) return key.names[i];
  if (pref === 'b') return FLAT[pc];
  if (pref === '#') return SHARP[pc];
  return (key.flat ? FLAT : SHARP)[pc];
}
export const noteName = (key, midi) => pcName(key, mod(midi, 12)) + (Math.floor(midi / 12) - 1);

export function sigText(sig) {
  if (!sig) return 'No sharps / flats';
  const n = Math.abs(sig);
  return n + (sig > 0 ? ' sharp' : ' flat') + (n > 1 ? 's' : '');
}

function accOf(semi, deg) {
  let d = semi - MAJ[deg];
  if (d > 6) d -= 12; if (d < -6) d += 12;
  return d < 0 ? 'b'.repeat(-d) : '#'.repeat(d);
}

function triadQ(key, i) {
  const r = key.iv[i];
  const t = mod(key.iv[(i + 2) % 7] - r, 12), f = mod(key.iv[(i + 4) % 7] - r, 12);
  return t === 4 && f === 7 ? 'maj' : t === 3 && f === 7 ? 'min' : t === 3 && f === 6 ? 'dim' : 'aug';
}

export function diatonic7(key, i) {
  const r = key.iv[i], q = triadQ(key, i);
  const s = mod(key.iv[(i + 6) % 7] - r, 12);
  if (q === 'maj') return s === 11 ? 'maj7' : '7';
  if (q === 'min') return 'm7';
  if (q === 'dim') return s === 10 ? 'm7b5' : 'dim7';
  return 'maj7';
}

// Token: number 1-7 = diatonic degree of the current mode; string = roman numeral relative to major (e.g. 'bVII', 'IV7').
export function parseTok(key, tok) {
  if (typeof tok === 'number') {
    const i = tok - 1, semi = key.iv[i];
    return { semi, deg: i, acc: accOf(semi, i), q: triadQ(key, i) };
  }
  const m = /^(b|#)?(iii|ii|iv|vii|vi|v|i|III|II|IV|VII|VI|V|I)(.*)$/.exec(tok);
  const up = m[2].toUpperCase(), deg = ROM.indexOf(up), upper = m[2] === up;
  const semi = mod(MAJ[deg] + (m[1] === 'b' ? -1 : m[1] === '#' ? 1 : 0), 12);
  let q = upper ? 'maj' : 'min';
  if (m[3] === '7') q = upper ? '7' : 'm7'; else if (m[3] === 'maj7') q = 'maj7';
  return { semi, deg, acc: m[1] || '', q };
}

export function seventhOf(key, p) {
  if (key.iv[p.deg] === p.semi && triadQ(key, p.deg) === p.q) return diatonic7(key, p.deg);
  return p.q === 'maj' ? '7' : p.q === 'min' ? 'm7' : p.q;
}

const RN_SFX = { dim:'°', m7b5:'ø7', dim7:'°7', aug:'+', '7':'7', maj7:'maj7', m7:'7', sus2:'sus2', sus4:'sus4', add9:'add9', madd9:'add9' };
const NS_SFX = { min:'-', m7:'-7', dim:'°', m7b5:'ø7', dim7:'°7', aug:'+', '7':'7', maj7:'Δ7', sus2:'sus2', sus4:'sus4', add9:'add9', madd9:'-add9' };

export function makeChord(key, p, q = p.q) {
  const root = mod(key.tonic + p.semi, 12);
  const pcs = QUALITY[q].iv.map(x => mod(root + x, 12));
  const dia = pcs.every(x => key.pcs.includes(x));
  let rn = ROM[p.deg];
  if (MINORISH.has(q)) rn = rn.toLowerCase();
  return {
    root, q, deg: p.deg, acc: p.acc, pcs, dia,
    name: pcName(key, root, p.acc[0]) + QUALITY[q].sfx,
    rn: p.acc + rn + (RN_SFX[q] || ''),
    nash: p.acc + (p.deg + 1) + (NS_SFX[q] || ''),
    fn: dia ? FN[p.deg] : 'Colour',
  };
}

export function diatonicChords(key, sevenths) {
  return key.iv.map((_, i) => {
    const p = parseTok(key, i + 1);
    return makeChord(key, p, sevenths ? diatonic7(key, i) : p.q);
  });
}

// Pick an inversion close to `center` that moves smoothly from `prev`.
export function voiceChord(chord, prev, center = 62) {
  const tones = [...new Set(QUALITY[chord.q].iv.map(x => x % 12))];
  let best = null, bestS = Infinity;
  for (let k = 0; k < tones.length; k++) {
    const rot = tones.slice(k).concat(tones.slice(0, k));
    const notes = [48 + mod(chord.root + rot[0], 12)];
    for (let j = 1; j < rot.length; j++) {
      let n = 48 + mod(chord.root + rot[j], 12);
      while (n <= notes[j - 1]) n += 12;
      notes.push(n);
    }
    for (const sh of [-12, 0, 12, 24]) {
      const v = notes.map(n => n + sh);
      if (v[0] < 50 || v[v.length - 1] > 80) continue;
      const avg = v.reduce((a, b) => a + b, 0) / v.length;
      let s = Math.abs(avg - center) * (prev ? 0.35 : 1);
      if (prev) s += v.reduce((a, n) => a + Math.min(...prev.map(x => Math.abs(x - n))), 0);
      if (s < bestS) { bestS = s; best = v; }
    }
  }
  return best || tones.map(t => 60 + mod(chord.root + t, 12));
}
