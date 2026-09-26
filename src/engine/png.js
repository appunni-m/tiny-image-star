// Pillow-RS 12.2.0-alpha.1 exposes the real palette through getpalette("RGB")
// but pads the PNG PLTE chunk to 256 entries. Preserve the declared palette
// length without changing indices, pixels, transparency, or compressed data.
let crcTable;
function crc32(bytes) {
  crcTable ??= Uint32Array.from({ length: 256 }, (_, value) => {
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
    return value >>> 0;
  });
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function preservePngPalette(bytes, paletteBytes) {
  if (!(bytes instanceof Uint8Array) || !Number.isInteger(paletteBytes)
      || paletteBytes < 3 || paletteBytes > 768 || paletteBytes % 3) return bytes;
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 8 || data.getUint32(0) !== 0x89504e47 || data.getUint32(4) !== 0x0d0a1a0a) return bytes;
  let palette = null;
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = data.getUint32(offset), type = data.getUint32(offset + 4);
    if (length > bytes.length - offset - 12) throw new Error("invalid PNG chunk length");
    if (type === 0x504c5445) {
      if (length <= paletteBytes) return bytes;
      palette = { offset, length };
    }
    // tRNS is indexed by the palette. Refuse a trim that would truncate a
    // declared alpha entry; leave the encoder result intact for validation.
    if (type === 0x74524e53 && length > paletteBytes / 3) return bytes;
    if (type === 0x49454e44) break;
    offset += length + 12;
  }
  if (!palette) return bytes;
  const { offset, length } = palette;
  const result = new Uint8Array(bytes.length - length + paletteBytes);
  result.set(bytes.subarray(0, offset + 8 + paletteBytes));
  result.set(bytes.subarray(offset + 12 + length), offset + 12 + paletteBytes);
  const view = new DataView(result.buffer);
  view.setUint32(offset, paletteBytes);
  view.setUint32(offset + 8 + paletteBytes, crc32(result.subarray(offset + 4, offset + 8 + paletteBytes)));
  return result;
}
