// Web Audio engine: synthesized instruments + lookahead scheduler with loop / count-in / click.
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

export const INSTRUMENTS = {
  keys:   { piano:'Piano', epiano:'E-Piano', organ:'Organ', pad:'Synth Pad', guitar:'Clean Guitar', dist:'Drive Guitar' },
  melody: { lead:'Synth Lead', flute:'Flute', brass:'Brass', piano:'Piano', epiano:'E-Piano' },
  bass:   { finger:'Finger Bass', synth:'Synth Bass', sub:'Sub Bass' },
  drums:  { kit:'Drum Kit' },
};
const SEND = { keys:.25, melody:.3, bass:0, drums:.08, click:0 };

export class Engine {
  constructor() {
    this.ctx = null;
    this.tracks = {
      keys:   { vol:.7, mute:false, solo:false, inst:'piano' },
      melody: { vol:.6, mute:false, solo:false, inst:'lead' },
      bass:   { vol:.8, mute:false, solo:false, inst:'finger' },
      drums:  { vol:.8, mute:false, solo:false, inst:'kit' },
      click:  { vol:.6, mute:false, solo:false },
    };
    this.masterVol = .85; this.reverbAmt = .5;
    this.playing = false; this.loop = null; this.clickOn = false; this.countIn = false;
    this.song = null; this.bpm = 110;
  }

  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint:'interactive' });
    this.master = ctx.createGain(); this.master.gain.value = this.masterVol;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = .005; comp.release.value = .2;
    this.master.connect(comp); comp.connect(ctx.destination);
    // reverb
    this.verb = ctx.createConvolver(); this.verb.buffer = this.impulse(2.2);
    this.verbGain = ctx.createGain(); this.verbGain.gain.value = this.reverbAmt;
    this.verb.connect(this.verbGain); this.verbGain.connect(this.master);
    // noise
    const nb = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), d = nb.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = nb;
    // distortion curve
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 6); }
    this.distCurve = curve;
    this.bus = {};
    for (const k of Object.keys(this.tracks)) {
      const g = ctx.createGain(); g.connect(this.master);
      const s = ctx.createGain(); s.gain.value = SEND[k]; g.connect(s); s.connect(this.verb);
      this.bus[k] = g;
    }
    this.applyMix();
  }

  impulse(sec) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * sec), b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); }
    return b;
  }

  applyMix() {
    if (!this.ctx) return;
    const anySolo = ['keys','melody','bass','drums'].some(k => this.tracks[k].solo);
    for (const [k, t] of Object.entries(this.tracks)) {
      const on = !t.mute && (!anySolo || t.solo || k === 'click');
      this.bus[k].gain.setTargetAtTime(on ? t.vol : 0, this.ctx.currentTime, .02);
    }
    this.master.gain.setTargetAtTime(this.masterVol, this.ctx.currentTime, .02);
    this.verbGain.gain.setTargetAtTime(this.reverbAmt, this.ctx.currentTime, .02);
  }

  // ---------- transport
  setSong(song) {
    this.song = song;
    if (this.playing) this.idx = lowerBound(song.events, this.cursor);
  }
  get bps() { return this.bpm / 60; }

  play(fromBeat) {
    this.ensure(); if (!this.song) return;
    this.stop(true);
    const bpb = this.song.bpb;
    if (this.loop && (fromBeat < this.loop[0] || fromBeat >= this.loop[1])) fromBeat = this.loop[0];
    const pre = this.countIn ? bpb : 0;
    const t0 = this.ctx.currentTime + .08;
    this.anchors = [{ time:t0, beat:fromBeat - pre }];
    this.cursor = fromBeat - pre;
    this.countInEnd = fromBeat;
    this.idx = lowerBound(this.song.events, fromBeat);
    this.playing = true;
    this.timer = setInterval(() => this.tick(), 25);
    this.tick();
  }

  stop(silent) {
    clearInterval(this.timer); this.timer = null;
    const was = this.playing; this.playing = false;
    if (was && !silent && this.onStop) this.onStop();
  }

  setBpm(bpm) {
    if (this.playing && this.ctx) {
      const now = this.ctx.currentTime, b = this.position();
      const before = this.anchors.length;
      this.anchors = this.anchors.filter(a => a.time <= now);
      if (this.anchors.length !== before) { this.cursor = b; this.idx = lowerBound(this.song.events, b); }
      this.bpm = bpm;
      this.anchors.push({ time:now, beat:b });
      this.cursor = Math.max(this.cursor, b);
    } else this.bpm = bpm;
  }

  position() {
    if (!this.playing || !this.ctx) return null;
    const now = this.ctx.currentTime;
    let a = this.anchors[0];
    for (const x of this.anchors) if (x.time <= now) a = x;
    if (this.anchors.length > 8) this.anchors = this.anchors.filter(x => x === a || x.time > now);
    return a.beat + (now - a.time) * this.bps;
  }

  tick() {
    if (!this.playing) return;
    const ctx = this.ctx, song = this.song, horizon = ctx.currentTime + .12;
    let a = this.anchors[this.anchors.length - 1];
    let end = a.beat + (horizon - a.time) * this.bps;
    for (let guard = 0; guard < 4; guard++) {
      const L = this.loop;
      const segEnd = L && this.cursor < L[1] ? Math.min(end, L[1]) : end;
      this.scheduleRange(this.cursor, segEnd, a);
      this.cursor = segEnd;
      if (L && segEnd >= L[1] && end >= L[1]) {
        a = { time: a.time + (L[1] - a.beat) / this.bps, beat: L[0] };
        this.anchors.push(a);
        this.cursor = L[0]; this.idx = lowerBound(song.events, L[0]); this.countInEnd = -Infinity;
        end = a.beat + (horizon - a.time) * this.bps;
        continue;
      }
      break;
    }
    const pos = this.position();
    if (!this.loop && pos > song.totalBeats + 1) this.stop();
  }

  scheduleRange(b0, b1, a) {
    const bps = this.bps, song = this.song, bpb = song.bpb;
    for (let b = Math.ceil(b0 - 1e-9); b < b1; b++) {
      if (b >= song.totalBeats) break;
      if (this.clickOn || b < this.countInEnd) this.click(a.time + (b - a.beat) / bps, ((b % bpb) + bpb) % bpb === 0);
    }
    const ev = song.events;
    while (this.idx < ev.length && ev[this.idx].t < b1 - 1e-9) {
      const e = ev[this.idx++];
      if (e.t >= b0 - 1e-6) this.playEvent(e, Math.max(this.ctx.currentTime, a.time + (e.t - a.beat) / bps), e.d / bps);
    }
  }

  playEvent(e, t, dur) {
    const tr = this.tracks[e.tr];
    if (e.tr === 'drums') return this.drum(e.k, t, e.v);
    const out = this.bus[e.tr];
    if (e.tr === 'keys') {
      if (tr.inst === 'dist' && e.n.length > 1) {
        const r = 40 + ((e.root - 4 + 12) % 12);
        [r, r + 7, r + 12].forEach(m => this.voice('dist', m, t, dur, e.v, out));
        return;
      }
      const strum = tr.inst === 'guitar' && e.n.length > 1;
      const notes = strum && e.up ? [...e.n].reverse() : e.n;
      notes.forEach((m, i) => this.voice(tr.inst, m, t + (strum ? i * .014 : 0), dur, e.v / (e.n.length > 1 ? 1.6 : 1), out));
      return;
    }
    this.voice(tr.inst, e.m, t, dur, e.v, out);
  }

  // preview a chord / note immediately (Key view, taps)
  preview(notes, inst = 'piano', dur = 1.2) {
    this.ensure();
    const t = this.ctx.currentTime + .02;
    notes.forEach((m, i) => this.voice(inst, m, t + i * .02, dur, .7 / Math.max(1, notes.length / 2), this.bus.keys));
  }

  // ---------- synthesis
  osc(type, f, t, end) { const o = this.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); o.start(t); o.stop(end); return o; }
  gain(v = 1) { const g = this.ctx.createGain(); g.gain.value = v; return g; }
  filt(type, f, q = .7) { const b = this.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }
  adsr(p, t, d, peak, a, dec, sus, rel) {
    p.setValueAtTime(0.0001, t); p.linearRampToValueAtTime(peak, t + a);
    p.setTargetAtTime(peak * sus, t + a, dec);
    p.setTargetAtTime(0.0001, t + Math.max(d, a), rel);
    return t + Math.max(d, a) + rel * 6;
  }

  voice(inst, m, t, d, v, out) {
    const f = mtof(m), ctx = this.ctx;
    const g = this.gain(0); g.connect(out);
    let end;
    switch (inst) {
      case 'piano': {
        const tau = .35 + Math.max(0, 90 - m) / 60;
        end = this.adsr(g.gain, t, d, .32 * v, .004, tau, 0, .09);
        const lp = this.filt('lowpass', Math.min(9000, f * 9)); lp.connect(g);
        lp.frequency.setTargetAtTime(Math.max(400, f * 2.2), t, .5);
        this.osc('triangle', f, t, end).connect(lp);
        const h = this.gain(.22); h.connect(lp); this.osc('sine', f * 2, t, end).connect(h);
        const h3 = this.gain(.06); h3.connect(lp); this.osc('sawtooth', f, t, end).connect(h3);
        break;
      }
      case 'epiano': {
        end = this.adsr(g.gain, t, d, .3 * v, .003, 1.1, 0, .15);
        const car = this.osc('sine', f, t, end); car.connect(g);
        const mo = this.osc('sine', f, t, end), mg = this.gain(0);
        mg.gain.setValueAtTime(f * 2.2 * v, t); mg.gain.setTargetAtTime(f * .2, t, .25);
        mo.connect(mg); mg.connect(car.frequency);
        const b = this.gain(.04 * v); b.connect(g); b.gain.setTargetAtTime(0, t, .05); this.osc('sine', f * 7, t, end).connect(b);
        break;
      }
      case 'organ': {
        end = this.adsr(g.gain, t, d, .14 * v, .008, .1, 1, .04);
        [[.5,.35],[1,.6],[2,.35],[3,.15],[4,.1]].forEach(([r, a]) => { const h = this.gain(a); h.connect(g); this.osc('sine', f * r, t, end).connect(h); });
        break;
      }
      case 'pad': {
        end = this.adsr(g.gain, t, d, .09 * v, .35, 1, .8, .5);
        const lp = this.filt('lowpass', 1500, 1); lp.connect(g);
        [-8, 8].forEach(c => { const o = this.osc('sawtooth', f, t, end); o.detune.value = c; o.connect(lp); });
        const s = this.gain(.5); s.connect(lp); this.osc('triangle', f / 2, t, end).connect(s);
        break;
      }
      case 'guitar': {
        end = this.adsr(g.gain, t, d, .16 * v, .002, .35, .2, .08);
        const lp = this.filt('lowpass', 3800, 2); lp.connect(g);
        lp.frequency.setTargetAtTime(900, t, .12);
        this.osc('sawtooth', f, t, end).connect(lp);
        const s = this.gain(.4); s.connect(lp); this.osc('square', f * 2, t, end).connect(s);
        break;
      }
      case 'dist': {
        end = this.adsr(g.gain, t, d, .07 * v, .003, .3, .75, .06);
        const lp = this.filt('lowpass', 3200, .8); lp.connect(g);
        const ws = ctx.createWaveShaper(); ws.curve = this.distCurve; ws.oversample = '2x'; ws.connect(lp);
        const pre = this.gain(2.5); pre.connect(ws);
        [-6, 6].forEach(c => { const o = this.osc('sawtooth', f, t, end); o.detune.value = c; o.connect(pre); });
        break;
      }
      case 'lead': {
        end = this.adsr(g.gain, t, d, .1 * v, .01, .2, .7, .1);
        const lp = this.filt('lowpass', 2600, 1.5); lp.connect(g);
        const o1 = this.osc('square', f, t, end), o2 = this.osc('sawtooth', f, t, end); o2.detune.value = 7;
        o1.connect(lp); o2.connect(lp);
        this.vibrato([o1, o2], f, t, end);
        break;
      }
      case 'flute': {
        end = this.adsr(g.gain, t, d, .2 * v, .06, .2, .85, .12);
        const o = this.osc('sine', f, t, end); o.connect(g);
        const h = this.gain(.12); h.connect(g); const o2 = this.osc('triangle', f * 2, t, end); o2.connect(h);
        const n = ctx.createBufferSource(); n.buffer = this.noiseBuf; n.loop = true;
        const bp = this.filt('bandpass', f * 2, 2), ng = this.gain(.05 * v);
        n.connect(bp); bp.connect(ng); ng.connect(g); n.start(t); n.stop(end);
        this.vibrato([o, o2], f, t, end);
        break;
      }
      case 'brass': {
        end = this.adsr(g.gain, t, d, .1 * v, .03, .3, .8, .1);
        const lp = this.filt('lowpass', 500, 1.2); lp.connect(g);
        lp.frequency.setValueAtTime(500, t); lp.frequency.linearRampToValueAtTime(3200 * v + 600, t + .07);
        lp.frequency.setTargetAtTime(1800, t + .07, .2);
        [-5, 5].forEach(c => { const o = this.osc('sawtooth', f, t, end); o.detune.value = c; o.connect(lp); });
        break;
      }
      case 'finger': {
        end = this.adsr(g.gain, t, d, .42 * v, .004, .45, .35, .06);
        const lp = this.filt('lowpass', 1100, 1); lp.connect(g);
        lp.frequency.setTargetAtTime(500, t, .2);
        this.osc('triangle', f, t, end).connect(lp);
        const s = this.gain(.6); s.connect(lp); this.osc('sine', f, t, end).connect(s);
        const p = this.gain(.15); p.connect(lp); this.osc('sawtooth', f, t, end).connect(p);
        break;
      }
      case 'synth': {
        end = this.adsr(g.gain, t, d, .22 * v, .005, .3, .6, .05);
        const lp = this.filt('lowpass', 2200, 5); lp.connect(g);
        lp.frequency.setTargetAtTime(420, t, .09);
        this.osc('sawtooth', f, t, end).connect(lp);
        const s = this.gain(.8); s.connect(g); this.osc('sine', f, t, end).connect(s);
        break;
      }
      case 'sub': default: {
        end = this.adsr(g.gain, t, d, .45 * v, .01, .3, .9, .05);
        this.osc('sine', f, t, end).connect(g);
        const s = this.gain(.15); s.connect(g); this.osc('triangle', f * 2, t, end).connect(s);
      }
    }
  }

  vibrato(oscs, f, t, end) {
    const lfo = this.osc('sine', 5.5, t, end), lg = this.gain(0);
    lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(f * .006, t + .45);
    lfo.connect(lg); oscs.forEach(o => lg.connect(o.frequency));
  }

  noise(t, dur) { const n = this.ctx.createBufferSource(); n.buffer = this.noiseBuf; n.start(t, Math.random() * .5); n.stop(t + dur); return n; }
  hit(src, g, t, peak, dec) { g.gain.setValueAtTime(peak, t); g.gain.exponentialRampToValueAtTime(.0008, t + dec); src.connect(g); }

  drum(k, t, v) {
    const out = this.bus.drums;
    switch (k) {
      case 'kick': {
        const o = this.osc('sine', 150, t, t + .5); o.frequency.exponentialRampToValueAtTime(45, t + .12);
        const g = this.gain(); g.connect(out); this.hit(o, g, t, 1 * v, .45);
        const c = this.noise(t, .02), hp = this.filt('highpass', 3000), cg = this.gain(); c.connect(hp); cg.connect(out); this.hit(hp, cg, t, .25 * v, .02);
        break;
      }
      case 'snare': {
        const n = this.noise(t, .25), hp = this.filt('highpass', 1300), g = this.gain(); n.connect(hp); g.connect(out); this.hit(hp, g, t, .55 * v, .2);
        const o = this.osc('triangle', 190, t, t + .15); o.frequency.exponentialRampToValueAtTime(150, t + .1);
        const og = this.gain(); og.connect(out); this.hit(o, og, t, .5 * v, .11);
        break;
      }
      case 'clap': {
        const n = this.noise(t, .3), bp = this.filt('bandpass', 1400, .9), g = this.gain(); n.connect(bp); bp.connect(g); g.connect(out);
        g.gain.setValueAtTime(0, t);
        [0, .011, .022].forEach(o => { g.gain.setValueAtTime(.7 * v, t + o); g.gain.exponentialRampToValueAtTime(.08, t + o + .009); });
        g.gain.setValueAtTime(.6 * v, t + .033); g.gain.exponentialRampToValueAtTime(.0008, t + .25);
        break;
      }
      case 'hat': case 'ohat': {
        const n = this.noise(t, .4), hp = this.filt('highpass', 7500), g = this.gain(); n.connect(hp); g.connect(out);
        this.hit(hp, g, t, (k === 'hat' ? .22 : .26) * v, k === 'hat' ? .05 : .32);
        break;
      }
      case 'crash': {
        const n = this.noise(t, 1.8), hp = this.filt('highpass', 4500), g = this.gain(); n.connect(hp); g.connect(out); this.hit(hp, g, t, .3 * v, 1.7);
        break;
      }
      case 'tomH': case 'tomL': {
        const f = k === 'tomH' ? 210 : 125;
        const o = this.osc('sine', f, t, t + .4); o.frequency.exponentialRampToValueAtTime(f * .7, t + .25);
        const g = this.gain(); g.connect(out); this.hit(o, g, t, .75 * v, .35);
        break;
      }
    }
  }

  click(t, accent) {
    const o = this.osc('square', accent ? 1760 : 1100, t, t + .05), g = this.gain(); g.connect(this.bus.click);
    this.hit(o, g, t, accent ? .35 : .22, .035);
  }
}

export function lowerBound(ev, t) {
  let lo = 0, hi = ev.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (ev[m].t < t - 1e-6) lo = m + 1; else hi = m; }
  return lo;
}
