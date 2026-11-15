// Standard MIDI File (format 1) export.
const GM_DRUM = { kick:36, snare:38, clap:39, hat:42, ohat:46, crash:49, tomH:50, tomL:45 };
const PROG = { piano:0, epiano:4, organ:16, guitar:27, dist:29, pad:89, lead:81, flute:73, brass:61, finger:33, synth:38, sub:38 };

const vlq = n => { const b = [n & 0x7f]; while ((n >>= 7)) b.unshift((n & 0x7f) | 0x80); return b; };
const u32 = n => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const txt = (type, s) => { const b = [...s].map(c => c.charCodeAt(0) & 0x7f); return [0xff, type, ...vlq(b.length), ...b]; };

function chunk(evs) {
  evs.sort((a, b) => a.tick - b.tick || a.o - b.o);
  const out = []; let last = 0;
  for (const e of evs) { out.push(...vlq(e.tick - last), ...e.data); last = e.tick; }
  out.push(0, 0xff, 0x2f, 0);
  return [0x4d, 0x54, 0x72, 0x6b, ...u32(out.length), ...out];
}

export function songToMidi(song, bpm, tracks) {
  const PPQ = 480, T = b => Math.max(0, Math.round(b * PPQ));
  const us = Math.round(60000000 / bpm);
  const meta = [
    { tick:0, o:0, data: txt(0x03, song.name || 'Song') },
    { tick:0, o:0, data: [0xff, 0x51, 3, (us >> 16) & 255, (us >> 8) & 255, us & 255] },
    { tick:0, o:0, data: [0xff, 0x58, 4, song.bpb, 2, 24, 8] },
    { tick:0, o:0, data: [0xff, 0x59, 2, song.key.sig & 255, song.key.mode === 'minor' ? 1 : 0] },
    ...song.sections.map(s => ({ tick: T(s.start), o:1, data: txt(0x06, s.label) })),
    ...song.chords.map(c => ({ tick: T(c.t), o:2, data: txt(0x01, c.c.name) })),
  ];
  const chunks = [chunk(meta)];
  const defs = [['keys', 0, 'Chords'], ['melody', 1, 'Melody'], ['bass', 2, 'Bass'], ['drums', 9, 'Drums']];
  for (const [tr, ch, name] of defs) {
    const evs = [{ tick:0, o:0, data: txt(0x03, name) }];
    if (ch !== 9) evs.push({ tick:0, o:0, data: [0xc0 | ch, PROG[tracks[tr].inst] ?? 0] });
    for (const e of song.byTrack[tr]) {
      const notes = tr === 'drums' ? [GM_DRUM[e.k]] : tr === 'keys' ? e.n : [e.m];
      const vel = Math.max(1, Math.min(127, Math.round(e.v * 110)));
      const d = tr === 'drums' ? .1 : e.d;
      for (const n of notes) {
        evs.push({ tick: T(e.t), o:2, data: [0x90 | ch, n, vel] });
        evs.push({ tick: T(e.t + d) - 1, o:1, data: [0x80 | ch, n, 0] });
      }
    }
    chunks.push(chunk(evs));
  }
  const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, chunks.length, (PPQ >> 8) & 255, PPQ & 255];
  return new Uint8Array([...header, ...chunks.flat()]);
}
