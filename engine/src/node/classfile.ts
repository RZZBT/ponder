// Reads the methods of a compiled Java class: names and parameter types as written in JVM symbols.

export interface ClassMethod { name: string; params: string[] }

/** `(I[Ljava/lang/String;J)V` to `['int', 'java.lang.String[]', 'long']`. */
export function descriptorParams(descriptor: string): string[] {
  const out: string[] = [];
  const prims: Record<string, string> = { B: 'byte', C: 'char', D: 'double', F: 'float', I: 'int', J: 'long', S: 'short', Z: 'boolean' };
  let i = descriptor.indexOf('(') + 1;
  while (i > 0 && i < descriptor.length && descriptor[i] !== ')') {
    let dims = 0;
    while (descriptor[i] === '[') { dims++; i++; }
    let type: string;
    if (descriptor[i] === 'L') {
      const end = descriptor.indexOf(';', i);
      type = descriptor.slice(i + 1, end).replace(/\//g, '.').replace(/\$/g, '.');
      i = end + 1;
    } else {
      type = prims[descriptor[i]!] ?? '?';
      i++;
    }
    out.push(type + '[]'.repeat(dims));
  }
  return out;
}

export function classMethods(bytes: Buffer): ClassMethod[] {
  if (bytes.length < 10 || bytes.readUInt32BE(0) !== 0xcafebabe) throw new Error('not a class file');
  let p = 8;
  const count = bytes.readUInt16BE(p); p += 2;
  const utf8: (string | undefined)[] = [];
  for (let i = 1; i < count; i++) {
    const tag = bytes[p++]!;
    switch (tag) {
      case 1: { const len = bytes.readUInt16BE(p); utf8[i] = bytes.toString('utf8', p + 2, p + 2 + len); p += 2 + len; break; }
      case 3: case 4: case 9: case 10: case 11: case 12: case 17: case 18: p += 4; break;
      case 5: case 6: p += 8; i++; break;
      case 7: case 8: case 16: case 19: case 20: p += 2; break;
      case 15: p += 3; break;
      default: throw new Error(`unknown constant pool tag ${tag}`);
    }
  }
  p += 6; // access flags, this, super
  const interfaces = bytes.readUInt16BE(p); p += 2 + interfaces * 2;
  const skipMembers = (collect: boolean): ClassMethod[] => {
    const n = bytes.readUInt16BE(p); p += 2;
    const out: ClassMethod[] = [];
    for (let k = 0; k < n; k++) {
      const name = utf8[bytes.readUInt16BE(p + 2)] ?? '';
      const desc = utf8[bytes.readUInt16BE(p + 4)] ?? '';
      const attrs = bytes.readUInt16BE(p + 6); p += 8;
      for (let a = 0; a < attrs; a++) p += 6 + bytes.readUInt32BE(p + 2);
      if (collect) out.push({ name, params: descriptorParams(desc) });
    }
    return out;
  };
  skipMembers(false); // fields
  return skipMembers(true);
}
