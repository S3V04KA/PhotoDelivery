import type { Readable, Writable } from 'node:stream';
import { crc32 as nodeCrc32 } from 'node:zlib';
import { validateObjectName } from './media';

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const DATA_DESCRIPTOR_SIGNATURE = 0x08074b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const EOCD_SIGNATURE = 0x06054b50;

const LOCAL_HEADER_SIZE = 30;
const CENTRAL_HEADER_SIZE = 46;
const DATA_DESCRIPTOR_SIZE = 16;
const EOCD_SIZE = 22;

const VERSION_STORE = 20;
const METHOD_STORE = 0;
const FLAG_DATA_DESCRIPTOR = 0x0008;
const FLAG_UTF8 = 0x0800;
const FLAGS = FLAG_UTF8 | FLAG_DATA_DESCRIPTOR;

const DOS_MIN_YEAR = 1980;
const DOS_MAX_YEAR = 2107;

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function tableCrc32(crc: number, chunk: Buffer): number {
  let value = (crc ^ -1) >>> 0;
  for (const byte of chunk) {
    value = (CRC_TABLE[(value ^ byte) & 0xff] ?? 0) ^ (value >>> 8);
  }
  return (value ^ -1) >>> 0;
}

const updateCrc: (crc: number, chunk: Buffer) => number =
  typeof nodeCrc32 === 'function' ? (crc, chunk) => nodeCrc32(chunk, crc) : tableCrc32;

function dosDateTime(mtime: Date): { date: number; time: number } {
  const year = Math.min(DOS_MAX_YEAR, Math.max(DOS_MIN_YEAR, mtime.getUTCFullYear()));
  const time =
    (mtime.getUTCHours() << 11) | (mtime.getUTCMinutes() << 5) | Math.floor(mtime.getUTCSeconds() / 2);
  const date = ((year - DOS_MIN_YEAR) << 9) | ((mtime.getUTCMonth() + 1) << 5) | mtime.getUTCDate();
  return { date, time };
}

interface CentralRecord {
  readonly nameBytes: Buffer;
  readonly crc: number;
  readonly size: number;
  readonly date: number;
  readonly time: number;
  readonly offset: number;
}

export interface ZipEntryOptions {
  readonly mtime?: Date;
}

// Смещение и размеры пишутся 32-битными полями: ZIP64 не поддерживается,
// архив ограничен 4 ГиБ данных и 65535 записями.
export class ZipWriter {
  readonly #out: Writable;
  readonly #records: CentralRecord[] = [];
  #offset = 0;
  #finished = false;

  constructor(out: Writable) {
    this.#out = out;
  }

  async addEntry(name: string, source: Readable | Buffer, options: ZipEntryOptions = {}): Promise<void> {
    if (this.#finished) throw new Error('Архив уже закрыт');
    const safe = validateObjectName(name);
    if (!safe.ok) throw new Error(safe.error);
    const nameBytes = Buffer.from(safe.value, 'utf8');
    if (nameBytes.length > 0xffff) throw new Error('Имя файла в архиве длиннее 65535 байт');
    const { date, time } = dosDateTime(options.mtime ?? new Date());
    const offset = this.#offset;

    const head = Buffer.alloc(LOCAL_HEADER_SIZE);
    head.writeUInt32LE(LOCAL_HEADER_SIGNATURE, 0);
    head.writeUInt16LE(VERSION_STORE, 4);
    head.writeUInt16LE(FLAGS, 6);
    head.writeUInt16LE(METHOD_STORE, 8);
    head.writeUInt16LE(time, 10);
    head.writeUInt16LE(date, 12);
    head.writeUInt16LE(nameBytes.length, 26);
    await this.#write(Buffer.concat([head, nameBytes]));

    const { crc, size } = await this.#writeBody(source);
    const descriptor = Buffer.alloc(DATA_DESCRIPTOR_SIZE);
    descriptor.writeUInt32LE(DATA_DESCRIPTOR_SIGNATURE, 0);
    descriptor.writeUInt32LE(crc, 4);
    descriptor.writeUInt32LE(size, 8);
    descriptor.writeUInt32LE(size, 12);
    await this.#write(descriptor);

    this.#records.push({ nameBytes, crc, size, date, time, offset });
  }

  async finish(): Promise<void> {
    if (this.#finished) return;
    this.#finished = true;
    const directoryOffset = this.#offset;
    for (const record of this.#records) {
      const head = Buffer.alloc(CENTRAL_HEADER_SIZE);
      head.writeUInt32LE(CENTRAL_HEADER_SIGNATURE, 0);
      head.writeUInt16LE(VERSION_STORE, 4);
      head.writeUInt16LE(VERSION_STORE, 6);
      head.writeUInt16LE(FLAGS, 8);
      head.writeUInt16LE(METHOD_STORE, 10);
      head.writeUInt16LE(record.time, 12);
      head.writeUInt16LE(record.date, 14);
      head.writeUInt32LE(record.crc, 16);
      head.writeUInt32LE(record.size, 20);
      head.writeUInt32LE(record.size, 24);
      head.writeUInt16LE(record.nameBytes.length, 28);
      head.writeUInt32LE(record.offset, 42);
      await this.#write(Buffer.concat([head, record.nameBytes]));
    }
    const directorySize = this.#offset - directoryOffset;
    const tail = Buffer.alloc(EOCD_SIZE);
    tail.writeUInt32LE(EOCD_SIGNATURE, 0);
    tail.writeUInt16LE(this.#records.length, 8);
    tail.writeUInt16LE(this.#records.length, 10);
    tail.writeUInt32LE(directorySize, 12);
    tail.writeUInt32LE(directoryOffset, 16);
    await this.#write(tail);
  }

  async #writeBody(source: Readable | Buffer): Promise<{ crc: number; size: number }> {
    if (Buffer.isBuffer(source)) {
      await this.#write(source);
      return { crc: updateCrc(0, source), size: source.length };
    }
    const chunks: AsyncIterable<Uint8Array> = source;
    let crc = 0;
    let size = 0;
    for await (const raw of chunks) {
      const piece = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      crc = updateCrc(crc, piece);
      size += piece.length;
      await this.#write(piece);
    }
    return { crc, size };
  }

  // Смещение и размеры пишутся 32-битными полями: ZIP64 не поддерживается,
  // архив ограничен 4 ГиБ данных и 65535 записями.
  async #write(chunk: Uint8Array): Promise<void> {
    if (!this.#out.write(chunk)) await this.#drain();
    this.#offset += chunk.length;
  }

  async #drain(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const drop = (): void => {
        this.#out.removeListener('drain', onDrain);
        this.#out.removeListener('close', onClose);
        this.#out.removeListener('error', onError);
      };
      const onDrain = (): void => {
        drop();
        resolve();
      };
      const onClose = (): void => {
        drop();
        reject(new Error('Ответ прерван до конца архива'));
      };
      const onError = (error: Error): void => {
        drop();
        reject(error);
      };
      this.#out.once('drain', onDrain);
      this.#out.once('close', onClose);
      this.#out.once('error', onError);
    });
  }
}
