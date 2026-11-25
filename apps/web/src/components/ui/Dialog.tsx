import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

/**
 * Prototype `.modal`, built on the native <dialog> element: focus is trapped,
 * Escape closes it, and the rest of the page is inert while it is open.
 */
export function Dialog({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    // Backdrop click closes; keyboard users close with Escape (native <dialog> behaviour).
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-labelledby="dialog-title"
      className="m-auto w-[min(30rem,calc(100vw_-_2rem))] rounded-panel border border-control-border bg-surface-overlay p-0 text-foreground shadow-e3 backdrop:bg-surface-base/80 backdrop:backdrop-blur-sm"
    >
      {open && (
        <div className="p-5 sm:p-6">
          <div className="mb-3 flex items-center justify-between gap-4">
            <h2 id="dialog-title" className="text-xl font-bold">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex size-9 items-center justify-center rounded-lg bg-surface-chip text-text-1 hover:brightness-110"
            >
              <X className="size-4" />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}
