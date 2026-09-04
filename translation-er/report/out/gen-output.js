const fs = require('fs');
const path = require('path');
const ROOT = 'D:/vibecoding/gba-font-cracker-js/gbajs2/translation-er';
const OUT = path.join(ROOT, 'report', 'out');

const T = JSON.parse(fs.readFileSync(path.join(OUT, 'translations-map.json'), 'utf8'));

let totalOK = 0, totalMissing = 0, totalPhMismatch = 0;
for (const n of [144, 145, 146]) {
  const bt = JSON.parse(fs.readFileSync(path.join(ROOT, 'report/batches', `batch-${n}.json`), 'utf8'));
  const out = bt.tasks.map(t => ({ id: t.id, zh: T[t.id] || '' }));
  
  const missing = out.filter(x => !x.zh);
  let phMismatch = 0;
  for (const t of bt.tasks) {
    const e = out.find(x => x.id === t.id);
    const enPH = (t.en.match(/\{\{C\d+\}\}/g) || []).length;
    const zhPH = (e.zh.match(/\{\{C\d+\}\}/g) || []).length;
    if (enPH !== zhPH) phMismatch++;
  }
  totalOK += out.length - missing.length;
  totalMissing += missing.length;
  totalPhMismatch += phMismatch;
  if (missing.length) console.log(`batch-${n}: MISSING ${missing.length} → ${missing.map(x=>x.id).join(',')}`);
  if (phMismatch) console.log(`batch-${n}: PH MISMATCH ${phMismatch}`);
  fs.writeFileSync(path.join(OUT, `batch-${n}.json`), JSON.stringify(out, null, 1));
  console.log(`batch-${n}: ${out.length} entries written`);
}
console.log(`\nTotal: OK=${totalOK} Missing=${totalMissing} PHMismatch=${totalPhMismatch}`);
