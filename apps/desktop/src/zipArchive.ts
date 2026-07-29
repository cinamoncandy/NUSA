import { deflateRawSync } from "node:zlib";

/**
 * A minimal ZIP writer built on `node:zlib` alone (WO-0034-A4O req 5).
 *
 * Written rather than depended on because this repository does not add dependencies, and a
 * diagnostics bundle is not worth widening the supply chain for. It implements the subset the
 * format actually needs for a flat bundle of small text files: local headers, a central
 * directory, and an end-of-central-directory record. No ZIP64, no encryption, no directory
 * entries -- an archive that needed any of those would be an archive that had stopped being a
 * support bundle.
 *
 * Every entry is stored with a UTF-8 name flag set, so Korean filenames survive the round
 * trip instead of arriving as mojibake in whatever tool the user opens it with.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xed_b8_83_20 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

export function crc32(data: Buffer): number {
  let crc = 0xff_ff_ff_ff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xff_ff_ff_ff) >>> 0;
}

export interface ZipEntry {
  /** Forward-slash separated path inside the archive. */
  readonly name: string;
  readonly data: Buffer;
  readonly modifiedAt?: number;
}

/** MS-DOS date/time. Pre-1980 timestamps are clamped, because the format cannot express them. */
function dosDateTime(timestamp: number): Readonly<{ time: number; date: number }> {
  const when = new Date(Number.isFinite(timestamp) ? timestamp : Date.now());
  const year = Math.max(1980, when.getFullYear());
  return Object.freeze({
    time: (when.getHours() << 11) | (when.getMinutes() << 5) | Math.floor(when.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate()
  });
}

const FLAG_UTF8_NAMES = 0x08_00;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

export function createZipArchive(entries: readonly ZipEntry[]): Buffer {
  const seen = new Set<string>();
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = entry.name.replace(/\\/g, "/").replace(/^\/+/, "");
    if (name.length === 0) throw new Error("zip entry name must not be empty");
    // A duplicate name produces an archive whose contents depend on which copy the reader
    // happens to keep. Refusing is the only outcome that means one thing.
    if (seen.has(name)) throw new Error(`duplicate zip entry: ${name}`);
    seen.add(name);

    const nameBuffer = Buffer.from(name, "utf8");
    const compressed = deflateRawSync(entry.data);
    // Deflate can be larger than the input for tiny or already-compressed payloads. Storing
    // those keeps the bundle from growing in the name of compressing it.
    const useDeflate = compressed.length < entry.data.length;
    const payload = useDeflate ? compressed : entry.data;
    const method = useDeflate ? METHOD_DEFLATE : METHOD_STORE;
    const { time, date } = dosDateTime(entry.modifiedAt ?? Date.now());
    const checksum = crc32(entry.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04_03_4b_50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(FLAG_UTF8_NAMES, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBuffer, payload);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02_01_4b_50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(FLAG_UTF8_NAMES, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    // Regular file, read/write for the owner. Left explicit so an extractor does not have to
    // guess a mode for a file that came from a Windows machine.
    // `<< 16` overflows into a negative 32-bit int here; the shift is done in floating
    // point and coerced back to unsigned so the mode lands as written.
    central.writeUInt32LE((0o10_0644 * 0x1_00_00) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuffer);

    offset += local.length + nameBuffer.length + payload.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06_05_4b_50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

/**
 * Reads back the entry names and sizes from the central directory. Used by the tests to prove
 * a produced bundle is a real archive rather than bytes that merely start with "PK", and by
 * nothing in the shipping app.
 */
export function readZipEntryNames(archive: Buffer): readonly string[] {
  const endIndex = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (endIndex < 0) throw new Error("not a zip archive: no end-of-central-directory record");
  const count = archive.readUInt16LE(endIndex + 10);
  let cursor = archive.readUInt32LE(endIndex + 16);
  const names: string[] = [];
  for (let index = 0; index < count; index += 1) {
    if (archive.readUInt32LE(cursor) !== 0x02_01_4b_50) throw new Error("corrupt central directory");
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    names.push(archive.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8"));
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return Object.freeze(names);
}
