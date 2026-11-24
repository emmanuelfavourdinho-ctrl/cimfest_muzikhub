/**
 * One-off: uploads the approved landing-page photographs to Cloudinary and writes a
 * manifest the web app reads. Safe to re-run (never overwrites). NEVER deletes the
 * local originals in brand-originals/landing/ (moved out of the deployed public/ folder) — remove those by hand only after
 * the hosted images are verified.
 *
 *   npm run brand:upload -w @muzikhub/api
 */
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { v2 as cloudinary } from 'cloudinary';
import { env } from '../config/env.js';

const LANDING_DIR = join(import.meta.dirname, '../../../../brand-originals/landing');
// Written next to the originals (git-ignored): delivery URLs must never be committed again
// (owner decision 2026-11-24 — the photos have no recorded licence and are not used).
const MANIFEST = join(LANDING_DIR, 'hero-photos.json');
const FOLDER = `${env.CLOUDINARY_FOLDER}/brand/landing`;

/** The five approved photographs (2026-11-24), in display order. Slugs describe the shot, not the person. */
const PHOTOS = [
  { slug: 'red-studio', file: 'WhatsApp Image 2026-11-23 at 9.26.13 PM.jpeg' },
  { slug: 'coral-portrait', file: 'WhatsApp Image 2026-11-23 at 10.28.50 PM.jpeg' },
  { slug: 'stage-saxophone', file: 'WhatsApp Image 2026-11-23 at 9.20.13 PM.jpeg' },
  { slug: 'blue-studio', file: 'WhatsApp Image 2026-11-23 at 9.26.14 PM.jpeg' },
  { slug: 'pointing-studio', file: 'WhatsApp Image 2026-11-23 at 10.28.50 PM(1).jpeg' },
] as const;

/** Candidate widths; only those ≤ the original are generated, so nothing is ever upscaled. */
const WIDTHS = [480, 768, 1080, 1280];

async function main() {
  if (!env.CLOUDINARY_CLOUD_NAME || !env.CLOUDINARY_API_KEY || !env.CLOUDINARY_API_SECRET) {
    throw new Error('Cloudinary is not configured (CLOUDINARY_* in apps/api/.env).');
  }
  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
    secure: true,
    analytics: false,
  });

  const manifest = [];
  for (const photo of PHOTOS) {
    const path = join(LANDING_DIR, photo.file);
    if (!existsSync(path)) throw new Error(`Missing original: ${photo.file} (nothing uploaded for it)`);
    const publicId = `${FOLDER}/${photo.slug}`;
    // overwrite:false → re-running returns the existing asset instead of replacing it.
    const r = await cloudinary.uploader.upload(path, { public_id: publicId, overwrite: false, resource_type: 'image' });
    const url = (transformation: Record<string, unknown>) =>
      cloudinary.url(r.public_id, {
        version: r.version,
        secure: true,
        transformation: [{ ...transformation, fetch_format: 'auto', quality: 'auto' }],
      });
    const widths = [...new Set([...WIDTHS.filter((w) => w < r.width), r.width])].sort((a, b) => a - b);
    const entry = {
      slug: photo.slug,
      width: r.width,
      height: r.height,
      srcset: widths.map((w) => ({ w, url: url({ width: w, crop: 'limit' }) })),
      /** 64px heavily blurred copy: an almost-free backdrop behind "contain" compositions. */
      blur: url({ width: 64, crop: 'limit', effect: 'blur:800' }),
    };

    // Verify every delivered variant actually serves before recording it.
    for (const { url: u } of [...entry.srcset, { url: entry.blur }]) {
      const res = await fetch(u, { headers: { Accept: 'image/avif,image/webp,image/*' } });
      if (!res.ok) throw new Error(`Delivery check failed (${res.status}) for ${photo.slug}`);
      await res.arrayBuffer();
    }
    manifest.push(entry);
    console.log(
      `✓ ${photo.slug}: ${r.width}×${r.height} → ${entry.srcset.map((s) => s.w).join('/')}w${r.existing ? ' (already uploaded)' : ''}`,
    );
  }

  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Manifest written: ${MANIFEST}\nLocal originals kept in ${LANDING_DIR}.`);
}

main().catch((e) => {
  console.error(`Brand upload failed: ${(e as Error).message}. Local originals are untouched.`);
  process.exit(1);
});
