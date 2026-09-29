import {
  CreateBucketCommand,
  GetBucketPolicyCommand,
  HeadBucketCommand,
  PutBucketPolicyCommand,
  S3Client,
} from '@aws-sdk/client-s3';

const RETRIES = 60;
const RETRY_DELAY_MS = 2000;
const FATAL_ERRORS = new Set([
  'AccessDenied',
  'AccountProblem',
  'InvalidAccessKeyId',
  'InvalidBucketName',
  'SignatureDoesNotMatch',
]);

const endpoint = process.env.S3_ENDPOINT ?? 'http://localhost:9000';
const region = process.env.S3_REGION ?? 'us-east-1';
const accessKeyId = process.env.S3_ACCESS_KEY_ID ?? '';
const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY ?? '';
const bucket = process.env.S3_BUCKET ?? 'photos';

function log(message) {
  console.log(`[s3-init] ${message}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describe(error) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function isFatal(error) {
  return typeof error?.name === 'string' && FATAL_ERRORS.has(error.name);
}

function isNotFound(error) {
  return (
    error?.name === 'NotFound' ||
    error?.name === 'NoSuchBucket' ||
    error?.$metadata?.httpStatusCode === 404
  );
}

function isMissingPolicy(error) {
  return error?.name === 'NoSuchBucketPolicy' || error?.$metadata?.httpStatusCode === 404;
}

function anonymousPolicy() {
  return JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Principal: '*',
        Action: ['s3:GetBucketLocation', 's3:ListBucket', 's3:ListBucketVersions'],
        Resource: [`arn:aws:s3:::${bucket}`],
      },
      {
        Effect: 'Allow',
        Principal: '*',
        Action: ['s3:GetObject', 's3:GetObjectVersion'],
        Resource: [`arn:aws:s3:::${bucket}/*`],
      },
    ],
  });
}

async function ensureBucket(client) {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    log(`бакет «${bucket}» уже есть`);
  } catch (error) {
    if (!isNotFound(error)) throw error;
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
    log(`бакет «${bucket}» создан`);
  }
}

async function ensurePolicy(client) {
  try {
    await client.send(new GetBucketPolicyCommand({ Bucket: bucket }));
    log('политика анонимного чтения уже настроена');
    return;
  } catch (error) {
    if (!isMissingPolicy(error)) {
      log(
        `не удалось прочитать политику (${describe(error)}) — пропустите, ` +
          'настройте анонимное чтение вручную, см. README',
      );
      return;
    }
  }
  await client.send(new PutBucketPolicyCommand({ Bucket: bucket, Policy: anonymousPolicy() }));
  log('политика анонимного чтения установлена');
}

async function main() {
  const client = new S3Client({
    endpoint,
    region,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });
  await ensureBucket(client);
  await ensurePolicy(client);
}

for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
  try {
    await main();
    log('готово');
    process.exit(0);
  } catch (error) {
    if (isFatal(error)) {
      log(`невосстановимая ошибка: ${describe(error)}`);
      process.exit(1);
    }
    if (attempt === RETRIES) {
      log(`S3 недоступен после ${RETRIES} попыток: ${describe(error)}`);
      process.exit(1);
    }
    if (attempt === 1 || attempt % 10 === 0) {
      log(`S3 недоступен (${describe(error)}), попытка ${attempt}/${RETRIES}...`);
    }
    await sleep(RETRY_DELAY_MS);
  }
}
