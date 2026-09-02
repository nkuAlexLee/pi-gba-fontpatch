'use strict';
/**
 * csv.js — 极简 CSV 读写（RFC 4180 子集：引号、逗号、换行、双引号转义）
 * 统一使用 UTF-8；写出的文件带 BOM（Excel/WPS 直接打开不乱码）。
 */
const fs = require('fs');

function parse(text) {
	const rows = [];
	let row = [];
	let field = '';
	let inQuotes = false;
	const s = text.replace(/^\uFEFF/, '');
	for (let i = 0; i < s.length; i++) {
		const c = s[i];
		if (inQuotes) {
			if (c === '"') {
				if (s[i + 1] === '"') { field += '"'; i++; }
				else inQuotes = false;
			} else field += c;
		} else if (c === '"') {
			inQuotes = true;
		} else if (c === ',') {
			row.push(field); field = '';
		} else if (c === '\n' || c === '\r') {
			if (c === '\r' && s[i + 1] === '\n') i++;
			row.push(field); field = '';
			rows.push(row); row = [];
		} else {
			field += c;
		}
	}
	if (field !== '' || row.length) { row.push(field); rows.push(row); }
	return rows;
}

/** rows: [[..],[..]] → Buffer(BOM+CSV)。所有值按字符串处理。 */
function stringify(rows) {
	const esc = v => {
		v = v === undefined || v === null ? '' : String(v);
		return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
	};
	return Buffer.from('\uFEFF' + rows.map(r => r.map(esc).join(',')).join('\r\n') + '\r\n', 'utf8');
}

/** 读 CSV 为对象数组（首行为表头） */
function readObjects(path) {
	const rows = parse(fs.readFileSync(path, 'utf8'));
	if (!rows.length) return [];
	const header = rows[0];
	return rows.slice(1)
		.filter(r => r.some(c => c !== ''))
		.map(r => {
			const o = {};
			header.forEach((h, i) => { o[h] = r[i] !== undefined ? r[i] : ''; });
			return o;
		});
}

/** 对象数组 → 写文件（header 取首对象键序 + extraKeys） */
function writeObjects(path, objects, extraKeys = []) {
	const keys = objects.length ? [...Object.keys(objects[0]), ...extraKeys.filter(k => !Object.keys(objects[0]).includes(k))] : extraKeys;
	const rows = [keys, ...objects.map(o => keys.map(k => o[k] !== undefined ? o[k] : ''))];
	fs.writeFileSync(path, stringify(rows));
}

module.exports = { parse, stringify, readObjects, writeObjects };
