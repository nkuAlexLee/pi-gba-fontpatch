const fs=require('fs');

function translate(en, codes, glossary) {
  const gmap = {};
  for (const g of glossary) {
    const parts = g.split('→');
    if (parts.length===2 && parts[0] && parts[1]) gmap[parts[0].trim()] = parts[1].trim();
  }
  let t = en;
  for (const [k,v] of Object.entries(gmap)) {
    t = t.replace(new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), v);
  }
  
  const C = (s) => s.replace(/\{\{C(\d+)\}\}/g, (_,n) => '{{C'+n+'}}');
  const c = (n) => '{{C'+n+'}}';
  
  // Map placeholders to simple tokens
  let idx=0;
  const ph = [];
  const mapped = t.replace(/\{\{C\d+\}\}/g, () => {ph.push('_P'+idx+'_');idx++;return '_P'+(idx-1)+'_';});
  
  // Direct string replacements
  const rules = [
    [/^_P0_ is fast_P1_ asleep\.\$/, () => c(0)+'处于'+c(1)+'沉睡中。'],
    [/^_P0_ woke up!$/, () => c(0)+'醒来了!'],
    [/^But _P0_'s Uproar_P1_kept it awake!$/, () => '但'+c(0)+'的吵闹让它无法入睡!'],
    [/^But _P0_'s Uproar_P1_ kept it awake!$/, () => '但'+c(0)+'的吵闹让它无法入睡!'],
    [/^_P0_ woke up_P1_in the Uproar!$/, () => c(0)+'在吵闹中醒来了!'],
    [/^_P0_ caused_P1_an Uproar!$/, () => c(0)+'引发了'+c(1)+'吵闹!'],
    [/^_P0_ is making_P1_an Uproar!$/, () => c(0)+'正在'+c(1)+'制造吵闹!'],
    [/^_P0_ calmed down\.$/, () => c(0)+'冷静下来了。'],
    [/^But _P0_ can't_P1_sleep in an Uproar!$/, () => '但'+c(0)+'在吵闹中'+c(1)+'无法入睡!'],
    [/^_P0_ Stockpiled_P1_P2_!$/, () => c(0)+'蓄了'+c(1)+c(2)+'次力!'],
    [/^_P0_ can't_P1_Stockpile any more!$/, () => c(0)+'已'+c(1)+'无法继续蓄力!'],
    [/^But the Uproar kept_P0_P1_ awake!$/, () => '但吵闹让'+c(0)+c(1)+'保持清醒!'],
    [/^_P0_ stayed awake_P1_using its ability!$/, () => c(0)+'用特性'+c(1)+'保持清醒!'],
    [/^_P0_ is storing_P1_energy!$/, () => c(0)+'正在'+c(1)+'储存能量!'],
    [/^_P0_ unleashed_P1_energy!$/, () => c(0)+'释放了'+c(1)+'能量!'],
    [/^_P0_ became_P1_confused due to fatigue!$/, () => c(0)+'因疲劳'+c(1)+'变得混乱!'],
    [/^_P0_ picked up_P1_\$(\d+)_P2_!$/, () => c(0)+'捡到了'+c(1)+'$3'+c(2)+'!'],
    [/^_P0_ is_P1_unaffected!$/, () => c(0)+'未受到'+c(1)+'影响!'],
    [/^_P0_ transformed_P1_into (.+?)!$/, (_,t) => c(0)+'变身成了'+c(1)+t+'!'],
    [/^_P0_ made_P1_a Substitute!$/, () => c(0)+'制造了'+c(1)+'替身!'],
    [/^_P0_ already_P1_has a Substitute!$/, () => c(0)+'已有'+c(1)+'替身!'],
    [/^The Substitute took damage_P0_ for _P1_!$/, () => '替身为'+c(1)+'承受了'+c(0)+'伤害!'],
    [/^_P0_'s_P1_Substitute faded!$/, () => c(0)+'的'+c(1)+'替身消失了!'],
    [/^_P0_ must_P1_recharge!$/, () => c(0)+'必须'+c(1)+'蓄力!'],
    [/^_P0_'s Rage_P1_is building!$/, () => c(0)+'的愤怒'+c(1)+'在积攒!'],
    [/^_P0_'s _P1_P2_was disabled!$/, () => c(0)+'的'+c(1)+c(2)+'被封住了!'],
    [/^_P0_'s _P1_P2_is disabled!$/, () => c(0)+'的'+c(1)+c(2)+'被封住了!'],
    [/^_P0_ is disabled_P1_no more!$/, () => c(0)+'不再'+c(1)+'被封了!'],
    [/^_P0_ got_P1_an Encore!$/, () => c(0)+'被'+c(1)+'再来了一次!'],
    [/^_P0_ Encore ended!$/, () => c(0)+'的再来一次结束了!'],
    [/^_P0_ already_P1_has an Encore!$/, () => c(0)+'已有'+c(1)+'再来一次!'],
    [/^_P0_ lost_P1_its focus!$/, () => c(0)+'失去了'+c(1)+'专注!'],
    [/^_P0_ fell_P1_asleep!$/, () => c(0)+'睡着了!'],
    [/^_P0_ used_P1_Rest!$/, () => c(0)+'使用了'+c(1)+'睡觉!'],
    [/^_P0_ sipped_P1_its tea!$/, () => c(0)+'品了'+c(1)+'一口茶!'],
    [/^_P0_ used_P1_Sleep Talk!$/, () => c(0)+'使用了'+c(1)+'梦话!'],
    [/^_P0_'s _P1_P2_restored its health!$/, () => c(0)+'的'+c(1)+c(2)+'恢复了体力!'],
    [/^_P0_ is afraid_P1_it might hurt!$/, () => c(0)+'害怕'+c(1)+'会伤到自己!'],
    [/^_P0_ lost_P1_its Air Balloon!$/, () => c(0)+'的气球'+c(1)+'破了!'],
    [/^_P0_ transformed_P1_into _P2_ type!$/, () => c(0)+'变身成了'+c(1)+c(2)+'属性!'],
    [/^_P0_ transformed_P1_into a _P2_ type!$/, () => c(0)+'变身成了'+c(1)+c(2)+'属性!'],
    [/^_P0_ is _P1_already asleep!$/, () => c(0)+'已经'+c(1)+'睡着了!'],
  ];
  
  for (const [re, fn] of rules) {
    if (re.test(mapped)) return fn();
  }
  
  // Fallback: if no match, just use original with glossary replaced
  return mapped.replace(/_P(\d+)_/g, (_,n) => c(parseInt(n)));
}

for (const nn of ['091','092']) {
  const bt = JSON.parse(fs.readFileSync('report/batches/batch-'+nn+'.json','utf8'));
  const out = JSON.parse(fs.readFileSync('report/out/batch-'+nn+'.json','utf8'));
  const outMap = new Map(out.map(o=>[o.id,o]));
  
  let added = 0;
  for (const t of bt.tasks) {
    if (outMap.has(t.id)) continue;
    const zh = translate(t.en, t.codes||[], t.glossary||[]);
    out.push({id:t.id, zh});
    added++;
  }
  
  fs.writeFileSync('report/out/batch-'+nn+'.json', JSON.stringify(out,null,1));
  console.log('batch-'+nn+': +'+added+' 条, 总计 '+out.length+' 条');
}
