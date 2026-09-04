// 对比 base vs passive 的 Option 首次 RT 调用 trace（排除补丁区）
'use strict';
const fs = require('fs');
const a = JSON.parse(fs.readFileSync(__dirname + '/../tmp/trace_rt_base.json'));
const b = JSON.parse(fs.readFileSync(__dirname + '/../tmp/trace_rt_passive.json'));
const f = (t) => {
	const o = [];
	for (let i = 0; i < t.length; i += 5) {
		const pc = t[i];
		if (pc >= 0x08257000 && pc < 0x08258000 && !(pc >= 0x08257098 && pc <= 0x082570a5)) o.push([pc, t[i + 1], t[i + 2], t[i + 4]]);
	}
	return o;
};
const fa = f(a), fb = f(b);
console.log('filtered: base', fa.length, ' passive', fb.length);
const n = Math.min(fa.length, fb.length);
let div = -1;
for (let i = 0; i < n; i++) {
	if (fa[i][0] !== fb[i][0] || fa[i][3] !== fb[i][3]) { div = i; break; }
}
console.log('semantic divergence @', div);
for (let j = Math.max(0, div - 4); j < div + 10; j++) {
	const A = fa[j] || ['-','-','-','-'], B = fb[j] || ['-','-','-','-'];
	console.log((j === div ? '★' : ' '), j,
		'base pc=0x' + A[0].toString(16), 'r0=0x' + A[1].toString(16), 'r1=0x' + A[2].toString(16), 'r3=0x' + A[3].toString(16),
		'| pass pc=0x' + B[0].toString(16), 'r0=0x' + B[1].toString(16), 'r1=0x' + B[2].toString(16), 'r3=0x' + B[3].toString(16));
}
