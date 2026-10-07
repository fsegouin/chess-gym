import type { PieceSymbol, Square } from "chess.js";
import type { PieceFinish } from "./scene/textures";

export type SoundKind = "move" | "capture" | "castle" | "check" | "end" | "alert";

/** Which piece lands where; shapes the sound so moves do not all sound alike. */
export interface SoundDetail {
  piece?: PieceSymbol;
  to?: Square;
}

/**
 * A piece set down on a board is a very short noise burst exciting a few low-Q wooden
 * resonances (the board around 400 and 600 Hz, the piece higher up), damped almost at once by
 * felt, with a quick second contact as the piece settles. The profile was measured from real
 * recordings; everything is synthesised here, so there are no audio files.
 */
interface Resonance {
  f: number;
  q: number;
  gain: number;
}

interface Voice {
  resonances: Resonance[];
  /** Felt damping: everything above this is rolled off. */
  feltHz: number;
}

const BASE: Resonance[] = [
  { f: 400, q: 10, gain: 1.6 },
  { f: 610, q: 12, gain: 0.9 },
  { f: 1180, q: 9, gain: 0.25 },
  { f: 1900, q: 4, gain: 0.02 },
  { f: 150, q: 3.5, gain: 0.95 },
];

/** Theme materials only shift and tilt the resonances. */
function voice(shift: number, bright: number, felt: number): Voice {
  return {
    resonances: BASE.map((r, i) => ({ ...r, f: r.f * shift, gain: r.gain * (i >= 2 && i <= 3 ? bright : 1) })),
    feltHz: felt,
  };
}

const VOICES: Record<PieceFinish, Voice> = {
  wood: voice(1, 1, 1900),
  ceramic: voice(1.18, 1.35, 2700),
  metal: voice(1.1, 1.2, 2500),
  stone: voice(1.05, 1.1, 2150),
  clay: voice(0.88, 0.75, 1600),
};

/** Where placements are written: the live graph, or an offline context for measurement. */
interface Output {
  ac: BaseAudioContext;
  dry: AudioNode;
  wet: AudioNode | null;
  noise: AudioBuffer;
}

let live: Output | null = null;
let current: Voice = VOICES.wood;

function noiseBuffer(ac: BaseAudioContext): AudioBuffer {
  const noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return noise;
}

/** A small, dark room: decaying noise smoothed so it does not hiss. */
function roomImpulse(ac: BaseAudioContext): AudioBuffer {
  const length = Math.floor(ac.sampleRate * 0.3);
  const buffer = ac.createBuffer(2, length, ac.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    let smooth = 0;
    for (let i = 0; i < length; i++) {
      smooth = smooth * 0.6 + (Math.random() * 2 - 1) * 0.4;
      data[i] = smooth * Math.exp(-i / (ac.sampleRate * 0.06));
    }
  }
  return buffer;
}

function getLive(): Output | null {
  if (typeof window === "undefined") return null;
  if (!live) {
    let ac: AudioContext;
    try {
      ac = new AudioContext();
    } catch {
      return null;
    }
    const compressor = ac.createDynamicsCompressor();
    compressor.threshold.value = -14;
    compressor.ratio.value = 3;
    compressor.attack.value = 0.001;
    compressor.release.value = 0.08;
    const master = ac.createGain();
    master.connect(compressor).connect(ac.destination);
    const dry = ac.createGain();
    dry.gain.value = 0.96;
    dry.connect(master);
    const convolver = ac.createConvolver();
    convolver.buffer = roomImpulse(ac);
    const wet = ac.createGain();
    wet.gain.value = 0.04;
    wet.connect(convolver).connect(master);
    live = { ac, dry, wet, noise: noiseBuffer(ac) };
  }
  const ac = live.ac as AudioContext;
  // Mobile browsers start the context suspended until a user gesture.
  if (ac.state === "suspended") void ac.resume();
  return live;
}

/** Call from a user gesture so later sounds are allowed to play. */
export function unlockAudio(): void {
  getLive();
}

/** Voices the pieces to match the board theme's material. */
export function setSoundMaterial(finish: PieceFinish): void {
  current = VOICES[finish];
}

const rand = (min: number, max: number) => min + Math.random() * (max - min);

/** Heavier pieces sit lower and carry more of the board's body; a pawn is light and higher. */
const WEIGHT: Record<PieceSymbol, { shift: number; body: number }> = {
  p: { shift: 1.12, body: 0.75 },
  n: { shift: 1.0, body: 1.0 },
  b: { shift: 1.02, body: 0.95 },
  r: { shift: 0.95, body: 1.1 },
  q: { shift: 0.92, body: 1.15 },
  k: { shift: 0.9, body: 1.2 },
};

/** 0 at the centre of the board, 1 in a corner: edges ring tighter and brighter. */
function edgeness(square: Square | undefined): number {
  if (!square) return 0.5;
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]) - 1;
  return Math.min(1, Math.hypot(file - 3.5, rank - 3.5) / Math.hypot(3.5, 3.5));
}

/** One contact: a burst of noise a couple of milliseconds long, shared by every resonance. */
function contact(o: Output, t: number, bus: AudioNode, amp: number, length = 0.0016): void {
  const src = o.ac.createBufferSource();
  src.buffer = o.noise;
  const env = o.ac.createGain();
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(amp, t + 0.0004);
  env.gain.setTargetAtTime(0, t + 0.0004, length);
  src.connect(env).connect(bus);
  // A random start in the noise buffer makes every contact slightly different.
  src.start(t, Math.random() * 0.9);
  src.stop(t + 0.02);
}

/**
 * A piece meeting the board. `force` scales loudness and brightness; `shift` moves the
 * resonances. The piece and square shape the sound, and every placement varies its resonances,
 * contact length and settle, within the range measured from real recordings.
 */
function place(o: Output, t: number, force = 1, shift = 1, detail: SoundDetail = {}): void {
  const v = current;
  const weight = WEIGHT[detail.piece ?? "n"];
  const edge = edgeness(detail.to);
  const f = force * rand(0.85, 1.15);
  const s = shift * weight.shift * (1 + (edge - 0.5) * 0.14) * rand(0.94, 1.06);
  const body = weight.body * (1.1 - 0.25 * edge);

  // Two gentle low-passes in series: felt and wood swallow the highs steeply.
  const feltHz = v.feltHz * (0.85 + 0.25 * Math.min(f, 1.4));
  const felt = o.ac.createBiquadFilter();
  felt.type = "lowpass";
  felt.frequency.value = feltHz;
  felt.Q.value = 0.6;
  const felt2 = o.ac.createBiquadFilter();
  felt2.type = "lowpass";
  felt2.frequency.value = feltHz;
  felt2.Q.value = 0.6;
  const out = o.ac.createGain();
  out.gain.value = 6 * f;
  felt.connect(felt2).connect(out).connect(o.dry);
  if (o.wet) out.connect(o.wet);

  const exciter = o.ac.createGain();
  v.resonances.forEach((r, i) => {
    const filter = o.ac.createBiquadFilter();
    filter.type = "bandpass";
    // Each mode moves on its own, so the balance between them changes from move to move.
    filter.frequency.value = r.f * s * rand(0.93, 1.07);
    filter.Q.value = r.q * rand(0.8, 1.2);
    const g = o.ac.createGain();
    // The two board modes and the low thud follow the board body; the rest is the piece.
    const isBody = i < 2 || i === v.resonances.length - 1;
    g.gain.value = r.gain * rand(0.75, 1.25) * (isBody ? body : 1);
    exciter.connect(filter).connect(g).connect(felt);
  });

  contact(o, t, exciter, 1, rand(0.0011, 0.0024));
  // How the piece settles: usually a quick second contact, sometimes a faint rattle as well,
  // now and then a clean single tap.
  const settle = Math.random();
  if (settle < 0.88) contact(o, t + rand(0.0035, 0.008), exciter, rand(0.4, 0.95), rand(0.0009, 0.0018));
  if (settle < 0.25) contact(o, t + rand(0.012, 0.02), exciter, rand(0.12, 0.28), 0.0009);
}

/** Renders one placement offline, for measuring the sound against reference recordings. */
export async function renderPlacement(force = 1, detail: SoundDetail = {}): Promise<Float32Array> {
  const ac = new OfflineAudioContext(1, Math.floor(48000 * 0.2), 48000);
  place({ ac, dry: ac.destination, wet: null, noise: noiseBuffer(ac) }, 0.004, force, 1, detail);
  return (await ac.startRendering()).getChannelData(0);
}

/** A soft, rounded tone for interface cues that are not board sounds. */
function cue(o: Output, t: number, f: number, gain: number, decay: number): void {
  const osc = o.ac.createOscillator();
  osc.type = "sine";
  osc.frequency.value = f;
  const env = o.ac.createGain();
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(gain, t + 0.02);
  env.gain.setTargetAtTime(0, t + 0.02, decay);
  osc.connect(env).connect(o.dry);
  osc.start(t);
  osc.stop(t + decay * 8);
}

export function playSound(kind: SoundKind, detail: SoundDetail = {}): void {
  const g = getLive();
  if (!g) return;
  const t = g.ac.currentTime + 0.005;
  switch (kind) {
    case "move":
      place(g, t, 1, 1, detail);
      break;
    case "capture":
      // The captured piece is knocked first, then the capturing piece lands on its square.
      place(g, t, 0.55, 1.2, { to: detail.to });
      place(g, t + 0.07, 1.1, 0.95, detail);
      break;
    case "castle":
      // King first, then the rook beside it.
      place(g, t, 0.95, 1, { piece: "k", to: detail.to });
      place(g, t + 0.14, 0.85, 1, { piece: "r", to: detail.to });
      break;
    case "check":
      place(g, t, 1.25, 0.95, detail);
      break;
    case "end":
      place(g, t, 1.35, 0.9, detail);
      break;
    case "alert":
      // The coach wants a word: two quiet, falling tones, clearly not a board sound.
      cue(g, t, 587.33, 0.045, 0.09);
      cue(g, t + 0.14, 440, 0.045, 0.12);
      break;
  }
}
