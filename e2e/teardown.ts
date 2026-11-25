import { v2 as cloudinary } from 'cloudinary';
import { cloudinaryEnv as env, hasCloudinary } from './cloudinary-env';

/** Removes every asset the browser tests uploaded (they all live under muzikhub/test/). */
export default async function teardown() {
  if (!hasCloudinary) return;
  cloudinary.config({ cloud_name: env.CLOUDINARY_CLOUD_NAME, api_key: env.CLOUDINARY_API_KEY, api_secret: env.CLOUDINARY_API_SECRET });
  for (const resource_type of ['image', 'video'] as const) {
    await cloudinary.api.delete_resources_by_prefix('muzikhub/test/', { resource_type });
  }
}
