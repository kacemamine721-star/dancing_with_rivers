import * as SliderPrimitive from '@radix-ui/react-slider';
import * as React from 'react';

import { cn } from '@/lib/utils';

export interface SliderProps extends React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root> {
  /** Accessible name for the thumb(s). */
  thumbLabel?: string;
  /** Human-readable value for screen readers (e.g. "19 June 2026, NISAR track D80"). */
  valueText?: string;
}

export const Slider = React.forwardRef<React.ElementRef<typeof SliderPrimitive.Root>, SliderProps>(
  ({ className, thumbLabel, valueText, ...props }, ref) => {
    const count = (props.value ?? props.defaultValue ?? [0]).length;
    return (
      <SliderPrimitive.Root
        ref={ref}
        className={cn(
          'relative flex w-full touch-none select-none items-center py-2 data-[disabled]:opacity-50',
          className,
        )}
        {...props}
      >
        <SliderPrimitive.Track className="relative h-1 w-full grow overflow-hidden rounded-pill bg-ink/15">
          <SliderPrimitive.Range className="absolute h-full bg-teal" />
        </SliderPrimitive.Track>
        {Array.from({ length: count }, (_, i) => (
          <SliderPrimitive.Thumb
            key={i}
            aria-label={thumbLabel}
            aria-valuetext={valueText}
            className={cn(
              'block size-4 cursor-grab rounded-full border-2 border-teal bg-bg shadow-[0_0_10px_rgba(26,34,180,.5)]',
              'transition-transform duration-ui hover:scale-110 active:cursor-grabbing',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal',
            )}
          />
        ))}
      </SliderPrimitive.Root>
    );
  },
);
Slider.displayName = SliderPrimitive.Root.displayName;
