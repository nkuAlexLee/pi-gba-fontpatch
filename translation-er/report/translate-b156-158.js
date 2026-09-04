















//















// === Single move names ===
































// === Weather/Terrain ===











// === Status ===











// === Evolution ===





// === Type ===



// === Pokemon Stats Labels ===











// === Ability/Pokemon ===









// === EVs ===


};

// Read batch, translate, write output
function processBatch(batchNum) {
  const nn = String(batchNum).padStart(3,     zh });
  }
  fs.writeFileSync(outFile, JSON.stringify(output, null, 1));
  const check = JSON.parse(fs.readFileSync(outFile,  占位符不匹配:  output: output.length, mismatch, valid: check };
}

const r156 = processBatch(156);
const r157 = processBatch(157);
const r158 = processBatch(158);
console.log('---');
console.log('总计: ' + (r156.output + r157.output + r158.output) + ' 条译文已写入');
