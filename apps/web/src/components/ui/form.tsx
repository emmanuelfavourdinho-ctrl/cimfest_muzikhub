import { useId, type ComponentProps, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** Prototype `.control` input styling, shared by inputs, textareas and selects. */
export const controlClass =
  'w-full rounded-[9px] border border-[#2b5844] bg-[#081d17] px-3 py-2.5 text-sm text-[#ddf5e7] outline-none placeholder:text-[#62836e] focus:border-mint aria-invalid:border-destructive disabled:opacity-60';

/**
 * Label + control + hint/error, wired up for screen readers
 * (aria-describedby, aria-invalid). Pass the control as a render function.
 */
export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  children: (props: { id: string; 'aria-invalid': boolean; 'aria-describedby'?: string }) => ReactNode;
  className?: string;
}) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={cn('mb-4', className)}>
      <label htmlFor={id} className="mb-1.5 block text-xs font-bold text-[#b4dbbf]">
        {label}
      </label>
      {children({ id, 'aria-invalid': Boolean(error), 'aria-describedby': describedBy })}
      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-1.5 text-xs text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-xs text-sage-dim">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(controlClass, 'h-11', className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn(controlClass, 'min-h-24 resize-y', className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<'select'>) {
  return <select className={cn(controlClass, 'h-11', className)} {...props} />;
}

/** Form-level error banner (for API errors that aren't tied to one field). */
export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-3.5 py-3 text-sm text-destructive">
      {message}
    </div>
  );
}
