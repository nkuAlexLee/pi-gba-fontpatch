// 枚举两个 ROM 的全部差异段
'use strict';
const fs = require('fs');
const p = (x) => (require('path').isAbsolute(x) ? x : __dirname + '/../fontpatch/' + x);
const a = fs.readFileSync(p(process.argv[2]));
const b = fs.readFileSync(p(process.argv[3]));
const segs = [];
let i = 0;
while (i < a.length) {
	if (a[i] !== b[i]) {
		const s = i;
		while (i < a.length && a[i] !== b[i]) i++;
		if (segs.length && s - segs[segs.length - 1][1] < 64) segs[segs.length - 1][1] = i;
		else segs.push([s, i]);
	} else i++;
}
for (const [s, e] of segs) {
	console.log('0x' + s.toString(16), '→ 0x' + e.toString(16), '(' + (e - s) + 'B)  GBA 0x' + (s + 0x8000000).toString(16));
	if (e - s <= 32) console.log('   base:', a.slice(s, e).toString('hex'), '\n   new :', b.slice(s, e).toString('hex'));
}
