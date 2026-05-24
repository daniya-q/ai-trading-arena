/**
 * Space ambient hum generated procedurally via Web Audio API.
 * No audio files needed. Requires a user gesture before starting.
 */

let audioCtx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let running = false;

export function startAmbience(): void {
  if (running) return;

  try {
    audioCtx = new AudioContext();

    // Master volume ramps from 0 → 0.04 over 3 seconds
    masterGain = audioCtx.createGain();
    masterGain.gain.setValueAtTime(0, audioCtx.currentTime);
    masterGain.gain.linearRampToValueAtTime(
      0.04,
      audioCtx.currentTime + 3
    );
    masterGain.connect(audioCtx.destination);

    // Three harmonic drone tones: A1 (55 Hz), E2 (82 Hz), A2 (110 Hz)
    [55, 82, 110].forEach((freq, i) => {
      const ctx = audioCtx!;

      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;

      const oscGain = ctx.createGain();
      oscGain.gain.value = 0.35 / (i + 1);

      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 700;
      filter.Q.value = 1.5;

      // Slow LFO for gentle pitch wobble (±0.5%)
      const lfo = ctx.createOscillator();
      lfo.type = "sine";
      lfo.frequency.value = 0.04 + i * 0.025;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = freq * 0.005;

      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);

      osc.connect(filter);
      filter.connect(oscGain);
      oscGain.connect(masterGain!);

      lfo.start();
      osc.start();
    });

    running = true;
  } catch (err) {
    console.warn("[SpaceAmbience] AudioContext unavailable:", err);
  }
}

export function stopAmbience(): void {
  if (!running || !masterGain || !audioCtx) return;

  const ctxRef = audioCtx;

  // Fade out over 1.5 seconds, then close context
  masterGain.gain.linearRampToValueAtTime(
    0,
    ctxRef.currentTime + 1.5
  );

  setTimeout(() => {
    ctxRef.close().catch(() => {});
    audioCtx = null;
    masterGain = null;
    running = false;
  }, 1700);
}
