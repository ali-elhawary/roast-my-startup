// Google Cloud Storage adapter for the cloud delivery pipeline. Env-gated: with
// GCS_BUCKET unset, isGcsEnabled() is false and none of this runs — the booth
// keeps hosting videos/recordings locally. When enabled, finished videos and
// recordings are uploaded here and served to founders via 7-day V4 signed URLs.
//
// Auth is KEYLESS: the base credential is Application Default Credentials (the
// user's `gcloud auth application-default login`), which impersonates the
// service account named in GCS_IMPERSONATE_SA. That SA has Storage Object Admin
// on the bucket, and the ADC user has Token Creator on the SA — so both object
// operations and V4 URL signing (via the IAM signBlob API) work without a
// downloadable service-account key. If GCS_IMPERSONATE_SA is unset, plain ADC /
// GOOGLE_APPLICATION_CREDENTIALS is used instead.
//
// Functions throw on failure so callers (video.ts / delivery.ts) can retry via
// withRetry and, on final failure, fall back to the durable delivery queue.

import { Storage, type Bucket } from '@google-cloud/storage';
import { GoogleAuth, Impersonated } from 'google-auth-library';

// 7 days, the brief's link lifetime for cloud Watch/Download links.
export const SIGNED_URL_TTL_MS = 604_800_000;

let bucketPromise: Promise<Bucket> | null = null;

export function isGcsEnabled(): boolean {
  return !!process.env.GCS_BUCKET;
}

async function buildBucket(): Promise<Bucket> {
  const name = process.env.GCS_BUCKET;
  if (!name) throw new Error('GCS not enabled (GCS_BUCKET unset)');

  const target = process.env.GCS_IMPERSONATE_SA;
  const projectId =
    process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || undefined;

  if (target) {
    // Keyless: ADC user -> impersonate the SA (uploads as the SA; V4 signing via
    // IAM signBlob on the SA, which Token Creator authorizes).
    const auth = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
    const sourceClient = await auth.getClient();
    const authClient = new Impersonated({
      sourceClient,
      targetPrincipal: target,
      targetScopes: ['https://www.googleapis.com/auth/devstorage.read_write'],
      lifetime: 3600,
    });
    return new Storage({ projectId, authClient }).bucket(name);
  }

  // Fallback: plain ADC or GOOGLE_APPLICATION_CREDENTIALS key.
  return new Storage({ projectId }).bucket(name);
}

function getBucket(): Promise<Bucket> {
  if (!bucketPromise) bucketPromise = buildBucket();
  return bucketPromise;
}

export async function uploadBuffer(
  key: string,
  buffer: Buffer,
  contentType: string,
): Promise<void> {
  const bucket = await getBucket();
  await bucket.file(key).save(buffer, { contentType, resumable: false });
}

export async function uploadFile(
  key: string,
  localPath: string,
  contentType: string,
): Promise<void> {
  const bucket = await getBucket();
  await bucket.upload(localPath, { destination: key, contentType, resumable: false });
}

export async function signedReadUrl(
  key: string,
  opts: { downloadFilename?: string } = {},
): Promise<string> {
  const bucket = await getBucket();
  const [url] = await bucket.file(key).getSignedUrl({
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
  const bucket = await getBucket();
  await bucket.file(key).delete();
}
