import {
  S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ApiError } from './errors.js';

const PRESIGN_TTL_SECONDS = 300;

let client = null;

/** An absent capability group is a disabled feature, not a crash on first use. */
export function assertStorageEnabled(config) {
  if (!config.features.attachments) {
    throw new ApiError(
      503, 'CAPABILITY_DISABLED',
      'File attachments are not configured on this installation',
    );
  }
}

function getClient(config) {
  assertStorageEnabled(config);
  if (!client) {
    client = new S3Client({
      region: config.storage.region,
      credentials: {
        accessKeyId: config.storage.accessKeyId,
        secretAccessKey: config.storage.secretAccessKey,
      },
    });
  }
  return client;
}

export async function putObject(config, { key, body, contentType }) {
  await getClient(config).send(new PutObjectCommand({
    Bucket: config.storage.bucket, Key: key, Body: body, ContentType: contentType,
  }));
}

export async function deleteObject(config, key) {
  await getClient(config).send(new DeleteObjectCommand({
    Bucket: config.storage.bucket, Key: key,
  }));
}

/**
 * Short-TTL and never stored. The presigned URL is the RESULT of an
 * authorization decision made by the caller — never a substitute for one.
 */
export async function presignGet(config, key, { ttlSeconds = PRESIGN_TTL_SECONDS } = {}) {
  const command = new GetObjectCommand({
    Bucket: config.storage.bucket,
    Key: key,
  });
  return getSignedUrl(getClient(config), command, { expiresIn: ttlSeconds });
}
