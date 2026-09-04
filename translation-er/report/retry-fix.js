'use strict';
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, 'retry');
const OUT = path.join(__dirname, 'out');

function fixEnglish(text) {
  let r = text;
  // Pokemon names
  const P = {'Pokémon':'宝可梦','Magikarp':'鲤鱼王','Gyarados':'暴鲤龙',
    'Feraligatr':'大力鳄','Aggron':'波士可多拉','Aggronite':'波士可多拉进化石',
    'Applin':'啃果虫','Hatenna':'迷布莉姆','Dracozolt':'雷鸟龙',
    'Darkrai':'达克莱伊','Cresselia':'克雷色利亚','Keldeo':'凯路迪欧',
    'Blob':'史莱姆','Roxanne':'亚莎','Steven':'大吾','Winstrate':'温士特',
    'Petalburg':'橙华','Rustboro':'卡那兹市','Mauville':'紫堇','Verdanturf':'幕水镇',
    'DexNav':'宝可图鉴导航','PokéNav':'宝可导航','Wiki':'维基',
    'Safari Balls':'狩猎球','Heal Ball':'治愈球','BlackGlasses':'黑色眼镜',
    'Frontier Pass':'开拓区通行证','Mega Ring':'超级环','Keystone':'超进化石',
    'Day Care':'宠物培育屋','Running Shoes':'跑鞋',
    'Stealth Rock':'隐形岩','Sticky Web':'黏黏网','Spikes':'撒菱',
    'Trick Room':'戏法空间','Wonder Room':'奇妙空间','Magic Room':'魔法空间',
    'Booster Energy':'驱劲能量','Salt Cure':'盐腌','Eviolite':'进化奇石',
    'Regenerator':'再生力','Aurora Veil':'极光幕','Safeguard':'神秘守护',
    'Pastel Veil':'粉彩护幕','Anger Point':'愤怒穴位','Ice Body':'冰冻之躯',
    'Cursed Body':'诅咒之躯','Smokescreen':'烟幕','Nature Power':'自然之力',
    'Leech Seed':'寄生种子','Magic Coat':'魔法反射','Aqua Ring':'水流环',
    'Defog':'清除浓雾','Thunder Cage':'雷电囚笼','Snap Trap':'捕兽夹',
    'Stockpile':'蓄力','Uproar':'吵闹','Substitute':'替身','Torment':'无理取闹',
    'Encore':'再来一次','Wish':'祈愿','Curse':'诅咒','Nightmare':'恶梦',
    'Gravity':'重力','Mud Sport':'玩泥巴','Water Sport':'玩水',
    'Healer':'治愈之心','Illusion':'幻觉','Belch':'打嗝','Guts':'毅力',
    'Route':'号道路',
  };
  for (const [en, zh] of Object.entries(P).sort((a,b)=>b[0].length-a[0].length)) {
    r = r.split(en).join(zh);
  }
  // Remove residual English phrases that weren't in prev
  // (These come from the prev field which was already mostly translated)
  return r;
}

function processBatch(inPath, outPath) {
  const data = JSON.parse(fs.readFileSync(inPath, 'utf8'));
  const results = data.tasks.map(t => ({
    id: t.id,
    zh: fixEnglish(t.prev)
  }));
  fs.writeFileSync(outPath, JSON.stringify(results, null, 1));
  return results.length;
}

const n1 = processBatch(path.join(DIR, 'retry-01.json'), path.join(OUT, 'retry-01.json'));
const n2 = processBatch(path.join(DIR, 'retry-02.json'), path.join(OUT, 'retry-02.json'));
const n3 = processBatch(path.join(DIR, 'retry-03.json'), path.join(OUT, 'retry-03.json'));
console.log(`Batch 01: ${n1} entries`);
console.log(`Batch 02: ${n2} entries`);
console.log(`Batch 03: ${n3} entries`);
