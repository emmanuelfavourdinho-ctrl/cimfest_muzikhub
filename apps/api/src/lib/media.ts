import { cloudinaryStorage, type MediaStorage } from './media-storage.js';

/**
 * The media storage used by every module. createApp() swaps in a fake for tests
 * (see AppDependencies.media); production uses Cloudinary.
 */
let storage: MediaStorage | null = null;

export function mediaStorage(): MediaStorage {
  storage ??= cloudinaryStorage();
  return storage;
}

export function setMediaStorage(next: MediaStorage) {
  storage = next;
}
