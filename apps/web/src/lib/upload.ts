import { checkUpload, kindFromMime, type MediaKind, type MediaPurpose, type MediaView, type SignedUpload } from '@muzikhub/shared';
import { api, ApiRequestError } from './api';

export class UploadError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'UploadError';
  }
}

interface UploadOptions {
  purpose: MediaPurpose;
  /** The member's plan limit for this kind (entitlements). The server re-checks it. */
  maxBytes?: (kind: MediaKind) => number | undefined;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

const MAX_ATTEMPTS = 4;
const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DOMException('Upload cancelled', 'AbortError'));
    });
  });

/** One HTTP request to Cloudinary via XHR (fetch has no upload-progress events). */
function send(
  url: string,
  body: FormData,
  headers: Record<string, string>,
  onProgress: (loaded: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      // 4xx from Cloudinary (bad format, rejected signature) won't succeed on retry.
      const message = (() => {
        try {
          return (JSON.parse(xhr.responseText) as { error?: { message?: string } }).error?.message;
        } catch {
          return undefined;
        }
      })();
      reject(new UploadError(message ?? 'The file was rejected.', xhr.status >= 500 || xhr.status === 429));
    };
    xhr.onerror = () => reject(new UploadError('Connection lost during upload.', true));
    xhr.ontimeout = () => reject(new UploadError('The upload timed out.', true));
    signal?.addEventListener('abort', () => {
      xhr.abort();
      reject(new DOMException('Upload cancelled', 'AbortError'));
    });
    xhr.send(body);
  });
}

/** Retries network failures with exponential backoff (1s, 2s, 4s); never retries rejections. */
async function withRetry(attempt: () => Promise<void>, signal?: AbortSignal) {
  for (let i = 1; ; i++) {
    try {
      return await attempt();
    } catch (error) {
      if (!(error instanceof UploadError) || !error.retryable || i >= MAX_ATTEMPTS) throw error;
      await wait(1000 * 2 ** (i - 1), signal);
    }
  }
}

function form(fields: Record<string, string>, file: Blob, filename: string) {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.append(k, v);
  data.append('file', file, filename);
  return data;
}

/**
 * Chunked upload (Cloudinary's protocol): every chunk carries the same signed fields,
 * an X-Unique-Upload-Id and a Content-Range. A dropped connection only re-sends the
 * chunk that failed, not the whole file.
 */
async function uploadChunked(signed: SignedUpload, file: File, onProgress: (n: number) => void, signal?: AbortSignal) {
  const total = file.size;
  for (let start = 0; start < total; start += signed.chunkBytes) {
    const end = Math.min(start + signed.chunkBytes, total);
    await withRetry(
      () =>
        send(
          signed.uploadUrl,
          form(signed.fields, file.slice(start, end), file.name),
          { 'X-Unique-Upload-Id': signed.assetId, 'Content-Range': `bytes ${start}-${end - 1}/${total}` },
          (loaded) => onProgress(start + loaded),
          signal,
        ),
      signal,
    );
  }
}

/**
 * Uploads one file: validate locally → ask the API for a signature → send the file
 * straight to Cloudinary (with progress, chunking and retries) → ask the API to verify it.
 */
export async function uploadFile(file: File, { purpose, onProgress, signal, maxBytes }: UploadOptions): Promise<MediaView> {
  const kind = kindFromMime(file.type);
  if (!kind) throw new UploadError("This file type isn't supported.", false);
  const problem = checkUpload(kind, purpose, file.size, maxBytes?.(kind));
  if (problem) throw new UploadError(problem, false);

  const signed = await api.createUpload({ kind, purpose, bytes: file.size, filename: file.name.slice(0, 200) });
  const report = (loaded: number) => onProgress?.(Math.min(0.99, loaded / file.size));

  try {
    if (signed.chunked) await uploadChunked(signed, file, report, signal);
    else await withRetry(() => send(signed.uploadUrl, form(signed.fields, file, file.name), {}, report, signal), signal);

    // Verification can briefly lag the upload; retry "incomplete" a few times.
    for (let i = 0; ; i++) {
      try {
        const media = await api.confirmUpload(signed.assetId);
        onProgress?.(1);
        return media;
      } catch (error) {
        if (error instanceof ApiRequestError && error.code === 'UPLOAD_INCOMPLETE' && i < 3) {
          await wait(1500, signal);
          continue;
        }
        if (error instanceof ApiRequestError) throw new UploadError(error.message, error.status === 0);
        throw error;
      }
    }
  } catch (error) {
    // Don't leave a half-finished upload behind (the server's cleanup job is the backstop).
    void api.deleteUpload(signed.assetId).catch(() => undefined);
    throw error;
  }
}
