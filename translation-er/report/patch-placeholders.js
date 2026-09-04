'use strict';
const fs = require('fs');
const path = require('path');

const base = 'D:/vibecoding/gba-font-cracker-js/gbajs2/translation-er/report';

// Manual fixes for specific entries where placeholders were missing or extra
const PATCHES = {
// === BATCH 057 ===
// 0035BDD5: en has C3, zh missing C3. zh ends after C2 but needs C3 somewhere
'0035BDD5': '大赛参赛号！{{C0}}{{C1}}的{{C2}}的{{C3}}！',
// 0035DF63/DF8E: 2-placeholder pattern entries
'0035DF63': '第一个表演时{{C0}}效果{{C1}}最佳。',
'0035DF8E': '最后一个表演时{{C0}}效果{{C1}}最佳。',
// 0035DFE5: 2-placeholder
'0035DFE5': '表演效果与{{C0}}之前的{{C1}}宝可梦持平。',
// 0035E014: 3-placeholder
'0035E014': '表演越靠后，{{C0}}效果{{C1}}越好。{{C2}}',
// 0035E047: 3-placeholder
'0035E047': '表演效果取决于{{C0}}表演的{{C1}}时机。{{C2}}',
// 0035E07C: 3-placeholder
'0035E07C': '与{{C0}}前一个宝可梦同{{C1}}属性时效果好。{{C2}}',
// 0035E0B0: 3-placeholder
'0035E0B0': '与{{C0}}前一个宝可梦不同{{C1}}属性时效果好。{{C2}}',
// 0035E0E5: 3-placeholder
'0035E0E5': '受{{C0}}前方宝可梦表演效果的{{C1}}影响。{{C2}}',
// 0035E114: 3-placeholder
'0035E114': '提升使用者的状态。{{C0}}有助于防止{{C1}}紧张。{{C2}}',
// 0035E180: 3-placeholder
'0035E180': '下回合可以{{C0}}提前进行{{C1}}表演。{{C2}}',
// 0035E1AF: 3-placeholder
'0035E1AF': '下回合可以{{C0}}延后进行{{C1}}表演。{{C2}}',
// 0035E1DC: 3-placeholder
'0035E1DC': '更容易扰乱{{C0}}下回合的{{C1}}顺序。{{C2}}',
// 0035E20F: 3-placeholder
'0035E20F': '扰乱{{C0}}下回合的表演{{C1}}顺序。{{C2}}',
// 0035E240: 3-placeholder
'0035E240': '在{{C0}}任何华丽大赛中都能引起{{C1}}观众兴奋。{{C2}}',
// 0035E274: 3-placeholder
'0035E274': '严重惊吓到{{C0}}所有表演出色{{C1}}的宝可梦。{{C2}}',
// 0035E2A7: 3-placeholder
'0035E2A7': '观众{{C0}}越兴奋，表演效果越好。{{C1}}{{C2}}',
// 0035E2DC: 3-placeholder
'0035E2DC': '暂时阻止{{C0}}观众变得{{C1}}兴奋。{{C2}}',
// 0035E37E: 3-placeholder
'0035E37E': '{{C0}}用{{C1}}{{C2}}进行了表演！',
// 0035E3E5: en has C0 but zh missing
'0035E3E5': '但表演被{{C0}}干扰了。',
// === BATCH 058 ===
// 00360448: en has C0-C4, zh only C0-C2
'00360448': '{{C0}}使用的{{C1}}最后一个招式完全关于"{{C2}}"！{{C3}}{{C4}}',
// 00360670: 4-placeholder
'00360670': '哦{{C0}}{{C1}}抱歉打扰你了。{{C2}}下次你来对战塔时请接受我们的采访。',
// 003606D2: 5-placeholder
'003606D2': '当然了！{{C0}}你脸上那明显的满足感{{C1}}{{C2}}{{C3}}说明你已经赢了！',
// 00360893: 5-placeholder
'00360893': '哦，这样啊。{{C0}}{{C1}}不过，沉默型也很酷，对吧？{{C2}}希望你能给我机会{{C3}}再次采访你。{{C4}}',
// 00360944: 8-placeholder (en has {{C0}}-{{C7}})
'00360944': '太棒了！{{C0}}又到了最佳训练家时间！{{C1}}今天，我们来介绍{{C2}}，{{C3}}这位在{{C4}}对战塔中挑战的训练家。{{C5}}{{C6}}{{C7}}',
// 00360A28: 10-placeholder
'00360A28': '这对搭档终于在第{{C0}}{{C1}}场比赛中惜败。{{C2}}尽力了，训练家！{{C3}}不过没关系，{{C4}}这只是开始。',
// 00360AF5: 10-placeholder
'00360AF5': '这对搭档彻底击败了{{C0}}{{C1}}的{{C2}}，赢得了最终胜利。{{C3}}太棒了，训练家！{{C4}}连{{C5}}都打败了！',
// 00360CB7: 7-placeholder
'00360CB7': '训练家说：{{C0}}"我很满意！"{{C1}}多么爽快的回答！{{C2}}太棒了，训练家！',
// 00360EDA: 11-placeholder (has C10 too)
'00360EDA': '"{{C0}}"。{{C1}}说得太好了！{{C2}}完全表达了{{C3}}的喜悦。{{C4}}{{C5}}和{{C6}}的那场对战{{C7}}真是令人难忘。',
// 00360F61: 11-placeholder (has C10 too)
'00360F61': '"{{C0}}"。{{C1}}多么贴切的形容！{{C2}}和{{C3}}在最后{{C4}}{{C5}}的那场对战...{{C6}}无法形容的精彩。',
// 0036100A: 8-placeholder
'0036100A': '太棒了，{{C0}}！{{C1}}太棒了，{{C2}}！{{C3}}希望我们能看到{{C4}}{{C5}}再创佳绩！{{C6}}今天就到这里！',
// 00361094: 10-placeholder
'00361094': '哇！{{C0}}可以看出你对你的{{C1}}宝可梦{{C2}}倾注了满满的爱。{{C3}}好的，它的名字叫{{C4}}。{{C5}}我能问几个问题吗？',
// 00361347: 10-placeholder
'00361347': '我明白了！{{C0}}嗯嗯{{C1}}{{C2}}好的！{{C3}}感谢你的配合。{{C4}}和你聊天很有趣也很有收获。{{C5}}下次再见！',
// 00361498: 9-placeholder
'00361498': '嗨，你和你的{{C0}}{{C1}}看起来关系很好。{{C2}}你知道吗？{{C3}}我是电视台记者。{{C4}}我在各地旅行，收集关于宝可梦和训练家的故事。',
// 00361FC4: zh has extra C6 not in en (en has C0-C5, zh has C0-C6)
'00361FC4': '哦？{{C0}}你喜欢宝可梦吗？{{C1}}我在电视台工作。{{C2}}我正在收集关于最近{{C3}}宝可梦和训练家的{{C4}}故事。{{C5}}如果你不介意的话，能跟我谈谈你自己吗？',
// 0036218B: zh has extra C3 (en has C0-C2)
'0036218B': '哦，这样啊。{{C0}}{{C1}}如果你有什么有趣的{{C2}}故事，请告诉我。',
// 00363DBF: en has C0-C8, zh only C0-C7
'00363DBF': '大家好！{{C0}}宝可梦今日播报时间到！{{C1}}大姐姐：嗨！大家今天都精神焕发吗？{{C2}}{{C3}}今天，我们来看看{{C4}}的{{C5}}宝可梦{{C6}}！{{C7}}大哥哥：对！就是这个！',
};

for (const batchNum of [57, 58, 59]) {
  const nn = String(batchNum).padStart(3, '0');
  const outPath = path.join(base, 'out/batch-' + nn + '.json');
  const d = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  let fixed = 0;
  for (const row of d) {
    if (PATCHES[row.id]) { row.zh = PATCHES[row.id]; fixed++; }
  }
  if (fixed) fs.writeFileSync(outPath, JSON.stringify(d, null, 1));
  // Re-check
  const bt = JSON.parse(fs.readFileSync(path.join(base, 'batches/batch-' + nn + '.json'), 'utf8'));
  let phErr = 0;
  const byId = new Map(d.map(x => [x.id, x.zh]));
  for (const t of bt.tasks) {
    const enPH = (t.en.match(/\{\{C\d+\}\}/g) || []).sort().join(',');
    const zhPH = ((byId.get(t.id) || '').match(/\{\{C\d+\}\}/g) || []).sort().join(',');
    if (enPH !== zhPH) { phErr++; console.log(t.id, 'en:', enPH, 'zh:', zhPH); }
  }
  console.log('batch-' + nn + ': patched ' + fixed + ', remaining mismatches: ' + phErr);
}
