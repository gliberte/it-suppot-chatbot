import { deflateRawSync, deflateSync } from 'zlib';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });

const rootDir = process.cwd();
const outDir = path.join(rootDir, 'teams', 'generated');
const manifestTemplatePath = path.join(rootDir, 'teams', 'manifest.template.json');
const crcTable = Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});

const appId = process.env.MICROSOFT_APP_ID;
const publicDomain = process.env.PUBLIC_APP_DOMAIN;

if (!appId || !publicDomain) {
  console.error('Faltan MICROSOFT_APP_ID y/o PUBLIC_APP_DOMAIN.');
  console.error('Ejemplo: MICROSOFT_APP_ID=... PUBLIC_APP_DOMAIN=soporte.example.com npm run teams:package');
  process.exit(1);
}

await mkdir(outDir, { recursive: true });

const manifestTemplate = await readFile(manifestTemplatePath, 'utf8');
const manifest = manifestTemplate
  .replaceAll('${MICROSOFT_APP_ID}', appId)
  .replaceAll('${PUBLIC_APP_DOMAIN}', publicDomain);

JSON.parse(manifest);

const files = [
  { name: 'manifest.json', bytes: Buffer.from(manifest) },
  { name: 'color.png', bytes: createColorIconPng(192, 192) },
  { name: 'outline.png', bytes: createOutlineIconPng(32, 32) }
];

for (const file of files) {
  await writeFile(path.join(outDir, file.name), file.bytes);
}

await writeFile(path.join(outDir, 'soporte-it-teams.zip'), createZip(files));

console.log(`Paquete Teams generado en ${path.join(outDir, 'soporte-it-teams.zip')}`);

function createColorIconPng(width, height) {
  return createPng(width, height, (x, y) => {
    if (!isInsideRoundedSquare(x, y, width, height)) return [37, 99, 235, 0];
    if (isInsideSophiaS(x, y, width, height)) return [255, 255, 255, 255];
    return [37, 99, 235, 255];
  });
}

function createOutlineIconPng(width, height) {
  return createPng(width, height, (x, y) => (
    isInsideSophiaS(x, y, width, height)
      ? [255, 255, 255, 255]
      : [255, 255, 255, 0]
  ));
}

function createPng(width, height, getPixel) {
  const raw = Buffer.alloc((width * 4 + 1) * height);

  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;

    for (let x = 0; x < width; x += 1) {
      const offset = rowStart + 1 + x * 4;
      const rgba = getPixel(x, y);
      raw[offset] = rgba[0];
      raw[offset + 1] = rgba[1];
      raw[offset + 2] = rgba[2];
      raw[offset + 3] = rgba[3];
    }
  }

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', bufferFromUInts(width, height, 8, 6, 0, 0, 0)),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

function isInsideRoundedSquare(x, y, width, height) {
  const pad = Math.round(width * 0.13);
  const radius = Math.round(width * 0.16);
  const minX = pad;
  const minY = pad;
  const maxX = width - pad - 1;
  const maxY = height - pad - 1;

  if (x < minX || x > maxX || y < minY || y > maxY) return false;
  const cornerX = x < minX + radius ? minX + radius : x > maxX - radius ? maxX - radius : x;
  const cornerY = y < minY + radius ? minY + radius : y > maxY - radius ? maxY - radius : y;
  return (x - cornerX) ** 2 + (y - cornerY) ** 2 <= radius ** 2;
}

function isInsideSophiaS(x, y, width, height) {
  const left = Math.round(width * 0.29);
  const right = Math.round(width * 0.71);
  const top = Math.round(height * 0.22);
  const middle = Math.round(height * 0.50);
  const bottom = Math.round(height * 0.78);
  const stroke = Math.max(4, Math.round(width * 0.12));
  const radius = Math.round(stroke * 0.45);

  return isInsideRoundedRect(x, y, left, top, right, top + stroke, radius)
    || isInsideRoundedRect(x, y, left, middle - Math.round(stroke / 2), right, middle + Math.round(stroke / 2), radius)
    || isInsideRoundedRect(x, y, left, bottom - stroke, right, bottom, radius)
    || isInsideRoundedRect(x, y, left, top, left + stroke, middle, radius)
    || isInsideRoundedRect(x, y, right - stroke, middle, right, bottom, radius);
}

function isInsideRoundedRect(x, y, minX, minY, maxX, maxY, radius) {
  if (x < minX || x > maxX || y < minY || y > maxY) return false;
  const cornerX = x < minX + radius ? minX + radius : x > maxX - radius ? maxX - radius : x;
  const cornerY = y < minY + radius ? minY + radius : y > maxY - radius ? maxY - radius : y;
  return (x - cornerX) ** 2 + (y - cornerY) ** 2 <= radius ** 2;
}

function bufferFromUInts(...values) {
  const buffer = Buffer.alloc(values.length <= 2 ? values.length * 4 : 13);
  if (values.length === 7) {
    buffer.writeUInt32BE(values[0], 0);
    buffer.writeUInt32BE(values[1], 4);
    values.slice(2).forEach((value, index) => buffer.writeUInt8(value, 8 + index));
    return buffer;
  }

  values.forEach((value, index) => buffer.writeUInt32BE(value, index * 4));
  return buffer;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function createZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.name);
    const data = file.bytes;
    const compressed = deflateRawSync(data);
    const checksum = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);

    offset += local.length + name.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}
