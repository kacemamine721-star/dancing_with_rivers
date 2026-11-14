import type { ReactNode } from 'react';

/** Shared layout for the text pages (Methods, Sources, School). */
export function DocPage({ kicker, title, children }: { kicker: string; title: string; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <article aria-labelledby="doc-title" className="glass bg-[rgba(6,12,20,.9)] p-6 sm:p-8">
        <p className="kicker">{kicker}</p>
        <h1 id="doc-title" className="mb-5 mt-2 text-[clamp(26px,3.4vw,40px)] font-bold leading-tight">
          {title}
        </h1>
        {children}
      </article>
    </div>
  );
}
