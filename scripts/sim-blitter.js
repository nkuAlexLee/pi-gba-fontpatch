// 抓取运行时 LUT4/LUT3 并模拟 blitter 验证字库解压
'use strict';
const { execSync } = require('child_process');
const fs = require('fs');
const ROOT = __dirname + '/..';

function rd(addr, len) {
	const out = execSync(`node romctl.js memread ${addr} ${len}`, {
		cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore']
	}).toString();
	const m = out.match(/[0-9a-fA-F]{8}: ((?:[0-9a-fA-F]{2} )+)/);
	return m ? m[1].trim().split(' ').map(x => parseInt(x, 16)) : [];
}

const LUT4 = [];
for (let i = 0; i < 256; i += 16) LUT4.push(...rd('0x' + (0x090191E0 + i).toString(16), 16));
const LUT3 = [];
for (let i = 0; i < 256; i += 16) LUT3.push(...rd('0x' + (0x03005550 + i).toString(16), 16));
fs.writeFileSync(ROOT + '/tmp/lut4.bin', Buffer.from(LUT4));
fs.writeFileSync(ROOT + '/tmp/lut3.bin', Buffer.from(LUT3));
console.log('LUT4:', LUT4.length, 'LUT3:', LUT3.length, ' LUT4[0xC8]=', LUT4[0xC8]);

const rom = fs.readFileSync(ROOT + '/fontpatch/er_probe.gba');
function sim(srcFile, recOffset, name) {
	console.log('--- ' + name + ' ---');
	for (let t = 0; t < 4; t++) {
		for (let r = 0; r < 8; r++) {
			const v = rom.readUInt16LE(srcFile + recOffset + t * 16 + r * 2);
			const hi = (v >> 8) & 0xFF, lo = v & 0xFF;
			const u32 = ((LUT3[LUT4[hi] * 2] << 16) | LUT3[LUT4[lo] * 2]) >>> 0;
			let s = '';
			for (let by = 0; by < 4; by++) {
				const B = (u32 >> (by * 8)) & 0xFF;
				for (let n = 0; n < 2; n++) {
					const nib = (B >> (n * 4)) & 0xF;
					s += nib === 0xB ? '#' : nib === 0xC ? '.' : ' ';
				}
			}
			console.log('  ' + s);
		}
	}
}
if (LUT4.length === 256 && LUT3.length === 256) {
	sim(0x1067D18, 0xC8, '原生 N(0xC8)');
	sim(0x168A4D8, 0x0C4D, '字库 新(0x0C4D)');
	sim(0x168A4D8, 0x0D7C, '字库 游(0x0D7C)');
} else {
	console.log('LUT 不完整，跳过模拟');
}
