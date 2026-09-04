'use strict';
/**
 * retry-translate.js — 重试批翻译：auto-redistribute /n + 手动英译 + 自检
 *   node retry-translate.js --project <目录> --batch 07|08|09
 */
const fs = require('fs');
const path = require('path');

function redistribute(text, targetCount) {
  let clean = text.replace(/\[\/[np]\]/g, '').trim();
  if (targetCount === 0) return clean;
  const chars = [...clean];
  const segCount = targetCount + 1;
  const segLen = Math.ceil(chars.length / segCount);
  const segments = [];
  for (let i = 0; i < segCount; i++) {
    const start = i * segLen;
    let end = Math.min((i + 1) * segLen, chars.length);
    if (i < segCount - 1 && end < chars.length) {
      const breaks = ['。','!','?','！','？','，',',','时','的','与','和','或','了','可','且','而'];
      for (let j = end; j > start + Math.floor(segLen * 0.35); j--) {
        if (breaks.includes(chars[j - 1])) { end = j; break; }
      }
    }
    segments.push(chars.slice(start, end).join(''));
  }
  return segments.filter(Boolean).join('[/n]');
}

// Manual translations for 残留英文 (keyed by task id)
// Use [/n] directly for /n-only codes; use {{Cn}} for mixed code types
const M = {
  // batch 08 — 1 token (/n) items
  '0100E0E8': '雾天时幽灵属性招式威力提升50%,[/n]且抵抗幽灵属性招式。',
  '0100E15C': '飞身重压威力+10,[/n]且附加挑衅效果。',
  '0100E1DC': '飞水手里剑变为单发100威力,[/n]且暴击率+1。',
  '0100E210': '锐利之刃。草属性招式[/n]获得锐利之刃加成。',
  '0100E288': '被击中时展开[/n]精神强念场地。',
  '0100E40C': '追加幽灵属性。受到的[/n]伤害减少15%,效果绝佳时减少30%。',
  '0100E4B4': '冰属性和投掷类[/n]招式威力提升50%。',
  '0100E820': '入场时使用摇晃舞,[/n]使全场混乱。',
  '0100E994': '追加火属性。锐利之刃招式[/n]20%几率灼伤或麻痹。',
  '0100EB4C': '被击中时展开[/n]电气场地。',
  '0100EEB8': '化石化。岩石属性[/n]招式无视特性。',
  '0100EF8C': '使用攻击招式后,[/n]追加35威力的毒液弹。',
  '0100F04C': '熔炉。吸收岩石属性[/n]招式和隐形岩。',
  '0100F098': '吸收火属性招式,[/n]并始终附加灼伤效果。',
  '0100F0C8': '吸收电属性招式,[/n]然后最高能力值+1。',
  '0100F118': '其他宝可梦无法[/n]获得本系加成。',
  '0100F140': '吸引火属性招式。[/n]吸收后提高最高攻击力。',
  '0100F178': '每次入场一次,[/n]受到半额伤害并强制目标退场。',
  '0100F2BC': '免疫异常状态。受到的[/n]毒属性伤害减半。',
  '0100F30C': '使用招式后,[/n]追加一记20威力的毒瓦斯。',
  '0100F4BC': '声音类招式变为舞蹈类招式,[/n]反之亦然。',
  '0100F538': '阻挡天气伤害和粉末类招式。[/n]受到的物理伤害减少20%。',
  '0100F574': '束缚类招式降低速度[/n]并麻痹。',
  '0100F59C': '剧毒场地中特防[/n]提高50%。',
  '0100F601': '展开青草场地时同时展开顺风,[/n]反之亦然。',
  '0100F63C': '目标中毒时抑制[/n]其特性。',
  '0100F694': '时间咆哮获得大幅[/n]改变。',
  '0100F7C4': '雾天时每回合从对手[/n]吸取10%HP。',
  '0100F7FC': '有50%几率困住对手,[/n]然后每回合降低速度1级。',
  '0100F858': '雾天时进入暴怒状态,[/n]暴怒时受到的伤害减半。',
  '0100F884': '自身混乱时抑制[/n]其他宝可梦的特性。',
  '0100F8BC': '暴击无视特性,对[/n]抵抗属性造成2倍伤害。',
  '0100F984': '受到非接触攻击时[/n]使用速度作为防御值。',
  '0100F9B8': '受到接触攻击时[/n]使用速度作为防御值。',
  '0100FD48': '饱了又饿 + 电和恶属性招式[/n]威力x1.35并造成10%反冲。',
  '010103AC': '入场时使用20威力的[/n]流沙地狱进行攻击。',
  '01010850': '首次入场时使用[/n]惊吓进行攻击。',
  '01010D88': '入场时恢复搭档[/n]最大HP的25%。',
  '01011270': '对换下场的对手[/n]使用威力的追打进行攻击。',
  '010112E0': '雾天时每回合恢复[/n]最大HP的1/8。',
  '0101131B': '天界祝福 +[/n]再生力',
  '01011E44': '被击中时展开[/n]电气场地。',
  '010120D8': '入场时撒下[/n]两层撒菱。',
  '01012254': '入场时消除对手[/n]的能力值变化。',
  '010122D4': '濒死时大幅降低攻击者的[/n]攻击和特攻。',
  '010129D8': '入场时使用40威力的[/n]暗影偷盗进行攻击。',
  '01012A54': '接触时盗取[/n]攻击者的PP。',
  // batch 08 — ability combos (no tokens)
  '0100E0B0': '多头 + 水属性本系加成',
  '0100E140': '王者之怒 + 火焰护盾',
  '0100E1A4': '极度攻击 + 浮游',
  '0100E244': '无坚不摧 + 防弹',
  '0100E5C4': '致命精准 + 气流',
  '0100E7CC': '硬爪 + 矿化',
  '0100E804': '半龙 + 粗糙皮肤',
  '0100EA28': '被击中时展开撒菱。',
  '0100EA44': '被击中时展开怪雾。',
  '0100F07C': '终结之地 + 风暴',
  '0100F0FC': '降雨 + 电气冲浪',
  '0100F1F1': '强壮之颚 + 狂暴之颚',
  '0100F228': '绝对睡眠 + 捕梦 + 造成20%额外伤害',
  '0100F258': '女王的威严 + 入场时大蛇瞪眼(每场一次)',
  '0100F2EA': '超级发射器 + 念力咬碎',
  '0100F3C0': '远隔 + 夹钳',
  '0100F3DC': '不屈之心 + 阻挡强制换人招式',
  '0100F43C': '强力角 + 角类招式30%几率出血',
  '0100F5C4': '水栖 + 悠游自如',
  '0100F6BC': '金库 + 钢能力者',
  '0100F71C': '迷人之躯 + 妖精属性本系加成',
  '0100F794': '幻影 + 幻影防守',
  '0100F7B0': '恐吓 + 背运',
  '0100FDF2': '伏击 + 神射手',
  '0100FE06': '超级发射器 + 变化类招式也视为超级发射器招式',
  '0100FE78': '超级发射器 + 火炮',
  '0100FF7C': '趁虚而入 + 不仁不义',
  '01010048': '打击者 + 舞者',
  '01010170': '腐蚀 + 毒属性本系加成',
  '0101024C': '可充气 + 极度攻击',
  '010104A4': '太晶甲壳 + 入场时清除天气和场地',
  '01010704': '蹑足 + 潜行',
  '01010738': '腐蚀 + 毒液飞溅',
  '01010788': '黏着 + 接触时封锁对手道具2回合',
  '0101098C': '强壮之颚 + 啃咬类招式50%几率麻痹',
  '01010C18': '画皮 + 画皮破裂时诅咒对手',
  '01010D68': '款待 + 舒缓芳香',
  '01010DBC': '无形拳 + 致命精准',
  '01010E10': '铁拳 + 钢属性招式伤害+30%',
  '01010E34': '自命不凡 + 悠游自如',
  '01010E50': '精神力 + 精准之拳',
  '010110EC': '水泡 + 燃魂',
  '010112C8': '静电 + 安息',
  '0101156C': '血浴 + 噬魂者',
  '01011990': '强壮之颚 + 燃炎之颚',
  '010119AC': '引爆 + 可充气',
  '010119C4': '皮毛大衣 + 魔法防守',
  '01011AE4': '飘浮 + 群聚',
  '01011D58': '锐利之刃 + 锐利之刃招式20%几率灼伤',
  '01011E03': '拂刃 + 锐利之刃',
  '01012854': '紧张感 + 漆黑嘶鸣 + 凛冽嘶鸣',
  '01012B0C': '锐利之刃 + 神秘之刃',
  // batch 09 — combos (no tokens)
  '01012BE0': '迷人之躯 + 对被魅惑目标造成伤害时恢复25%HP',
  '01012D90': '恐吓 + 威吓。攻击时30%几率魅惑对手',
  '01012E14': '所有招式获得本系加成。效果绝佳伤害+10%。',
  '01013070': '临界点 + 暴走',
  '010130B4': '妖精和恶属性获得本系加成。月光恢复75%HP。',
  '010137DC': '变色 + 变幻自如 + 皮毛大衣 + 冰鳞粉',
  '01014064': '超级发射器 + 瞄准系统',
  '01014150': '对水属性宝可梦伤害+50% + 穿透',
  '01014410': '超级发射器类招式必定命中且命中对手双方',
  // batch 09 — dialog (use {{Cn}} for mixed code types)
  '0116F91D': '感谢您使用神秘礼物系统.{{C0}}您一定是{{C2}}吧.{{C1}}这里有一张门票给您.{{C3}}',
  '0116FA0B': '啊,抱歉,{{C0}}.{{C1}}您的道具袋的关键道具口袋已满.{{C2}}请在电脑里存一些东西,{{C3}}然后再来领取.',
  '0116FAF5': '感谢您使用神秘礼物系统.{{C0}}您一定是{{C2}}吧.{{C1}}这里有一张门票给您.{{C3}}',
  '0116FBE3': '啊,抱歉,{{C0}}.{{C1}}您的道具袋的关键道具口袋已满.{{C2}}请在电脑里存一些东西,{{C3}}然后再来领取.',
  '0116FDD5': '感谢您使用神秘礼物系统.{{C0}}让我确认一下——您是{{C2}}吗？{{C1}}我们收到了寄给您的古海图.{{C3}}这就交给您.',
  '0116FEDE': '啊,抱歉,{{C0}}.{{C1}}您的道具袋的关键道具口袋已满.{{C2}}请在电脑里存一些东西,{{C3}}然后再来领取.',
  '0126DAE8': 'YhqwwrolnvÜ[文本色00][/n][/c][/c][/n][fdfd][l]Äuqppprw:ö[u][u][l]',
};

function countTokens(zh) {
  return (zh.match(/\{\{C\d+\}\}/g) || []).length + (zh.match(/\[\/[np]\]/g) || []).length;
}

function processBatch(proj, num) {
  const batchIn = path.join(proj, 'report/retry/retry-' + num + '.json');
  const batchOut = path.join(proj, 'report/out/retry-' + num + '.json');
  const data = JSON.parse(fs.readFileSync(batchIn, 'utf8'));
  const results = [];
  let autoFixed = 0, manualDone = 0;

  for (const t of data.tasks) {
    const id = t.id;
    const numTokens = t.codes ? t.codes.length : 0;
    let zh;

    if (M[id]) {
      zh = M[id];
      const zhTok = countTokens(zh);
      if (numTokens > 0 && zhTok === 0) {
        // Manual has no tokens but needs some — auto-insert /n
        zh = redistribute(M[id], numTokens);
        autoFixed++;
      } else {
        manualDone++;
      }
    } else {
      // Auto-redistribute prev /n tokens
      zh = redistribute(t.prev || '', numTokens);
      autoFixed++;
    }
    results.push({ id, zh });
  }

  fs.writeFileSync(batchOut, JSON.stringify(results, null, 1));
  return { total: results.length, autoFixed, manualDone };
}

function selfCheck(proj, num) {
  const batchIn = path.join(proj, 'report/retry/retry-' + num + '.json');
  const batchOut = path.join(proj, 'report/out/retry-' + num + '.json');
  const tasks = JSON.parse(fs.readFileSync(batchIn, 'utf8')).tasks;
  const outputs = JSON.parse(fs.readFileSync(batchOut, 'utf8'));
  const outMap = new Map(outputs.map(o => [o.id, o.zh]));
  let tokenErr = 0, leftoverErr = 0;

  for (const t of tasks) {
    const zh = outMap.get(t.id);
    if (!zh) { tokenErr++; continue; }
    const expected = (t.codes || []).length;
    if (expected === 0) continue;
    const zhTokens = countTokens(zh);
    if (zhTokens !== expected) {
      tokenErr++;
      if (tokenErr <= 5) console.log('  TOK:', t.id, 'exp=' + expected, 'got=' + zhTokens, zh.slice(0, 60));
    }
    // Leftover English check
    const en = t.en.replace(/\{\{C\d+\}\}/g, '').replace(/\[\/?[^\]]*\]/g, ' ');
    const enWords = new Set((en.match(/[A-Za-z]{4,}/g) || []).map(w => w.toLowerCase()));
    const zhWords = (zh.replace(/\[\/?[^\]]*\]/g, '').match(/[A-Za-z]{4,}/g) || []);
    const leftover = zhWords.filter(w => enWords.has(w.toLowerCase()));
    if (leftover.length > 0) {
      leftoverErr++;
      if (leftoverErr <= 3) console.log('  EN:', t.id, leftover.join(','), zh.slice(0, 50));
    }
  }
  console.log('  token不一致:', tokenErr, '| 残留英文:', leftoverErr);
  return { tokenErr, leftoverErr };
}

// Main
const proj = 'D:/vibecoding/gba-font-cracker-js/gbajs2/translation-er';
const nums = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ['07', '08', '09'];

for (const num of nums) {
  const r = processBatch(proj, num);
  console.log('retry-' + num + ': ' + r.total + '条 | 自动:' + r.autoFixed + ' | 手动:' + r.manualDone);
  selfCheck(proj, num);
}
