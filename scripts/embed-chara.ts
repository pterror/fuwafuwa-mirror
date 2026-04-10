import { readFileSync, writeFileSync } from "fs";

const pngFile = process.argv[2];
const b64File = process.argv[3];
const outFile = process.argv[4];

const png = readFileSync(pngFile);
const b64 = readFileSync(b64File, "utf8").trim();

// PNG signature is 8 bytes
// IHDR chunk: 4 (length) + 4 (type) + 13 (data) + 4 (crc) = 25 bytes
// After that, insert our tEXt chunk

const sig = 8;
const ihdrLen = 4 + 4 + 13 + 4; // = 25
const insertAt = sig + ihdrLen; // = 33

// Build tEXt chunk: keyword\0text
const keyword = "Chara";
const chunkData = Buffer.concat([
  Buffer.from(keyword + "\0", "ascii"),
  Buffer.from(b64, "ascii"),
]);

// CRC32 of "tEXt" + data
const crc32 = (buf: Buffer): number => {
  let crc = 0xFFFFFFFF;
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c;
  }
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
};

const typeAndData = Buffer.concat([Buffer.from("tEXt", "ascii"), chunkData]);
const crcValue = crc32(typeAndData);

const lenBuf = Buffer.allocUnsafe(4);
lenBuf.writeUInt32BE(chunkData.length, 0);

const crcBuf = Buffer.allocUnsafe(4);
crcBuf.writeUInt32BE(crcValue, 0);

const textChunk = Buffer.concat([lenBuf, typeAndData, crcBuf]);

const result = Buffer.concat([
  png.subarray(0, insertAt),
  textChunk,
  png.subarray(insertAt),
]);

writeFileSync(outFile, result);
console.log(`wrote ${outFile} (${result.length} bytes, tEXt chunk: ${textChunk.length} bytes)`);
