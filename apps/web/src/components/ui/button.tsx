import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';
import { Slot } from 'radix-ui';

/**
 * The one button. Tokens only (CLAUDE.md §20.2): lime "signal" for the primary action,
 * a 150 ms colour change and a 0.98 press scale (reduced-motion users get no transition).
 */
const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 rounded-lg font-extrabold whitespace-nowrap transition duration-(--motion-micro) ease-enter outline-none select-none active:scale-98 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*="size-"])]:size-4',
  {
    variants: {
      variant: {
        primary: 'bg-signal text-on-signal hover:bg-signal-hover active:bg-signal-press',
        outline: 'border border-control-border bg-transparent text-text-1 hover:bg-surface-chip',
        ghost: 'border border-hairline-strong bg-surface-raised text-text-1 hover:bg-surface-chip',
        quiet: 'text-text-2 hover:bg-surface-chip hover:text-text-1',
        link: 'px-1.5 text-signal underline-offset-4 hover:underline',
        destructive: 'border border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/20',
        /** Dark button for use ON a lime surface (the landing's final call to action). */
        inverse: 'bg-surface-base text-text-1 hover:bg-surface-raised focus-visible:ring-on-signal focus-visible:ring-offset-signal',
      },
      size: {
        default: 'h-11 px-4 text-xs',
        sm: 'h-9 px-3 text-xs',
        lg: 'h-12 px-6 text-sm',
        icon: 'size-10',
      },
      shape: {
        default: '',
        pill: 'rounded-full',
      },
    },
    defaultVariants: { variant: 'primary', size: 'default', shape: 'default' },
  },
);

function Button({
  className,
  variant,
  size,
  shape,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'button';
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, shape, className }))} {...props} />;
}

export { Button, buttonVariants };
