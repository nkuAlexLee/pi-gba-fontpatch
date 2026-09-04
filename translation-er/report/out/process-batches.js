'use strict';
const fs = require('fs');
const path = require('path');

const outDir = __dirname;
const batchDir = path.resolve(__dirname, '..', 'batches');

// Read translations from JSON file
const T = JSON.parse(fs.readFileSync(path.join(outDir, 'translations-084-086.json'), 'utf8'));

for (const b of [84,85,86]) {
  const nn = String(b).padStart(3,'0');
  const data = JSON.parse(fs.readFileSync(path.join(batchDir, `batch-${nn}.json`), 'utf8'));
  const out = [];
  let ok = 0, miss = 0;
  for (const t of data.tasks) {
    const zh = T[t.id];
    if (zh) { out.push({id: t.id, zh}); ok++; }
    else { console.error(`MISS ${t.id}`); miss++; }
  }
  fs.writeFileSync(path.join(outDir, `batch-${nn}.json`), JSON.stringify(out, null, 1));
  console.log(`batch-${nn}: ${ok}/${data.count} translated, ${miss} missing`);
}
