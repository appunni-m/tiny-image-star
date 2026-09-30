const encoder = new TextEncoder();
const UINT32_MAX = 0xffff_ffff;
export const MAX_STORED_ZIP_BYTES = 128 * 1024 * 1024;
export const MAX_STORED_ZIP_ENTRIES = 4096;

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb8_8320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function abortIfNeeded(signal) {
  if (signal?.aborted) throw new DOMException('Export canceled.', 'AbortError');
}

function dataLength(data) {
  if (data instanceof Blob) return data.size;
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (ArrayBuffer.isView(data)) return data.byteLength;
  throw new TypeError('ZIP entries must contain a Blob or byte array.');
}

function asBytes(data) {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return null;
}

function updateCrc32(crc, bytes) {
  let value = crc ^ UINT32_MAX;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ UINT32_MAX) >>> 0;
}

async function dataCrc32(data, signal) {
  const bytes = asBytes(data);
  if (bytes) return updateCrc32(0, bytes);
  let crc = 0;
  const reader = data.stream().getReader();
  try {
    while (true) {
      abortIfNeeded(signal);
      const { done, value } = await reader.read();
      if (done) break;
      crc = updateCrc32(crc, value);
    }
  } finally {
    reader.releaseLock();
  }
  return crc;
}

function dosDateTime() {
  // A deterministic DOS date (1980-01-01) avoids time-dependent ZIP bytes.
  return { date: 0x0021, time: 0 };
}

function localHeader(name, size, crc) {
  const header = new Uint8Array(30);
  const view = new DataView(header.buffer);
  const { date, time } = dosDateTime();
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 0x0800, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, time, true);
  view.setUint16(12, date, true);
  view.setUint32(14, crc, true);
  view.setUint32(18, size, true);
  view.setUint32(22, size, true);
  view.setUint16(26, name.byteLength, true);
  view.setUint16(28, 0, true);
  return header;
}

function centralHeader(name, size, crc, offset) {
  const header = new Uint8Array(46);
  const view = new DataView(header.buffer);
  const { date, time } = dosDateTime();
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(8, 0x0800, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, time, true);
  view.setUint16(14, date, true);
  view.setUint32(16, crc, true);
  view.setUint32(20, size, true);
  view.setUint32(24, size, true);
  view.setUint16(28, name.byteLength, true);
  view.setUint16(30, 0, true);
  view.setUint16(32, 0, true);
  view.setUint16(34, 0, true);
  view.setUint16(36, 0, true);
  view.setUint32(38, 0, true);
  view.setUint32(42, offset, true);
  return header;
}

function endOfCentralDirectory(entryCount, centralSize, centralOffset) {
  const end = new Uint8Array(22);
  const view = new DataView(end.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(4, 0, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, entryCount, true);
  view.setUint16(10, entryCount, true);
  view.setUint32(12, centralSize, true);
  view.setUint32(16, centralOffset, true);
  view.setUint16(20, 0, true);
  return end;
}

function normalizeEntries(entries, maxEntries, maxArchiveBytes) {
  if (!Array.isArray(entries) || entries.length === 0) throw new TypeError('A ZIP archive needs at least one file.');
  if (entries.length > maxEntries || entries.length > 0xffff) throw new RangeError(`This archive exceeds the ${maxEntries.toLocaleString()}-file limit.`);
  const names = new Set();
  let total = 22;
  const normalized = entries.map((entry, index) => {
    if (!entry || typeof entry.name !== 'string') throw new TypeError(`ZIP entry ${index + 1} needs a file name.`);
    const name = entry.name.normalize('NFC');
    if (!name || name === '.' || name === '..' || /[\\/\u0000-\u001f\u007f]/.test(name)) throw new TypeError(`ZIP entry ${index + 1} has an unsafe file name.`);
    const nameBytes = encoder.encode(name);
    if (nameBytes.byteLength > 0xffff) throw new RangeError(`ZIP entry ${index + 1} has a file name that is too long.`);
    if (names.has(name)) throw new TypeError(`The ZIP contains duplicate file name “${name}”.`);
    names.add(name);
    const size = dataLength(entry.data);
    if (!Number.isSafeInteger(size) || size < 0 || size > UINT32_MAX) throw new RangeError(`ZIP entry “${name}” exceeds the ZIP32 file-size limit.`);
    total += 30 + nameBytes.byteLength + size + 46 + nameBytes.byteLength;
    if (!Number.isSafeInteger(total) || total > maxArchiveBytes || total > UINT32_MAX) {
      throw new RangeError(`This ZIP would exceed the ${Math.floor(maxArchiveBytes / (1024 * 1024))} MiB local archive limit.`);
    }
    return { name, nameBytes, data: entry.data, size };
  });
  return { entries: normalized, total };
}

/**
 * Build a deterministic, uncompressed ZIP Blob from already-compressed image files.
 * Size and entry limits are checked before reading file bytes or allocating archive headers.
 */
export async function createStoredZip(entries, {
  maxArchiveBytes = MAX_STORED_ZIP_BYTES,
  maxEntries = MAX_STORED_ZIP_ENTRIES,
  signal
} = {}) {
  if (!Number.isSafeInteger(maxArchiveBytes) || maxArchiveBytes < 22) throw new RangeError('The ZIP archive byte limit is invalid.');
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) throw new RangeError('The ZIP archive file-count limit is invalid.');
  const preflight = normalizeEntries(entries, maxEntries, maxArchiveBytes);
  abortIfNeeded(signal);

  const parts = [];
  const centralParts = [];
  let localOffset = 0;
  for (const entry of preflight.entries) {
    abortIfNeeded(signal);
    const crc = await dataCrc32(entry.data, signal);
    abortIfNeeded(signal);
    parts.push(localHeader(entry.nameBytes, entry.size, crc), entry.nameBytes, entry.data);
    centralParts.push(centralHeader(entry.nameBytes, entry.size, crc, localOffset), entry.nameBytes);
    localOffset += 30 + entry.nameBytes.byteLength + entry.size;
  }
  const centralOffset = localOffset;
  const centralSize = centralParts.reduce((sum, part) => sum + part.byteLength, 0);
  parts.push(...centralParts, endOfCentralDirectory(preflight.entries.length, centralSize, centralOffset));
  const archive = new Blob(parts, { type: 'application/zip' });
  if (archive.size !== preflight.total) throw new Error('The ZIP writer produced an unexpected archive size.');
  return archive;
}
