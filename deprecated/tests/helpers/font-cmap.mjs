import assert from "node:assert/strict";

// Independent test-only reader for the format 4/12 Unicode subtables used by
// our four pinned SFNT binaries. This is not an arbitrary-font import decoder.
// Mapping rules: https://learn.microsoft.com/en-us/typography/opentype/spec/cmap
export function fontUnicodeRanges(bytes) {
  let cmap;
  for (let i = 0; i < bytes.readUInt16BE(4); i++) {
    const directory = 12 + i * 16;
    if (bytes.toString("ascii", directory, directory + 4) === "cmap") {
      const start = bytes.readUInt32BE(directory + 8), length = bytes.readUInt32BE(directory + 12);
      assert.ok(start + length <= bytes.length); cmap = bytes.subarray(start, start + length);
    }
  }
  assert.ok(cmap); assert.equal(cmap.readUInt16BE(0), 0);
  const records = [];
  for (let i = 0; i < cmap.readUInt16BE(2); i++) {
    const at = 4 + i * 8, platform = cmap.readUInt16BE(at), encoding = cmap.readUInt16BE(at + 2), offset = cmap.readUInt32BE(at + 4);
    const format = cmap.readUInt16BE(offset);
    if ((platform === 0 || platform === 3 && [1, 10].includes(encoding)) && [4, 12].includes(format)) records.push({ offset, format, platform });
  }
  records.sort((a, b) => b.format - a.format || b.platform - a.platform);
  assert.ok(records.length); const { offset, format } = records[0];
  const length = format === 12 ? cmap.readUInt32BE(offset + 4) : cmap.readUInt16BE(offset + 2);
  assert.ok(offset + length <= cmap.length); const table = cmap.subarray(offset, offset + length), points = [];
  const add = (point, glyph) => { assert.ok(point <= 0x10ffff); if (glyph) points.push(point); assert.ok(points.length <= 100_000); };
  if (format === 12) {
    const groups = table.readUInt32BE(12); assert.ok(16 + 12 * groups <= length);
    for (let i = 0; i < groups; i++) {
      const at = 16 + 12 * i, start = table.readUInt32BE(at), end = table.readUInt32BE(at + 4), first = table.readUInt32BE(at + 8);
      assert.ok(start <= end && end <= 0x10ffff && end - start <= 100_000);
      for (let point = start; point <= end; point++) add(point, first + point - start);
    }
  } else {
    const count = table.readUInt16BE(6) / 2; assert.ok(Number.isInteger(count));
    const ends = 14, starts = ends + 2 * count + 2, deltas = starts + 2 * count, offsets = deltas + 2 * count;
    assert.ok(offsets + 2 * count <= length);
    for (let i = 0; i < count; i++) {
      const start = table.readUInt16BE(starts + 2 * i), end = table.readUInt16BE(ends + 2 * i), delta = table.readInt16BE(deltas + 2 * i), range = table.readUInt16BE(offsets + 2 * i);
      assert.ok(start <= end);
      for (let point = start; point <= end; point++) {
        const raw = range ? table.readUInt16BE(offsets + 2 * i + range + 2 * (point - start)) : point;
        add(point, range && raw === 0 ? 0 : (raw + delta) & 0xffff);
      }
    }
  }
  const ranges = [];
  for (const point of [...new Set(points)].sort((a, b) => a - b)) {
    if (ranges.length && ranges.at(-1)[1] + 1 === point) ranges.at(-1)[1] = point;
    else ranges.push([point, point]);
  }
  return ranges;
}
