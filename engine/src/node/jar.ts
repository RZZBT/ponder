// Reads single entries from a zip/jar file (stored or deflated). Enough for META-INF/ponder/ponder.json and
// META-INF/maven/**/pom.properties; no zip64, no encryption.
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

const MAX_ENTRY_BYTES = 1024 * 1024;

export interface ZipEntry { name: string; method: number; compressedSize: number; size: number; localOffset: number }

export class Jar {
  private constructor(private readonly fd: number, readonly entries: Map<string, ZipEntry>) {}

  static open(path: string): Jar {
    const fd = openSync(path, 'r');
    try {
      return new Jar(fd, readCentralDirectory(fd));
    } catch (e) {
      closeSync(fd);
      throw e;
    }
  }

  read(name: string): Buffer | null {
    const e = this.entries.get(name);
    if (!e || e.size > MAX_ENTRY_BYTES || e.compressedSize > MAX_ENTRY_BYTES) return null;
    const header = Buffer.alloc(30);
    readSync(this.fd, header, 0, 30, e.localOffset);
    if (header.readUInt32LE(0) !== 0x04034b50) return null;
    const dataStart = e.localOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
    const data = Buffer.alloc(e.compressedSize);
    readSync(this.fd, data, 0, e.compressedSize, dataStart);
    if (e.method === 0) return data;
    if (e.method === 8) return inflateRawSync(data, { maxOutputLength: MAX_ENTRY_BYTES });
    return null;
  }

  readText(name: string): string | null {
    return this.read(name)?.toString('utf8') ?? null;
  }

  close(): void {
    closeSync(this.fd);
  }
}

function readCentralDirectory(fd: number): Map<string, ZipEntry> {
  const size = fstatSync(fd).size;
  const tailLen = Math.min(size, 65_557);
  const tail = Buffer.alloc(tailLen);
  readSync(fd, tail, 0, tailLen, size - tailLen);
  let eocd = -1;
  for (let i = tailLen - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip file');
  const count = tail.readUInt16LE(eocd + 10);
  const cdSize = tail.readUInt32LE(eocd + 12);
  const cdOffset = tail.readUInt32LE(eocd + 16);
  if (cdOffset + cdSize > size) throw new Error('corrupt zip file');
  const cd = Buffer.alloc(cdSize);
  readSync(fd, cd, 0, cdSize, cdOffset);
  const entries = new Map<string, ZipEntry>();
  let p = 0;
  for (let i = 0; i < count && p + 46 <= cd.length; i++) {
    if (cd.readUInt32LE(p) !== 0x02014b50) break;
    const nameLen = cd.readUInt16LE(p + 28);
    const extraLen = cd.readUInt16LE(p + 30);
    const commentLen = cd.readUInt16LE(p + 32);
    const name = cd.toString('utf8', p + 46, p + 46 + nameLen);
    entries.set(name, {
      name,
      method: cd.readUInt16LE(p + 10),
      compressedSize: cd.readUInt32LE(p + 20),
      size: cd.readUInt32LE(p + 24),
      localOffset: cd.readUInt32LE(p + 42),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Maven coordinates from every `META-INF/maven/<g>/<a>/pom.properties` in the jar. */
export function pomCoordinates(jar: Jar): { group: string; name: string; version?: string }[] {
  const out: { group: string; name: string; version?: string }[] = [];
  for (const name of jar.entries.keys()) {
    if (!/^META-INF\/maven\/[^/]+\/[^/]+\/pom\.properties$/.test(name)) continue;
    const text = jar.readText(name) ?? '';
    const g = /^groupId\s*=\s*(.+)$/m.exec(text)?.[1]?.trim();
    const a = /^artifactId\s*=\s*(.+)$/m.exec(text)?.[1]?.trim();
    const v = /^version\s*=\s*(.+)$/m.exec(text)?.[1]?.trim();
    if (g && a) out.push(v ? { group: g, name: a, version: v } : { group: g, name: a });
    if (out.length >= 16) break;
  }
  return out;
}
