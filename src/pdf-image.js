const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const MAX_IMAGE_PIXELS = 80_000_000;
const MAX_PNG_DECODED_BYTES = 128 * 1024 * 1024;

export class PdfImageFormatError extends TypeError {
  constructor(message) {
    super(message);
    this.name = 'PdfImageFormatError';
  }
}

function unsupported(message) {
  throw new PdfImageFormatError(message);
}

function dataView(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function readU32(bytes, offset) {
  if (offset < 0 || offset + 4 > bytes.length) unsupported('the embedded image data is truncated; re-export the image as PNG or JPEG');
  return dataView(bytes).getUint32(offset, false);
}

function decodeBase64(value) {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    unsupported('the embedded image has malformed base64 data; re-export it as PNG or JPEG');
  }
  try {
    const binary = typeof atob === 'function' ? atob(value) : Buffer.from(value, 'base64').toString('binary');
    return Uint8Array.from(binary, character => character.charCodeAt(0));
  } catch {
    unsupported('the embedded image has malformed base64 data; re-export it as PNG or JPEG');
  }
}

function parseDataUri(value) {
  const match = /^data:([^;,]+);base64,([\s\S]*)$/i.exec(value || '');
  if (!match) unsupported('images must be self-contained base64 data URLs; export the source as PNG or JPEG');
  const type = match[1].toLowerCase();
  if (!['image/png', 'image/jpeg'].includes(type)) {
    unsupported(`${type || 'this image encoding'} is not supported; export the source as PNG or JPEG`);
  }
  return { type, bytes: decodeBase64(match[2]) };
}

function validateImageDimensions(width, height, byteCount) {
  const pixels = width * height;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1
    || !Number.isSafeInteger(pixels) || pixels > MAX_IMAGE_PIXELS) {
    unsupported(`the embedded image dimensions exceed the ${MAX_IMAGE_PIXELS.toLocaleString()}-pixel vector-PDF limit; resize the source or use raster PDF`);
  }
  if (!Number.isSafeInteger(byteCount) || byteCount < 1 || byteCount > MAX_PNG_DECODED_BYTES) {
    unsupported(`the decoded PNG exceeds the ${Math.floor(MAX_PNG_DECODED_BYTES / (1024 * 1024))} MiB vector-PDF image limit; resize the source or use raster PDF`);
  }
}

function crcTable() {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
}
const PNG_CRC_TABLE = crcTable();

function crc32(bytes, start, end) {
  let crc = 0xffffffff;
  for (let index = start; index < end; index += 1) crc = PNG_CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function concatBytes(chunks, totalLength) {
  const output = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  return output;
}

function pngChunks(bytes) {
  if (bytes.length < 33 || !PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) {
    unsupported('the PNG header is invalid or incomplete; re-export the source image');
  }
  const view = dataView(bytes);
  let cursor = 8;
  let header = null;
  let palette = null;
  let transparency = null;
  let sawData = false;
  let dataEnded = false;
  let ended = false;
  let dataLength = 0;
  const dataChunks = [];
  while (cursor < bytes.length) {
    if (cursor + 12 > bytes.length) unsupported('the PNG contains a truncated chunk; re-export the source image');
    const length = view.getUint32(cursor, false);
    const typeStart = cursor + 4;
    const dataStart = cursor + 8;
    const crcOffset = dataStart + length;
    if (crcOffset + 4 > bytes.length) unsupported('the PNG contains a truncated chunk; re-export the source image');
    let type = '';
    for (let index = 0; index < 4; index += 1) type += String.fromCharCode(bytes[typeStart + index]);
    if (crc32(bytes, typeStart, crcOffset) !== view.getUint32(crcOffset, false)) {
      unsupported(`the PNG ${type} chunk failed its integrity check; re-export the source image`);
    }
    const chunk = bytes.subarray(dataStart, crcOffset);
    if (!header && type !== 'IHDR') unsupported('the PNG does not begin with an IHDR header; re-export the source image');
    if (type === 'IHDR') {
      if (header || length !== 13 || cursor !== 8) unsupported('the PNG IHDR header is invalid; re-export the source image');
      header = {
        width: view.getUint32(dataStart, false),
        height: view.getUint32(dataStart + 4, false),
        bitDepth: bytes[dataStart + 8],
        colorType: bytes[dataStart + 9],
        compression: bytes[dataStart + 10],
        filter: bytes[dataStart + 11],
        interlace: bytes[dataStart + 12],
      };
      if (header.compression !== 0 || header.filter !== 0) unsupported('the PNG uses unsupported compression or filter methods; export it as a standard PNG');
      if (header.interlace !== 0) unsupported('interlaced PNG is not supported yet; export a non-interlaced PNG or use raster PDF');
    } else if (type === 'PLTE') {
      if (sawData || palette || length === 0 || length % 3 || length > 768) unsupported('the PNG palette is invalid; re-export the source image');
      palette = new Uint8Array(chunk);
    } else if (type === 'tRNS') {
      if (sawData || transparency) unsupported('the PNG transparency chunk is invalid; re-export the source image');
      transparency = new Uint8Array(chunk);
    } else if (type === 'IDAT') {
      if (dataEnded) unsupported('the PNG image-data chunks are not contiguous; re-export the source image');
      sawData = true;
      dataLength += length;
      if (!Number.isSafeInteger(dataLength) || dataLength > bytes.length) unsupported('the PNG image data is too large; resize the source or use raster PDF');
      dataChunks.push(new Uint8Array(chunk));
    } else if (type === 'IEND') {
      if (length !== 0 || !sawData || cursor + 12 !== bytes.length) unsupported('the PNG end marker is invalid; re-export the source image');
      ended = true;
      cursor += 12;
      break;
    } else {
      if (sawData) dataEnded = true;
      if (type === 'acTL') unsupported('animated PNG is not supported; export a still PNG or use raster PDF');
      if (type[0] === type[0].toUpperCase()) unsupported(`PNG chunk ${type} uses unsupported image features; export a standard PNG`);
    }
    if (sawData && type !== 'IDAT') dataEnded = true;
    cursor = crcOffset + 4;
  }
  if (!ended || cursor !== bytes.length || !header) unsupported('the PNG is incomplete; re-export the source image');
  if (!dataLength) unsupported('the PNG has no image data; re-export the source image');
  return { header, palette, transparency, compressed: concatBytes(dataChunks, dataLength) };
}

class BitReader {
  constructor(bytes, end) { this.bytes = bytes; this.end = end; this.bit = 0; }

  readBits(count) {
    let result = 0;
    for (let index = 0; index < count; index += 1) {
      const byteIndex = this.bit >>> 3;
      if (byteIndex >= this.end) unsupported('the PNG deflate stream is truncated; re-export the source image');
      result |= ((this.bytes[byteIndex] >>> (this.bit & 7)) & 1) << index;
      this.bit += 1;
    }
    return result;
  }

  readByte() { return this.readBits(8); }
  align() { this.bit = (this.bit + 7) & ~7; }

  readU16() {
    const low = this.readByte();
    return low | (this.readByte() << 8);
  }
}

function buildHuffman(lengths) {
  const maxBits = Math.max(...lengths);
  if (maxBits < 1 || maxBits > 15) unsupported('the PNG deflate stream contains an invalid Huffman table');
  const counts = new Uint16Array(maxBits + 1);
  for (const length of lengths) {
    if (length < 0 || length > maxBits) unsupported('the PNG deflate stream contains an invalid Huffman code length');
    if (length) counts[length] += 1;
  }
  const nextCode = new Uint16Array(maxBits + 1);
  let code = 0;
  for (let bits = 1; bits <= maxBits; bits += 1) {
    code = (code + counts[bits - 1]) << 1;
    nextCode[bits] = code;
  }
  const tables = Array.from({ length: maxBits + 1 }, () => new Map());
  for (let symbol = 0; symbol < lengths.length; symbol += 1) {
    const length = lengths[symbol];
    if (length) tables[length].set(nextCode[length]++, symbol);
  }
  return { maxBits, tables };
}

function decodeSymbol(reader, huffman) {
  let code = 0;
  for (let length = 1; length <= huffman.maxBits; length += 1) {
    code = (code << 1) | reader.readBits(1);
    const symbol = huffman.tables[length].get(code);
    if (symbol != null) return symbol;
  }
  unsupported('the PNG deflate stream contains an invalid Huffman code');
}

const FIXED_LITERAL_LENGTHS = Array.from({ length: 288 }, (_, symbol) =>
  symbol <= 143 ? 8 : symbol <= 255 ? 9 : symbol <= 279 ? 7 : 8);
const FIXED_DISTANCE_LENGTHS = new Array(32).fill(5);
const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DISTANCE_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DISTANCE_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];

function dynamicHuffmanTables(reader) {
  const literalCount = reader.readBits(5) + 257;
  const distanceCount = reader.readBits(5) + 1;
  const codeLengthCount = reader.readBits(4) + 4;
  const order = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
  const codeLengths = new Array(19).fill(0);
  for (let index = 0; index < codeLengthCount; index += 1) codeLengths[order[index]] = reader.readBits(3);
  const lengthCode = buildHuffman(codeLengths);
  const total = literalCount + distanceCount;
  const lengths = [];
  while (lengths.length < total) {
    const symbol = decodeSymbol(reader, lengthCode);
    if (symbol <= 15) lengths.push(symbol);
    else if (symbol === 16) {
      if (!lengths.length) unsupported('the PNG deflate stream has an invalid repeated code length');
      const repeat = reader.readBits(2) + 3;
      lengths.push(...new Array(repeat).fill(lengths.at(-1)));
    } else if (symbol === 17) lengths.push(...new Array(reader.readBits(3) + 3).fill(0));
    else if (symbol === 18) lengths.push(...new Array(reader.readBits(7) + 11).fill(0));
    else unsupported('the PNG deflate stream has an invalid code length symbol');
    if (lengths.length > total) unsupported('the PNG deflate stream has an oversized Huffman table');
  }
  const literalLengths = lengths.slice(0, literalCount);
  const distanceLengths = lengths.slice(literalCount);
  if (!literalLengths[256]) unsupported('the PNG deflate stream has no end-of-block code');
  return { literal: buildHuffman(literalLengths), distance: buildHuffman(distanceLengths) };
}

function adler32(bytes) {
  let first = 1;
  let second = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    first = (first + bytes[index]) % 65521;
    second = (second + first) % 65521;
  }
  return ((second << 16) | first) >>> 0;
}

function inflateZlib(bytes, expectedLength) {
  if (bytes.length < 6) unsupported('the PNG deflate stream is too short; re-export the source image');
  const cmf = bytes[0]; const flg = bytes[1];
  if ((cmf & 15) !== 8 || (cmf >>> 4) > 7 || ((cmf << 8) + flg) % 31 !== 0 || (flg & 32)) {
    unsupported('the PNG uses an unsupported zlib compression header; export a standard PNG');
  }
  const reader = new BitReader(bytes, bytes.length - 4);
  reader.bit = 16;
  const output = new Uint8Array(expectedLength);
  let offset = 0;
  let final = false;
  while (!final) {
    final = Boolean(reader.readBits(1));
    const blockType = reader.readBits(2);
    if (blockType === 0) {
      reader.align();
      const length = reader.readU16();
      const complement = reader.readU16();
      if (((length ^ complement) & 0xffff) !== 0xffff || offset + length > output.length) {
        unsupported('the PNG deflate stream contains an invalid uncompressed block');
      }
      for (let index = 0; index < length; index += 1) output[offset++] = reader.readByte();
      continue;
    }
    if (blockType === 3) unsupported('the PNG deflate stream uses a reserved block type');
    const tables = blockType === 1
      ? { literal: buildHuffman(FIXED_LITERAL_LENGTHS), distance: buildHuffman(FIXED_DISTANCE_LENGTHS) }
      : dynamicHuffmanTables(reader);
    while (true) {
      const symbol = decodeSymbol(reader, tables.literal);
      if (symbol < 256) {
        if (offset >= output.length) unsupported('the PNG deflate stream expands beyond its declared image dimensions');
        output[offset++] = symbol;
      } else if (symbol === 256) break;
      else {
        const lengthIndex = symbol - 257;
        if (lengthIndex < 0 || lengthIndex >= LENGTH_BASE.length) unsupported('the PNG deflate stream uses a reserved length code');
        const length = LENGTH_BASE[lengthIndex] + reader.readBits(LENGTH_EXTRA[lengthIndex]);
        const distanceSymbol = decodeSymbol(reader, tables.distance);
        if (distanceSymbol >= DISTANCE_BASE.length) unsupported('the PNG deflate stream uses a reserved distance code');
        const distance = DISTANCE_BASE[distanceSymbol] + reader.readBits(DISTANCE_EXTRA[distanceSymbol]);
        if (distance > offset || offset + length > output.length) unsupported('the PNG deflate stream contains an invalid back-reference');
        for (let index = 0; index < length; index += 1) {
          output[offset] = output[offset - distance];
          offset += 1;
        }
      }
    }
  }
  if (offset !== output.length) unsupported('the PNG deflate output does not match its declared dimensions');
  const expectedAdler = readU32(bytes, bytes.length - 4);
  if (adler32(output) !== expectedAdler) unsupported('the PNG deflate checksum is invalid; re-export the source image');
  return output;
}

function paeth(left, above, upperLeft) {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  return leftDistance <= aboveDistance && leftDistance <= upperLeftDistance ? left
    : aboveDistance <= upperLeftDistance ? above : upperLeft;
}

function unfilterPngRows(filtered, width, height, bitDepth, channels) {
  const rowBytes = Math.ceil(width * channels * bitDepth / 8);
  const bpp = Math.max(1, Math.ceil(channels * bitDepth / 8));
  const pixels = new Uint8Array(rowBytes * height);
  let sourceOffset = 0;
  for (let row = 0; row < height; row += 1) {
    const filter = filtered[sourceOffset++];
    if (filter > 4) unsupported('the PNG uses an unknown row filter; re-export the source image');
    const rowOffset = row * rowBytes;
    const previousOffset = rowOffset - rowBytes;
    for (let column = 0; column < rowBytes; column += 1) {
      const raw = filtered[sourceOffset++];
      const left = column >= bpp ? pixels[rowOffset + column - bpp] : 0;
      const above = row ? pixels[previousOffset + column] : 0;
      const upperLeft = row && column >= bpp ? pixels[previousOffset + column - bpp] : 0;
      const predictor = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? above
        : filter === 3 ? Math.floor((left + above) / 2) : paeth(left, above, upperLeft);
      pixels[rowOffset + column] = (raw + predictor) & 0xff;
    }
  }
  return { pixels, rowBytes };
}

function zlibStored(bytes) {
  const blocks = Math.max(1, Math.ceil(bytes.length / 65535));
  const output = new Uint8Array(2 + bytes.length + blocks * 5 + 4);
  output[0] = 0x78; output[1] = 0x01;
  let inputOffset = 0;
  let outputOffset = 2;
  while (inputOffset < bytes.length || (!bytes.length && outputOffset === 2)) {
    const length = Math.min(65535, bytes.length - inputOffset);
    const final = inputOffset + length >= bytes.length;
    output[outputOffset++] = final ? 1 : 0;
    output[outputOffset++] = length & 0xff;
    output[outputOffset++] = length >>> 8;
    output[outputOffset++] = (~length) & 0xff;
    output[outputOffset++] = ((~length) >>> 8) & 0xff;
    output.set(bytes.subarray(inputOffset, inputOffset + length), outputOffset);
    outputOffset += length;
    inputOffset += length;
    if (!bytes.length) break;
  }
  const checksum = adler32(bytes);
  output[outputOffset++] = checksum >>> 24;
  output[outputOffset++] = checksum >>> 16;
  output[outputOffset++] = checksum >>> 8;
  output[outputOffset++] = checksum;
  return output.subarray(0, outputOffset);
}

function pdfHex(bytes) {
  let result = '';
  for (const byte of bytes) result += byte.toString(16).padStart(2, '0');
  return result.toUpperCase();
}

function pngImage(bytes) {
  const parsed = pngChunks(bytes);
  const { width, height, bitDepth, colorType } = parsed.header;
  const channelsByType = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  const channels = channelsByType[colorType];
  if (!channels) unsupported('this PNG color type is not supported; export it as RGB, RGBA, grayscale, or indexed PNG');
  const legalDepths = colorType === 3 ? [1, 2, 4, 8]
    : colorType === 0 ? [1, 2, 4, 8, 16]
      : [8, 16];
  if (!legalDepths.includes(bitDepth)) unsupported('this PNG bit depth is not supported; export it as 8-bit or 16-bit PNG');
  if (colorType === 3 && !parsed.palette) unsupported('the indexed PNG is missing its color palette; re-export the source image');
  const paletteEntries = parsed.palette?.length / 3 || 0;
  if (colorType === 3 && paletteEntries > (1 << bitDepth)) unsupported('the PNG palette exceeds its indexed color depth; re-export the source image');
  if (parsed.transparency) {
    const validTransparency = colorType === 0 ? parsed.transparency.length === 2
      : colorType === 2 ? parsed.transparency.length === 6
        : colorType === 3 ? parsed.transparency.length <= paletteEntries
          : false;
    if (!validTransparency) unsupported('the PNG transparency data is invalid for its color type; re-export the source image');
  }
  const pixels = width * height;
  if (!Number.isSafeInteger(pixels) || pixels < 1 || pixels > MAX_IMAGE_PIXELS) {
    validateImageDimensions(width, height, 1);
  }
  const rowBytes = Math.ceil(width * channels * bitDepth / 8);
  const filteredLength = height * (rowBytes + 1);
  if (!Number.isSafeInteger(filteredLength) || filteredLength > MAX_PNG_DECODED_BYTES) {
    validateImageDimensions(width, height, filteredLength);
  }
  const descriptor = {
    width, height, displayWidth: width, displayHeight: height,
    bitsPerComponent: bitDepth, filter: 'FlateDecode', data: parsed.compressed
  };
  if (colorType === 0) {
    descriptor.colorSpace = '/DeviceGray';
    descriptor.decodeParms = `/DecodeParms << /Predictor 15 /Colors 1 /BitsPerComponent ${bitDepth} /Columns ${width} >>`;
    if (parsed.transparency) {
      const transparent = (parsed.transparency[0] << 8) | parsed.transparency[1];
      if (transparent >= 2 ** bitDepth) unsupported('the grayscale PNG transparency sample is out of range; re-export the source image');
      descriptor.mask = `/Mask [${transparent} ${transparent}]`;
    }
  } else if (colorType === 2) {
    descriptor.colorSpace = '/DeviceRGB';
    descriptor.decodeParms = `/DecodeParms << /Predictor 15 /Colors 3 /BitsPerComponent ${bitDepth} /Columns ${width} >>`;
    if (parsed.transparency) {
      const values = [0, 2, 4].map(offset => (parsed.transparency[offset] << 8) | parsed.transparency[offset + 1]);
      if (values.some(value => value >= 2 ** bitDepth)) unsupported('the RGB PNG transparency sample is out of range; re-export the source image');
      descriptor.mask = `/Mask [${values.map(value => `${value} ${value}`).join(' ')}]`;
    }
  } else if (colorType === 3) {
    descriptor.colorSpace = `[/Indexed /DeviceRGB ${paletteEntries - 1} <${pdfHex(parsed.palette)}>]`;
    descriptor.decodeParms = `/DecodeParms << /Predictor 15 /Colors 1 /BitsPerComponent ${bitDepth} /Columns ${width} >>`;
    const alpha = parsed.transparency;
    if (alpha && [...alpha].some(value => value !== 255)) {
      if (filteredLength * 2 > MAX_PNG_DECODED_BYTES) {
        validateImageDimensions(width, height, filteredLength * 2);
      }
      const filtered = inflateZlib(parsed.compressed, filteredLength);
      const { pixels: rows } = unfilterPngRows(filtered, width, height, bitDepth, 1);
      const mask = new Uint8Array(pixels);
      const sampleMask = (1 << bitDepth) - 1;
      for (let row = 0; row < height; row += 1) {
        const rowOffset = row * rowBytes;
        for (let column = 0; column < width; column += 1) {
          const bitOffset = column * bitDepth;
          const shift = 8 - bitDepth - (bitOffset & 7);
          const paletteIndex = (rows[rowOffset + (bitOffset >>> 3)] >>> shift) & sampleMask;
          if (paletteIndex >= paletteEntries) unsupported('the indexed PNG references a missing palette color; re-export the source image');
          mask[row * width + column] = alpha[paletteIndex] ?? 255;
        }
      }
      descriptor.alpha = { bitsPerComponent: 8, data: zlibStored(mask) };
    }
  } else {
    const rawBytes = height * rowBytes;
    if (!Number.isSafeInteger(rawBytes) || rawBytes + filteredLength > MAX_PNG_DECODED_BYTES) {
      validateImageDimensions(width, height, rawBytes + filteredLength);
    }
    const filtered = inflateZlib(parsed.compressed, filteredLength);
    const { pixels: rows } = unfilterPngRows(filtered, width, height, bitDepth, channels);
    const bytesPerSample = bitDepth / 8;
    const colorChannels = colorType === 4 ? 1 : 3;
    const colorBytes = new Uint8Array(pixels * colorChannels * bytesPerSample);
    const alphaBytes = new Uint8Array(pixels * bytesPerSample);
    let colorOffset = 0;
    let alphaOffset = 0;
    for (let pixel = 0; pixel < pixels; pixel += 1) {
      const sourceOffset = pixel * channels * bytesPerSample;
      for (let channel = 0; channel < colorChannels; channel += 1) {
        for (let byte = 0; byte < bytesPerSample; byte += 1) colorBytes[colorOffset++] = rows[sourceOffset + channel * bytesPerSample + byte];
      }
      for (let byte = 0; byte < bytesPerSample; byte += 1) alphaBytes[alphaOffset++] = rows[sourceOffset + colorChannels * bytesPerSample + byte];
    }
    descriptor.colorSpace = colorChannels === 1 ? '/DeviceGray' : '/DeviceRGB';
    descriptor.data = zlibStored(colorBytes);
    // These streams contain unpacked, unfiltered samples rather than PNG row
    // records, so a PDF PNG-predictor DecodeParms entry would reinterpret the
    // first pixel byte as a per-row filter tag.
    descriptor.decodeParms = '';
    descriptor.alpha = { bitsPerComponent: bitDepth, data: zlibStored(alphaBytes) };
  }
  return descriptor;
}

function exifOrientation(segment) {
  if (segment.length < 14 || String.fromCharCode(...segment.subarray(0, 6)) !== 'Exif\0\0') return null;
  const tiffOffset = 6;
  const endian = String.fromCharCode(segment[tiffOffset], segment[tiffOffset + 1]);
  if (endian !== 'II' && endian !== 'MM') return null;
  const little = endian === 'II';
  const view = dataView(segment);
  const u16 = offset => offset + 2 <= segment.length ? view.getUint16(offset, little) : 0;
  const u32 = offset => offset + 4 <= segment.length ? view.getUint32(offset, little) : 0;
  if (u16(tiffOffset + 2) !== 42) return null;
  const ifd = tiffOffset + u32(tiffOffset + 4);
  const count = u16(ifd);
  for (let index = 0; index < count; index += 1) {
    const entry = ifd + 2 + index * 12;
    if (entry + 12 > segment.length) return null;
    if (u16(entry) === 0x0112 && u16(entry + 2) === 3 && u32(entry + 4) >= 1) {
      const orientation = u16(entry + 8);
      return orientation >= 1 && orientation <= 8 ? orientation : null;
    }
  }
  return null;
}

function jpegImage(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) unsupported('the JPEG header is invalid; re-export the source image');
  let cursor = 2;
  let frame = null;
  let orientation = 1;
  let hasExifOrientation = false;
  while (cursor < bytes.length) {
    while (bytes[cursor] === 0xff) cursor += 1;
    if (cursor >= bytes.length) break;
    const marker = bytes[cursor++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (cursor + 2 > bytes.length) unsupported('the JPEG marker data is truncated; re-export the source image');
    const length = (bytes[cursor] << 8) | bytes[cursor + 1];
    if (length < 2 || cursor + length > bytes.length) unsupported('the JPEG marker data is truncated; re-export the source image');
    const segmentStart = cursor + 2;
    const segmentEnd = cursor + length;
    if (marker === 0xe1 && !hasExifOrientation) {
      const parsedOrientation = exifOrientation(bytes.subarray(segmentStart, segmentEnd));
      if (parsedOrientation !== null) {
        orientation = parsedOrientation;
        hasExifOrientation = true;
      }
    }
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (length < 8) unsupported('the JPEG frame header is invalid; re-export the source image');
      frame = {
        marker,
        precision: bytes[segmentStart],
        height: (bytes[segmentStart + 1] << 8) | bytes[segmentStart + 2],
        width: (bytes[segmentStart + 3] << 8) | bytes[segmentStart + 4],
        components: bytes[segmentStart + 5],
      };
      break;
    }
    cursor = segmentEnd;
  }
  if (!frame || ![0xc0, 0xc1, 0xc2].includes(frame.marker) || frame.precision !== 8 || ![1, 3].includes(frame.components)) {
    unsupported('this JPEG variant is not supported; convert it to baseline/progressive 8-bit grayscale/RGB JPEG or PNG');
  }
  validateImageDimensions(frame.width, frame.height, 1);
  const displayWidth = orientation >= 5 ? frame.height : frame.width;
  const displayHeight = orientation >= 5 ? frame.width : frame.height;
  return {
    width: frame.width,
    height: frame.height,
    bitsPerComponent: 8,
    colorSpace: frame.components === 1 ? '/DeviceGray' : '/DeviceRGB',
    filter: 'DCTDecode',
    data: bytes,
    orientation,
    displayWidth,
    displayHeight,
  };
}

/** Decode the supported, self-contained SVG raster source into PDF image data. */
export function decodePdfImageDataUri(value) {
  const { type, bytes } = parseDataUri(value);
  return type === 'image/png' ? pngImage(bytes) : jpegImage(bytes);
}
