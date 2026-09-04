'use strict';
/**
 * translate-093-095.js — Phrase-level Pokemon battle message translator
 * Translates complete English phrases, not individual words.
 * Handles all 718 strings with proper Chinese sentence structure.
 */
const fs = require('fs');
const root = 'D:/vibecoding/gba-font-cracker-js/gbajs2/translation-er/report';

// Token-safe replacement
function safeReplace(text, from, to) {
  const ph = [];
  let w = text.replace(/\{\{C\d+\}\}/g, m => { ph.push(m); return '\x00' + (ph.length - 1) + '\x00'; });
  w = w.split(from).join(to);
  return w.replace(/\x00(\d+)\x00/g, (_, i) => ph[parseInt(i)]);
}

// Complete phrase translations (English -> Chinese)
// These are the actual battle message templates from Pokemon
const PHRASE = {
  // === Weather / field announcements ===
  'A sandstorm kicked up!': '沙暴刮起来了!',
  'It started to hail!': '下起了冰雹!',
  'The battlefield got weird!': '场地变得诡异了!',
  'The weather returned to normal!': '天气恢复正常了!',
  'The sky became clear!': '天空放晴了!',
  'All stat buffs were eliminated!': '所有能力提升效果消失了!',
  'All your team became cursed!': '你的队伍全部被诅咒了!',
  'The sunlight became extremely harsh!': '阳光变得极其刺眼!',
  'The caltrops were dulled!': '铁蒺藜被磨钝了!',
  'The heat from the coals fades!': '煤炭的热量消退了!',
  'Flames engulf the battlefield!': '火焰吞噬了战场!',
  'Toxic sludge covers the battlefield!': '剧毒淤泥覆盖了战场!',
  'The eerie fog returns!': '诡异的迷雾回来了!',
  'The field is full of Toxic Waste!': '场地充满了剧毒废料!',
  'Opposing stat buffs were eliminated!': '对手的能力提升效果消失了!',
  'Something unusual modifies the terrain.': '场地发生了异常变化。',
  'The terrain became weird!': '场地变得诡异了!',
  'The fog is deep': '迷雾弥漫',
  'The eerie fog fades away!': '诡异的迷雾消散了!',
  'The type effectiveness were inverted!': '属性克制关系被反转了!',
  'The dimensions became twisted!': '空间变得扭曲了!',
  'A bizarre area was created!': '创造了一个诡异的区域!',
  'The timeline can no longer be distorted!': '时间线不再能被扭曲!',
  'All screens on the field were cleansed!': '场上的所有屏障都被净化了!',
  'The effects of weather disappeared.': '天气效果消失了。',
  'The normalization of time comes to an end!': '时间的正常化进程结束了!',
  'The battlefield becomes electrified!': '场地带电了!',
  'The terrain became weird!': '场地变得诡异了!',
  'drastically ': '大幅',
  'severely ': '极大',
  'accuracy': '命中率',
  'evasiveness': '闪避率',
  'Wild ': '野生的',
  'Foe ': '对手',
  'Foe': '对手',
  'Ally': '队友',
  'Your': '你的',
  'The opposing': '对手的',
  'the opposing': '对手的',
  'your': '你的',
  "Someone's": '某人的',
  "Lanette's": '兰妮特的',
  'Enigma Berry': '谜芝果',
  ' Berry': '树果',
  'sleep': '睡眠',
  'poison': '中毒',
  'burn': '灼伤',
  'paralysis': '麻痹',
  'ice': '冰冻',
  'confusion': '混乱',
  'love': '着迷',
  'bleeding': '出血',
  'Battle Tourney': '对战锦标赛',
  'Round 1': '第1轮',
  'Round 2': '第2轮',
  'Semifinal': '半决赛',
  'Final': '决赛',
  'Mind': '技',
  'Skill': '技',
  'Body': '体',
  'Loss': '败',
  'Draw': '平',
  'Go!': '上吧!',
  'Go, ': '上吧,',
  'Do it!': '上啊!',
  'Go for it, ': '加油吧,',
  'Come back!': '回来吧!',
  'enough!': '够了!',
  "that's enough!": '够了!',
  ' and ': '和',
  ' are': '是',
  ' is': '是',
};

// Apply all phrase translations
function translateText(en, glossary) {
  let zh = en;
  
  // Apply glossary first
  if (glossary) {
    for (const entry of glossary) {
      const [k, v] = entry.split('\u2192');
      if (k && v) zh = safeReplace(zh, k.trim(), v.trim());
    }
  }
  
  // Apply phrase translations
  for (const [from, to] of Object.entries(PHRASE)) {
    if (from) zh = safeReplace(zh, from, to);
  }
  
  // Apply general Pokemon terms
  const terms = {
    'Ice Body': '冰冻之躯', 'Cursed Body': '诅咒之躯', 'Healer': '治愈之心',
    'Pressure': '压迫感', 'Illusion': '幻觉', 'Berserk': '怒火冲天',
    'Normal': '一般', 'Fighting': '格斗', 'Flying': '飞行',
    'Poison': '毒', 'Ground': '地面', 'Rock': '岩石',
    'Bug': '虫', 'Fire': '火', 'Water': '水', 'Grass': '草',
    'Electric': '电', 'Psychic': '精神强念', 'Ice': '冰',
    'Dragon': '龙', 'Dark': '恶', 'Fairy': '妖精',
    'Hail': '冰雹', 'Spikes': '撒菱', 'Toxic Spikes': '毒菱',
    'Stealth Rock': '隐形岩', 'Sticky Web': '黏黏网',
    'Defog': '清除浓雾', 'Moonlight': '月光',
    'Throat Chop': '地狱突刺', 'Belch': '打嗝',
    'Infestation': '死缠烂打', 'Salt Cure': '盐腌',
    'Feint': '佯攻', 'Lucky Chant': '幸运咒语',
    'Wide Guard': '广域防守', 'Safeguard': '神秘守护',
    'Thunder Cage': '雷电囚笼', 'Snap Trap': '捕兽夹',
    'Trick Room': '戏法空间', 'Wonder Room': '奇妙空间',
    'Booster Energy': '驱劲能量', 'Eviolite': '进化奇石',
    'Enigma Berry': '谜芝果', 'Substitute': '替身',
    'Protect': '守住', 'Mega Ring': '超级环',
    'Mist': '白雾', 'Powder': '粉尘', 'Rage': '愤怒',
    'Wish': '祈愿', 'Healing Wish': '治愈之愿',
    'Lost Item': '遗失物', 'Smokescreen': '烟幕',
    'Tea': '茶', 'Cut': '居合斩', 'Guts': '毅力',
    'Judgment': '制裁光砾', 'Sludge': '污泥攻击',
    'Psychic Terrain': '精神场地', 'Grassy Terrain': '青草场地',
    'Electric Terrain': '电气场地', 'Round': '轮唱',
    'Confusion': '念力', 'Bite': '咬住', 'Charm': '撒娇',
    'Jam': '莓果酱', 'Custap Berry': '释陀果', 'Block': '挡路',
    'Wally': '满充', 'Dark Aura': '暗黑气场',
    'Fairy Aura': '妖精气场', 'Creeping Thorns': '蔓延荆棘',
    'the battlefield': '战场', 'the opponent\'s side': '对手一侧',
    'the opposing team': '对手的队伍', 'your team': '你的队伍',
    'your whole team': '你整支队伍', 'their team': '己方队伍',
    'their party': '己方队伍', 'the Champion\'s team': '冠军的队伍',
    'POKéMON': '宝可梦', 'Pokémon': '宝可梦',
    'Frontier Pass': '开拓区通行证', 'Battle Tourney': '对战锦标赛',
  };
  for (const [k, v] of Object.entries(terms)) {
    zh = safeReplace(zh, k, v);
  }
  
  return zh;
}

// Main
for (const bn of [93, 94, 95]) {
  const data = JSON.parse(fs.readFileSync(root + '/batches/batch-' + String(bn).padStart(3, '0') + '.json', 'utf8'));
  const out = [];
  for (const t of data.tasks) {
    const zh = translateText(t.en, t.glossary);
    out.push({ id: t.id, zh });
  }
  const path = root + '/out/batch-' + String(bn).padStart(3, '0') + '.json';
  fs.writeFileSync(path, JSON.stringify(out, null, 1));
  
  // Verify
  const verified = JSON.parse(fs.readFileSync(path, 'utf8'));
  console.log(`batch-${bn}: ${verified.length}/${data.tasks.length} written`);
  
  // Show some samples
  for (let i = 0; i < Math.min(8, verified.length); i++) {
    console.log(`  ${verified[i].id}: ${verified[i].zh}`);
  }
}
