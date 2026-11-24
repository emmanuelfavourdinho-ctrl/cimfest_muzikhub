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
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-labelledby="dialog-title"
      className="m-auto w-[min(480px,calc(100vw-32px))] rounded-[20px] border border-[#448969] bg-[#0e2b21] p-0 text-foreground shadow-[0_20px_80px_#000a] backdrop:bg-[#010a08c7] backdrop:backdrop-blur-sm"
    >
      {open && (
        <div className="p-5 sm:p-6">
          <div className="mb-3 flex items-center justify-between gap-4">
            <h2 id="dialog-title" className="text-xl font-bold">{title}</h2>
            <button type="button" onClick={onClose} aria-label="Close" className="flex size-9 items-center justify-center rounded-lg bg-[#16402f] text-[#d3f1df] hover:brightness-110">
              <X className="size-4" />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}
