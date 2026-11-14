/** Optional drone + pings + whoosh (prototype `sound`), WebAudio only, off by default. */
type Win = Window & { webkitAudioContext?: typeof AudioContext };

class IntroSound {
  private ctx: AudioContext | null = null;
  on = false;
  private lastPing = 0;
  private whooshed = false;

  private start(): void {
    const AC = window.AudioContext ?? (window as Win).webkitAudioContext;
    if (!AC) throw new Error('no WebAudio');
    const ctx = new AC();
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 180;
    lp.connect(master);
    for (const f of [43.65, 43.9, 65.4]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = 0.12;
      o.connect(g);
      g.connect(lp);
      o.start();
    }
    master.gain.linearRampToValueAtTime(0.35, ctx.currentTime + 2);
  }

  private ping(): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(1500, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(420, ctx.currentTime + 0.35);
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.6);
  }

  private whoosh(): void {
    const ctx = this.ctx!;
    const n = ctx.sampleRate * 1.4;
    const b = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const s = ctx.createBufferSource();
    s.buffer = b;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 0.8;
    f.frequency.setValueAtTime(300, ctx.currentTime);
    f.frequency.exponentialRampToValueAtTime(3500, ctx.currentTime + 1.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.35, ctx.currentTime + 0.9);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.4);
    s.connect(f);
    f.connect(g);
    g.connect(ctx.destination);
    s.start();
  }

  toggle(): boolean {
    this.on = !this.on;
    try {
      if (this.on && !this.ctx) this.start();
      else if (this.ctx) void (this.on ? this.ctx.resume() : this.ctx.suspend());
    } catch {
      this.on = false;
    }
    return this.on;
  }

  update(tt: number, mode: string): void {
    if (!this.on || !this.ctx) return;
    if (mode === 'intro' && tt > 8.6 && tt - this.lastPing > 0.9) {
      this.lastPing = tt;
      this.ping();
    }
    if (mode === 'dive' && tt > 0.6 && !this.whooshed) {
      this.whooshed = true;
      this.whoosh();
    }
  }

  reset(): void {
    this.lastPing = 0;
    this.whooshed = false;
  }

  stop(): void {
    if (this.ctx && this.on) void this.ctx.suspend();
  }
}

export const introSound = new IntroSound();
