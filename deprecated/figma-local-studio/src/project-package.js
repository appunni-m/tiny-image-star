import { serializeProject } from './model.js';

const MAGIC = 'LOCALSTUDIO-DESIGN/1\n';
const MAGIC_BYTES = new TextEncoder().encode(MAGIC);
const MAX_PACKAGE_BYTES = 600 * 1024 * 1024;
const MAX_ASSETS = 10_000;

export function packProject(project, assets) {
  const metadata = { format: 'local-studio-design', version: 1, project: JSON.parse(serializeProject(project)), assets: [] };
  const payload = [];
  const packedIds = new Set();
  let offset = 0;
  for (const page of project.pages) for (const node of page.nodes) {
    if (node.type !== 'image') continue;
    const id = node.assetId || node.id;
    if (packedIds.has(id)) continue;
    const bytes = assets.get(id);
    if (!(bytes instanceof Uint8Array)) throw new Error(`Image “${node.sourceName || node.name}” is not available in memory.`);
    packedIds.add(id);
    metadata.assets.push({ id, name: node.sourceName || node.name, type: node.sourceType || 'image/png', offset, length: bytes.byteLength });
    payload.push(bytes);
    offset += bytes.byteLength;
  }
  const header = new TextEncoder().encode(`${JSON.stringify(metadata)}\n`);
  return new Blob([MAGIC_BYTES, header, ...payload], { type: 'application/x-local-studio' });
}

export function unpackProjectPackage(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength > MAX_PACKAGE_BYTES || bytes.byteLength < MAGIC_BYTES.byteLength + 2) throw new Error('This design file is too large or incomplete.');
  for (let i = 0; i < MAGIC_BYTES.length; i++) if (bytes[i] !== MAGIC_BYTES[i]) throw new Error('This is not a Local Studio design file.');
  let newline = MAGIC_BYTES.length;
  while (newline < bytes.length && bytes[newline] !== 10) newline++;
  if (newline >= bytes.length) throw new Error('The design file header is incomplete.');
  let metadata;
  try { metadata = JSON.parse(new TextDecoder().decode(bytes.subarray(MAGIC_BYTES.length, newline))); }
  catch { throw new Error('The design file header is invalid.'); }
  if (metadata?.format !== 'local-studio-design' || metadata.version !== 1 || !metadata.project || !Array.isArray(metadata.assets) || metadata.assets.length > MAX_ASSETS) throw new Error('The design file format is unsupported.');
  const payloadStart = newline + 1;
  const payloadLength = bytes.byteLength - payloadStart;
  const assets = new Map();
  let expectedOffset = 0;
  for (const asset of metadata.assets) {
    if (!asset || typeof asset.id !== 'string' || !Number.isSafeInteger(asset.offset) || !Number.isSafeInteger(asset.length) || asset.offset !== expectedOffset || asset.length < 1 || asset.offset + asset.length > payloadLength || assets.has(asset.id)) throw new Error('An image asset in this design file is invalid.');
    assets.set(asset.id, { bytes: bytes.slice(payloadStart + asset.offset, payloadStart + asset.offset + asset.length), name: String(asset.name || 'Image'), type: String(asset.type || 'image/png') });
    expectedOffset += asset.length;
  }
  if (expectedOffset !== payloadLength) throw new Error('The design file contains unexpected asset data.');
  return { project: metadata.project, assets };
}
