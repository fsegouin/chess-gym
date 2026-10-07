export type SoundKind = "move" | "capture" | "check" | "end" | "alert";

let ctx: AudioContext | null = null;

function context(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    try {
      ctx = new AudioContext();
    } catch {
      return null;
    }
  }
  // Mobile browsers start the context suspended until a user gesture.
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** Call from a user gesture so later sounds are allowed to play. */
export function unlockAudio(): void {
  context();
}

/** A short filtered noise burst, close to a wooden piece being set down. */
function knock(ac: AudioContext, at: number, freq: number, gain: number): void {
  const length = Math.floor(ac.sampleRate * 0.08);
  const buffer = ac.createBuffer(1, length, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 4);
  const src = ac.createBufferSource();
  src.buffer = buffer;
  const filter = ac.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = freq;
  filter.Q.value = 1.6;
  const g = ac.createGain();
  g.gain.value = gain;
  src.connect(filter).connect(g).connect(ac.destination);
  src.start(at);
}

function tone(ac: AudioContext, at: number, freq: number, duration: number, gain: number): void {
  const osc = ac.createOscillator();
  osc.type = "sine";
  osc.frequency.value = freq;
  const g = ac.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(gain, at + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  osc.connect(g).connect(ac.destination);
  osc.start(at);
  osc.stop(at + duration + 0.05);
}

export function playSound(kind: SoundKind): void {
  const ac = context();
  if (!ac) return;
  const t = ac.currentTime + 0.01;
  switch (kind) {
    case "move":
      knock(ac, t, 1400, 0.9);
      break;
    case "capture":
      knock(ac, t, 1100, 1);
      knock(ac, t + 0.06, 1700, 0.7);
      break;
    case "check":
      knock(ac, t, 1400, 0.8);
      tone(ac, t + 0.02, 880, 0.25, 0.08);
      break;
    case "end":
      tone(ac, t, 523, 0.5, 0.08);
      tone(ac, t + 0.12, 659, 0.5, 0.07);
      tone(ac, t + 0.24, 784, 0.7, 0.07);
      break;
    case "alert":
      tone(ac, t, 330, 0.3, 0.09);
      tone(ac, t + 0.14, 262, 0.4, 0.08);
      break;
  }
}
