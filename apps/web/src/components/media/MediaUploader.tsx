import { useRef, useState } from 'react';
import { cn } from 'cn';
import { RotateCcw, Upload, X } from 'lucide-react';
import { formatBytes, MEDIA_RULES, PURPOSE_KINDS, type MediaKind, type MediaPurpose, type MediaView } from '@muzikhub/shared';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { uploadFile, UploadError } from '@/lib/upload';
import { MediaBlock } from './Media';

type State =
  | { kind: 'idle' }
  | { kind: 'uploading'; file: File; progress: number }
  | { kind: 'failed'; file: File; message: string; retryable: boolean };

/**
 * Pick → validate → upload with a real progress bar → verified MediaView.
 * Failures keep the chosen file so the user can retry with one tap.
 */
export function MediaUploader({
  purpose,
  kinds = PURPOSE_KINDS[purpose],
  value,
  onChange,
  label,
  previewTitle,
  onBusyChange,
}: {
  purpose: MediaPurpose;
  kinds?: readonly MediaKind[];
  value: MediaView | null;
  onChange: (media: MediaView | null) => void;
  label: string;
  previewTitle?: string;
  /** Lets the parent disable Post/Publish while a file is still uploading. */
  onBusyChange?: (busy: boolean) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const [state, setState] = useState<State>({ kind: 'idle' });
  const accept = kinds.map((k) => MEDIA_RULES[k].accept).join(',');
  const limits = kinds.map((k) => `${MEDIA_RULES[k].label} up to ${formatBytes(MEDIA_RULES[k].maxBytes)}`).join(' · ');

  async function start(file: File) {
    abort.current = new AbortController();
    setState({ kind: 'uploading', file, progress: 0 });
    onBusyChange?.(true);
    try {
      const media = await uploadFile(file, {
        purpose,
        signal: abort.current.signal,
        onProgress: (progress) => setState({ kind: 'uploading', file, progress }),
      });
      setState({ kind: 'idle' });
      onChange(media);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setState({ kind: 'idle' });
        return;
      }
      const message = error instanceof Error ? error.message : 'Upload failed.';
      setState({ kind: 'failed', file, message, retryable: error instanceof UploadError ? error.retryable : true });
    } finally {
      onBusyChange?.(false);
    }
  }

  if (value && state.kind === 'idle') {
    return (
      <div>
        <div className="max-w-md overflow-hidden rounded-xl">
          <MediaBlock media={value} title={previewTitle ?? label} />
        </div>
        <div className="mt-2 flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()}>
            Replace
          </Button>
          <Button
            type="button"
            variant="quiet"
            size="sm"
            onClick={() => {
              // Deletes unsaved uploads now; the server refuses (409) if it's attached to saved work.
              void api.deleteUpload(value.id).catch(() => undefined);
              onChange(null);
            }}
          >
            Remove
          </Button>
        </div>
        <HiddenInput refEl={input} accept={accept} onPick={start} label={label} />
      </div>
    );
  }

  return (
    <div>
      {state.kind === 'uploading' ? (
        <div className="rounded-xl border border-[#3a7f60] bg-[#102f24] p-4" aria-live="polite">
          <div className="mb-2 flex items-center justify-between gap-3 text-xs">
            <span className="truncate text-[#c2dacc]">Uploading {state.file.name}</span>
            <span className="shrink-0 font-semibold text-mint">{Math.round(state.progress * 100)}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-forest-700" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(state.progress * 100)} aria-label={`Uploading ${state.file.name}`}>
            <div className="h-full rounded-full bg-emerald transition-[width]" style={{ width: `${state.progress * 100}%` }} />
          </div>
          <Button type="button" variant="quiet" size="sm" className="mt-2" onClick={() => abort.current?.abort()}>
            <X /> Cancel
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => input.current?.click()}
          className={cn(
            'flex w-full flex-col items-center gap-2 rounded-xl border border-dashed bg-[#102f24] p-5 text-center text-xs text-[#9ecbb3] transition hover:border-mint',
            state.kind === 'failed' ? 'border-destructive/60' : 'border-[#3a7f60]',
          )}
        >
          <Upload className="size-6 text-[#80eab6]" aria-hidden />
          <strong className="text-sm text-[#d4fce9]">{label}</strong>
          <span>{limits}</span>
        </button>
      )}
      {state.kind === 'failed' && (
        <div role="alert" className="mt-2 flex flex-wrap items-center gap-2 text-xs text-destructive">
          <span>{state.message}</span>
          {state.retryable && (
            <Button type="button" variant="outline" size="sm" onClick={() => void start(state.file)}>
              <RotateCcw /> Retry
            </Button>
          )}
        </div>
      )}
      <HiddenInput refEl={input} accept={accept} onPick={start} label={label} />
    </div>
  );
}

function HiddenInput({ refEl, accept, onPick, label }: { refEl: React.RefObject<HTMLInputElement | null>; accept: string; onPick: (f: File) => void; label: string }) {
  return (
    <input
      ref={refEl}
      type="file"
      accept={accept}
      aria-label={label}
      className="sr-only"
      tabIndex={-1}
      onChange={(e) => {
        const file = e.target.files?.[0];
        e.target.value = ''; // allow picking the same file again after a failure
        if (file) onPick(file);
      }}
    />
  );
}
