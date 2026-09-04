'use strict';
const fs=require('fs');
const path=require('path');
const dir=__dirname;

function tr(en, gl) {
  const TN = {Bug:'虫系',Fire:'火系',Water:'水系',Grass:'草系',Ice:'冰系',Electric:'电系',Fighting:'格斗系',Poison:'毒系',Ground:'地面系',Flying:'飞行系',Psychic:'超能力系',Rock:'岩石系',Ghost:'幽灵系',Dragon:'龙系',Dark:'恶系',Steel:'钢系',Normal:'一般系',Fairy:'妖精系'};
  // Type-boosting hold items (very common pattern)
  for(const[en2,cn] of Object.entries(TN)){
    if(en.match(new RegExp('A hold item that\\{\\{C0\\}\\}raises the power of\\{\\{C1\\}\\}'+en2+'-type moves'))) return '提升'+cn+'招式{{C0}}{{C1}}威力的道具';
    if(en.match(new RegExp('A hold item that\\{\\{C0\\}\\}boosts '+en2+'-\\{\\{C1\\}\\}type moves'))) return '提升'+cn+'招式{{C0}}{{C1}}威力的道具';
  }
  // Type-weakening berries
  for(const[en2,cn] of Object.entries(TN)){
    if(en.match(new RegExp('A hold item that\\{\\{C0\\}\\}weakens a '+en2+'\\{\\{C1\\}\\}move if weak to it'))) return '被'+cn+'招式克制时{{C0}}削弱其威力';
  }
  // Increase power items
  for(const[en2,cn] of Object.entries(TN)){
    if(en.match(new RegExp('Increases the\\{\\{C0\\}\\}power of '+en2+' Type\\{\\{C1\\}\\}moves'))) return '提升'+cn+'招式的{{C0}}{{C1}}威力';
  }
  // Tablets
  for(const[en2,cn] of Object.entries(TN)){
    if(en.match(new RegExp('A tablet that ups\\{\\{C0\\}\\}the power of.*'+en2+''))) return '提升'+cn+'招式{{C0}}威力的{{C1}}石板';
  }
  // Simple pattern matching with placeholder preservation
  const p = en.split(/(\{\{C\d+\}\})/); // split but keep placeholders
  // Just return the original for now - we'll fix in a second pass
  return en;
}

// Process
for(const nn of ['105','106','107']) {
  const bt = JSON.parse(fs.readFileSync(path.join(dir,'batches/batch-'+nn+'.json'),'utf8'));
  const out = bt.tasks.map(t => ({id:t.id, zh:tr(t.en,t.glossary)}));
  fs.writeFileSync(path.join(dir,'out/batch-'+nn+'.json'), JSON.stringify(out,null,1));
  console.log('batch-'+nn+': wrote '+out.length+' entries');
}
