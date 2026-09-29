import { createReadStream } from 'node:fs';
import type { Readable } from 'node:stream';
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { S3Config } from '../config';

export interface ObjectItem {
  readonly key: string;
  readonly size: number;
  readonly lastModified: Date;
}

export interface ListPage {
  readonly items: readonly ObjectItem[];
  readonly commonPrefixes: readonly string[];
  readonly nextToken: string | null;
}

export interface ObjectStore {
  listPage(prefix: string, delimiter?: string, token?: string, maxKeys?: number): Promise<ListPage>;
  putFromFile(key: string, path: string, contentType: string): Promise<void>;
  putBuffer(key: string, body: Buffer, contentType: string): Promise<void>;
  deleteKeys(keys: readonly string[]): Promise<void>;
  getStream(key: string): Promise<Readable>;
}

export const DEFAULT_PAGE_SIZE = 1000;

export class AwsObjectStore implements ObjectStore {
  readonly #client: S3Client;
  readonly #bucket: string;

  constructor(s3: S3Config) {
    this.#bucket = s3.bucket;
    this.#client = new S3Client({
      region: s3.region,
      endpoint: s3.endpoint,
      forcePathStyle: true,
      credentials: { accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey },
    });
  }

  async listPage(prefix: string, delimiter?: string, token?: string, maxKeys: number = DEFAULT_PAGE_SIZE): Promise<ListPage> {
    const response = await this.#client.send(
      new ListObjectsV2Command({
        Bucket: this.#bucket,
        Prefix: prefix,
        Delimiter: delimiter,
        ContinuationToken: token,
        MaxKeys: maxKeys,
      }),
    );
    return {
      items: (response.Contents ?? []).flatMap((object) =>
        object.Key === undefined
          ? []
          : [{ key: object.Key, size: object.Size ?? 0, lastModified: object.LastModified ?? new Date(0) }],
      ),
      commonPrefixes: (response.CommonPrefixes ?? []).flatMap((entry) =>
        entry.Prefix === undefined ? [] : [entry.Prefix],
      ),
      nextToken: response.IsTruncated === true ? (response.NextContinuationToken ?? null) : null,
    };
  }

  async putFromFile(key: string, path: string, contentType: string): Promise<void> {
    await this.#client.send(
      new PutObjectCommand({
        Bucket: this.#bucket,
        Key: key,
        Body: createReadStream(path),
        ContentType: contentType,
      }),
    );
  }

  async putBuffer(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.#client.send(
      new PutObjectCommand({ Bucket: this.#bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async deleteKeys(keys: readonly string[]): Promise<void> {
    if (keys.length === 0) return;
    await this.#client.send(
      new DeleteObjectsCommand({
        Bucket: this.#bucket,
        Delete: { Objects: keys.map((key) => ({ Key: key })) },
      }),
    );
  }

  async getStream(key: string): Promise<Readable> {
    const response = await this.#client.send(new GetObjectCommand({ Bucket: this.#bucket, Key: key }));
    if (response.Body === undefined) throw new Error(`Объект недоступен: ${key}`);
    return response.Body as Readable;
  }
}
