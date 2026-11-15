import { generate, STYLES, randomName, SEC_COLOR, RHYTHMS, rhythmPattern } from './generator.js';
import { parseTok, makeChord, seventhOf } from './theory.js';
import { Engine, INSTRUMENTS, lowerBound } from './audio.js';
import { songToMidi } from './midi.js';
import { KEY_LABELS, MODES, makeKey, noteName, sigText, diatonicChords, pcName, mod, voiceChord } from './theory.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const engine = new Engine();
const COL = { keys:'#ffd43b', melody:'#4dabf7', bass:'#69db7c', drums:'#ff8787' };
const FNCOL = { Tonic:'#4dabf7', Subdominant:'#69db7c', Dominant:'#ff922b', Colour:'#b197fc' };
const TRACKS = [['keys','Chords'], ['melody','Melody'], ['bass','Bass'], ['drums','Drums']];
const DEFAULTS = { tonic:0, mode:'major', style:'pop', bpm:110, bpb:4, length:'medium', complexity:'normal', hr:'normal', autoTempo:true,
  layers:{ melody:false, bass:false, drums:false }, rhythm:null };
const LAYER_NAME = { melody:'Melody', bass:'Bass', drums:'Drums' };
const layerOn = tr => tr === 'keys' || !!S.song?.layers[tr];
function setLayer(tr, on) {
  S.settings.layers = { ...S.song.layers, [tr]: on };
  rebuild(); renderMix();
  toast(`${LAYER_NAME[tr]} ${on ? 'added' : 'removed'}`);
}
// mini picture of a rhythm: one bar, filled blocks where the chord sounds
function rhythmSVG(id, bpb) {
  const p = rhythmPattern(id, bpb), W = 64, H = 14, u = W / bpb;
  let s = `<svg class="rsvg" viewBox="0 0 ${W} ${H}">`;
  for (let b = 0; b < bpb; b++) s += `<rect x="${b * u}" y="0" width="${u - 1}" height="${H}" fill="#232833"/>`;
  if (p === 'arp') for (let i = 0; i < bpb * 2; i++) { const y = [9, 6, 3, 0, 3, 6][i % 6]; s += `<rect x="${i * u / 2 + 1}" y="${y}" width="${u / 2 - 2}" height="5" rx="1" fill="#ffd43b"/>`; }
  else for (const [st, d, v] of p) s += `<rect x="${st * u + .5}" y="2" width="${Math.max(2, d * u - 1.5)}" height="${H - 4}" rx="2" fill="#ffd43b" opacity="${.45 + .55 * (v ?? .8)}"/>`;
  return s + '</svg>';
}

const S = {
  settings:null, name:'', id:null, song:null, view:'arrange', zoom:22, follow:true,
  sel:null, selChord:null, loopOn:false, chartMode:'name', fret:'guitar', cursor:0,
  draft:null, dirty:true, lastBar:-2, lastBeat:-2, countIn:false,
};

// ---------------------------------------------------------------- song lifecycle
function newSong() {
  const d = S.draft;
  const seed = (Math.random() * 2 ** 32) >>> 0;
  const st = STYLES[d.style];
  const bpm = d.autoTempo ? Math.round(st.bpm[0] + Math.random() * (st.bpm[1] - st.bpm[0])) : S.settings?.bpm || d.bpm;
  S.settings = { tonic:d.tonic, mode:d.mode, style:d.style, bpm, bpb:d.bpb, length:d.length, complexity:d.complexity, hr:d.hr, seed, seeds:{},
    layers:{ ...DEFAULTS.layers, ...(d.layers || {}) }, rhythm:d.rhythm || null };
  S.name = randomName(seed); S.id = null; S.sel = null; S.selChord = null; S.cursor = 0; S.loopOn = false;
  for (const [k, v] of Object.entries(st.inst)) engine.tracks[k].inst = v;
  saveMix();
  engine.stop(true); updatePlayBtn();
  rebuild();
  renderMix();
  toast(`New song: ${S.name}`);
}

function rebuild() {
  const song = generate(S.settings);
  song.name = S.name;
  S.song = song;
  engine.setSong(song);
  engine.setBpm(S.settings.bpm);
  if (S.sel != null && S.sel >= song.sections.length) S.sel = null;
  if (S.selChord != null && S.selChord >= song.chords.length) S.selChord = null;
  S.cursor = Math.min(S.cursor, song.totalBeats - song.bpb);
  updateLoop();
  renderHeads(); layoutArr(); renderSecTools(); renderInfo(); renderChart(); renderKey(); renderGen(); updateLCD(S.cursor, false);
  $('#songName').textContent = S.name;
  persist();
}
function persist() { store.set('bm.current', { settings:S.settings, name:S.name, id:S.id }); store.set('bm.draft', S.draft); }
function saveMix() {
  const t = {}; for (const [k, v] of Object.entries(engine.tracks)) t[k] = { vol:v.vol, mute:v.mute, solo:v.solo, inst:v.inst };
  store.set('bm.mix', { tracks:t, master:engine.masterVol, reverb:engine.reverbAmt, countIn:S.countIn });
}
function loadMix() {
  const m = store.get('bm.mix', null); if (!m) return;
  for (const [k, v] of Object.entries(m.tracks || {})) if (engine.tracks[k]) Object.assign(engine.tracks[k], v);
  engine.masterVol = m.master ?? engine.masterVol; engine.reverbAmt = m.reverb ?? engine.reverbAmt;
  S.countIn = !!m.countIn; engine.countIn = S.countIn;
}

// ---------------------------------------------------------------- transport
let wakeLock = null;
async function lockScreen(on) {
  try {
    if (on && 'wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => wakeLock = null); }
    if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch {}
}
function play(from = S.cursor) { engine.play(from); updatePlayBtn(); lockScreen(true); }
function pause() {
  const p = engine.position();
  engine.stop(true);
  if (p != null) S.cursor = Math.max(0, Math.floor(p / S.song.bpb) * S.song.bpb);
  updatePlayBtn(); lockScreen(false); S.dirty = true;
}
engine.onStop = () => { S.cursor = 0; updatePlayBtn(); lockScreen(false); S.dirty = true; };
function seek(beat) {
  S.cursor = Math.max(0, Math.min(S.song.totalBeats - S.song.bpb, Math.floor(beat / S.song.bpb) * S.song.bpb));
  if (engine.playing) play(S.cursor);
  S.dirty = true;
}
function updatePlayBtn() {
  const on = engine.playing;
  $('#btnPlay').classList.toggle('on', on);
  $('#playIcon').innerHTML = on ? '<path class="fill" d="M6 4h4v16H6zM14 4h4v16h-4z"/>' : '<path class="fill" d="M7 4l13 8-13 8z"/>';
}
function updateLoop() {
  if (S.loopOn && S.sel == null) S.loopOn = false;
  const sec = S.sel != null ? S.song.sections[S.sel] : null;
  engine.loop = S.loopOn && sec ? [sec.start, sec.start + sec.len] : null;
  $('#btnLoop').classList.toggle('on', S.loopOn);
  S.dirty = true;
}
function toggleLoop() {
  if (!S.loopOn && S.sel == null) {
    const b = engine.position() ?? S.cursor;
    S.sel = S.song.chordAt(Math.max(0, b)).sec;
  }
  S.loopOn = !S.loopOn;
  updateLoop(); renderSecTools();
  if (S.loopOn && engine.playing) {
    const p = engine.position(), L = engine.loop;
    if (p < L[0] || p >= L[1]) play(L[0]);
  }
  toast(S.loopOn ? `Looping ${S.song.sections[S.sel].label}` : 'Loop off');
}

// ---------------------------------------------------------------- LCD
function posText(b) {
  const bpb = S.song.bpb;
  if (b < 0) return 'IN ' + Math.ceil(-b);
  return `${Math.floor(b / bpb) + 1}.${Math.floor(mod(b, bpb)) + 1}`;
}
function nextChord(b) {
  const ch = S.song.chordAt(Math.max(0, b)), i = S.song.chords.indexOf(ch);
  return S.song.chords[i + 1] || null;
}
function updateLCD(b, playing) {
  const song = S.song, ch = song.chordAt(Math.max(0, b));
  $('#lcdPos').textContent = posText(b);
  $('#lcdChord').textContent = ch.c.name;
  $('#lcdKey').textContent = song.key.label;
  $('#lcdBpm').textContent = S.settings.bpm;
  $('#lcdSig').textContent = song.bpb + '/4';
}

// ---------------------------------------------------------------- ARRANGE (canvas timeline)
const A = { cv:$('#arrCanvas'), W:0, H:0, dpr:1, lanes:[] };
function renderHeads() {
  const ms = k => `<div class="ms"><button class="m ${engine.tracks[k].mute ? 'on' : ''}" data-mute="${k}">M</button><button class="s ${engine.tracks[k].solo ? 'on' : ''}" data-solo="${k}">S</button></div>`;
  $('#arrHeads').innerHTML = `<div class="head ruler">BARS</div>` +
    TRACKS.map(([k, n]) => layerOn(k)
      ? `<div class="head"><div class="nm"><i style="background:${COL[k]}"></i>${n}</div>${ms(k)}</div>`
      : `<div class="head off"><button class="addl" data-layer="${k}" style="--lc:${COL[k]}">+ ${n}</button></div>`).join('');
  layoutHeads();
}
function layoutHeads() { $$('#arrHeads .head').forEach((el, i) => { if (A.lanes[i]) el.style.height = A.lanes[i].h + 'px'; }); }
function layoutArr() {
  const sc = $('#arrScroll'); const W = sc.clientWidth, H = sc.clientHeight;
  if (!W || !H || !S.song) return;
  A.dpr = Math.min(3, window.devicePixelRatio || 1);
  A.cv.width = Math.round(W * A.dpr); A.cv.height = Math.round(H * A.dpr);
  A.cv.style.width = W + 'px'; A.cv.style.height = H + 'px';
  A.W = W; A.H = H;
  $('#arrInner').style.width = Math.max(W, S.song.totalBeats * S.zoom + 80) + 'px';
  const OFF = 34, dr = layerOn('drums') ? 58 : OFF;
  const rem = Math.max(70, H - 30 - 46 - dr), mel = layerOn('melody') ? Math.min(130, Math.round(rem * .58)) : OFF, bass = layerOn('bass') ? Math.min(90, rem - mel) : OFF;
  const anyNotes = layerOn('melody') || layerOn('bass') || layerOn('drums');
  A.lanes = [{ id:'ruler', h:30 }, { id:'keys', h: anyNotes ? 46 : 64 }, { id:'melody', h:mel }, { id:'bass', h:bass }, { id:'drums', h:dr }];
  let y = 0; for (const l of A.lanes) { l.y = y; y += l.h; }
  layoutHeads();
  S.dirty = true;
}
function rr(g, x, y, w, h, r) { g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h); }
function drawArr(b, playing) {
  if (!A.W) return;
  const g = A.cv.getContext('2d'), { W, H, dpr, lanes } = A, song = S.song, z = S.zoom, bpb = song.bpb;
  const x0 = $('#arrScroll').scrollLeft, b0 = x0 / z, b1 = (x0 + W) / z, X = t => t * z - x0;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = '#111318'; g.fillRect(0, 0, W, H);
  lanes.forEach((l, i) => { g.fillStyle = i === 0 ? '#181b22' : i % 2 ? '#14171d' : '#111318'; g.fillRect(0, l.y, W, l.h); g.fillStyle = '#262b36'; g.fillRect(0, l.y + l.h - 1, W, 1); });
  // sections
  g.font = '700 10px system-ui, sans-serif'; g.textBaseline = 'middle';
  for (const sec of song.sections) {
    if (sec.start + sec.len < b0 || sec.start > b1) continue;
    const sx = X(sec.start), sw = sec.len * z, on = S.sel === sec.i;
    g.fillStyle = sec.color + (on ? '22' : '10'); g.fillRect(sx, 30, sw, H - 30);
    g.fillStyle = sec.color + (on ? 'ff' : 'aa'); rr(g, sx + 1, 2, sw - 2, 14, 4); g.fill();
    g.save(); g.beginPath(); g.rect(sx + 1, 2, sw - 2, 14); g.clip();
    const tw = g.measureText(sec.label).width;
    g.fillStyle = '#0b0d11'; g.fillText(sec.label, Math.min(Math.max(sx + 5, 5), sx + sw - tw - 5), 9.5);
    g.restore();
    if (on) { g.strokeStyle = sec.color; g.lineWidth = 1.5; g.strokeRect(sx + .75, 30.75, sw - 1.5, H - 31.5); }
  }
  // grid
  g.font = '600 9px system-ui, sans-serif'; g.textBaseline = 'alphabetic';
  for (let t = Math.max(0, Math.floor(b0)); t <= Math.min(b1, song.totalBeats); t++) {
    const bar = t % bpb === 0;
    if (!bar && z < 10) continue;
    const x = Math.round(X(t));
    g.fillStyle = bar ? '#2b313c' : '#1b1f27'; g.fillRect(x, 30, 1, H - 30);
    if (bar) {
      const n = t / bpb + 1;
      if (z * bpb >= 22 || n % 4 === 1) { g.fillStyle = '#6b7383'; g.fillText(n, x + 3, 27); }
      g.fillStyle = '#3a414e'; g.fillRect(x, 19, 1, 11);
    }
  }
  // loop
  if (engine.loop) { const [l0, l1] = engine.loop; g.fillStyle = 'rgba(255,176,46,.08)'; g.fillRect(X(l0), 30, (l1 - l0) * z, H - 30); g.fillStyle = '#ffb02e'; g.fillRect(X(l0), 17, (l1 - l0) * z, 2); }
  // chords
  const L = lanes[1];
  g.textBaseline = 'middle';
  song.chords.forEach((ch, i) => {
    if (ch.t + ch.d < b0 || ch.t > b1) return;
    const x = X(ch.t) + 1, w = ch.d * z - 2, c = FNCOL[ch.c.fn], on = S.selChord === i;
    g.fillStyle = c + (on ? '66' : '2a'); rr(g, x, L.y + 4, w, L.h - 9, 6); g.fill();
    g.fillStyle = c; g.fillRect(x, L.y + 4, 3, L.h - 9);
    if (on) { g.strokeStyle = c; g.lineWidth = 1.5; rr(g, x, L.y + 4, w, L.h - 9, 6); g.stroke(); }
    if (w > 22) {
      g.save(); g.beginPath(); g.rect(x, L.y, w - 2, L.h); g.clip();
      g.fillStyle = '#eef1f6'; g.font = '800 13px system-ui, sans-serif'; g.fillText(ch.c.name, x + 7, L.y + 17);
      g.fillStyle = c; g.font = '700 10px system-ui, sans-serif'; g.fillText(S.chartMode === 'nash' ? ch.c.nash : ch.c.rn, x + 7, L.y + 32);
      g.restore();
    }
  });
  // notes
  const notes = (l, arr, [mn, mx], col) => {
    const pad = 5, span = Math.max(14, mx - mn + 3), lo = mn - Math.floor((span - (mx - mn + 1)) / 2);
    const rowH = (l.h - 2 * pad) / span, nh = Math.max(2, Math.min(7, rowH));
    g.fillStyle = col;
    for (let i = lowerBound(arr, b0 - 8); i < arr.length && arr[i].t < b1; i++) {
      const e = arr[i]; if (e.t + e.d < b0) continue;
      g.globalAlpha = .45 + .55 * Math.min(1, e.v);
      g.fillRect(X(e.t), l.y + l.h - pad - (e.m - lo + 1) * rowH, Math.max(2, e.d * z - 1), nh);
    }
    g.globalAlpha = 1;
  };
  notes(lanes[2], song.byTrack.melody, song.stats.melody, COL.melody);
  notes(lanes[3], song.byTrack.bass, song.stats.bass, COL.bass);
  // drums
  const D = lanes[4], rows = { crash:0, tomH:0, tomL:0, hat:1, ohat:1, snare:2, clap:2, kick:3 }, rcol = ['#ffd8a8', '#ffc9c9', '#ff8787', '#fa5252'];
  const rh = (D.h - 8) / 4, dw = Math.max(2, Math.min(5, z * .22)), arr = song.byTrack.drums;
  for (let i = lowerBound(arr, b0 - 1); i < arr.length && arr[i].t < b1; i++) {
    const e = arr[i], r = rows[e.k];
    g.fillStyle = rcol[r]; g.globalAlpha = .35 + .65 * Math.min(1, e.v);
    g.fillRect(X(e.t), D.y + 4 + r * rh + 1, dw, rh - 2);
  }
  g.globalAlpha = 1;
  // muted lanes
  const anySolo = TRACKS.some(([k]) => engine.tracks[k].solo);
  TRACKS.forEach(([k, n], i) => {
    const t = engine.tracks[k], l = lanes[i + 1];
    if (!layerOn(k)) {
      g.fillStyle = '#0f1115'; g.fillRect(0, l.y, W, l.h - 1);
      g.fillStyle = '#4a5160'; g.font = '600 11px system-ui, sans-serif'; g.textBaseline = 'middle';
      g.fillText(`No ${n.toLowerCase()} yet — tap here or “+ ${n}” to add it`, 10, l.y + l.h / 2);
    } else if (t.mute || (anySolo && !t.solo)) { g.fillStyle = 'rgba(12,13,17,.6)'; g.fillRect(0, l.y, W, l.h); }
  });
  // empty space below the last lane
  const lb = D.y + D.h; if (lb < H) { g.fillStyle = '#0e1014'; g.fillRect(0, lb, W, H - lb); }
  // end marker
  const ex = X(song.totalBeats); if (ex < W) { g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(ex, 0, W - ex, H); }
  // playhead
  const px = X(Math.max(0, b));
  if (px > -4 && px < W + 4) {
    g.fillStyle = playing ? '#ff5252' : '#ffb02e'; g.fillRect(Math.round(px) - 1, 0, 2, H);
    g.beginPath(); g.moveTo(px - 6, 0); g.lineTo(px + 6, 0); g.lineTo(px, 8); g.fill();
  }
}
function followScroll(b) {
  const sc = $('#arrScroll'), x = b * S.zoom;
  if (x < sc.scrollLeft + 8 || x > sc.scrollLeft + sc.clientWidth * .8) sc.scrollLeft = Math.max(0, x - sc.clientWidth * .2);
}
function setZoom(z) {
  const sc = $('#arrScroll'), b = (sc.scrollLeft + sc.clientWidth / 2) / S.zoom;
  S.zoom = Math.max(5, Math.min(70, z)); layoutArr();
  sc.scrollLeft = b * S.zoom - sc.clientWidth / 2;
}
A.cv.addEventListener('click', e => {
  const r = A.cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
  const beat = (x + $('#arrScroll').scrollLeft) / S.zoom, song = S.song;
  if (beat >= song.totalBeats) return;
  const lane = A.lanes.find(l => y >= l.y && y < l.y + l.h); if (!lane) return;
  const ch = song.chordAt(beat);
  if (LAYER_NAME[lane.id] && !layerOn(lane.id)) return setLayer(lane.id, true);
  if (lane.id === 'ruler') { S.sel = ch.sec; S.selChord = null; seek(beat); }
  else if (lane.id === 'keys') {
    const i = song.chords.indexOf(ch);
    S.selChord = S.selChord === i ? null : i; S.sel = ch.sec;
    if (S.selChord != null && !engine.playing) previewChord(ch.v);
  } else seek(beat);
  updateLoop(); renderSecTools(); renderInfo(); S.dirty = true;
});
function previewChord(notes) {
  const inst = engine.tracks.keys.inst;
  engine.preview(notes, inst === 'dist' ? 'guitar' : inst);
}

function renderSecTools() {
  const el = $('#secTools');
  if (S.sel == null) { el.innerHTML = `<span class="hint">Tap the ruler to pick a section · tap a chord to hear it</span>`; return; }
  const sec = S.song.sections[S.sel];
  el.innerHTML = `<span class="sec-name" style="color:${sec.color}">${sec.label}</span>
    <button class="pill" data-sec="play">▶ From here</button>
    <button class="pill ${S.loopOn ? 'on' : ''}" data-sec="loop">⟲ Loop</button>
    <button class="pill" data-sec="edit">✎ Chords</button>
    <button class="pill" data-sec="chords">↻ Chords</button>
    ${sec.type !== 'Intro' && sec.type !== 'Outro' ? '<button class="pill" data-sec="melody">↻ Melody</button>' : ''}
    <button class="pill" data-sec="close">✕</button>`;
}
$('#secTools').addEventListener('click', e => {
  const a = e.target.closest('[data-sec]')?.dataset.sec; if (!a) return;
  const sec = S.song.sections[S.sel];
  const reseed = k => { S.settings.seeds = { ...(S.settings.seeds || {}), [k]: (Math.random() * 2 ** 32) >>> 0 }; rebuild(); };
  if (a === 'play') { S.cursor = sec.start; play(sec.start); }
  if (a === 'loop') toggleLoop();
  if (a === 'edit') openChords(sec);
  if (a === 'chords') {
    if (S.settings.progs) { delete S.settings.progs[sec.key]; delete S.settings.progs[sec.group]; }
    reseed('ch:' + sec.group); toast(`New chords for every ${groupName(sec)}`);
  }
  if (a === 'melody') { reseed('mel:' + sec.mel); toast(`New melody for every ${groupName(sec)}`); }
  if (a === 'close') { S.sel = null; S.selChord = null; S.loopOn = false; updateLoop(); renderSecTools(); renderInfo(); }
});
function groupName(sec) { return S.song.sections.filter(s => s.group === sec.group).map(s => s.type).filter((v, i, a) => a.indexOf(v) === i).join(' / '); }

function renderInfo() {
  const el = $('#infoStrip'), song = S.song;
  if (S.selChord != null) {
    const ch = song.chords[S.selChord], c = ch.c;
    const notes = c.pcs.map(p => pcName(song.key, p)).join(' · ');
    el.innerHTML = `<span class="big">${c.name}</span><span><b>${c.rn}</b> <span class="dim">(${c.nash})</span><br><span class="tag fn-${c.fn}">${c.fn}</span></span><span class="dim">${notes}<br>bar ${Math.floor(ch.t / song.bpb) + 1} · ${ch.d / song.bpb} bar${ch.d === song.bpb ? '' : 's'}</span>`;
  } else if (S.sel != null) {
    const sec = song.sections[S.sel];
    const names = [...new Set(song.chords.filter(c => c.sec === sec.i).map(c => c.c.name))].join('  ');
    el.innerHTML = `<span class="big" style="color:${sec.color}">${sec.label}</span><span class="dim">${sec.bars} bars<br>${names}</span>`;
  } else {
    const secs = Math.round(song.totalBeats / S.settings.bpm * 60);
    el.innerHTML = `<span class="big">${song.key.label}</span><span class="dim">${song.style.name} · ${song.totalBeats / song.bpb} bars · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}<br>${song.sections.map(s => s.type[0] + (s.type === 'Pre-Chorus' ? 'c' : '')).join(' ')}</span>`;
  }
}

// ---------------------------------------------------------------- CHART
function barChords(bar) {
  const song = S.song, bs = bar * song.bpb, be = bs + song.bpb;
  let i = song.chords.indexOf(song.chordAt(bs)); const out = [];
  for (; i < song.chords.length && song.chords[i].t < be - 1e-6; i++) out.push(song.chords[i]);
  return out;
}
const lab = c => c.c[S.chartMode];
function renderChart() {
  const song = S.song;
  $('#chartBody').innerHTML = song.sections.map(sec => {
    let prev = null, cells = '';
    for (let b = 0; b < sec.bars; b++) {
      const bar = sec.start / song.bpb + b, cs = barChords(bar), key = cs.map(lab).join(' ');
      const rep = b > 0 && cs.length === 1 && key === prev;
      cells += `<div class="bar ${rep ? 'rep' : ''}" data-bar="${bar}"><span class="n">${bar + 1}</span>${rep ? '%' : cs.map(c => `<span>${lab(c)}</span>`).join('')}</div>`;
      prev = key;
    }
    return `<div class="csec"><h4 data-csec="${sec.i}"><i style="background:${sec.color}"></i>${sec.label} <small>${sec.bars} bars · ✎ edit chords</small></h4><div class="bars">${cells}</div></div>`;
  }).join('');
  S.lastBar = -2; S.lastBeat = -2;
  $('#stBeats').innerHTML = Array.from({ length: song.bpb }, () => '<i></i>').join('');
}
function updateChart(b, playing) {
  const song = S.song, bb = Math.max(0, b), bar = Math.floor(bb / song.bpb), beat = Math.floor(mod(bb, song.bpb));
  if (bar !== S.lastBar) {
    S.lastBar = bar;
    $$('#chartBody .bar.now').forEach(e => e.classList.remove('now'));
    const el = $(`#chartBody .bar[data-bar="${bar}"]`);
    if (el) { el.classList.add('now'); if (playing && S.follow) el.scrollIntoView({ block:'nearest', behavior:'smooth' }); }
    const ch = song.chordAt(bb), nx = nextChord(bb), sec = song.sections[ch.sec];
    $('#stNow').textContent = lab(ch); $('#stNowSub').textContent = S.chartMode === 'name' ? ch.c.rn : ch.c.name;
    $('#stNext').textContent = nx ? lab(nx) : '■'; $('#stNextSub').textContent = nx ? (S.chartMode === 'name' ? nx.c.rn : nx.c.name) : 'end';
    $('#stSec').innerHTML = `<span style="color:${sec.color}">${sec.label}</span> · bar ${bar - sec.start / song.bpb + 1}/${sec.bars}`;
  }
  // chord can change mid-bar
  const ch = song.chordAt(bb); if ($('#stNow').textContent !== lab(ch)) S.lastBar = -2;
  const curBeat = playing ? beat : -1;
  if (curBeat !== S.lastBeat) { S.lastBeat = curBeat; $$('#stBeats i').forEach((e, i) => { e.classList.toggle('on', i === curBeat); e.classList.toggle('one', i === 0); }); }
}
$('#chartBody').addEventListener('click', e => {
  const h = e.target.closest('[data-csec]'); if (h) return openChords(S.song.sections[+h.dataset.csec]);
  const el = e.target.closest('.bar'); if (el) { seek(+el.dataset.bar * S.song.bpb); S.lastBar = -2; } });
$('#chartMode').addEventListener('click', e => {
  const v = e.target.closest('button')?.dataset.v; if (!v) return;
  S.chartMode = v; $$('#chartMode button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  renderChart(); S.dirty = true;
});
$('#btnCopyChart').addEventListener('click', async () => {
  const song = S.song;
  let txt = `${S.name}\nKey: ${song.key.label} · ${S.settings.bpm} bpm · ${song.bpb}/4 · ${song.style.name}\n`;
  for (const sec of song.sections) {
    txt += `\n[${sec.label}]\n`;
    const bars = [];
    for (let b = 0; b < sec.bars; b++) bars.push(barChords(sec.start / song.bpb + b).map(lab).join(' '));
    for (let i = 0; i < bars.length; i += 4) txt += '| ' + bars.slice(i, i + 4).join(' | ') + ' |\n';
  }
  try {
    if (navigator.share) await navigator.share({ title:S.name, text:txt });
    else { await navigator.clipboard.writeText(txt); toast('Chart copied'); }
  } catch {}
});

// ---------------------------------------------------------------- KEY view
const CIRCLE = [0,7,2,9,4,11,6,1,8,3,10,5];
const CMAJ = ['C','G','D','A','E','B','F#','Db','Ab','Eb','Bb','F'];
const CMIN = ['Am','Em','Bm','F#m','C#m','G#m','Ebm','Bbm','Fm','Cm','Gm','Dm'];
function pianoSVG(key) {
  const W = 26, H = 96, whites = [0,2,4,5,7,9,11], blacks = [[1,1],[3,2],[6,4],[8,5],[10,6]];
  let s = `<svg viewBox="0 0 ${14 * W + 2} ${H + 2}">`;
  for (let o = 0; o < 2; o++) whites.forEach((pc, i) => {
    const x = (o * 7 + i) * W + 1, inS = key.pcs.includes(pc), t = pc === key.tonic;
    s += `<rect x="${x}" y="1" width="${W - 2}" height="${H}" rx="3" fill="${t ? '#4dabf7' : inS ? '#e3efff' : '#8a909c'}"/>`;
    if (inS) s += `<text x="${x + W / 2 - 1}" y="${H - 8}" font-size="10" font-weight="700" text-anchor="middle" fill="#0e1014">${pcName(key, pc)}</text>`;
  });
  for (let o = 0; o < 2; o++) for (const [pc, wi] of blacks) {
    const x = (o * 7 + wi) * W - 8, inS = key.pcs.includes(pc), t = pc === key.tonic;
    s += `<rect x="${x}" y="1" width="16" height="58" rx="2" fill="${t ? '#4dabf7' : inS ? '#2f6fb5' : '#1b1e24'}" stroke="#0e1014"/>`;
    if (inS) s += `<text x="${x + 8}" y="52" font-size="8" font-weight="700" text-anchor="middle" fill="#fff">${pcName(key, pc)}</text>`;
  }
  return s + '</svg>';
}
function circleSVG(key) {
  const C = 120, idx = CIRCLE.indexOf(key.parent);
  let s = `<svg viewBox="0 0 240 240"><circle cx="${C}" cy="${C}" r="112" fill="#161920" stroke="#2a303c"/><circle cx="${C}" cy="${C}" r="70" fill="#12141a" stroke="#2a303c"/>`;
  CIRCLE.forEach((pc, i) => {
    const a = (-90 + i * 30) * Math.PI / 180, d = Math.min(mod(i - idx, 12), mod(idx - i, 12));
    const hl = d === 0 ? '#ffb02e' : d === 1 ? '#5c4615' : null;
    const xo = C + Math.cos(a) * 92, yo = C + Math.sin(a) * 92, xi = C + Math.cos(a) * 52, yi = C + Math.sin(a) * 52;
    s += `<g data-par="${pc}" style="cursor:pointer"><circle cx="${xo}" cy="${yo}" r="17" fill="${hl || '#1d212a'}"/><text x="${xo}" y="${yo + 4}" font-size="12" font-weight="800" text-anchor="middle" fill="${d === 0 ? '#1f1400' : '#e6e9ef'}">${CMAJ[i]}</text></g>`;
    s += `<g data-par="${pc}" style="cursor:pointer"><circle cx="${xi}" cy="${yi}" r="13" fill="${hl ? (d === 0 ? '#b37a14' : '#3a2e10') : '#181b22'}"/><text x="${xi}" y="${yi + 3.5}" font-size="9" font-weight="700" text-anchor="middle" fill="#c7ccd6">${CMIN[i]}</text></g>`;
  });
  return s + `<text x="${C}" y="${C - 4}" font-size="11" text-anchor="middle" fill="#8b93a3">${sigText(key.sig)}</text><text x="${C}" y="${C + 12}" font-size="9" text-anchor="middle" fill="#5b6373">tap to change key</text></svg>`;
}
function fretSVG(key) {
  const tun = S.fret === 'bass' ? [43,38,33,28] : [64,59,55,50,45,40];
  const FW = 30, L = 26, top = 14, SH = 20, n = tun.length, w = L + 20 + 12 * FW + 4, h = top + (n - 1) * SH + 26;
  const fx = f => f === 0 ? L + 8 : L + 20 + (f - .5) * FW;
  let s = `<svg viewBox="0 0 ${w} ${h}" style="min-width:${w}px">`;
  s += `<rect x="${L + 20}" y="${top}" width="${12 * FW}" height="${(n - 1) * SH}" fill="#1a1510"/>`;
  [3,5,7,9].forEach(f => s += `<circle cx="${fx(f)}" cy="${top + (n - 1) * SH / 2}" r="4" fill="#3a3226"/>`);
  s += `<circle cx="${fx(12)}" cy="${top + SH * .5}" r="4" fill="#3a3226"/><circle cx="${fx(12)}" cy="${top + (n - 1.5) * SH}" r="4" fill="#3a3226"/>`;
  for (let f = 0; f <= 12; f++) s += `<rect x="${L + 20 + f * FW - (f ? 1 : 2)}" y="${top}" width="${f ? 2 : 4}" height="${(n - 1) * SH}" fill="${f ? '#6b6457' : '#d8d2c4'}"/>`;
  tun.forEach((o, i) => {
    const y = top + i * SH;
    s += `<rect x="${L + 16}" y="${y - .75 - i * .15}" width="${12 * FW + 4}" height="${1.5 + i * .3}" fill="#a49d90"/>`;
    s += `<text x="${L - 6}" y="${y + 4}" font-size="10" font-weight="700" text-anchor="end" fill="#8b93a3">${pcName(key, o % 12)}</text>`;
    for (let f = 0; f <= 12; f++) {
      const pc = (o + f) % 12; if (!key.pcs.includes(pc)) continue;
      const t = pc === key.tonic;
      s += `<circle cx="${fx(f)}" cy="${y}" r="8.5" fill="${t ? '#4dabf7' : '#2c3340'}" stroke="${t ? '#a5d8ff' : '#56627a'}"/><text x="${fx(f)}" y="${y + 3.2}" font-size="8.5" font-weight="700" text-anchor="middle" fill="#fff">${pcName(key, pc)}</text>`;
    }
  });
  for (const f of [3,5,7,9,12]) s += `<text x="${fx(f)}" y="${h - 4}" font-size="9" text-anchor="middle" fill="#5b6373">${f}</text>`;
  return s + '</svg>';
}
function renderKey() {
  const song = S.song, key = song.key;
  const steps = key.iv.map((x, i) => { const d = mod(key.iv[(i + 1) % 7] - x, 12); return d === 1 ? 'H' : d === 2 ? 'W' : 'W+H'; }).join(' ');
  const rel = key.mode === 'major' ? `${pcName(key, mod(key.tonic + 9, 12))} Minor` : key.mode === 'minor' ? `${pcName(key, mod(key.tonic + 3, 12))} Major` : `${key.parentName} Major (parent scale)`;
  const par = key.mode === 'major' ? `${key.tonicName} Minor` : `${key.tonicName} Major`;
  const tri = diatonicChords(key, false), sev = diatonicChords(key, true);
  const usedDeg = new Set(song.chords.filter(c => c.c.dia).map(c => c.c.deg));
  const songChords = [...new Map(song.chords.map(c => [c.c.name, c])).values()];
  const [mlo, mhi] = song.stats.melody;
  $('#view-key').innerHTML = `
    <div class="card">
      <div class="key-head">
        <div><div class="key-title">${key.label}</div><div class="key-sub">${key.info}</div></div>
        <div class="trans"><button data-tr="-1">−</button><button data-tr="1">+</button></div>
      </div>
      <div class="kv">
        <span>Signature</span><span>${sigText(key.sig)}</span>
        <span>Relative</span><span>${rel}</span>
        <span>Parallel</span><span>${par}</span>
        <span>Formula</span><span class="mono">${steps}</span>
        ${song.byTrack.melody.length ? `<span>Melody range</span><span>${noteName(key, mlo)} – ${noteName(key, mhi)} (${mhi - mlo} semitones)</span>` : ''}
      </div>
    </div>
    <div class="card"><h3>Scale</h3>
      <div class="notes">${key.names.map((n, i) => `<div class="note ${i ? '' : 't'}"><small>${i + 1}</small>${n}</div>`).join('')}</div>
      <div class="svgwrap" style="margin-top:10px">${pianoSVG(key)}</div>
    </div>
    <div class="card"><h3>Chords in the key <small style="text-transform:none;letter-spacing:0">· tap to hear</small></h3>
      <div class="dchords">${tri.map((c, i) => `<button class="dchord ${usedDeg.has(i) ? 'used' : ''}" data-pc="${i}"><span class="rn">${c.rn} · ${c.nash}</span><span class="nm">${c.name}</span><span class="ns">${sev[i].name}</span><span class="tag fn-${c.fn}" style="align-self:flex-start">${c.fn}</span></button>`).join('')}</div>
      <div class="legend"><span><i style="background:var(--tonic)"></i>Tonic = home</span><span><i style="background:var(--sub)"></i>Subdominant = away</span><span><i style="background:var(--dom)"></i>Dominant = tension → home</span><span><i style="background:var(--colour)"></i>Borrowed / colour</span></div>
    </div>
    <div class="card"><h3>Chords used in this song</h3>
      <div class="dchords">${songChords.map((c, i) => `<button class="dchord" data-sc="${song.chords.indexOf(c)}"><span class="rn">${c.c.rn}</span><span class="nm">${c.c.name}</span><span class="ns">${c.c.pcs.map(p => pcName(key, p)).join(' ')}</span></button>`).join('')}</div>
    </div>
    <div class="card"><h3>Fretboard</h3>
      <div class="chips" style="margin-bottom:8px"><button data-fret="guitar" class="${S.fret === 'guitar' ? 'on' : ''}">Guitar</button><button data-fret="bass" class="${S.fret === 'bass' ? 'on' : ''}">Bass</button></div>
      <div class="svgwrap">${fretSVG(key)}</div>
    </div>
    <div class="card"><h3>Circle of fifths</h3><div class="svgwrap" style="max-width:340px;margin:0 auto">${circleSVG(key)}</div></div>`;
}
$('#view-key').addEventListener('click', e => {
  const t = e.target.closest('[data-tr],[data-pc],[data-sc],[data-fret],[data-par]'); if (!t) return;
  const key = S.song.key;
  if (t.dataset.tr) transpose(+t.dataset.tr);
  else if (t.dataset.pc) previewChord(voiceChord(diatonicChords(key, false)[+t.dataset.pc], null));
  else if (t.dataset.sc) previewChord(S.song.chords[+t.dataset.sc].v);
  else if (t.dataset.fret) { S.fret = t.dataset.fret; renderKey(); }
  else if (t.dataset.par) { const tonic = mod(+t.dataset.par + MODES[key.mode].off, 12); transpose(mod(tonic - key.tonic + 6, 12) - 6); }
});
function transpose(n) {
  if (!n) return;
  S.settings.tonic = mod(S.settings.tonic + n, 12);
  S.draft.tonic = S.settings.tonic;
  rebuild();
  toast(`Transposed to ${S.song.key.label}`);
}

// ---------------------------------------------------------------- MIXER
function renderMix() {
  const strip = (k, name, insts) => {
    const t = engine.tracks[k];
    if (LAYER_NAME[k] && !layerOn(k)) return `<div class="strip"><div class="nm"><i style="background:${COL[k]}"></i>${name} <small style="color:var(--faint)">not in song</small></div>
      <div class="ctl"><button class="pill" data-layer="${k}">+ Add layer</button></div></div>`;
    return `<div class="strip"><div class="nm"><i style="background:${COL[k] || '#adb5bd'}"></i>${name}${LAYER_NAME[k] ? ` <button class="pill sm" data-layer="${k}" title="Remove this layer">✕</button>` : ''}</div>
      <div class="ctl">${insts ? `<select data-inst="${k}">${Object.entries(insts).map(([v, n]) => `<option value="${v}" ${t.inst === v ? 'selected' : ''}>${n}</option>`).join('')}</select>` : ''}
      <span class="ms"><button class="m ${t.mute ? 'on' : ''}" data-mute="${k}">M</button>${k !== 'click' ? `<button class="s ${t.solo ? 'on' : ''}" data-solo="${k}">S</button>` : ''}</span></div>
      <input type="range" min="0" max="1" step="0.01" value="${t.vol}" data-vol="${k}"></div>`;
  };
  $('#view-mix').innerHTML = `
    <div class="card"><h3>Tracks</h3>
      ${strip('keys', 'Chords', INSTRUMENTS.keys)}${strip('melody', 'Melody', INSTRUMENTS.melody)}${strip('bass', 'Bass', INSTRUMENTS.bass)}${strip('drums', 'Drums')}${strip('click', 'Metronome')}
    </div>
    <div class="card"><h3>Master</h3>
      <div class="lbl">Volume</div><input type="range" min="0" max="1.2" step="0.01" value="${engine.masterVol}" data-master>
      <div class="lbl">Reverb</div><input type="range" min="0" max="1.2" step="0.01" value="${engine.reverbAmt}" data-reverb>
      <div class="lbl">Practice</div>
      <div class="opts"><button class="opt ${S.countIn ? 'on' : ''}" data-countin>1-bar count-in</button><button class="opt ${engine.clickOn ? 'on' : ''}" data-clicktog>Metronome</button></div>
    </div>`;
  renderHeads();
}
document.addEventListener('click', e => {
  const ly = e.target.closest('[data-layer]');
  if (ly) return setLayer(ly.dataset.layer, !layerOn(ly.dataset.layer));
  const m = e.target.closest('[data-mute]'), s = e.target.closest('[data-solo]');
  if (m) { const t = engine.tracks[m.dataset.mute]; t.mute = !t.mute; }
  else if (s) { const t = engine.tracks[s.dataset.solo]; t.solo = !t.solo; }
  else return;
  engine.applyMix(); saveMix(); renderMix(); S.dirty = true;
});
$('#view-mix').addEventListener('input', e => {
  const el = e.target;
  if (el.dataset.vol) { engine.tracks[el.dataset.vol].vol = +el.value; }
  else if (el.dataset.master !== undefined) engine.masterVol = +el.value;
  else if (el.dataset.reverb !== undefined) engine.reverbAmt = +el.value;
  else return;
  engine.applyMix(); saveMix();
});
$('#view-mix').addEventListener('change', e => {
  const el = e.target; if (!el.dataset.inst) return;
  engine.tracks[el.dataset.inst].inst = el.value; saveMix();
  if (!engine.playing && el.dataset.inst === 'keys') previewChord(S.song.chordAt(S.cursor).v);
  if (!engine.playing && el.dataset.inst === 'melody') engine.preview([72], el.value, .6);
});
$('#view-mix').addEventListener('click', e => {
  if (e.target.closest('[data-countin]')) { S.countIn = engine.countIn = !S.countIn; saveMix(); renderMix(); }
  if (e.target.closest('[data-clicktog]')) toggleClick();
});
function toggleClick() { engine.clickOn = !engine.clickOn; $('#btnClick').classList.toggle('on', engine.clickOn); if (S.view === 'mix') renderMix(); }

// ---------------------------------------------------------------- GENERATE
function renderGen() {
  const d = S.draft;
  const opt = (k, v, label) => `<button class="opt ${String(d[k]) === String(v) ? 'on' : ''}" data-set="${k}" data-v="${v}">${label}</button>`;
  $('#view-gen').innerHTML = `
    <button class="bigbtn" data-act="generate">✦ Generate song</button>
    <div class="card"><h3>Key</h3>
      <div class="grid12">${KEY_LABELS.map((k, i) => `<button data-set="tonic" data-v="${i}" class="${d.tonic === i ? 'on' : ''}">${k}</button>`).join('')}</div>
      <div class="lbl">Mode</div><div class="opts">${Object.entries(MODES).map(([k, m]) => opt('mode', k, m.name)).join('')}</div>
      <div class="lbl" style="font-weight:400">${makeKey(d.tonic, d.mode).label} — ${MODES[d.mode].info}</div>
      <div class="opts" style="margin-top:8px"><button class="opt" data-act="randkey">🎲 Random key</button></div>
    </div>
    <div class="card"><h3>Style</h3><div class="opts">${Object.entries(STYLES).map(([k, s]) => opt('style', k, s.name)).join('')}</div>
      <div class="lbl" style="font-weight:400">${STYLES[d.style].bpm.join('–')} bpm typical</div></div>
    <div class="card"><h3>Tempo <small style="text-transform:none;letter-spacing:0">· current song, live</small></h3>
      <div class="bpmrow"><input type="range" min="40" max="220" value="${S.settings.bpm}" id="bpmSlider"><span class="v" id="bpmVal">${S.settings.bpm}</span></div>
      <div class="opts" style="grid-template-columns:1fr 1fr;margin-top:8px"><button class="opt" data-act="tap">👆 Tap tempo</button><button class="opt ${d.autoTempo ? 'on' : ''}" data-act="autotempo">Auto tempo for new songs</button></div>
    </div>
    <div class="card"><h3>Structure</h3>
      <div class="lbl">Time signature</div><div class="opts">${opt('bpb', 4, '4/4')}${opt('bpb', 3, '3/4')}</div>
      <div class="lbl">Length</div><div class="opts">${opt('length', 'short', 'Short')}${opt('length', 'medium', 'Medium')}${opt('length', 'long', 'Long')}</div>
      <div class="lbl">Harmony</div><div class="opts">${opt('complexity', 'simple', 'Triads')}${opt('complexity', 'normal', 'Normal')}${opt('complexity', 'rich', 'Rich / 7ths')}</div>
      <div class="lbl">Chord changes</div><div class="opts">${opt('hr', 'slow', 'Every 2 bars')}${opt('hr', 'normal', 'Every bar')}${opt('hr', 'fast', 'Twice a bar')}</div>
    </div>
    <div class="card"><h3>Chord rhythm <small style="text-transform:none;letter-spacing:0">· current song, live</small></h3>
      ${rhythmPicker(S.settings.rhythm, 'data-rhy', `Style (${RHYTHMS[STYLES[S.settings.style].comp].name})`)}
      <div class="lbl" style="font-weight:400">Each section can have its own rhythm: ✎ Chords on a section.</div>
    </div>
    <div class="card"><h3>Layers in new songs</h3>
      <div class="opts"><button class="opt on" disabled>Chords</button>${['melody', 'bass', 'drums'].map(k => `<button class="opt ${d.layers?.[k] ? 'on' : ''}" data-dl="${k}">${LAYER_NAME[k]}</button>`).join('')}</div>
      <div class="lbl" style="font-weight:400">Add or remove layers on the current song any time in Arrange (+ buttons) or the Mixer.</div>
    </div>
    <button class="bigbtn" data-act="generate">✦ Generate song</button>
    <div class="lbl" style="font-weight:400;text-align:center">Tip: in Arrange, tap a section on the ruler to re-roll only its chords or melody.<br>Use Key → − / + to transpose without changing the song.</div>`;
}
function rhythmPicker(cur, attr, defLabel) {
  const bpb = S.song.bpb;
  return `<div class="rgrid"><button class="ropt ${!cur ? 'on' : ''}" ${attr}=""><span>${defLabel}</span></button>` +
    Object.entries(RHYTHMS).map(([id, r]) => `<button class="ropt ${cur === id ? 'on' : ''}" ${attr}="${id}"><span>${r.name}</span>${rhythmSVG(id, bpb)}</button>`).join('') + '</div>';
}
let taps = [];
$('#view-gen').addEventListener('click', e => {
  const r = e.target.closest('[data-rhy]');
  if (r) { S.settings.rhythm = S.draft.rhythm = r.dataset.rhy || null; rebuild(); toast(`Chord rhythm: ${RHYTHMS[r.dataset.rhy]?.name || 'style default'}`); return; }
  const dl = e.target.closest('[data-dl]');
  if (dl) { const k = dl.dataset.dl; S.draft.layers = { ...S.draft.layers, [k]: !S.draft.layers?.[k] }; persist(); renderGen(); return; }
  const t = e.target.closest('[data-set],[data-act]'); if (!t) return;
  const d = S.draft;
  if (t.dataset.set) { const k = t.dataset.set; d[k] = ['tonic', 'bpb'].includes(k) ? +t.dataset.v : t.dataset.v; persist(); renderGen(); return; }
  const a = t.dataset.act;
  if (a === 'generate') { newSong(); setView('arrange'); }
  if (a === 'randkey') { d.tonic = Math.floor(Math.random() * 12); persist(); renderGen(); }
  if (a === 'autotempo') { d.autoTempo = !d.autoTempo; persist(); renderGen(); }
  if (a === 'tap') {
    const now = performance.now(); taps = taps.filter(x => now - x < 2500); taps.push(now);
    if (taps.length >= 2) { const avg = (taps[taps.length - 1] - taps[0]) / (taps.length - 1); setTempo(Math.round(60000 / avg)); }
    t.textContent = `👆 Tap (${taps.length})`;
  }
});
$('#view-gen').addEventListener('input', e => { if (e.target.id === 'bpmSlider') setTempo(+e.target.value); });
let persistT = 0;
function setTempo(bpm) {
  bpm = Math.max(40, Math.min(220, bpm));
  S.settings.bpm = bpm; engine.setBpm(bpm);
  $('#lcdBpm').textContent = bpm;
  const v = $('#bpmVal'), sl = $('#bpmSlider'); if (v) v.textContent = bpm; if (sl && +sl.value !== bpm) sl.value = bpm;
  clearTimeout(persistT); persistT = setTimeout(() => { persist(); renderInfo(); }, 300);
}

// ---------------------------------------------------------------- SONG BUILDER: structure
const TYPES = ['Intro', 'Verse', 'Pre-Chorus', 'Chorus', 'Bridge', 'Solo', 'Outro'];
const BARS = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32];
const curForm = () => S.song.sections.map(s => [s.type, s.bars]);
function setForm(f) {
  S.settings.form = f; S.sel = null; S.selChord = null; S.loopOn = false;
  rebuild(); renderSecTools();
}
function openStruct() { S.modal = 'struct'; renderStruct(); $('#modal').hidden = false; }
function renderStruct() {
  const f = curForm(), bars = f.reduce((a, x) => a + x[1], 0), secs = Math.round(bars * S.song.bpb / S.settings.bpm * 60);
  $('#modalTitle').textContent = 'Song structure';
  $('#modalBody').innerHTML = `
    <div class="lbl">Start from a pattern</div>
    <div class="opts">${['short', 'medium', 'long'].map(k => `<button class="opt" data-st-preset="${k}">${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}</div>
    <div class="lbl">Sections, in playing order</div>
    <div class="slist">${f.map(([t, b], i) => `
      <div class="srow"><i style="background:${SEC_COLOR[t]}"></i>
        <select data-st-type="${i}">${TYPES.map(x => `<option ${x === t ? 'selected' : ''}>${x}</option>`).join('')}</select>
        <span class="stepper"><button data-st-bars="${i}" data-d="-1">−</button><b>${b}</b><button data-st-bars="${i}" data-d="1">+</button></span>
        <button class="sb" data-st-up="${i}" ${i ? '' : 'disabled'}>↑</button><button class="sb" data-st-del="${i}" ${f.length > 1 ? '' : 'disabled'}>✕</button>
      </div>`).join('')}</div>
    <div class="lbl">Add section at the end</div>
    <div class="opts">${TYPES.map(t => `<button class="opt" data-st-add="${t}" style="border-left:4px solid ${SEC_COLOR[t]}">+ ${t}</button>`).join('')}</div>
    <div class="lbl" style="font-weight:400">${bars} bars · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}. Sections of the same type share their chords — edit them with ✎ Chords.</div>
    <button class="bigbtn" data-modal-close>Done</button>`;
}
$('#modalBody').addEventListener('click', e => {
  if (S.modal !== 'struct') return;
  const t = e.target.closest('button'); if (!t) return;
  const f = curForm(), d = t.dataset;
  if (d.stPreset) { S.settings.length = d.stPreset; S.draft.length = d.stPreset; setForm(null); }
  else if (d.stBars) { const i = +d.stBars, k = BARS.indexOf(f[i][1]); f[i][1] = BARS[Math.max(0, Math.min(BARS.length - 1, (k < 0 ? 5 : k) + +d.d))]; setForm(f); }
  else if (d.stUp) { const i = +d.stUp; [f[i - 1], f[i]] = [f[i], f[i - 1]]; setForm(f); }
  else if (d.stDel) { f.splice(+d.stDel, 1); setForm(f); }
  else if (d.stAdd) { f.push([d.stAdd, ['Intro', 'Outro', 'Pre-Chorus'].includes(d.stAdd) ? 4 : 8]); setForm(f); }
  else return;
  renderStruct();
});
$('#modalBody').addEventListener('change', e => {
  if (S.modal !== 'struct' || !e.target.dataset.stType) return;
  const f = curForm(); f[+e.target.dataset.stType][0] = e.target.value; setForm(f); renderStruct();
});

// ---------------------------------------------------------------- SONG BUILDER: chord editor
const NEXT = { 0:[3,4,5,1], 1:[4,6,3], 2:[5,3], 3:[4,0,1], 4:[0,5], 5:[1,3,4], 6:[0,2] };
const COLOUR_TOKS = ['bVII', 'bVI', 'bIII', 'IV', 'V', 'iv', 'II'];
const QK = [['tri', 'Triad'], ['7', '7th'], ['sus2', 'sus2'], ['sus4', 'sus4'], ['add9', 'add9']];
const LENS = [.5, 1, 2, 4];
const lenLabel = l => l === .5 ? '½ bar' : l === 1 ? '1 bar' : l + ' bars';
const ceChord = x => { const p = parseTok(S.song.key, x.t); return makeChord(S.song.key, p, x.q || p.q); };
const qKind = q => ['7', 'maj7', 'm7', 'm7b5', 'dim7'].includes(q) ? '7' : q === 'sus2' || q === 'sus4' ? q : q === 'add9' || q === 'madd9' ? 'add9' : 'tri';
function applyKind(x, kind) {
  const p = parseTok(S.song.key, x.t);
  x.q = kind === 'tri' ? p.q : kind === '7' ? seventhOf(S.song.key, p) : kind === 'add9' ? (p.q === 'min' ? 'madd9' : 'add9') : kind;
}
function openChords(sec) {
  const s = S.settings, g = S.song.groups[sec.group], custom = S.song.custom[sec.group];
  const src = s.progs?.[sec.key] || g.map(c => ({ t:c.tok, q:c.q, l: custom ? c.len : S.song.slot }));
  S.ce = { key:sec.key, type:sec.type, list:structuredClone(src), sel:-1 };
  S.modal = 'chords'; renderCE(); $('#modal').hidden = false;
}
function commitCE() {
  const s = S.settings; s.progs = { ...(s.progs || {}) };
  if (S.ce.list.length) s.progs[S.ce.key] = structuredClone(S.ce.list); else delete s.progs[S.ce.key];
  rebuild();
}
function renderCE() {
  const { list, sel, type, key: k } = S.ce, key = S.song.key;
  const prev = sel >= 0 ? list[sel - 1] : list[list.length - 1];
  const pc = prev && ceChord(prev);
  const fit = !pc ? [0, 3, 4, 5] : pc.dia ? NEXT[pc.deg] : [0, 3, 4];
  const dia = key.iv.map((_, i) => ceChord({ t:i + 1 }));
  const diaNames = new Set(dia.map(c => c.name));
  const colour = COLOUR_TOKS.map(t => ({ t, c: ceChord({ t }) })).filter(x => !diaNames.has(x.c.name));
  const total = list.reduce((a, x) => a + x.l, 0);
  const secLens = [...new Set(S.song.sections.filter(s => s.key === k || (s.group === k)).map(s => s.bars))];
  const x = list[sel];
  $('#modalTitle').textContent = `${type} chords · ${key.label}`;
  $('#modalBody').innerHTML = `
    <div class="prog">${list.map((e, i) => { const c = ceChord(e); return `<button class="cchip ${i === sel ? 'on' : ''}" data-ce-sel="${i}" style="--fc:${FNCOL[c.fn]}"><b>${c.name}</b><small>${c.rn} · ${lenLabel(e.l)}</small></button>`; }).join('')}
      <button class="cchip add ${sel < 0 ? 'on' : ''}" data-ce-sel="-1"><b>＋</b><small>add</small></button></div>
    <div class="lbl" style="font-weight:400">${total} bar${total === 1 ? '' : 's'}, repeats to fill the ${type} (${secLens.join(' / ') || '?'} bars).</div>
    <details class="rdet" ${S.ce.rhyOpen ? 'open' : ''}><summary>Rhythm for ${type}: <b>${RHYTHMS[S.settings.rhythms?.[k]]?.name || 'song default'}</b></summary>
      ${rhythmPicker(S.settings.rhythms?.[k], 'data-ce-rhy', 'Song default')}</details>
    ${x ? `<div class="card ce-ctl">
      <div class="lbl">Length</div><div class="chips">${LENS.map(l => `<button class="${x.l === l ? 'on' : ''}" data-ce-len="${l}">${lenLabel(l)}</button>`).join('')}</div>
      <div class="lbl">Type</div><div class="chips">${QK.map(([q, n]) => `<button class="${qKind(x.q) === q ? 'on' : ''}" data-ce-q="${q}">${n}</button>`).join('')}</div>
      <div class="chips" style="margin-top:10px"><button data-ce-mv="-1">◀ Move</button><button data-ce-mv="1">Move ▶</button><button data-ce-del>✕ Remove</button></div>
    </div>` : ''}
    <div class="lbl">${x ? `Tap to replace ${ceChord(x).name}` : 'Tap to add'} · <span style="color:var(--accent)">★ fits well after ${pc ? pc.name : 'the start'}</span></div>
    <div class="dchords">${dia.map((c, i) => `<button class="dchord ${fit.includes(i) ? 'fit' : ''}" data-ce-add="${i + 1}"><span class="rn">${c.rn}${fit.includes(i) ? ' ★' : ''}</span><span class="nm">${c.name}</span><span class="tag fn-${c.fn}" style="align-self:flex-start">${c.fn}</span></button>`).join('')}</div>
    <div class="lbl">Colour chords (borrowed — use for surprise)</div>
    <div class="dchords">${colour.map(({ t, c }) => `<button class="dchord" data-ce-add="${t}"><span class="rn">${c.rn}</span><span class="nm">${c.name}</span></button>`).join('')}</div>
    <div class="opts" style="grid-template-columns:1fr 1fr 1fr;margin-top:14px">
      <button class="opt" data-ce-play>▶ Hear</button><button class="opt" data-ce-reset>↺ Generated</button><button class="opt on" data-modal-close>Done</button></div>`;
}
let ceTimers = [];
function stopCE() { ceTimers.forEach(clearTimeout); ceTimers = []; }
function playCE() {
  stopCE();
  let t = 0, prev = null; const spb = 60 / S.settings.bpm, bpb = S.song.bpb, inst = engine.tracks.keys.inst === 'dist' ? 'guitar' : engine.tracks.keys.inst;
  S.ce.list.forEach((x, i) => {
    const v = voiceChord(ceChord(x), prev); prev = v; const d = x.l * bpb * spb;
    ceTimers.push(setTimeout(() => { if (S.modal !== 'chords') return; S.ce.sel = i; renderCE(); engine.preview(v, inst, d * .95); }, t * 1000));
    t += d;
  });
  ceTimers.push(setTimeout(() => { if (S.modal === 'chords') { S.ce.sel = -1; renderCE(); } }, t * 1000));
}
$('#modalBody').addEventListener('click', e => {
  if (S.modal !== 'chords') return;
  const b = e.target.closest('button'); if (!b) return;
  const d = b.dataset, ce = S.ce, L = ce.list;
  if (d.ceSel !== undefined) { ce.sel = +d.ceSel; if (ce.sel >= 0) previewChord(voiceChord(ceChord(L[ce.sel]), null)); renderCE(); return; }
  if (d.cePlay !== undefined) return playCE();
  if (d.ceRhy !== undefined) {
    S.settings.rhythms = { ...(S.settings.rhythms || {}) };
    if (d.ceRhy) S.settings.rhythms[ce.key] = d.ceRhy; else delete S.settings.rhythms[ce.key];
    ce.rhyOpen = true; rebuild(); renderCE(); return;
  }
  if (d.ceAdd) {
    const t = /^\d$/.test(d.ceAdd) ? +d.ceAdd : d.ceAdd, p = parseTok(S.song.key, t);
    if (ce.sel >= 0) { L[ce.sel] = { t, q:p.q, l:L[ce.sel].l }; }
    else L.push({ t, q:p.q, l: L.length ? L[L.length - 1].l : S.song.slot });
    previewChord(voiceChord(ceChord({ t }), null));
  } else if (d.ceLen) L[ce.sel].l = +d.ceLen;
  else if (d.ceQ) { applyKind(L[ce.sel], d.ceQ); previewChord(voiceChord(ceChord(L[ce.sel]), null)); }
  else if (d.ceMv) { const i = ce.sel, j = i + +d.ceMv; if (j < 0 || j >= L.length) return; [L[i], L[j]] = [L[j], L[i]]; ce.sel = j; }
  else if (d.ceDel !== undefined) { L.splice(ce.sel, 1); ce.sel = -1; }
  else if (d.ceReset !== undefined) {
    if (S.settings.progs) delete S.settings.progs[ce.key];
    rebuild(); const sec = S.song.sections.find(s => s.key === ce.key); if (sec) return openChords(sec);
    return;
  } else return;
  commitCE(); renderCE();
});

// ---------------------------------------------------------------- library / export / misc
function openModal(title, html) { S.modal = 'lib'; $('#modalTitle').textContent = title; $('#modalBody').innerHTML = html; $('#modal').hidden = false; }
function closeModal() { $('#modal').hidden = true; S.modal = null; stopCE(); }
$('#modalClose').addEventListener('click', closeModal);
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal' || e.target.closest('[data-modal-close]')) closeModal(); });
function renderLib() {
  const lib = store.get('bm.lib', []);
  openModal('Library', lib.length ? lib.map(x => {
    const k = makeKey(x.settings.tonic, x.settings.mode);
    return `<div class="libitem"><div class="t"><b>${esc(x.name)}</b><small>${k.label} · ${STYLES[x.settings.style].name} · ${x.settings.bpm} bpm</small></div>
      <button class="pill" data-load="${x.id}">Open</button><button class="pill" data-del="${x.id}">✕</button></div>`;
  }).join('') : '<div class="empty">No saved songs yet.<br>Tap 💾 to save the current one.</div>');
}
$('#modalBody').addEventListener('click', e => {
  const l = e.target.closest('[data-load]'), d = e.target.closest('[data-del]');
  const lib = store.get('bm.lib', []);
  if (l) {
    const x = lib.find(i => i.id === l.dataset.load); if (!x) return;
    engine.stop(true); updatePlayBtn();
    S.settings = structuredClone(x.settings); S.name = x.name; S.id = x.id; S.sel = null; S.selChord = null; S.cursor = 0; S.loopOn = false;
    if (x.mix) for (const [k, v] of Object.entries(x.mix)) if (engine.tracks[k]) engine.tracks[k].inst = v;
    rebuild(); renderMix(); closeModal(); toast(`Opened ${x.name}`);
  }
  if (d) {
    const x = lib.find(i => i.id === d.dataset.del);
    if (x && confirm(`Delete "${x.name}"?`)) { store.set('bm.lib', lib.filter(i => i !== x)); if (S.id === x.id) S.id = null; renderLib(); }
  }
});
function saveSong() {
  const lib = store.get('bm.lib', []);
  if (!S.id) S.id = Date.now().toString(36);
  const mix = {}; for (const k of ['keys', 'melody', 'bass']) mix[k] = engine.tracks[k].inst;
  const entry = { id:S.id, name:S.name, settings:S.settings, mix, saved:Date.now() };
  const i = lib.findIndex(x => x.id === S.id);
  if (i >= 0) lib[i] = entry; else lib.unshift(entry);
  store.set('bm.lib', lib); persist(); toast('Saved to library');
}
function exportMidi() {
  const bytes = songToMidi(S.song, S.settings.bpm, engine.tracks);
  const url = URL.createObjectURL(new Blob([bytes], { type:'audio/midi' }));
  const a = document.createElement('a'); a.href = url; a.download = `${S.name.replace(/[^\w\- ]+/g, '')} - ${S.song.key.label}.mid`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  toast('MIDI exported');
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
let toastT = 0;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 1800); }

function setView(v) {
  S.view = v;
  $$('.view').forEach(el => el.classList.toggle('on', el.id === 'view-' + v));
  $$('#tabbar button').forEach(b => b.classList.toggle('on', b.dataset.view === v));
  if (v === 'arrange') { layoutArr(); requestAnimationFrame(layoutArr); }
  if (v === 'chart') S.lastBar = -2;
  if (v === 'mix') renderMix();
}

// ---------------------------------------------------------------- wiring
$('#tabbar').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setView(b.dataset.view); });
$('#btnPlay').addEventListener('click', () => engine.playing ? pause() : play());
$('#btnRew').addEventListener('click', () => { S.cursor = engine.loop ? engine.loop[0] : 0; if (engine.playing) play(S.cursor); S.dirty = true; S.lastBar = -2; $('#arrScroll').scrollLeft = S.cursor * S.zoom - 20; });
$('#btnLoop').addEventListener('click', toggleLoop);
$('#btnClick').addEventListener('click', toggleClick);
$('#btnFollow').addEventListener('click', e => { S.follow = !S.follow; e.currentTarget.classList.toggle('on', S.follow); });
$('#zoomIn').addEventListener('click', () => setZoom(S.zoom * 1.35));
$('#zoomOut').addEventListener('click', () => setZoom(S.zoom / 1.35));
$('#arrScroll').addEventListener('scroll', () => S.dirty = true, { passive:true });
$('#btnLib').addEventListener('click', renderLib);
$('#btnStruct').addEventListener('click', openStruct);
$('#btnSave').addEventListener('click', saveSong);
$('#btnMidi').addEventListener('click', exportMidi);
$('#songName').addEventListener('click', () => {
  const n = prompt('Song name', S.name); if (!n || !n.trim()) return;
  S.name = n.trim().slice(0, 60); S.song.name = S.name; $('#songName').textContent = S.name; persist();
});
window.addEventListener('resize', () => { if (S.view === 'arrange') layoutArr(); });
document.addEventListener('keydown', e => { if (e.code === 'Space' && e.target === document.body) { e.preventDefault(); engine.playing ? pause() : play(); } });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && engine.playing) lockScreen(true); });

function frame() {
  const pos = engine.playing ? engine.position() : null, playing = pos != null, b = playing ? pos : S.cursor;
  updateLCD(b, playing);
  if (S.view === 'arrange') {
    if (playing && S.follow) followScroll(Math.max(0, b));
    if (playing || S.dirty) { drawArr(b, playing); S.dirty = false; }
  }
  if (S.view === 'chart') updateChart(b, playing);
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- boot
loadMix();
S.draft = { ...DEFAULTS, ...store.get('bm.draft', {}) };
const cur = store.get('bm.current', null);
if (cur && cur.settings && STYLES[cur.settings.style]) { S.settings = cur.settings; S.name = cur.name; S.id = cur.id; }
renderMix();
if (S.settings) rebuild(); else newSong();
setView('arrange');
requestAnimationFrame(frame);
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => {});
