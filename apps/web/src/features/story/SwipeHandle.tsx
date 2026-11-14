import { SlidersHorizontal } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/app';

interface SwipeHandleProps {
  className?: string;
}

export function SwipeHandle({ className }: SwipeHandleProps) {
  const swipe = useAppStore((s) => s.swipe);
  const setSwipe = useAppStore((s) => s.setSwipe);
  const compareDate = useAppStore((s) => s.compareDate) ?? '2026-06-17';
  const currentDate = useAppStore((s) => s.date);

  return (
    <div
      className={cn(
        'glass pointer-events-auto flex flex-col gap-2 rounded-xl border border-white/10 bg-[rgba(6,12,20,.85)] p-3 text-ink backdrop-blur-md',
        className,
      )}
    >
      <div className="flex items-center justify-between font-mono text-[11px]">
        <div className="flex items-center gap-1.5 text-mute">
          <SlidersHorizontal className="size-3 text-teal" />
          <span className="uppercase tracking-wider">Radar Swipe</span>
        </div>
        <div className="flex items-center gap-1">
          <Button size="xs" variant="ghost" className="h-5 px-1.5 text-[9.5px]" onClick={() => setSwipe(0)}>
            Before
          </Button>
          <Button size="xs" variant="ghost" className="h-5 px-1.5 text-[9.5px]" onClick={() => setSwipe(0.5)}>
            50%
          </Button>
          <Button size="xs" variant="ghost" className="h-5 px-1.5 text-[9.5px]" onClick={() => setSwipe(1)}>
            After
          </Button>
        </div>
      </div>

      <div className="px-1">
        <Slider
          min={0}
          max={1}
          step={0.01}
          value={[swipe]}
          onValueChange={(val) => setSwipe(val[0] ?? 0.5)}
          thumbLabel="Before / After swipe"
        />
      </div>

      <div className="flex justify-between font-mono text-[10px] tracking-wide text-mute">
        <span className="text-[#a5b9d4]">
          ◀ S1 ({compareDate})
        </span>
        <span className="text-teal">
          NISAR ({currentDate}) ▶
        </span>
      </div>
    </div>
  );
}
