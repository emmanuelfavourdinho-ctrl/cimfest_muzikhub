import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from 'cn';
import { Slot } from 'radix-ui';

/** Buttons as defined by the prototype (.btn, .btn-primary, .btn-outline, .btn-ghost, .btn-sm). */
const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 rounded-[10px] font-extrabold whitespace-nowrap transition outline-none select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*="size-"])]:size-4',
  {
    variants: {
      variant: {
        primary:
          'bg-[linear-gradient(135deg,#39edab,#11c88b)] text-primary-foreground shadow-[0_6px_22px_#0bc38c30] hover:brightness-110',
        outline: 'border border-[#2c6750] bg-[#0f2b22] text-[#d4fce9] hover:bg-forest-700',
        ghost: 'border border-[#276347] bg-[#163c2f] text-[#a8f5cf] hover:bg-forest-700',
        quiet: 'text-muted-foreground hover:bg-forest-700 hover:text-foreground',
        link: 'px-1.5 text-mint-soft underline-offset-4 hover:underline',
        destructive: 'border border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/20',
      },
      size: {
        default: 'h-11 px-[17px] text-xs',
        sm: 'h-9 rounded-lg px-3 text-[11px]',
        lg: 'h-12 px-6 text-sm',
        icon: 'size-10',
      },
    },
    defaultVariants: { variant: 'primary', size: 'default' },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'button';
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { Button, buttonVariants };
