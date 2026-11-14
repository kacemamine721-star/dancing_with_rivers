import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Pill button ported from the prototype `.btn` (reference/NISAR-HydroStress-Cinematic-Intro.html):
 * JetBrains Mono, uppercase, letter-spacing .14em, glass background, teal on hover.
 * `primary` = teal fill with #021014 text; `chip` = compact Try-it / toolbar chip.
 * Pressed state (aria-pressed or Radix data-state=on) mirrors the prototype `.btn.act`.
 */
export const buttonVariants = cva(
  [
    'inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-pill border',
    'font-mono uppercase leading-none tracking-btn',
    'transition-[border-color,background-color,color] duration-ui',
    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal',
    'disabled:pointer-events-none disabled:opacity-45',
    '[&_svg]:pointer-events-none [&_svg]:size-3.5 [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        ghost: [
          'border-ink/20 bg-[rgba(10,18,30,.55)] text-ink backdrop-blur-[6px]',
          'hover:border-teal hover:text-teal',
          'aria-pressed:border-teal aria-pressed:bg-teal aria-pressed:text-on-teal',
          'data-[state=on]:border-teal data-[state=on]:bg-teal data-[state=on]:text-on-teal',
        ],
        primary: ['border-teal bg-teal font-semibold text-on-teal', 'hover:bg-[#9ff8ff] hover:text-on-teal'],
        chip: [
          'border-teal/35 bg-teal/[.06] text-ink backdrop-blur-[6px]',
          'hover:border-teal hover:text-teal',
          'aria-pressed:border-teal aria-pressed:bg-teal aria-pressed:text-on-teal',
          'data-[state=on]:border-teal data-[state=on]:bg-teal data-[state=on]:text-on-teal',
        ],
      },
      size: {
        md: 'h-9 px-[15px] text-[12px]',
        sm: 'h-[30px] px-[11px] text-[11px]',
        xs: 'h-6 px-[9px] text-[10px]',
        icon: 'size-9 p-0 text-[12px]',
      },
    },
    defaultVariants: { variant: 'ghost', size: 'md' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, type, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        {...(asChild ? {} : { type: type ?? 'button' })}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';
