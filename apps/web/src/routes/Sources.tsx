import { ExternalLink } from 'lucide-react';

import { DataState } from '@/components/DataState';
import { dataStateForError } from '@/components/data-state-model';
import { useSources } from '@/data/hooks';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { DocPage } from '@/routes/DocPage';

/** `/sources` — data credits, read from story/sources.json. */
export function Component() {
  useDocumentTitle('Sources');
  const sources = useSources();

  return (
    <DocPage kicker="Sources & data credits" title="Where every number comes from">
      {sources.isPending ? <DataState kind="loading" subject="Sources" /> : null}
      {sources.isError ? (
        <DataState
          kind={dataStateForError(sources.error).kind}
          subject="Sources"
          {...(dataStateForError(sources.error).retryable ? { onRetry: () => void sources.refetch() } : {})}
        />
      ) : null}
      {sources.data ? (
        sources.data.sources.length === 0 ? (
          <DataState kind="missing" subject="Sources" message="No sources are listed in this data bundle yet." />
        ) : (
          <ul className="divide-y divide-hairline">
            {sources.data.sources.map((s) => (
              <li key={s.id} className="flex items-start justify-between gap-4 py-3">
                <div>
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1.5"
                  >
                    {s.title}
                    <ExternalLink aria-hidden className="size-3" />
                    <span className="sr-only">(opens in a new tab)</span>
                  </a>
                </div>
                <span className="shrink-0 font-mono text-[10.5px] uppercase tracking-badge text-mute">{s.kind}</span>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </DocPage>
  );
}
