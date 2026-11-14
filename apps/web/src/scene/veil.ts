/**
 * Full-screen veils owned by the persistent Stage (they survive route changes):
 *  - `flash`: the dive's white flash (prototype `#flash`), driven per frame from the intro runtime;
 *  - `fade`: a black crossfade used for camera/scene CUTS under reduced motion (300 ms total).
 */
export const CUT_MS = 300;

class Veil {
  flashEl: HTMLDivElement | null = null;
  fadeEl: HTMLDivElement | null = null;
  private timers: ReturnType<typeof setTimeout>[] = [];

  setFlash(opacity: number): void {
    const el = this.flashEl;
    if (!el) return;
    const v = opacity < 0.002 ? '0' : opacity.toFixed(3);
    if (el.style.opacity !== v) el.style.opacity = v;
  }

  /** Fade to black, run `fn` (the cut), fade back. Without a veil element it just runs `fn`. */
  cut(fn: () => void): void {
    const el = this.fadeEl;
    if (!el) {
      fn();
      return;
    }
    this.timers.forEach(clearTimeout);
    // Web Animations API: not flattened by the global reduced-motion CSS rule.
    el.animate([{ opacity: 0 }, { opacity: 1 }, { opacity: 0 }], { duration: CUT_MS, easing: 'linear' });
    this.timers = [setTimeout(fn, CUT_MS / 2)];
  }
}

export const veil = new Veil();
