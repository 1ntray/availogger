// Deterministic PNGs for the simple LF lettermark, no fonts or third-party images.
// Run: node scripts/generate-icons.cjs (from frontend/).
const fs = require('node:fs');
const zlib = require('node:zlib');
const path = require('node:path');
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type), length = Buffer.alloc(4), crc = Buffer.alloc(4);
  length.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, crc]);
}
function png(size, maskable) {
  const data = Buffer.alloc(size * (size * 3 + 1));
  const rectangles = [[160,180,188,332],[160,304,248,332],[272,180,300,332],[272,180,356,208],[272,242,348,270]];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const px = (x + .5) * 512 / size, py = (y + .5) * 512 / size;
    // Maskable content lies inside the center safe area; the background fills the icon.
    const green = !maskable && px >= 96 && px < 416 && py >= 96 && py < 416;
    const letter = rectangles.some(([left, top, right, bottom]) => px >= left && px < right && py >= top && py < bottom);
    const color = letter ? (maskable ? [103,212,174] : [18,54,46]) : green ? [103,212,174] : [23,40,51];
    const offset = y * (size * 3 + 1) + 1 + x * 3;
    data.set(color, offset);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size,4); header[8]=8; header[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(data)),chunk('IEND',Buffer.alloc(0))]);
}
const directory = path.resolve(__dirname, '../public/icons');
fs.mkdirSync(directory, { recursive: true });
for (const [name,size,maskable] of [['portal-192.png',192,false],['portal-512.png',512,false],['portal-maskable-512.png',512,true],['apple-touch-icon.png',180,false]]) fs.writeFileSync(path.join(directory,name), png(size,maskable));
