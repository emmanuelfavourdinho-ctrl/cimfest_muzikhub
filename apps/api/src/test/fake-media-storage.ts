import type { MediaStorage, RemoteResource, ResourceType } from '../lib/media-storage.js';

/**
 * In-memory stand-in for Cloudinary. Tests simulate the browser's direct upload with
 * `simulateUpload(publicId, …)`, then exercise the real confirm/attach/delete logic.
 */
export class FakeMediaStorage implements MediaStorage {
  configured = true;
  readonly files = new Map<string, RemoteResource>();
  readonly destroyed: string[] = [];
  failDestroy = false;

  reset() {
    this.files.clear();
    this.destroyed.length = 0;
    this.failDestroy = false;
    this.configured = true;
  }

  simulateUpload(publicId: string, resource: Partial<RemoteResource> & { resourceType: ResourceType; format: string }) {
    this.files.set(publicId, { bytes: 1000, width: null, height: null, durationSec: null, version: 1, ...resource });
  }

  signUpload({
    publicId,
    resourceType,
    allowedFormats,
  }: {
    publicId: string;
    resourceType: ResourceType;
    allowedFormats: readonly string[];
  }) {
    return {
      uploadUrl: `https://api.cloudinary.test/v1_1/fake/${resourceType}/upload`,
      fields: {
        public_id: publicId,
        timestamp: '1700000000',
        allowed_formats: allowedFormats.join(','),
        overwrite: 'false',
        api_key: 'fake-key',
        signature: 'fake-signature',
      },
    };
  }

  async fetchResource(publicId: string, resourceType: ResourceType) {
    const file = this.files.get(publicId);
    return file && file.resourceType === resourceType ? file : null;
  }

  async destroy(publicId: string) {
    if (this.failDestroy) throw new Error('simulated Cloudinary outage');
    this.files.delete(publicId);
    this.destroyed.push(publicId);
  }

  view(asset: Parameters<MediaStorage['view']>[0]) {
    const url = (variant: string) => `https://res.cloudinary.test/${variant}/${asset.publicId}`;
    const base = { id: asset.id, kind: asset.kind, width: asset.width, height: asset.height, durationSec: asset.durationSec };
    if (asset.kind === 'IMAGE') {
      return { ...base, urls: { small: url('w320'), medium: url('w640'), wide: url('w960'), large: url('w1280'), square: url('sq192') } };
    }
    if (asset.kind === 'VIDEO') return { ...base, urls: { poster: url('poster'), src: url('mp4') } };
    return { ...base, urls: { src: url('mp3') } };
  }
}
