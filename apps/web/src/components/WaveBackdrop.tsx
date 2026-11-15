/**
 * Organic ultramarine "wave" shapes (visual_reference.jpg) at the edges of the text pages.
 * Decorative only (aria-hidden), fixed behind the content, drifting slowly (off under reduced motion).
 */
export function WaveBackdrop() {
  return (
    <div className="wave-backdrop" aria-hidden>
      {/* top right: a river-like band curling off the corner */}
      <svg viewBox="0 0 600 600" className="wave-drift -right-[180px] -top-[200px] w-[620px] max-w-[90vw] opacity-95">
        <path
          fill="#1A22B4"
          d="M600 0H330c-38 0-70 26-74 64-6 52 40 76 30 122-9 42-62 52-74 96-14 52 26 92 78 98 56 7 86-36 132-34 42 2 58 44 98 52 34 7 80-14 80-60z"
        />
        <path fill="#1A22B4" d="M210 70c34-4 58 22 54 52-5 34-44 40-46 74-2 30-40 40-58 18-20-24 2-52-10-80-11-28 22-60 60-64z" />
      </svg>
      {/* bottom left: a wave rising from the corner */}
      <svg viewBox="0 0 600 600" className="wave-drift -bottom-[220px] -left-[200px] w-[640px] max-w-[95vw] opacity-95 [animation-delay:-6s]">
        <path
          fill="#1A22B4"
          d="M0 600V250c40-22 92-14 112 30 22 48-10 98 26 134 34 34 92 6 128 38 40 36 8 98 46 128 22 17 52 18 72 20z"
        />
        <path fill="#1A22B4" d="M300 330c30-14 66 6 70 40 4 30-22 46-20 76 2 26-30 42-52 26-26-18-14-50-30-74-16-24 2-56 32-68z" />
      </svg>
      {/* a small drop, mid right */}
      <svg viewBox="0 0 120 120" className="wave-drift right-[4vw] top-[58vh] hidden w-[86px] opacity-90 [animation-delay:-3s] lg:block">
        <path fill="#1A22B4" d="M60 6c30 0 54 26 52 56-2 32-30 52-58 50C26 110 6 86 10 58 14 28 30 6 60 6z" />
      </svg>
    </div>
  );
}
