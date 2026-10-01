import { decompressSync as inflateBounded } from 'fflate';

export const FIG_IMPORT_LIMITS = Object.freeze({
  archiveBytes: 32 * 1024 * 1024,
  archiveEntries: 2_048,
  expandedBytes: 64 * 1024 * 1024,
  singleEntryBytes: 32 * 1024 * 1024,
  canvasBytes: 32 * 1024 * 1024,
  schemaBytes: 1 * 1024 * 1024,
  messageBytes: 32 * 1024 * 1024,
  imageBytes: 24 * 1024 * 1024,
  singleImageBytes: 16 * 1024 * 1024,
  metadataBytes: 256 * 1024,
  thumbnailBytes: 4 * 1024 * 1024,
  nodes: 25_000
});

const ZIP_END = 0x06054b50;
const ZIP_CENTRAL = 0x02014b50;
const ZIP_LOCAL = 0x04034b50;
const ZIP_DATA_DESCRIPTOR = 0x08074b50;
const ZIP64_EXTRA = 0x0001;
const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd];
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function fail(message, code = 'INVALID_FIG') {
  const error = new TypeError(message);
  error.code = code;
  throw error;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(view, offset) {
  if (offset < 0 || offset + 2 > view.byteLength) fail('The .fig archive is truncated.');
  return view.getUint16(offset, true);
}

function u32(view, offset) {
  if (offset < 0 || offset + 4 > view.byteLength) fail('The .fig archive is truncated.');
  return view.getUint32(offset, true);
}

function boundedName(bytes) {
  let name;
  try { name = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { fail('The .fig archive contains an invalid file name.'); }
  if (!name || name.startsWith('/') || name.includes('\\') || name.includes('\0')
    || name.split('/').some(part => part === '..' || part === '.')) fail('The .fig archive contains an unsafe file path.');
  if (name !== 'canvas.fig' && name !== 'meta.json' && name !== 'thumbnail.png'
    && name !== 'images/' && !/^images\/[A-Za-z0-9._-]{1,200}$/u.test(name)) {
    fail(`The .fig archive contains an unsupported entry (“${name.slice(0, 80)}”).`);
  }
  return name;
}

function assertSafeExtraFields(view, offset, length) {
  const end = offset + length;
  if (!Number.isSafeInteger(end) || end > view.byteLength) fail('The .fig archive has a truncated ZIP extra field.');
  while (offset < end) {
    if (offset + 4 > end) fail('The .fig archive has a corrupt ZIP extra field.');
    const id = u16(view, offset);
    const fieldLength = u16(view, offset + 2);
    offset += 4;
    if (offset + fieldLength > end || id === ZIP64_EXTRA) fail('ZIP64 or corrupt .fig archive entries are not supported.');
    offset += fieldLength;
  }
}

function zipEndOffset(bytes, view) {
  const first = Math.max(0, bytes.length - 22 - 0xffff);
  for (let offset = bytes.length - 22; offset >= first; offset -= 1) {
    if (u32(view, offset) !== ZIP_END) continue;
    const commentLength = u16(view, offset + 20);
    if (offset + 22 + commentLength === bytes.length) return offset;
  }
  fail('This is not a complete .fig ZIP archive.');
}

function safeInflate(bytes, expectedBytes, maximumBytes) {
  if (expectedBytes > maximumBytes) fail('The .fig archive exceeds the safe import size limit.', 'FIG_RESOURCE_LIMIT');
  const output = inflateBounded(bytes, { out: new Uint8Array(expectedBytes + 1) });
  if (output.byteLength !== expectedBytes) fail('The .fig archive has a corrupt compressed entry.');
  return output;
}

function parseZipEntries(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 22 || bytes.byteLength > FIG_IMPORT_LIMITS.archiveBytes) {
    fail(`Choose a .fig file no larger than ${Math.floor(FIG_IMPORT_LIMITS.archiveBytes / (1024 * 1024))} MiB.`, 'FIG_RESOURCE_LIMIT');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = zipEndOffset(bytes, view);
  if (u16(view, end + 4) !== 0 || u16(view, end + 6) !== 0) fail('Multi-disk .fig archives are not supported.');
  const entryCount = u16(view, end + 10);
  const entriesOnDisk = u16(view, end + 8);
  const centralSize = u32(view, end + 12);
  const centralOffset = u32(view, end + 16);
  if (!entryCount || entryCount !== entriesOnDisk || entryCount > FIG_IMPORT_LIMITS.archiveEntries
    || centralOffset + centralSize !== end || centralOffset > end) {
    fail('The .fig archive directory is invalid or exceeds the safe import limit.', entryCount > FIG_IMPORT_LIMITS.archiveEntries ? 'FIG_RESOURCE_LIMIT' : 'INVALID_FIG');
  }

  const entries = [];
  const names = new Set();
  let offset = centralOffset;
  let expandedBytes = 0;
  let imageBytes = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (u32(view, offset) !== ZIP_CENTRAL || offset + 46 > end) fail('The .fig archive directory is corrupt.');
    const flags = u16(view, offset + 8);
    const method = u16(view, offset + 10);
    const expectedCrc = u32(view, offset + 16);
    const compressedSize = u32(view, offset + 20);
    const uncompressedSize = u32(view, offset + 24);
    const nameLength = u16(view, offset + 28);
    const extraLength = u16(view, offset + 30);
    const commentLength = u16(view, offset + 32);
    const startDisk = u16(view, offset + 34);
    const localOffset = u32(view, offset + 42);
    const recordEnd = offset + 46 + nameLength + extraLength + commentLength;
    if (recordEnd > end || extraLength > 4096 || commentLength > 4096 || !nameLength
      || startDisk !== 0 || [compressedSize, uncompressedSize, localOffset].includes(0xffffffff)) {
      fail('The .fig archive uses an unsupported or corrupt ZIP directory entry.');
    }
    const supportedFlags = 0x0002 | 0x0004 | 0x0008 | 0x0800;
    if ((flags & ~supportedFlags) !== 0 || (method === 0 && (flags & 0x0006) !== 0)) {
      fail('Encrypted or unsupported .fig archive entries cannot be imported.');
    }
    if (method !== 0 && method !== 8) fail('This .fig archive uses an unsupported compression method.');
    const name = boundedName(bytes.subarray(offset + 46, offset + 46 + nameLength));
    assertSafeExtraFields(view, offset + 46 + nameLength, extraLength);
    const foldedName = name.toLowerCase();
    if (names.has(foldedName)) fail('The .fig archive contains duplicate file names.');
    names.add(foldedName);
    if (uncompressedSize > FIG_IMPORT_LIMITS.singleEntryBytes) fail('A .fig archive entry exceeds the safe import size limit.', 'FIG_RESOURCE_LIMIT');
    expandedBytes += uncompressedSize;
    if (!Number.isSafeInteger(expandedBytes) || expandedBytes > FIG_IMPORT_LIMITS.expandedBytes) {
      fail('The .fig archive expands beyond the safe import size limit.', 'FIG_RESOURCE_LIMIT');
    }
    if (name === 'canvas.fig' && uncompressedSize > FIG_IMPORT_LIMITS.canvasBytes) fail('The .fig canvas data exceeds the safe import size limit.', 'FIG_RESOURCE_LIMIT');
    if (name === 'meta.json' && uncompressedSize > FIG_IMPORT_LIMITS.metadataBytes) fail('The .fig metadata exceeds the safe import size limit.', 'FIG_RESOURCE_LIMIT');
    if (name === 'thumbnail.png' && uncompressedSize > FIG_IMPORT_LIMITS.thumbnailBytes) fail('The .fig thumbnail exceeds the safe import size limit.', 'FIG_RESOURCE_LIMIT');
    if (name.startsWith('images/') && name !== 'images/') {
      imageBytes += uncompressedSize;
      if (uncompressedSize > FIG_IMPORT_LIMITS.singleImageBytes || imageBytes > FIG_IMPORT_LIMITS.imageBytes) {
        fail('The .fig image assets exceed the safe import size limit.', 'FIG_RESOURCE_LIMIT');
      }
    }
    entries.push({ name, flags, method, expectedCrc, compressedSize, uncompressedSize, localOffset });
    offset = recordEnd;
  }
  if (offset !== end || !names.has('canvas.fig')) fail('The .fig archive is missing its canvas data.');

  const localRanges = [];
  const output = new Map();
  for (const entry of entries) {
    const local = entry.localOffset;
    if (u32(view, local) !== ZIP_LOCAL) fail('The .fig archive has a corrupt local file header.');
    const flags = u16(view, local + 6);
    const method = u16(view, local + 8);
    const localCrc = u32(view, local + 14);
    const localCompressed = u32(view, local + 18);
    const localExpanded = u32(view, local + 22);
    const nameLength = u16(view, local + 26);
    const extraLength = u16(view, local + 28);
    const headerEnd = local + 30 + nameLength + extraLength;
    if (headerEnd > centralOffset || extraLength > 4096 || flags !== entry.flags || method !== entry.method
      || boundedName(bytes.subarray(local + 30, local + 30 + nameLength)) !== entry.name) {
      fail('The .fig archive local and directory headers do not match.');
    }
    assertSafeExtraFields(view, local + 30 + nameLength, extraLength);
    const hasDescriptor = Boolean(flags & 0x0008);
    if (!hasDescriptor && (localCrc !== entry.expectedCrc || localCompressed !== entry.compressedSize || localExpanded !== entry.uncompressedSize)) {
      fail('The .fig archive local and directory sizes do not match.');
    }
    const dataStart = headerEnd;
    const dataEnd = dataStart + entry.compressedSize;
    if (!Number.isSafeInteger(dataEnd) || dataEnd > centralOffset) fail('The .fig archive data is truncated.');
    let memberEnd = dataEnd;
    if (hasDescriptor) {
      let descriptor = dataEnd;
      if (u32(view, descriptor) === ZIP_DATA_DESCRIPTOR) descriptor += 4;
      if (descriptor + 12 > centralOffset || u32(view, descriptor) !== entry.expectedCrc
        || u32(view, descriptor + 4) !== entry.compressedSize || u32(view, descriptor + 8) !== entry.uncompressedSize) {
        fail('The .fig archive data descriptor is corrupt.');
      }
      memberEnd = descriptor + 12;
    }
    localRanges.push({ start: local, end: memberEnd });
    const compressed = bytes.subarray(dataStart, dataEnd);
    const unpacked = entry.method === 0
      ? (entry.compressedSize === entry.uncompressedSize ? compressed : fail('The .fig archive has invalid stored-entry lengths.'))
      : safeInflate(compressed, entry.uncompressedSize, FIG_IMPORT_LIMITS.singleEntryBytes);
    if (crc32(unpacked) !== entry.expectedCrc) fail('The .fig archive failed its integrity check.');
    if (!entry.name.endsWith('/')) output.set(entry.name, unpacked);
  }
  localRanges.sort((left, right) => left.start - right.start);
  for (let index = 1; index < localRanges.length; index += 1) {
    if (localRanges[index].start < localRanges[index - 1].end) fail('The .fig archive contains overlapping file entries.');
  }
  return output;
}

function zstdFrameContentSize(bytes, offset) {
  if (offset + 6 > bytes.length || !ZSTD_MAGIC.every((value, index) => bytes[offset + index] === value)) return null;
  const descriptor = bytes[offset + 4];
  const singleSegment = Boolean(descriptor & 0x20);
  const contentSizeFlag = descriptor >>> 6;
  const dictionaryFlag = descriptor & 0x03;
  if (!singleSegment || (descriptor & 0x18) !== 0 || dictionaryFlag !== 0) {
    fail('This .fig uses a Zstandard frame that cannot be bounded safely. Export a fresh local copy and retry.', 'FIG_UNSUPPORTED_FRAME');
  }
  const sizeBytes = [1, 2, 4, 8][contentSizeFlag];
  const sizeOffset = offset + 5;
  if (sizeOffset + sizeBytes > bytes.length) fail('The .fig canvas has a truncated Zstandard frame.');
  let size = 0n;
  for (let index = 0; index < sizeBytes; index += 1) size |= BigInt(bytes[sizeOffset + index]) << BigInt(index * 8);
  if (contentSizeFlag === 1) size += 256n;
  if (size < 1n || size > BigInt(FIG_IMPORT_LIMITS.messageBytes)) {
    fail('The .fig design data exceeds the safe import size limit.', 'FIG_RESOURCE_LIMIT');
  }
  let cursor = sizeOffset + sizeBytes;
  let lastBlock = false;
  while (!lastBlock) {
    if (cursor + 3 > bytes.length) fail('The .fig canvas contains a truncated Zstandard block.');
    const blockHeader = bytes[cursor] | (bytes[cursor + 1] << 8) | (bytes[cursor + 2] << 16);
    lastBlock = Boolean(blockHeader & 1);
    const blockType = (blockHeader >>> 1) & 3;
    const blockSize = blockHeader >>> 3;
    if (blockType === 3 || blockSize > 128 * 1024) fail('The .fig canvas contains an unsupported Zstandard block.');
    cursor += 3 + (blockType === 1 ? 1 : blockSize);
    if (!Number.isSafeInteger(cursor) || cursor > bytes.length) fail('The .fig canvas contains a truncated Zstandard block.');
  }
  if (descriptor & 0x04) cursor += 4;
  if (cursor !== bytes.length) fail('The .fig canvas contains trailing or additional compressed data.');
  return Number(size);
}

function canvasChunks(canvasBytes) {
  if (!(canvasBytes instanceof Uint8Array) || canvasBytes.byteLength < 20
    || String.fromCharCode(...canvasBytes.subarray(0, 8)) !== 'fig-kiwi'
    || canvasBytes.byteLength > FIG_IMPORT_LIMITS.canvasBytes) fail('The .fig canvas header is invalid.');
  const view = new DataView(canvasBytes.buffer, canvasBytes.byteOffset, canvasBytes.byteLength);
  const version = u32(view, 8);
  if (version < 1 || version > 10_000) fail('The .fig canvas version is invalid.');
  const chunks = [];
  let offset = 12;
  while (offset < canvasBytes.byteLength) {
    if (chunks.length >= 64 || offset + 4 > canvasBytes.byteLength) fail('The .fig canvas contains too many or truncated data chunks.');
    const length = u32(view, offset);
    offset += 4;
    if (!length || offset + length > canvasBytes.byteLength) fail('The .fig canvas contains a truncated data chunk.');
    chunks.push(canvasBytes.subarray(offset, offset + length));
    offset += length;
  }
  if (chunks.length < 2) fail('The .fig canvas is missing its schema or design data.');
  const schema = inflateBounded(chunks[0], { out: new Uint8Array(FIG_IMPORT_LIMITS.schemaBytes + 1) });
  if (!schema.byteLength || schema.byteLength > FIG_IMPORT_LIMITS.schemaBytes) fail('The .fig schema exceeds the safe import size limit.', 'FIG_RESOURCE_LIMIT');
  const message = chunks[1];
  if (ZSTD_MAGIC.every((value, index) => message[index] === value)) {
    zstdFrameContentSize(message, 0);
  } else {
    const data = inflateBounded(message, { out: new Uint8Array(FIG_IMPORT_LIMITS.messageBytes + 1) });
    if (!data.byteLength || data.byteLength > FIG_IMPORT_LIMITS.messageBytes) fail('The .fig design data exceeds the safe import size limit.', 'FIG_RESOURCE_LIMIT');
  }
  return { version, chunks };
}

/** Validate and boundedly extract a local .fig archive before calling the Kiwi parser. */
export function preflightFigArchive(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const entries = parseZipEntries(bytes);
  const canvas = entries.get('canvas.fig');
  const { version } = canvasChunks(canvas);
  let meta = null;
  const rawMeta = entries.get('meta.json');
  if (rawMeta) {
    try {
      meta = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(rawMeta));
      if (!meta || typeof meta !== 'object' || Array.isArray(meta)) meta = null;
    } catch { fail('The .fig metadata is invalid.'); }
  }
  return { version, entries, meta };
}
