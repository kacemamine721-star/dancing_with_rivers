import { isRouteErrorResponse, Link, useRouteError } from 'react-router-dom';

import { buttonVariants } from '@/components/ui/button';

/** Router-level error element (failed lazy chunk, thrown render error outside a boundary). */
export function RouteError() {
  const error = useRouteError();
  const detail = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : 'Unknown error';

  return (
    <main className="flex min-h-[100svh] items-center justify-center bg-bg px-4 text-ink">
      <section role="alert" className="glass max-w-md p-6">
        <p className="kicker text-alert">Signal lost</p>
        <h1 className="mt-2 text-2xl font-bold">Something went wrong</h1>
        <p className="mt-2 break-words font-mono text-xs text-mute">{detail}</p>
        <div className="mt-5 flex gap-2">
          <a href="/" className={buttonVariants({ variant: 'primary' })} onClick={() => window.location.reload()}>
            Reload
          </a>
          <Link to="/story/1" className={buttonVariants()}>
            Back to the story
          </Link>
        </div>
      </section>
    </main>
  );
}
