import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { DocPage } from '@/routes/DocPage';

/** `/school` — Radar School (Radar Lab, three surfaces, quiz), ported from the prototype later. */
export function Component() {
  useDocumentTitle('Radar School');
  return (
    <DocPage kicker="Radar School" title="How radar sees water, soil and towns">
      <p className="text-ink/85">
        The Radar Lab, the three surfaces and the quiz are ported from the prototype in a later milestone.
      </p>
    </DocPage>
  );
}
