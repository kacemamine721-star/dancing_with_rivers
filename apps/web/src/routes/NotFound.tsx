import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

export function NotFoundContent() {
  return (
    <div className="flex min-h-[calc(100svh-62px)] items-center justify-center px-4">
      <section aria-labelledby="nf-title" className="glass max-w-md p-6 text-center">
        <p className="kicker">404 · No signal</p>
        <h1 id="nf-title" className="mt-2 text-2xl font-bold">
          This page is not in the story
        </h1>
        <p className="mt-2 text-mute">The link may be old, or the act or dam does not exist.</p>
        <Button variant="primary" className="mt-5" asChild>
          <Link to="/story/1">Back to the story</Link>
        </Button>
      </section>
    </div>
  );
}

export function Component() {
  useDocumentTitle('Not found');
  return <NotFoundContent />;
}
