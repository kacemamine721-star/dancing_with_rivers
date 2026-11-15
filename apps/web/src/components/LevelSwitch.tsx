import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import { type Level, useAppStore } from '@/store/app';

// TODO(i18n, M4): labels move to locales/en/common.json.
const LABELS: Record<Level, string> = { everyone: 'Simplified', experts: 'Advanced' };

/**
 * Everyone / Experts reading level (prototype `.lvl`). Writes the store (persisted to
 * localStorage by the store, mirrored to the URL as `lvl=` by useUrlSync).
 */
export function LevelSwitch({ className }: { className?: string }) {
  const level = useAppStore((s) => s.level);
  const setLevel = useAppStore((s) => s.setLevel);

  return (
    <ToggleGroup
      type="single"
      size="sm"
      value={level}
      onValueChange={(v) => {
        // Radix emits "" when the active item is clicked again; keep one level selected.
        if (v === 'everyone' || v === 'experts') setLevel(v);
      }}
      aria-label="Reading level"
      className={cn('gap-1', className)}
    >
      {(Object.keys(LABELS) as Level[]).map((l) => (
        <ToggleGroupItem key={l} value={l} aria-label={`${LABELS[l]} level`} className="h-7 px-[11px] text-[11px]">
          {LABELS[l]}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
