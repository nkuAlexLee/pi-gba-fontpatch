// 渲染 绿宝石字库.bin 的字形记录为 BMP 接触表，供目检索引映射
// 用法: node scripts/font-sheet.js <起始记录> <数量> [列数=16] [输出=tmp/sheet.bmp] [缩放=1]
const fs = require('fs');
const path = require('path');

const FONT = 'D:/vibecoding/gba-font-cracker-js/gbajs2/fontpatch/armips-src/graphics/fonts/full_fonts.bin';
const [,, startArg, countArg, colsArg, outArg, scaleArg] = process.argv;
const start = parseInt(startArg || '0', 10);
const count = parseInt(countArg || '256', 10);
const cols = parseInt(colsArg || '16', 10);
const out = outArg || 'tmp/sheet.bmp';
const scale = parseInt(scaleArg || '1', 10);

const font = fs.readFileSync(FONT);
const rows = 16; // 每字 16 行
const GW = 16, GH = 16;

// 解码一条记录为 16x16 像素 (0=透明 1=前景 2=阴影 3=透明)
function glyph(idx) {
  const base = idx * 64;
  const px = [];
  for (let r = 0; r < rows; r++) {
    const t = r < 8 ? 0 : 2, tr = r < 8 ? 1 : 3, rr = r % 8;
    const vL = font.readUInt16LE(base + t * 16 + rr * 2);
    const vR = font.readUInt16LE(base + tr * 16 + rr * 2);
    const line = [];
    for (const v of [vL, vR]) for (const b of [(v >> 8) & 0xFF, v & 0xFF])
      for (let p = 6; p >= 0; p -= 2) line.push((b >> p) & 3);
    px.push(line);
  }
  return px;
}

const rowsCount = Math.ceil(count / cols);
const W = cols * (GW * scale + 1) + 1;
const H = rowsCount * (GH * scale + 1) + 1;
const stride = Math.ceil((W * 3) / 4) * 4;
const img = Buffer.alloc(stride * H, 0xFF); // 白底

function setPx(x, y, v) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const off = (H - 1 - y) * stride + x * 3;
  if (v === 1) { img[off] = 0; img[off+1] = 0; img[off+2] = 0; }        // 前景=黑
  else if (v === 2) { img[off] = 0xB0; img[off+1] = 0xB0; img[off+2] = 0xB0; } // 阴影=灰
}

for (let i = 0; i < count; i++) {
  const g = glyph(start + i);
  const gx = i % cols, gy = Math.floor(i / cols);
  const ox = 1 + gx * (GW * scale + 1), oy = 1 + gy * (GH * scale + 1);
  for (let r = 0; r < GH; r++) for (let c = 0; c < GW; c++) {
    const v = g[r][c];
    if (v === 1 || v === 2) {
      for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++)
        setPx(ox + c * scale + sx, oy + r * scale + sy, v);
    }
  }
}

// BMP 头
const fileSize = 54 + img.length;
const hdr = Buffer.alloc(54);
hdr.write('BM', 0);
hdr.writeUInt32LE(fileSize, 2);
hdr.writeUInt32LE(54, 10);
hdr.writeUInt32LE(40, 14);
hdr.writeInt32LE(W, 18);
hdr.writeInt32LE(H, 22);
hdr.writeUInt16LE(1, 26);
hdr.writeUInt16LE(24, 28);
hdr.writeUInt32LE(img.length, 34);

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.concat([hdr, img]));
console.log(`records ${start}..${start + count - 1}, ${cols}/行 → ${out} (${W}x${H})`);
