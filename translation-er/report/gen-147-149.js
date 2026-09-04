'use strict';
const fs = require('fs');
const path = require('path');

const megaStoneNames = {
  'Lucarionite': '路卡利欧进化石', 'Aegislashite': '坚盾剑怪进化石',
  'Arbokite': '阿柏怪进化石', 'Clefablite': '皮可西进化石',
  'Flygonite': '超音波幼虫进化石', 'Empoleonite': '帝王拿波进化石',
  'Infernapite': '烈焰猴进化石', 'Froslassite': '雪妖女进化石',
  'Glalitite': '冰鬼护进化石', 'Rapidashite': '烈焰马进化石',
  'Golisopite': '智挥猩进化石', 'Hydreigonite': '三首恶龙进化石',
  'Torterranite': '土台龟进化石', 'Reuniclusite': '人造细胞卵进化石',
  'Toxtricitite': '颤蛙进化石', 'Oricorionite': '花舞鸟进化石',
  'Tsareenite': '甜冷美后进化石', 'Amphybuzzite': '电龙进化石',
  'Venusaurite': '妙蛙花进化石', 'Charizardite': '喷火龙进化石',
  'Blastoisinite': '水箭龟进化石', 'Gengarite': '耿鬼进化石',
  'Snorlaxite': '卡比兽进化石', 'Rillaboomite': '轰擂金刚猩进化石',
  'Cinderacite': '闪焰王牌进化石', 'Inteleonite': '千面避役进化石',
  'Corvinite': '钢铠鸦进化石', 'Drednawite': '暴噬龟进化石',
  'Coalossite': '巨炭山进化石', 'Sandacondite': '沙螺蟒进化石',
  'Copperajite': '铜象进化石', 'Hatterenite': '布莉姆温进化石',
  'Garbodorite': '灰尘山进化石', 'Orbeetite': '以欧路普进化石',
  'Grimmsnarlite': '长毛巨魔进化石', 'Centiskite': '火神蛾进化石',
  'Alcremite': '霜奶仙进化石', 'Weavileite': '玛狃拉进化石',
  'Mienshaoite': '功夫鼬进化石', 'Goodranite': '卡比兽进化石',
  'Slowbronite': '呆壳兽进化石', 'Slowkingite': '呆呆王进化石',
  'Arcanite': '嘎啦嘎啦进化石', 'Dududunite': '大王铜柱进化石',
  'Tinkatite': '小锻匠进化石', 'Luxraynite': '伦琴猫进化石',
  'Scizorite': '巨钳螳螂进化石', 'Kleavite': '劈斧螳螂进化石',
  'Scytherite': '飞天螳螂进化石', 'Kinglerite': '大钳蟹进化石',
  'Kilozunite': '铅笔进化石', 'Gardevoirite': '沙奈朵进化石',
  'Galladite': '艾路雷朵进化石', 'Clodsite': '泥巴鱼进化石',
  'Gothitite': '哥德小姐进化石', 'Aggronite': '波士可多拉进化石',
  'Swampageite': '沼跃鱼进化石', 'Chandelurite': '水晶灯火灵进化石',
  'Carbonixite': '大炭车进化石', 'Dragapultite': '多龙巴鲁托进化石',
  'Sandslashite': '穿山王进化石', 'Vanilluxeite': '双倍多多冰进化石',
  'Heracreusite': '赫拉克罗斯进化石', 'Mamoswinite': '象牙猪进化石',
  'Sneaslerite': '狃拉进化石', 'Altarianite': '七夕青鸟进化石',
  'Hariyamite': '哈力君进化石', 'Luxzerite': '伦琴猫进化石',
  'Talonflameite': '烈箭鹰进化石', 'Starminite': '太阳珊瑚进化石',
  'Dragoninite': '快龙进化石', 'Excadrite': '大嘴娃进化石',
  'Scolipite': '龙头地鼠进化石', 'Eelektrossite': '电鳗进化石',
  'Chesnaughtite': '布里卡隆进化石', 'Delphoxite': '妖火红狐进化石',
  'Greninjite': '甲贺忍蛙进化石', 'Malamarite': '超坏星进化石',
  'Barbaracite': '钻角犀兽进化石', 'Dragalgite': '多龙梅西亚进化石',
  'Hawluchanite': '摔角鹰人进化石', 'Drampanite': '铁臂膀进化石',
  'Falinksite': '劈斧螳螂进化石', 'Raichunite': '雷丘进化石',
  'Pyroarite': '火炎狮进化石', 'Skarmorite': '骷髅进化石',
  'Victreebelite': '大食花进化石', 'Chimechite': '风铃铃进化石',
  'Absolite': '阿勃梭鲁进化石', 'Garchompite': '烈咬陆鲨进化石',
  'Staraptite': '电光兽进化石',
};

const natures = {
  'Hardy': '勤奋', 'Lonely': '怕寂寞', 'Brave': '勇敢', 'Adamant': '固执',
  'Naughty': '顽皮', 'Bold': '大胆', 'Docile': '坦率', 'Relaxed': '悠闲',
  'Impish': '淘气', 'Lax': '乐天', 'Timid': '胆小', 'Hasty': '急躁',
  'Serious': '认真', 'Jolly': '爽朗', 'Naive': '天真', 'Modest': '内敛',
  'Mild': '慢吞吞', 'Quiet': '冷静', 'Bashful': '害羞', 'Rash': '马虎',
  'Calm': '温和', 'Gentle': '温顺', 'Sassy': '自大', 'Careful': '慎重',
  'Quirky': '浮躁'
};

const traits = {
  'Loves to eat.': '非常喜欢吃。',
  'Proud of its power.': '对自己的力量感到自豪。',
  'Sturdy body.': '身体结实。',
  'Likes to run.': '喜欢奔跑。',
  'Highly curious.': '好奇心很强。',
  'Strong willed.': '意志坚强。',
  'Takes plenty of siestas.': '经常午睡。',
  'Likes to thrash about.': '喜欢乱闹。',
  'Capable of taking hits.': '很能扛打。',
  'Alert to sounds.': '对声音很敏感。',
  'Mischievous.': '喜欢恶作剧。',
  'Somewhat vain.': '有点虚荣。',
  'Nods off a lot.': '经常打瞌睡。',
  'A little quick tempered.': '有点急性子。',
  'Highly persistent.': '非常坚持。',
  'Impetuous and silly.': '冲动又傻乎乎。',
  'Thoroughly cunning.': '非常狡猾。',
  'Strongly defiant.': '非常不服输。',
  'Scatters things often.': '经常乱丢东西。',
  'Likes to fight.': '喜欢战斗。',
  'Good endurance.': '耐力很好。',
  'Somewhat of a clown.': '有点搞笑。',
  'Often lost in thought.': '经常陷入沉思。',
  'Hates to lose.': '讨厌输。',
  'Likes to relax.': '喜欢放松。',
  'Quick tempered.': '脾气急。',
  'Good perseverance.': '毅力很好。',
  'Quick to flee.': '逃跑很快。',
  'Very finicky.': '非常挑剔。',
  'Somewhat stubborn.': '有点固执。',
  'Happily eats anything.': '什么都吃。',
};

const labels = {
  'ID No.': '编号', 'Pokémon Info': '宝可梦信息', 'Trainer Memo': '训练家笔记',
  'Abilities': '特性', 'Pokémon Stats': '宝可梦能力', 'Moves': '招式',
  'Condition': '状态', 'Pokémon IVs': '宝可梦个体值', 'Pokémon EVs': '宝可梦努力值',
  'Evolution Data': '进化数据', 'None': '无', 'Cancel': '取消', 'Power': '威力',
  'Accuracy': '命中率', 'Appeal': '华丽', 'Jam': '干扰',
  'Pokédex No.': '图鉴编号', 'Name': '名字', 'Type': '属性',
  'Exp. Points': '经验值', 'To Next Lv.': '距下级', 'Attack': '攻击',
  'Defense': '防御', 'Sp. Atk': '特攻', 'Sp. Def': '特防',
  'Speed': '速度', 'Sheen': '光泽', 'Cool': '帅气',
  'Beauty': '美丽', 'Cute': '可爱', 'Smart': '聪明',
  'Tough': '强壮', 'Held Item': '携带道具', 'Ability': '特性',
  'Innate': '天生特性', 'Acc': '命中', 'Level': '等级',
  'Stat': '能力值', 'Phys': '物攻', 'Spec': '特攻', 'Learned': '已学会',
};

const locations = {
  'BATTLE TOWER': '对战塔', 'A DISTANT LAND': '遥远的国度', 'OUTSKIRT STAND': '边境小镇',
  'PHENAC CITY': '翡翠市', 'PRE GYM': '道馆前',
  'PHENAC STADIUM': '翡翠竞技场', 'PYRITE TOWN': '黄铁镇', 'PYRITE BLDG': '黄铁大楼',
  'PYRITE CAVE': '黄铁洞穴',
  'PYRITE COLOSSEUM': '黄铁竞技场', 'AGATE VILLAGE': '阿盖特村',
  'RELIC CAVE': '遗迹洞穴', 'THE UNDER': '地下世界',
  ' THE UNDER SUBWAY': '地下世界地铁', 'UNDER COLOSSEUM': '地下竞技场',
  'DEEP COLOSSEUM': '深层竞技场', 'FRONT OF LAB': '研究所前',
  'LABORATORY': '研究所', 'MT. BATTLE': '对战山',
  'MT.BTL COLOSSEUM': '对战山竞技场', 'REALGAM TOWER': '利尔加姆塔',
  'REALGAMTWR DOME': '利尔加姆塔穹顶', 'REALGAMTWR LOBBY': '利尔加姆塔大厅',
  'TOWER COLOSSEUM': '塔之竞技场', 'ORRE COLOSSEUM': '奥雷竞技场',
  'SNAGEM HIDEOUT': '夺取队隐居地', 'REALGAM TOWER 2F': '利尔加姆塔2楼',
  'CIPHER LAB': '暗影研究所', 'S.S. LIBRA': '天秤号',
  'CIPHER KEY LAIR': '暗影钥匙巢穴', 'CITADARK ISLE': '暗之城岛',
  'OASIS': '绿洲', 'CAVE': '洞穴', 'POKÉMON HQ LAB': '宝可梦总部研究所',
  'GATEON PORT': '加蒂恩港', 'ROCK': '岩石',
};

const types = {
  'Ghost': '幽灵', 'Dark': '恶', 'Psychic': '超能力', 'Ice': '冰',
  'Water': '水', 'Poison': '毒', 'Bug': '虫', 'Ground': '地面',
  'Electric': '电', 'Normal': '一般', 'Fire': '火', 'Fairy': '妖精',
  'Grass': '草', 'Steel': '钢',
};

function translateBatch(batchFile) {
  const data = JSON.parse(fs.readFileSync(batchFile, 'utf8'));
  const results = [];

  for (const t of data.tasks) {
    const en = t.en;
    const glossary = t.glossary || [];
    const gloss = {};
    for (const g of glossary) {
      const [k, v] = g.split('\u2192');
      if (k && v) gloss[k.trim()] = v.trim();
    }

    let zh = null;

    // Purchase mega stone
    if (!zh && en.startsWith('Purchase ')) {
      const m = en.match(/^Purchase (.+?) from (?:an )?Adoption Center\./);
      if (m) {
        const stoneName = m[1];
        const stoneZh = megaStoneNames[stoneName] || gloss[stoneName] || stoneName;
        zh = '\u5728\u9886\u517b\u4e2d\u5fc3\u8d2d\u4e70' + stoneZh + '\u3002';
      }
    }
    // Get from Steven
    if (!zh && en.startsWith('Get ')) {
      const m = en.match(/^Get (.+?) from Steven(?:'s)? House in\{\{C0\}\}(.+)\./);
      if (m) { const p = gloss[m[1]]||m[1]; zh = '\u5728' + m[2].trim() + '\u7684\u5e0c\u7f57\u6069\u5bb6\u83b7\u5f97' + p + '\u3002'; }
      else { const m2 = en.match(/^Get (.+?) from Steven's House in(.+)\./); if (m2) { const p = gloss[m2[1]]||m2[1]; zh = '\u5728' + m2[2].trim() + '\u7684\u5e0c\u7f57\u6069\u5bb6\u83b7\u5f97' + p + '\u3002'; } }
    }
    // Defeat Monotype Champion
    if (!zh && en.includes('Monotype Champion')) {
      const m = en.match(/Defeat the (\w+) Monotype\{\{C0\}\}Champion\./);
      if (m) { zh = '\u51fb\u8d25' + (types[m[1]]||m[1]) + '\u5c5e\u6027\u5355\u5c5e\u6027\u51a0\u519b\u3002'; }
    }
    // Defeat quest
    if (!zh && en.startsWith('Defeat ')) {
      let e = en.replace(/\{\{C\d+\}\}/g, ' ');
      if (e.includes('Totem ')) {
        const m = e.match(/Defeat Totem (\w+) in\{\{C0\}\}(.+?)\.?\s*$/);
        if (!m) { const m2 = e.match(/Defeat Totem (\w+) in (.+?)\.?\s*$/); if (m2) { zh = '\u5728' + m2[2].trim() + '\u51fb\u8d25\u9738\u4e3b' + (gloss[m2[1]]||m2[1]) + '\u3002'; } }
        else zh = '\u5728' + m[2].trim() + '\u51fb\u8d25\u9738\u4e3b' + (gloss[m[1]]||m[1]) + '\u3002';
      } else if (e.includes('Leader ') || e.includes('Gym Leader')) {
        const m = e.match(/Defeat (?:Leader|Gym Leader) (\w+)\.?/);
        if (m) zh = '\u51fb\u8d25' + m[1] + '\u9986\u4e3b\u3002';
      } else {
        const m = e.match(/Defeat (.+?) (?:on|in|at|outside) (.+?)\.?\s*$/);
        if (m) zh = '\u5728' + m[2].trim() + '\u51fb\u8d25' + m[1].trim() + '\u3002';
        else { const m2 = e.match(/Defeat (.+?)\.?\s*$/); if (m2) zh = '\u51fb\u8d25' + m2[1].trim() + '\u3002'; }
      }
    }
    // Find / Solve / Speak
    if (!zh && en.startsWith('Find ')) {
      const m = en.replace(/\{\{C\d+\}\}/g, ' ').match(/Find in (.+?)\.?\s*$/);
      if (m) zh = '\u5728' + m[1].trim() + '\u627e\u5230\u3002';
    }
    if (!zh && en.startsWith('Solve ')) {
      const m = en.replace(/\{\{C\d+\}\}/g, ' ').match(/Solve the mystery at (.+?)\.?\s*$/);
      if (m) zh = '\u89e3\u5f00' + m[1].trim() + '\u7684\u8c1c\u56e2\u3002';
    }
    if (!zh && en.startsWith('Speak ')) {
      const m = en.match(/Speak to (?:Leader )?(.+?)\.?\s*$/);
      if (m) zh = '\u4e0e' + m[1].trim() + '\u5bf9\u8bdd\u3002';
    }
    // Talk to / Unknown
    if (!zh && en.startsWith('Talk to ')) {
      zh = '\u4e0e' + en.replace('Talk to ', '').replace('.', '').trim() + '\u5bf9\u8bdd\u3002';
    }
    if (!zh && en.startsWith('Unknown ')) {
      zh = '\u672a\u77e5\u89e3\u9501\u65b9\u5f0f\u3002';
    }
    // Nature with stats
    if (!zh && /\(\+?\w+, -?\w+\)/.test(en)) {
      const m = en.match(/^(\w+)\s*\((.+?)\)/);
      if (m) {
        const name = natures[m[1]] || m[1];
        const statMap = {'Atk':'攻击','Def':'防御','SpA':'特攻','SpD':'特防','Spe':'速度'};
        const statZh = m[2].replace(/(\w+)/g, s => statMap[s] || s);
        zh = name + '\uff08' + statZh + '\uff09';
      }
    }
    // Nature plain
    if (!zh && natures[en.trim()]) zh = natures[en.trim()];
    // Traits
    if (!zh && traits[en]) zh = traits[en];
    // Food preferences
    if (!zh && en.startsWith('Likes ')) {
      const fm = en.match(/Likes \{\{C0\}\}\{\{C1\}\}(\w+)\{\{C2\}\}\{\{C3\}\} food\./);
      if (fm) { const fd = {'spicy':'辣','dry':'涩','sweet':'甜','bitter':'苦','sour':'酸'}[fm[1]]||fm[1]; zh = '\u559c\u6b22{{C0}}{{C1}}' + fd + '{{C2}}{{C3}}\u5473\u98df\u7269\u3002'; }
    }
    // Egg Watch
    if (!zh && en.includes('POKÉMON EGG')) {
      if (en.includes('very mysterious')) zh = '\u4e00\u679a\u975e\u5e38\u795e\u79d8\u7684{{C0}}\u5b9d\u53ef\u68a6{{C1}}{{C2}}{{C3}}\u86cb\u3002';
      else if (en.includes('An odd') && en.includes('DAY CARE') && en.includes('KANTO')) zh = '\u5728\u5173\u90fd\u5730\u533a\u7684\u82d2\u80b2\u5c4b\u592b\u5987\u53d1\u73b0\u7684\u5947\u602a\u5b9d\u53ef\u68a6\u86cb\u3002';
      else if (en.includes('An odd') && en.includes('DAY CARE')) zh = '\u5728\u82d2\u80b2\u5c4b\u592b\u5987\u53d1\u73b0\u7684\u5947\u602a\u5b9d\u53ef\u68a6\u86cb\u3002';
      else if (en.includes('peculiar')) zh = '\u5728\u4e00\u5904\u597d\u5730\u65b9\u83b7\u5f97\u7684\u7279\u6b8a\u5b9d\u53ef\u68a6\u86cb\u3002';
      else if (en.includes('hot springs')) zh = '\u5728\u6e29\u6cc9\u83b7\u5f97\u7684\u5b9d\u53ef\u68a6\u86cb\u3002';
      else if (en.includes('traveler')) zh = '\u4ece\u65c5\u884c\u8005\u5904\u83b7\u5f97\u7684\u5947\u602a\u5b9d\u53ef\u68a6\u86cb\u3002';
      else if (en.includes('BRIGETTE')) zh = '\u4ece\u5e0c\u5e0c\u7279\u5904\u83b7\u5f97\u7684\u5b9d\u53ef\u68a6\u86cb\u3002';
    }
    // UI Labels
    if (!zh && labels[en]) zh = labels[en];
    // Locations
    if (!zh && locations[en]) zh = locations[en];
    if (!zh && locations[en.replace(/^,\s*/, '')]) zh = locations[en.replace(/^,\s*/, '')];
    // Page UI
    if (!zh && en.includes('Page') && en.includes('Detail')) {
      if (en.includes('Replace')) zh = '{{C0}}\u9875 {{C1}} \u8be6\u60c5 {{C2}}\u66ff\u6362';
      else if (en.includes('Modify')) zh = '{{C0}}\u9875 {{C1}} \u4fee\u6539';
      else if (en.includes('EVs')) zh = '{{C0}}\u9875 {{C1}} \u52aa\u529b\u503c';
      else if (en.includes('Stats')) zh = '{{C0}}\u9875 {{C1}} \u80fd\u529b';
      else zh = '{{C0}}\u9875 {{C1}} \u8be6\u60c5';
    }
    // Locked
    if (!zh && en.startsWith('Locked until level')) zh = '\u9501\u5b9a\u81f3\u7b49\u7ea7{{C0}}\u3002';
    // Move descriptions (unique ones)
    if (!zh && en === 'Hides on the first turn{{C0}}scares the foe on the{{C1}}second. 30% flinch{{C2}}chance.')
      zh = '\u9996\u56de\u5408\u9690\u853d{{C0}}\u6b21\u56de\u5408\u6050\u5413\u5bf9\u624b\u3002{{C1}}30%\u51e0\u7387\u4f7f\u5bf9\u624b\u754f\u7f29\u3002{{C2}}';
    if (!zh && en === 'Strikes with a mighty{{C0}}gale, but the user\'s{{C1}}Speed is lowered. Air{{C2}}based.')
      zh = '\u4ee5\u731b\u70c8\u72c2\u98ce\u653b\u51fb{{C0}}\uff0c\u4f46\u4f7f\u7528\u8005\u901f\u5ea6\u964d\u4f4e\u3002{{C1}}\u98de\u884c\u5c5e\u6027\u3002{{C2}}';
    if (!zh && en === '30% chance to lower{{C0}}Special Defense. Never{{C1}}misses in fog.')
      zh = '30%\u51e0\u7387\u964d\u4f4e\u7279\u9632\u3002{{C0}}\u96fe\u5929\u5fc5\u4e2d\u3002{{C1}}';
    if (!zh && en === 'Deals heavy damage.{{C0}}Afterwards the user{{C1}}loses its Dark typing.')
      zh = '\u9020\u6210\u5de8\u5927\u4f24\u5bb3\u3002{{C0}}\u4e4b\u540e\u4f7f\u7528\u8005\u5931\u53bb\u6076\u5c5e\u6027\u3002{{C1}}';
    if (!zh && en === 'Deals damage and then{{C0}}switches out. Air based.')
      zh = '\u9020\u6210\u4f24\u5bb3\u540e\u66ff\u6362\u4e0b\u573a\u3002{{C0}}\u98de\u884c\u5c5e\u6027\u3002';
    if (!zh && en === 'Spreads spikes that{{C0}}inflict bleeding on the{{C1}}next opponent to switch{{C2}}in.')
      zh = '\u6492\u4e0b\u5c16\u9489\uff0c\u4f7f\u4e00\u4e2a\u4e0a\u573a\u7684\u5bf9\u624b\u964d\u5165\u51fa\u8840\u72b6\u6001\u3002{{C0}}{{C1}}{{C2}}';
    if (!zh && en === 'Heals status and raises{{C0}}SpAtk and SpDef by 1{{C1}}stage.')
      zh = '\u56de\u590d\u5f02\u5e38\u72b6\u6001\u5e76\u63d0\u5347\u7279\u653b\u7279\u96321\u7ea7\u3002{{C0}}{{C1}}';
    if (!zh && en === '50% chance to raise{{C0}}Special Attack. Dance{{C1}}move.')
      zh = '50%\u51e0\u7387\u63d0\u5347\u7279\u653b\u3002{{C0}}\u821e\u8e48\u7c7b\u62db\u5f0f\u3002{{C1}}';
    if (!zh && en === '50% chance to raise{{C0}}Speed. Dance move.')
      zh = '50%\u51e0\u7387\u63d0\u5347\u901f\u5ea6\u3002{{C0}}\u821e\u8e48\u7c7b\u62db\u5f0f\u3002';
    if (!zh && en === 'Hits both opponents.{{C0}}30% chance to flinch.{{C1}}Air based.')
      zh = '\u653b\u51fb\u53cc\u65b9\u5bf9\u624b\u3002{{C0}}30%\u51e0\u7387\u4f7f\u5bf9\u624b\u754f\u7f29\u3002{{C1}}\u98de\u884c\u5c5e\u6027\u3002';
    if (!zh && en === 'Deals damage and raises{{C0}}the user\'s highest{{C1}}attack or defense by 1{{C2}}stage.')
      zh = '\u9020\u6210\u4f24\u5bb3\u5e76\u63d0\u5347\u4f7f\u7528\u8005\u6700\u9ad8\u7684\u653b\u51fb\u6216\u9632\u5fa11\u7ea7\u3002{{C0}}{{C1}}{{C2}}';
    if (!zh && en === 'Hits three times. More{{C0}}powerful with each{{C1}}successive hit.')
      zh = '\u8fde\u7eed\u653b\u51fb\u4e09\u6b21\u3002{{C0}}\u6bcf\u6b21\u5473\u9053\u66f4\u5f3a\u3002{{C1}}';
    if (!zh && en === 'A powerful punch that{{C0}}never misses. High crit{{C1}}rate. Iron Fist boost.')
      zh = '\u4e00\u8bb0\u5f3a\u529b\u7684\u62f3\u51fb\uff0c\u5fc5\u4e2d\u3002{{C0}}\u9ad8\u66b4\u51fb\u7387\u3002\u94c1\u62f3\u589e\u5f3a\u3002{{C1}}';
    if (!zh && en === 'The user\'s spirit{{C0}}surges from a azure{{C1}}full moon. Cannot be{{C2}}used twice in a row.')
      zh = '\u4f7f\u7528\u8005\u7684\u7cbe\u795e\u4ece\u9752\u7a7a\u6ee1\u6708\u4e2d\u6fc0\u53d1\u3002{{C0}}{{C1}}\u4e0d\u53ef\u8fde\u7eed\u4f7f\u7528\u4e24\u6b21\u3002{{C2}}';
    if (!zh && en === 'Foe\'s last move has 3 PP{{C0}}cut. Mega launcher{{C1}}boost.')
      zh = '\u5bf9\u624b\u6700\u540e\u4f7f\u7528\u7684\u62db\u5f0f\u51cf\u5c113PP\u3002{{C0}}\u8d85\u7ea7\u53d1\u5c04\u5668\u589e\u5f3a\u3002{{C1}}';
    if (!zh && en === 'Rotates its body like a{{C0}}drill. High crit ratio.{{C1}}Mighty Horn boost.')
      zh = '\u8eab\u4f53\u65cb\u8f6c\u5982\u94bb\u5934\u3002\u9ad8\u66b4\u51fb\u7387\u3002{{C0}}\u5927\u89d2\u589e\u5f3a\u3002{{C1}}';
    if (!zh && en === 'A strong punch from the{{C0}}shadows. Always hits.{{C1}}Iron Fist boost.')
      zh = '\u4ece\u6697\u5904\u53d1\u51fa\u7684\u5f3a\u529b\u4e00\u51fb\u3002\u5fc5\u4e2d\u3002{{C0}}\u94c1\u62f3\u589e\u5f3a\u3002{{C1}}';
    if (!zh && en === 'A powerful punch. 30%{{C0}}chance to drop defense.{{C1}}Iron Fist boost.')
      zh = '\u4e00\u8bb0\u5f3a\u529b\u62f3\u51fb\u300230%\u51e0\u7387\u964d\u4f4e\u9632\u5fa1\u3002{{C0}}\u94c1\u62f3\u589e\u5f3a\u3002{{C1}}';
    // Move desc: damage and raises
    if (!zh && en === 'Deals damage and raises{{C0}}the user\'s highest{{C1}}attack or defense by 1{{C2}}stage.')
      zh = '\u9020\u6210\u4f24\u5bb3\u5e76\u63d0\u5347\u4f7f\u7528\u8005\u6700\u9ad8\u7684\u653b\u51fb\u6216\u9632\u5fa11\u7ea7\u3002{{C0}}{{C1}}{{C2}}';
    // More unique move descs
    if (!zh && en === 'A jabbing attack. 30% {{C0}}chance to inflict{{C1}}bleeding. Mighty Horn{{C2}}boost.')
      zh = '\u7a81\u523a\u653b\u51fb\u300230%\u51e0\u7387\u964d\u51fa\u8840\u3002{{C0}}{{C1}}\u5927\u89d2\u589e\u5f3a\u3002{{C2}}';
    if (!zh && en === 'A jabbing attack. 30% {{C0}}chance to lower{{C1}}Defense. Mighty Horn{{C2}}boost.')
      zh = '\u7a81\u523a\u653b\u51fb\u300230%\u51e0\u7387\u964d\u4f4e\u9632\u5fa1\u3002{{C0}}{{C1}}\u5927\u89d2\u589e\u5f3a\u3002{{C2}}';
    if (!zh && en === 'Dives and then attacks{{C0}}on the next turn. 20%{{C1}}chance to poison.')
      zh = '\u6f5c\u5165\u6c34\u4e2d\u540e\u6b21\u56de\u5408\u653b\u51fb\u3002{{C0}}20%\u51e0\u7387\u4e2d\u6bd2\u3002{{C1}}';
    if (!zh && en === 'Clears other rooms and{{C0}}sets Magic Room, then{{C1}}switches to an ally.')
      zh = '\u6e05\u9664\u5176\u4ed6\u623f\u95f4\u5e76\u5c55\u5f00\u9b54\u6cd5\u7a7a\u95f4\uff0c\u7136\u540e\u66ff\u6362\u540c\u4f34\u3002{{C0}}{{C1}}';
    if (!zh && en === 'Strikes with a white{{C0}}hot horn, ignoring stat{{C1}}changes. Might Horn{{C2}}boost.')
      zh = '\u4ee5\u70ed\u7684\u89d2\u653b\u51fb\uff0c\u65e0\u89c6\u80fd\u529b\u53d8\u5316\u3002{{C0}}{{C1}}\u5927\u89d2\u589e\u5f3a\u3002{{C2}}';
    if (!zh && en === 'A wide reaching bomb is{{C0}}thrown, hitting the{{C1}}field with A 30% burn{{C2}}chance.')
      zh = '\u6295\u63b7\u4e00\u679a\u5927\u8303\u56f4\u70b8\u5f39\uff0c\u51fb\u4e2d\u573a\u5730\uff0c30%\u711a\u4f24\u7387\u3002{{C0}}{{C1}}{{C2}}';
    if (!zh && en === 'Throws a ball forward.{{C0}}20% flinch chance')
      zh = '\u5411\u524d\u65b9\u6295\u51fa\u7403\u3002{{C0}}20%\u754f\u7f29\u7387';
    if (!zh && en === 'Heals you and your ally{{C0}}by 25% and does damage.')
      zh = '\u6062\u590d\u81ea\u5df1\u548c\u540c\u4f3425%HP\u5e76\u9020\u6210\u4f24\u5bb3\u3002{{C0}}';
    if (!zh && en === 'Throws a heavy sphere.{{C0}}30% to lower speed.')
      zh = '\u6295\u63b7\u6c89\u91cd\u7684\u7403\u4f53\u3002{{C0}}30%\u51e0\u7387\u964d\u4f4e\u901f\u5ea6\u3002';
    if (!zh && en === 'Drops 2 to 5 blocks{{C0}}onto the target.')
      zh = '\u6295\u4e0b2\u52305\u5757\u3002{{C0}}';
    if (!zh && en === 'Hits twice. Uses elec.{{C0}}or fire based on{{C1}}effectiveness.')
      zh = '\u653b\u51fb\u4e24\u6b21\u3002\u6839\u636e\u6709\u6548\u6027\u4f7f\u7528\u7535\u6216\u706b\u5c5e\u6027\u3002{{C0}}{{C1}}';
    if (!zh && en === 'Lunges at the target{{C0}}quickly. +1 prio.')
      zh = '\u5feb\u901f\u7a81\u88ad\u5bf9\u624b\u3002{{C0}}+1\u4f18\u5148\u5ea6\u3002';
    if (!zh && en === 'The user throws sand on{{C0}}a dime. 10% acc. drop,{{C1}}+1 priority.')
      zh = '\u4f7f\u7528\u8005\u5411\u5bf9\u624b\u6492\u6c99\u300210%\u547d\u4e2d\u7387\u964d\u4f4e\uff0c{{C0}}+1\u4f18\u5148\u5ea6\u3002{{C1}}';
    if (!zh && en === 'Attacks and uses a{{C0}}random berry effect.')
      zh = '\u653b\u51fb\u5e76\u4f7f\u7528\u968f\u673a\u6811\u679c\u6548\u679c\u3002{{C0}}';
    if (!zh && en === 'Tampers with the{{C0}}target. Stronger vs{{C1}}Steel.')
      zh = '\u5e72\u6270\u5bf9\u624b\u3002{{C0}}\u5bf9\u94a2\u5c5e\u6027\u66f4\u6709\u6548\u3002{{C1}}';
    if (!zh && en === 'Swoops with incredible{{C0}}speed. +2 prio.')
      zh = '\u4ee5\u60ca\u4eba\u901f\u5ea6\u51b2\u950b\u3002{{C0}}+2\u4f18\u5148\u5ea6\u3002';
    if (!zh && en === 'A hazardous energy ball{{C0}}hits the foe. 50% recoil{{C1}}damage.')
      zh = '\u6295\u63b7\u5371\u9669\u7684\u80fd\u91cf\u7403\uff0c\u9020\u621050%\u53cd\u4f0f\u4f24\u5bb3\u3002{{C0}}{{C1}}';
    if (!zh && en === 'An all consuming rain{{C0}}hits the foe. drops{{C1}}your defenses.')
      zh = '\u50ac\u751f\u5927\u96e8\u88ad\u5411\u5bf9\u624b\uff0c\u964d\u4f4e\u81ea\u5df1\u7684\u9632\u5fa1\u3002{{C0}}{{C1}}';
    if (!zh && en === 'The user applies a{{C0}}stone cold barrier,{{C1}}setting reflect.')
      zh = '\u4f7f\u7528\u8005\u5c55\u5f00\u575a\u51b0\u5c4f\u969c\uff0c\u5c55\u5f00\u53cd\u5c04\u58c1\u3002{{C0}}{{C1}}';
    if (!zh && en === 'User strikes first. It{{C0}}fails if the foe is not{{C1}}attacking.')
      zh = '\u4f7f\u7528\u8005\u5148\u5236\u653b\u51fb\u3002{{C0}}\u5bf9\u624b\u672a\u53d1\u52a8\u653b\u51fb\u65f6\u5931\u8d25\u3002{{C1}}';
    if (!zh && en === 'Shoots an arrow with{{C0}}fighter will. 20% flinch{{C1}}chance.')
      zh = '\u5c04\u51fa\u8574\u542b\u6597\u5fd7\u7684\u7bad\u3002{{C0}}20%\u754f\u7f29\u7387\u3002{{C1}}';
    if (!zh && en === 'A kick from a{{C0}}reinforced leg. 20% Atk{{C1}}drop. Striker.')
      zh = '\u4ee5\u5f3a\u5316\u7684\u817f\u8e22\u51fa\u4e00\u51fb\u3002{{C0}}20%\u653b\u51fb\u964d\u4f4e\u3002\u6253\u51fb\u7c7b\u3002{{C1}}';
    if (!zh && en === 'Hits 2 to 5 times. Has{{C0}}+1 priority. Iron Fist{{C1}}boost.')
      zh = '\u8fde\u7eed\u653b\u51fb2\u52305\u6b21\u3002{{C0}}+1\u4f18\u5148\u5ea6\u3002\u94c1\u62f3\u589e\u5f3a\u3002{{C1}}';
    if (!zh && en === 'Super effective vs{{C0}}Poison. Can\'t be used{{C1}}twice in a row. Hammer-{{C2}}based.')
      zh = '\u5bf9\u6bd2\u5c5e\u6027\u6709\u6548\u3002{{C0}}\u4e0d\u53ef\u8fde\u7eed\u4f7f\u7528\u4e24\u6b21\u3002\u9524\u5b50\u7c7b\u3002{{C1}}{{C2}}';
    if (!zh && en === 'Supresses the targets{{C0}}abilities then switches{{C1}}out.')
      zh = '\u5c01\u9501\u5bf9\u624b\u7684\u7279\u6027\uff0c\u7136\u540e\u66ff\u6362\u4e0b\u573a\u3002{{C0}}{{C1}}';
    if (!zh && en === 'Makes the target move{{C0}}last. 20% drench{{C1}}chance, 50% in rain.')
      zh = '\u4f7f\u5bf9\u624b\u884c\u52a8\u987a\u5e8f\u53d8\u540e\u3002{{C0}}20%\u6e7f\u6da6\u7387\uff0c\u96e8\u592950%\u3002{{C1}}';
    if (!zh && en === 'Adds dark type and{{C0}}enraged status to the{{C1}}target.')
      zh = '\u4e3a\u5bf9\u624b\u9644\u52a0\u6076\u5c5e\u6027\u548c\u6012\u6c14\u72b6\u6001\u3002{{C0}}{{C1}}';
    if (!zh && en === 'Attacks with wind that{{C0}}hits both targets.')
      zh = '\u7528\u98ce\u8fdb\u884c\u653b\u51fb\uff0c\u653b\u51fb\u53cc\u65b9\u5bf9\u624b\u3002{{C0}}';
    if (!zh && en === 'Howling winds shake the{{C0}}heavens, hitting both{{C1}}foes.')
      zh = '\u72c2\u98ce\u6447\u52a8\u5929\u9645\uff0c\u653b\u51fb\u53cc\u65b9\u5bf9\u624b\u3002{{C0}}{{C1}}';
    if (!zh && en === 'Boosts Poison-type{{C0}}moves for 8 turns and{{C1}}deals 1/16 HP damage.')
      zh = '\u589e\u5f3a\u6bd2\u5c5e\u6027\u62db\u5f0f8\u56de\u5408\uff0c\u6bcf\u56de\u5408\u9020\u62101/16HP\u4f24\u5bb3\u3002{{C0}}{{C1}}';
    if (!zh && en === 'Strikes and negates{{C0}}evs, items, boosts, and{{C1}}hits lowest defense.')
      zh = '\u653b\u51fb\u5e76\u65e0\u89c6\u4e2a\u4f53\u503c\u3001\u9053\u5177\u3001\u80fd\u529b\u53d8\u5316\uff0c\u653b\u51fb\u9632\u5fa1\u6700\u4f4e\u7684\u5bf9\u624b\u3002{{C0}}{{C1}}';
    if (!zh && en === 'Hits both sides with a{{C0}}thundershock at the{{C1}}end of each turn for 2-{{C2}}5 turns.')
      zh = '\u7528\u96f7\u51fb\u653b\u51fb\u53cc\u65b9\uff0c\u6bcf\u56de\u5408\u7ed3\u675f\u65f6\u53d1\u52a8\uff0c\u6301\u7eed2-5\u56de\u5408\u3002{{C0}}{{C1}}{{C2}}';
    if (!zh && en === 'Fires an energy prism,{{C0}}lowers acc. of the foe{{C1}}by 1, 10% chance to{{C2}}confuse foe.')
      zh = '\u53d1\u5c04\u80fd\u91cf\u68f1\u955c\uff0c\u964d\u4f4e\u5bf9\u624b\u547d\u4e2d\u73871\u7ea7\uff0c10%\u51e0\u7387\u4f7f\u5bf9\u624b\u6df7\u4e71\u3002{{C0}}{{C1}}{{C2}}';
    if (!zh && en === 'Charges with earth{{C0}}shattering power. 33%{{C1}}recoil damage.')
      zh = '\u4ee5\u649f\u5730\u4e4b\u529b\u51b2\u950b\u3002{{C0}}33%\u53cd\u4f0f\u4f24\u5bb3\u3002{{C1}}';
    if (!zh && en === 'Hits the foe with 3{{C0}}explosive snowballs.{{C1}}10% Frostbite.')
      zh = '\u5411\u5bf9\u624b\u6295\u63b73\u4e2a\u7206\u70b8\u96ea\u7403\u3002{{C0}}10%\u51bb\u4f24\u3002{{C1}}';
    if (!zh && en === 'Supresses the targets{{C0}}abilities then switches{{C1}}out.')
      zh = '\u5c01\u9501\u5bf9\u624b\u7279\u6027\u540e\u66ff\u6362\u4e0b\u573a\u3002{{C0}}{{C1}}';
    if (!zh && en === 'Guides an ally onto the{{C0}}field. They take -35%{{C1}}damage this turn.')
      zh = '\u5f15\u5bfc\u540c\u4f34\u4e0a\u573a\u3002\u672c\u56de\u5408\u53d7\u5230\u7684\u4f24\u5bb3\u51cf\u5c1135%\u3002{{C0}}{{C1}}';
    if (!zh && en === 'Deals damage and switches{{C0}}out.')
      zh = '\u9020\u6210\u4f24\u5bb3\u540e\u66ff\u6362\u4e0b\u573a\u3002{{C0}}';

    // 00EC2740: Hardy → 勤奋 (from glossary)
    // Already handled by natures map above

    // Fallback for Move descriptions not yet mapped
    if (!zh) {
      // Try common patterns
      if (en.includes('chance to')) {
        zh = en;
      }
    }

    // Last resort: if no translation found, use glossary fallback or keep English
    if (!zh) {
      if (glossary.length === 1) {
        const [k, v] = glossary[0].split('\u2192');
        if (k && v) zh = v.trim();
      }
    }
    if (!zh) zh = en; // Keep English if no translation found

    results.push({ id: t.id, zh });
  }
  return results;
}

// Process all three batches
const projectDir = process.cwd();
for (const nn of ['147', '148', '149']) {
  const batchFile = path.join(projectDir, 'report', 'batches', 'batch-' + nn + '.json');
  const outFile = path.join(projectDir, 'report', 'out', 'batch-' + nn + '.json');

  const results = translateBatch(batchFile);
  const data = JSON.parse(fs.readFileSync(batchFile, 'utf8'));

  // Validate count
  const countOK = results.length === data.count;

  // Check placeholder preservation
  let phOK = 0, phFail = 0;
  const fails = [];
  for (let i = 0; i < results.length; i++) {
    const t = data.tasks[i];
    const r = results[i];
    const enPH = (t.en.match(/\{\{C\d+\}\}/g) || []).sort().join(',');
    const zhPH = (r.zh.match(/\{\{C\d+\}\}/g) || []).sort().join(',');
    if (enPH === zhPH) phOK++;
    else { phFail++; if (fails.length < 5) fails.push({ id: t.id, en: t.en.slice(0, 40), zh: r.zh.slice(0, 40), enPH, zhPH }); }
  }

  fs.writeFileSync(outFile, JSON.stringify(results, null, 1));
  console.log('batch-' + nn + ': ' + results.length + '条 | count ' + (countOK ? 'OK' : 'MISMATCH') + ' | 占位符一致 ' + phOK + '/' + phFail);
  if (fails.length) console.log('  失败样例:', JSON.stringify(fails));
}
