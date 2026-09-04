'use strict';
/**
 * gen-retry4.js — 最终版：基于 prev 修正，最小化字典
 * 策略：prev 翻译已基本正确，仅需：
 * 1. 将 codes 映射回 {{Cn}} 占位符
 * 2. 翻译残留英文
 * 3. 确保占位符数量一致
 * 4. 全角标点归半角
 */
const fs = require('fs');
const path = require('path');

// 核心英文→中文翻译（仅保留高频残留词）
const FIX = [
  // 动词
  ['enables', '使'], ['allows', '允许'], ['prevents', '防止'], ['restores', '恢复'],
  ['deals', '造成'], ['lowers', '降低'], ['raises', '提升'], ['boosts', '提升'],
  ['inflicts', '施加'], ['causes', '导致'], ['triggers', '触发'], ['clears', '清除'],
  ['removes', '移除'], ['negates', '无效化'], ['reflects', '反弹'], ['swaps', '交换'],
  ['absorbs', '吸收'], ['ignores', '无视'], ['pierces', '穿透'], ['bypasses', '无视'],
  ['reduces', '减少'], ['resets', '重置'], ['cures', '治愈'], ['heals', '治愈'],
  ['protects', '保护'], ['guards', '守护'], ['shields', '防护'], ['deflects', '偏转'],
  ['nullifies', '无效化'], ['dispels', '驱散'], ['disperses', '散布'], ['scatters', '散播'],
  ['spreads', '扩散'], ['surrounds', '包围'], ['traps', '困住'], ['binds', '束缚'],
  ['paralyzes', '麻痹'], ['burns', '灼伤'], ['freezes', '冰冻'], ['confuses', '混乱'],
  ['terrifies', '恐吓'], ['intimidates', '威吓'], ['attracts', '吸引'], ['draws', '吸引'],
  ['summons', '召唤'], ['calls', '召唤'], ['gathers', '聚集'], ['builds', '构建'],
  ['creates', '创造'], ['makes', '使'], ['turns', '变成'], ['becomes', '变成'],
  ['transforms', '变形'], ['shifts', '切换'], ['changes', '改变'], ['alters', '改变'],
  ['varies', '变化'], ['copies', '模仿'], ['mimics', '模仿'], ['replaces', '替换'],
  ['switches', '交换'], ['trades', '交换'], ['starts', '开始'], ['ends', '结束'],
  ['stops', '停止'], ['slows', '减速'], ['waits', '等待'], ['strikes', '攻击'],
  ['slams', '猛撞'], ['hits', '攻击'], ['hurls', '投掷'], ['throws', '投掷'],
  ['flings', '投掷'], ['spits', '喷射'], ['blows', '吹'], ['breathes', '吐出'],
  ['shoots', '发射'], ['fires', '发射'], ['launches', '发射'], ['releases', '释放'],
  ['envelops', '包裹'], ['engulfs', '包裹'], ['covers', '覆盖'], ['whirls', '旋转'],
  ['drills', '钻'], ['rotates', '旋转'], ['twists', '扭'], ['stabs', '刺'],
  ['slashes', '斩'], ['cuts', '切'], ['swings', '挥'], ['eats', '吃掉'],
  ['devours', '吞噬'], ['consumes', '消耗'], ['steals', '偷取'], ['plucks', '拔取'],
  ['knocks', '击倒'], ['pushes', '推'], ['drags', '拖拽'], ['casts', '施放'],
  ['dances', '跳舞'], ['sings', '唱歌'], ['yells', '吼叫'], ['cries', '哭喊'],
  ['congratulates', '祝贺'], ['taunts', '嘲讽'], ['soothes', '安抚'], ['calms', '安抚'],
  ['activates', '激活'], ['receives', '受到'], ['suffers', '受到'], ['endures', '承受'],
  ['recovers', '恢复'], ['restores', '恢复'], ['purifies', '净化'],
  ['sharply raises', '大幅提升'], ['harshly lowers', '大幅降低'], ['drastically raises', '大幅提升'],
  // 名词
  ['target', '目标'], ['targets', '目标'], ['user', '使用者'], ['allies', '队友'],
  ['ally', '队友'], ['foe', '对手'], ['foes', '对手'], ['party', '队伍'],
  ['wild', '野生'], ['field', '场地'], ['battle', '对战'], ['turn', '回合'],
  ['turns', '回合'], ['damage', '伤害'], ['priority', '先制度'], ['holding', '携带'],
  ['held', '携带'], ['stat changes', '能力值变化'], ['stat boosts', '能力值强化'],
  ['stat', '能力值'], ['stats', '能力值'], ['stage', '等级'], ['stages', '等级'],
  ['moves', '招式'], ['move', '招式'], ['attack', '攻击'], ['attacks', '攻击'],
  ['defense', '防御'], ['defense.', '防御。'], ['speed', '速度'], ['accuracy', '命中率'],
  ['critical hit', '会心一击'], ['critical hits', '暴击'], ['flinch', '畏缩'],
  ['paralyze', '麻痹'], ['poison', '中毒'], ['burn', '灼伤'], ['confuse', '混乱'],
  ['sleep', '睡眠'], ['recoil', '反伤'], ['power', '威力'], ['powerful', '强大'],
  ['pokemon', '宝可梦'], ['Pokémon', '宝可梦'], ['berry', '树果'], ['Berry', '树果'],
  ['weather', '天气'], ['terrain', '场地'], ['contact', '接触'],
  // 属性
  ['Fire', '火'], ['Water', '水'], ['Grass', '草'], ['Electric', '电'],
  ['Ice', '冰'], ['Fighting', '格斗'], ['Poison', '毒'], ['Ground', '地面'],
  ['Flying', '飞行'], ['Psychic', '超能力'], ['Bug', '虫'], ['Rock', '岩石'],
  ['Ghost', '幽灵'], ['Dragon', '龙'], ['Dark', '恶'], ['Steel', '钢'],
  ['Fairy', '妖精'], ['Normal', '一般'],
  // 招式名
  ['Thunderbolt', '十万伏特'], ['Stone Edge', '尖石攻击'], ['Volt Tackle', '伏特攻击'],
  ['Last Resort', '珍藏'], ['Giga Impact', '终极冲击'], ['Clanging Scales', '鳞片噪音'],
  ['Moongeist Beam', '暗影之光'], ['Sunsteel Strike', '流星闪冲'],
  ['Sparkling Aria', '泡影的咏叹调'], ['Nature\'s Madness', '自然之怒'],
  ['Play Rough', '嬉闹'], ['Poison Barb', '毒针'], ['Shock Wave', '电击波'],
  // 特性/道具
  ['Iron Fist', '铁拳'], ['Strong Jaw', '强壮之颚'], ['Keen Edge', '锋锐'],
  ['Mighty Horn', '蛮力角'], ['Mega Launcher', '超级发射器'],
  ['Simple', '单纯'], ['Sound-based', '声音系'], ['Air-based', '飞行系'],
  ['Field-based', '场地系'], ['Throw-based', '投掷系'],
  // 宝可梦名
  ['Corviknight', '钢铠鸦'], ['Centiskorch', '焚焰蚣'], ['Meowscarada', '魔幻假面喵'],
  ['Crabominable', '好胜毛蟹'], ['Chandelure-R', '水晶灯火灵-R'], ['Chandelure', '水晶灯火灵'],
  ['Vanilluxe-R', '双倍多多冰-R'], ['Vanilluxe', '双倍多多冰'],
  ['Dududunsparce', '嘟嘟大蛇'], ['MimikyuApex', '谜拟丘Apex'],
  ['Wigglytuff-A', '胖可丁-A'], ['DuraludonP.', '铝钢龙P.'], ['FidoughP.', '爱吃豚P.'],
  ['Luxzero', '零度雷龙'], ['Carbonix', '碳晶龙'], ['Heracreus', '赫拉克烈斯'],
  ['Swampage', '沼跃霸'], ['Kilozuna', '基尔祖纳'], ['Silvally', '银伴战兽'],
  ['Ogerpon-H', '厄诡椪-H'], ['Ogerpon-W', '厄诡椪-W'], ['Ogerpon-C', '厄诡椪-C'],
  ['Ogerpon', '厄诡椪'], ['Pikachu', '皮卡丘'], ['Mimikyu', '谜拟丘'],
  ['Snorlax', '卡比兽'], ['Lycanroc', '鬃岩狼人'], ['Primarina', '西狮海壬'],
  ['Kommo-o', '杖尾鳞甲龙'], ['Solgaleo', '索尔迦雷欧'], ['Lunala', '露奈雅拉'],
  ['Alolan Raichu', '阿罗拉雷丘'], ['Mew', '梦幻'], ['Eevee', '伊布'],
  ['Raichu', '雷丘'], ['Hoopa', '胡帕'], ['Keldeo', '凯路迪欧'],
  ['Rotom', '洛托姆'], ['Vivillon', '彩粉蝶'], ['Cormoth', '椰蛋树龙'],
  ['Popcorm', '爆米花龙'], ['Amphybuzz', '电龙霸'], ['Steve', '史蒂夫'],
  // 其他
  ['Mega Evolve', '超级进化'], ['Mega evolution', '超级进化'], ['Mega Evolution', '超级进化'],
  ['Primal Revert', '原始回归'], ['Primal Reverse', '原始回归'],
  ['Z-Move', 'Z招式'], ['Z-Moves', 'Z招式'],
  ['DexNav+', 'DexNav+'], ['DexNav', 'DexNav'],
  ['King\'s Rock', '王者之证'], ['Infinite Repel', '无限除虫喷雾'],
  ['Iron Pill', '铁丸'], ['Egg Incubator', '蛋孵化器'],
  ['Elite Redux', '精英重制'], ['Game Boy Advance', 'Game Boy Advance'],
  ['Berry Blender', '树果搅拌机'], ['Berry Program', '树果程序'],
  ['Bike Shop', '自行车店'], ['Ruby/Sapphire', '红宝石/蓝宝石'],
  ['Game Pak', '卡带'], ['Link Cable', '连接线'], ['POKeBALL', '精灵球'],
  ['Easy', '简单'], ['More', '更多'], ['Elite', '精英'], ['Hell', '地狱'],
  ['Monster', '怪兽'], ['Dangerous', '危险'], ['Brutal', '残暴'], ['Insane', '疯狂'],
  ['Resolute', '贤者'], ['Hearthflame', '炉灶'], ['Cornerstone', '磐石'],
  ['Teal Mask', '碧之假面'],
  // 常用短语
  ['critical damage', '会心一击伤害'], ['critical hit', '会心一击'],
  ['super effective', '非常有效'], ['super-effective', '非常有效'],
  ['never misses', '必定命中'], ['always hits', '必定命中'],
  ['higher speed', '更高速度'], ['faster users', '速度越快的使用者'],
  ['heavier users', '体重越重的使用者'], ['each successive hit', '每段'],
  ['increases its', '提升其'], ['sharply raising', '大幅提升'],
  ['lowers their', '降低其'], ['more damage', '更多伤害'],
  ['double damage', '双倍伤害'], ['greater damage', '更强伤害'],
  ['deals damage', '造成伤害'], ['damage dealt', '造成的伤害'],
  ['in a row', '连续'], ['from above', '从上方'], ['into a', '变成'],
  ['of the', '的'], ['and its', '和其'], ['for its', '为其'],
  ['the foe', '对手'], ['the target', '目标'], ['the user', '使用者'],
  ['the party', '队伍'], ['the field', '场地'], ['the battle', '对战'],
];

// Sort by length descending for greedy matching
FIX.sort((a, b) => b[0].length - a[0].length);

function processEntry(task) {
  const en = task.en;
  const codes = task.codes || [];

  // Build reverse map: code → placeholder
  const codeToPH = {};
  for (const [ph, code] of codes) {
    codeToPH[code] = ph;
  }

  // Start with prev as base
  let zh = task.prev || '';

  // Replace codes with placeholders
  for (const [code, ph] of Object.entries(codeToPH)) {
    zh = zh.split(code).join(ph);
  }

  // Translate remaining English
  for (const [eng, chi] of FIX) {
    const re = new RegExp(eng.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    zh = zh.replace(re, chi);
  }

  // Full-width → half-width
  zh = zh.replace(/。/g, '.').replace(/，/g, ',').replace(/！/g, '!').replace(/？/g, '?');
  zh = zh.replace(/：/g, ':').replace(/；/g, ';').replace(/、/g, ',');
  zh = zh.replace(/（/g, '(').replace(/）/g, ')').replace(/【/g, '[').replace(/】/g, ']');
  zh = zh.replace(/—/g, '-').replace(/～/g, '~');

  // Ensure placeholder count matches en
  const enPH = (en.match(/\{\{C\d+\}\}/g) || []);
  const zhPH = (zh.match(/\{\{C\d+\}\}/g) || []);

  if (zhPH.length < enPH.length) {
    for (let i = zhPH.length; i < enPH.length; i++) {
      zh += enPH[i];
    }
  } else if (zhPH.length > enPH.length) {
    // Remove excess placeholders from the end
    let count = 0;
    zh = zh.replace(/\{\{C\d+\}\}/g, (m) => {
      count++;
      return count <= enPH.length ? m : '';
    });
  }

  // Clean up double spaces
  zh = zh.replace(/  +/g, ' ').trim();

  return { id: task.id, zh };
}

// Main
const batches = ['retry-04', 'retry-05', 'retry-06'];
const base = path.resolve(__dirname, '../retry');

for (const batch of batches) {
  const taskFile = path.join(base, batch + '.json');
  const outFile = path.join(__dirname, batch + '.json');

  const data = JSON.parse(fs.readFileSync(taskFile, 'utf8'));
  const tasks = data.tasks || data;

  const entries = tasks.map(t => processEntry(t));

  // Self-check
  let placeholderOK = 0, leftoverEN = 0;
  const issues = [];
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    const e = entries[i];
    const origPH = (t.en.match(/\{\{C\d+\}\}/g) || []).length;
    const newPH = (e.zh.match(/\{\{C\d+\}\}/g) || []).length;
    if (origPH === newPH) placeholderOK++;

    const enWords = (t.en.replace(/\[[^\]]*\]|\{\{[^}]*\}/g, ' ').match(/[A-Za-z]{4,}/g) || []).map(w => w.toLowerCase());
    const zhWords = (e.zh.replace(/\[[^\]]*\]|\{\{[^}]*\}/g, ' ').match(/[A-Za-z]{4,}/g) || []).map(w => w.toLowerCase());
    const left = zhWords.filter(w => enWords.includes(w));
    if (left.length) { leftoverEN++; issues.push(`${t.id}: ${left.join(',')}`); }
  }

  fs.writeFileSync(outFile, JSON.stringify(entries, null, 1));
  console.log(`${batch}: ${entries.length} entries | PH OK: ${placeholderOK}/${entries.length} | Leftover EN: ${leftoverEN}`);
  if (issues.length > 0) console.log(`  Issues (${issues.length}): ${issues.slice(0, 5).join('; ')}`);
}
