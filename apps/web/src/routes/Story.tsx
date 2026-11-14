import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';

import { Badge } from '@/components/Badge';
import { provenanceProps } from '@/components/badge-model';
import { DataState } from '@/components/DataState';
import { dataStateForError } from '@/components/data-state-model';
import { Button } from '@/components/ui/button';
import { useManifest } from '@/data/hooks';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { NotFoundContent } from '@/routes/NotFound';
import { isAct, useAppStore } from '@/store/app';

/**
 * `/story/:act` — M1 placeholder card on top of the persistent stage. Acts become data
 * (features/story/acts/actN.ts) and ActCard lands in M4.
 */
export function Component() {
  const { act: actParam } = useParams();
  const n = Number(actParam);
  const valid = isAct(n);
  useDocumentTitle(valid ? `Act ${n}` : 'Not found');

  const setMode = useAppStore((s) => s.setMode);
  useEffect(() => {
    if (valid) setMode('story');
  }, [valid, setMode]);

  if (!valid) return <NotFoundContent />;
  return <ActPlaceholder act={n} />;
}

function ActPlaceholder({ act }: { act: number }) {
  const date = useAppStore((s) => s.date);
  const manifest = useManifest();
  const layer = manifest.data?.layers.find((l) => l.kind === 'radar' && l.date === date) ?? null;

  return (
    <div className="flex min-h-[calc(100svh-62px)] items-end px-4 pb-8 sm:items-center sm:px-8">
      <section aria-labelledby="act-title" className="glass w-full max-w-[460px] bg-[rgba(6,12,20,.88)] p-[22px]">
        <div className="flex items-center justify-between gap-2">
          <p className="kicker">Act {act} / 9</p>
          {layer ? <Badge {...provenanceProps(layer)} subject={layer.label} /> : null}
        </div>
        <h2 id="act-title" className="mb-2.5 mt-2 text-[clamp(22px,2.2vw,30px)] font-bold leading-tight">
          Act {act}
        </h2>
        <p className="text-[15px] leading-[1.65] text-[#d6e0ee]">The story cards arrive with milestone M4.</p>

        <div className="mt-4">
          {manifest.isPending ? <DataState kind="loading" subject="Layer catalogue" minHeight={40} /> : null}
          {manifest.isError ? (
            <DataState
              {...(() => {
                const s = dataStateForError(manifest.error);
                return { kind: s.kind, ...(s.retryable ? { onRetry: () => void manifest.refetch() } : {}) };
              })()}
              subject="Layer catalogue"
            />
          ) : null}
        </div>

        <nav aria-label="Acts" className="mt-4 flex justify-between gap-2">
          {act > 1 ? (
            <Button size="sm" asChild>
              <Link to={`/story/${act - 1}`}>
                <ArrowLeft aria-hidden /> Previous
              </Link>
            </Button>
          ) : (
            <span />
          )}
          {act < 9 ? (
            <Button size="sm" variant="primary" asChild>
              <Link to={`/story/${act + 1}`}>
                Next <ArrowRight aria-hidden />
              </Link>
            </Button>
          ) : (
            <Button size="sm" variant="primary" asChild>
              <Link to="/watch">Open Dam Watch</Link>
            </Button>
          )}
        </nav>
      </section>
    </div>
  );
}
