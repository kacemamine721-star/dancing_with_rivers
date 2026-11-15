import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { DocPage } from '@/routes/DocPage';

/** `/methods` — Methods & validation (docs/07 §8), filled in M8. */
export function Component() {
  useDocumentTitle('Methods');
  return (
    <DocPage kicker="Methods & validation" title="How we measure, model and check">
      <p className="text-ink/85">The methods, validation table and honest limits are published here in milestone M8.</p>
    </DocPage>
  );
}
