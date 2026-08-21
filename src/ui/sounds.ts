type NotifyKind = "hint" | "ok" | "warn" | "go";

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  const Ctor =
    window.AudioContext ||
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) {
    return null;
  }
  if (!ctx) {
    ctx = new Ctor();
  }
  return ctx;
}

export function unlockAudio(): void {
  const audio = getCtx();
  if (audio && audio.state === "suspended") {
    void audio.resume();
  }
}

export function playPluck(freq: number, volume: number, velocity = 1): void {
  const audio = getCtx();
  if (!audio || volume <= 0) {
    return;
  }
  if (audio.state === "suspended") {
    void audio.resume();
  }

  const t0 = audio.currentTime;
  const gain =
    Math.max(0.02, Math.min(1, volume)) * Math.min(1, 0.35 + velocity);
  const osc = audio.createOscillator();
  const g = audio.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, t0);
  osc.frequency.exponentialRampToValueAtTime(freq * 0.92, t0 + 0.12);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain * 0.14, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
  osc.connect(g);
  g.connect(audio.destination);
  osc.start(t0);
  osc.stop(t0 + 0.18);
}

export function playNotify(kind: NotifyKind, volume: number): void {
  const audio = getCtx();
  if (!audio || volume <= 0) {
    return;
  }
  if (audio.state === "suspended") {
    void audio.resume();
  }

  const t0 = audio.currentTime;
  const gain = Math.max(0.02, Math.min(1, volume));
  const freq = { ok: 920, hint: 640, go: 760, warn: 390 }[kind];

  const osc = audio.createOscillator();
  const oscGain = audio.createGain();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(freq, t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(120, freq * 0.42), t0 + 0.07);
  oscGain.gain.setValueAtTime(0.0001, t0);
  oscGain.gain.exponentialRampToValueAtTime(gain * 0.2, t0 + 0.008);
  oscGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.09);
  osc.connect(oscGain);
  oscGain.connect(audio.destination);
  osc.start(t0);
  osc.stop(t0 + 0.1);

  const frames = Math.floor(audio.sampleRate * 0.035);
  const buffer = audio.createBuffer(1, frames, audio.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i += 1) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  }
  const noise = audio.createBufferSource();
  noise.buffer = buffer;
  const filter = audio.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = kind === "warn" ? 900 : 2100;
  filter.Q.value = 0.9;
  const noiseGain = audio.createGain();
  noiseGain.gain.setValueAtTime(gain * 0.16, t0);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.04);
  noise.connect(filter);
  filter.connect(noiseGain);
  noiseGain.connect(audio.destination);
  noise.start(t0);
}
