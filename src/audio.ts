/** Tiny synthesised sound effects so we don't need asset files. */
export class Audio {
  ctx: AudioContext;
  master: GainNode;
  hum: GainNode | null = null;

  constructor() {
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
  }

  private noise(dur: number) {
    const buf = this.ctx.createBuffer(1, Math.floor(this.ctx.sampleRate * dur), this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    return src;
  }

  private env(g: GainNode, a: number, peak: number, r: number) {
    const t = this.ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + r);
  }

  push() {
    const n = this.noise(0.4);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 500;
    const g = this.ctx.createGain();
    this.env(g, 0.05, 0.25, 0.3);
    n.connect(f).connect(g).connect(this.master);
    n.start();
  }

  bump(strength: number) {
    const o = this.ctx.createOscillator();
    o.frequency.value = 70;
    const g = this.ctx.createGain();
    this.env(g, 0.005, Math.min(0.6, strength * 0.2), 0.25);
    o.connect(g).connect(this.master);
    o.start();
    o.stop(this.ctx.currentTime + 0.3);
  }

  clunk() {
    const o = this.ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(140, this.ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(50, this.ctx.currentTime + 0.15);
    const f = this.ctx.createBiquadFilter();
    f.frequency.value = 400;
    const g = this.ctx.createGain();
    this.env(g, 0.005, 0.3, 0.2);
    o.connect(f).connect(g).connect(this.master);
    o.start();
    o.stop(this.ctx.currentTime + 0.3);
  }

  click() {
    const o = this.ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = 1800;
    const g = this.ctx.createGain();
    this.env(g, 0.001, 0.12, 0.03);
    o.connect(g).connect(this.master);
    o.start();
    o.stop(this.ctx.currentTime + 0.05);
  }

  beep(freq = 880, dur = 0.12) {
    const o = this.ctx.createOscillator();
    o.frequency.value = freq;
    const g = this.ctx.createGain();
    this.env(g, 0.01, 0.15, dur);
    o.connect(g).connect(this.master);
    o.start();
    o.stop(this.ctx.currentTime + dur + 0.05);
  }

  hiss(dur = 2) {
    const n = this.noise(dur);
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 2500;
    const g = this.ctx.createGain();
    this.env(g, 0.2, 0.2, dur - 0.2);
    n.connect(f).connect(g).connect(this.master);
    n.start();
  }

  paper() {
    const n = this.noise(0.25);
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 3000;
    const g = this.ctx.createGain();
    this.env(g, 0.02, 0.2, 0.2);
    n.connect(f).connect(g).connect(this.master);
    n.start();
  }

  /** Background station fan hum; level 0..1 */
  setHum(level: number) {
    if (!this.hum) {
      const n = this.noise(4);
      n.loop = true;
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 220;
      this.hum = this.ctx.createGain();
      this.hum.gain.value = 0;
      n.connect(f).connect(this.hum).connect(this.master);
      n.start();
    }
    this.hum.gain.setTargetAtTime(level * 0.12, this.ctx.currentTime, 0.5);
  }
}
