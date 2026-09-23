// Google Cloud Storage adapter for the cloud delivery pipeline. Env-gated: with
// GCS_BUCKET unset, isGcsEnabled() is false and none of this runs — the booth
// keeps hosting videos/recordings locally. When enabled, finished videos and
// recordings are uploaded here and served to founders via 7-day V4 signed URLs.
//
// The Storage client auto-reads GOOGLE_APPLICATION_CREDENTIALS. Functions throw
// on failure so callers (video.ts / delivery.ts) can retry via withRetry and,
// on final failure, fall back to the durable delivery queue.

import { Storage, type Bucket } from '@google-cloud/storage';

// 7 days, the brief's link lifetime for cloud Watch/Download links.
export const SIGNED_URL_TTL_MS = 604_800_000;

let bucket: Bucket | null = null;

export function isGcsEnabled(): boolean {
  return !!process.env.GCS_BUCKET;
}

// Lazily construct the client + bucket handle so nothing touches Google auth
// unless GCS is actually configured.
function getBucket(): Bucket {
  const name = process.env.GCS_BUCKET;
  if (!name) throw new Error('GCS not enabled (GCS_BUCKET unset)');
  if (!bucket) {
    const storage = new Storage(); // reads GOOGLE_APPLICATION_CREDENTIALS
    bucket = storage.bucket(name);
  }
  return bucket;
}

export async function uploadBuffer(
  key: string,
  buffer: Buffer,
  contentType: string,
): Promise<void> {
  await getBucket().file(key).save(buffer, {
    contentType,
    resumable: false,
  });
}

export async function uploadFile(
  key: string,
  localPath: string,
  contentType: string,
): Promise<void> {
  await getBucket().upload(localPath, {
    destination: key,
    contentType,
    resumable: false,
  });
}

export async function signedReadUrl(
  key: string,
  opts: { downloadFilename?: string } = {},
): Promise<string> {
  const [url] = await getBucket()
    .file(key)
    .getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + SIGNED_URL_TTL_MS,
      ...(opts.downloadFilename
        ? { responseDisposition: `attachment; filename="${opts.downloadFilename}"` }
        : {}),
    });
  return url;
}

export async function deleteObject(key: string): Promise<void> {
  await getBucket().file(key).delete();
}
