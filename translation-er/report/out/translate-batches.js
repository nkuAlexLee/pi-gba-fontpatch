const fs = require('fs');
const path = require('path');
const ROOT = 'D:/vibecoding/gba-font-cracker-js/gbajs2/translation-er';
const OUT = path.join(ROOT, 'report', 'out');

// Pokemon term glossary
const G = {
  'burn':'灼伤','burning':'灼热','paralyze':'麻痹','paralysis':'麻痹','confuse':'混乱','confusion':'混乱',
  'flinch':'畏缩','frostbite':'冻伤','poison':'中毒','toxic':'剧毒','sleep':'入睡','infatuate':'魅惑',
  'infatuation':'魅惑','curse':'诅咒','drowsy':'困意','bleed':'出血','fear':'恐惧','drench':'潮湿',
  'Defense':'防御','Attack':'攻击','Speed':'速度','SpAtk':'特攻','SpDef':'特防',
  'HP':'HP','stats':'能力值','stat':'能力值',
  'Mega Launcher':'超级发射器','Strong Jaw':'强壮之颚','Iron Fist':'铁拳','Keen Edge':'锐利之刃',
  'Mighty Horn':'大角','Striker':'打击手','Archer':'弓箭手','Super Slammer':'超级摔打',
  'Leech Seed':'寄生种子','Stealth Rocks':'隐形岩','Sticky Web':'黏黏网','Light Screen':'光墙',
  'Reflect':'反射壁','Substitute':'替身','Tailwind':'顺风',
  'Fire':'火','Water':'水','Electric':'电','Grass':'草','Ice':'冰','Ground':'地面',
  'Flying':'飞行','Psychic':'超能力','Dark':'恶','Dragon':'龙','Steel':'钢','Ghost':'幽灵',
  'Bug':'虫','Fairy':'妖精','Normal':'一般','Poison':'毒','Rock':'岩石',
  'terrain':'场地','Weather':'天气','Rain':'雨天','Hail':'冰雹','Sunlight':'强光','Sandstorm':'沙暴',
  'Pikachu':'皮卡丘','Eevee':'伊布','Eternatus':'无极汰那','Tatsugiri':'吃吼霸',
  'Rest':'睡觉','Whirlwind':'吹飞','Haze':'黑雾','Snap Trap':'捕兽夹',
  'Apple':'苹果片','Leek':'大葱','Apple':'苹果片',
  'Hammer':'锤','Horn':'角','Arrow':'箭','Blade':'剑',
  'Pokémon':'宝可梦','foe':'对手','user':'使用方','target':'目标','ally':'队友',
  'allies':'队友','battlers':'宝可梦','trader':'训练家',
  'Super effective':'效果绝佳','critical hit':'暴击','crit':'暴击','priority':'先制度',
  'recoil':'反冲','in a row':'连续使用','sound':'声音','projectile':'弹','bone':'骨头',
  'aura':'气场','astral':'异次元','ethereal':'空灵','ruinous':'毁灭',
  'syrup':'糖浆','lotus':'莲花','pebbles':'卵石','blizzard':'暴风雪',
  'gale':'狂风','tempest':'暴风','quartz':'水晶',
};

function translateEn(en, codes) {
  // Strip all placeholders from en, translate, then re-insert placeholders at same positions
  const placeholders = [];
  let stripped = en;
  // Extract all {{Cn}} placeholders with their positions
  const re = /\{\{C\d+\}\}/g;
  let m;
  const parts = [];
  let lastIdx = 0;
  while ((m = re.exec(en)) !== null) {
    parts.push({ text: en.slice(lastIdx, m.index), ph: m[0] });
    lastIdx = m.index + m[0].length;
  }
  parts.push({ text: en.slice(lastIdx), ph: null });

  // Now translate each text segment
  const zhParts = parts.map(p => {
    if (p.ph) return p.ph;
    return translateSegment(p.text);
  });

  return zhParts.join('');
}

function translateSegment(text) {
  // Clean up the text
  let t = text.trim();
  if (!t) return '';

  // Direct phrase replacements (order matters - longer first)
  const phrases = [
    ['The foe is struck with a','用'],
    ['The more the user\'s','使用方的'],
    ['To strike at full force,','为了全力一击'],
    ['Swaps Speed stat and','互换速度和'],
    ['Stabs the foe with a','用尖锐的角刺穿对手'],
    ['The user tries to heal','试图治好'],
    ['The user attacks by dancing','通过跳舞攻击'],
    ['This attack will also negate the foe\'s Ability if it has moved already.','若对手已行动此招式还会消除其特性。'],
    ['An intense, tropical','猛烈的热带'],
    ['The user instructs the','指示'],
    ['The user strikes with its heated beak.','用灼热的喙攻击。'],
    ['The user attacks by rubbing the scales on','摩擦'],
    ['Using its body like a hammer, the user','使用方把身体当作锤子'],
    ['The user violently swings its body around,','猛烈甩动身体'],
    ['For 5 turns, damage from attacks are weakened. This fails without Hail.','5回合内攻击伤害被削弱。无冰雹时失败。'],
    ['The user sets a shell trap that is set off by physical attacks.','设置贝壳陷阱被物理攻击触发。'],
    ['A strong beam. Harshly lowers the user\'s SpAtk','强烈光束。大幅降低使用方特攻。'],
    ['Breaks any barrier like Light Screen and Reflect.','打破光墙和反射壁等屏障。'],
    ['A frustrated strike that deals twice the damage if the last move failed.','愤怒一击上一招式失败时造成双倍伤害。'],
    ['The foe is hit by a spirit bone.','用灵魂之骨击中对手。'],
    ['The user smashes into the foe at high speed.','高速撞向对手。'],
    ['A full-force blast of water','全力水之冲击'],
    ['Severely damaging laser beams. Can\'t be used twice in a row.','威力极大的激光连续使用会失败。'],
    ['Hiding in the foe\'s shadow, the user steals its stat boosts and attacks.','隐藏在对手影子中偷走能力值提升并攻击。'],
    ['Slams into the foe like a meteor.','像陨石撞向对手。'],
    ['A sinister ray attacks the foe.','邪恶光线攻击对手。'],
    ['The foe\'s Special Attack is lowered by the user\'s teary eyes.','用泪汪汪的眼睛降低对手特攻。'],
    ['A strong electric blast crashes on the foe.','强烈电击轰向对手。'],
    ['The user hits the foe with the force of nature, halving the foe\'s HP.','用自然之力击中对手将对手HP减半。'],
    ['A high-energy slam.','高能量摔打。'],
    ['The user attacks everything nearby, causing its own head to explode.','攻击周围一切导致自身头部爆炸。'],
    ['Electrifies Normal-type moves used in the same turn.','使同回合一般属性招式变为电属性。'],
    ['A pillar of light.','光柱。'],
    ['High-speed electric bursts that always go first and land in a critical hit.','高速电击总是先手且必定暴击。'],
    ['The user creates a huge electrified wave that may paralyze the foe.','制造巨大电磁波可能使对手麻痹。'],
    ['Floats in the air and dives at a steep angle.','空中浮起后陡峭俯冲。'],
    ['Pikachu\'s love for its trainer raises this move\'s power. It never misses.','皮卡丘的爱意提升招式威力。必定命中。'],
    ['An attack that absorbs all the damage it inflicted to restore HP.','吸收造成的所有伤害来恢复HP。'],
    ['The user shoots a jolt of electricity that always paralyzes the foe.','射出一股电流必定使对手麻痹。'],
    ['The user cloaks itself in fire and charges at the foe, leaving a burn.','裹在火焰中冲向对手造成灼伤。'],
    ['A Telekinetic force attacks the foe, putting a wall that raises Sp. Defense.','念力攻击对手同时设置提升特防的屏障。'],
    ['The user acts bad and attacks, putting a wall that raises Defense.','做出挑衅行为攻击设置提升防御的屏障。'],
    ['Grows a giant stalk, scattering seeds that drain the foe\'s HP every turn.','长出巨大茎散出吸取对手HP的种子。'],
    ['Attack with crystal made of cold frozen haze.','用寒冷冻雾制成的水晶攻击。'],
    ['Wraps foe with a whirlwind of scent. It heals all status of the user\'s party.','用芳香旋风裹住对手治愈我方所有宝可梦异常状态。'],
    ['Eevee\'s love for its trainer raises this move\'s power. It never misses.','伊布的爱意提升招式威力。必定命中。'],
    ['Spinning rapidly, the user strikes twice.','高速旋转攻击连击两次。'],
    ['The user unleashes a strong beam that damages Mega foes twice as hard.','释放强力光束对超级宝可梦双倍伤害。'],
    ['The user ignores effects that draw in moves. High crit.','无视吸引招式效果高暴击率。'],
    ['Prevents both the user and the foe from switching out.','阻止交换宝可梦。'],
    ['The user eats its held Berry, then sharply raises its Defense stat.','吃掉携带树果大幅提升防御。'],
    ['Ups all the user\'s stats. However, the user cannot switch out or flee.','提升所有能力值但无法交换或逃跑。'],
    ['Sticky tar lowers the foe\'s Speed, and makes it weaker to Fire-type moves.','粘稠焦油降低对手速度并使其更弱于火属性。'],
    ['A cloud of magic powder that changes the foe to Psychic-type.','魔法粉云雾将对手变为超能力属性。'],
    ['User fires two dragon-shaped darts.','射出两支龙形飞镖。'],
    ['All Pokémon in the battle have teatime, and eat their held Berry.','所有宝可梦茶话会吃掉各自携带树果。'],
    ['Prevents escape, and lowers the Sp. Def and Defense of the foe each turn.','阻止逃跑每回合降低对手特防和防御。'],
    ['If attacking before the target, move power doubles.','比目标先行动时威力翻倍。'],
    ['A mysterious power that swaps the effects on either side of the field.','神秘力量交换场地双方效果。'],
    ['The user raises all its stats by using 1/3 of its HP.','消耗1/3HP提升所有能力值。'],
    ['A body slam attack which inflicts more damage the higher the user\'s Defense.','泰山压顶攻击防御越高伤害越大。'],
    ['Damages foes. Raises allies\' Attack, Special Attack, and Crit by 2 stages.','攻击对手提升我方攻击特攻和暴击各2级。'],
    ['The user attacks the foe with its drum, lowering the foe\'s Speed stat.','用鼓攻击对手降低其速度。'],
    ['The user snares the target in a snap trap for four to five turns.','用捕兽夹困住目标持续四到五回合。'],
    ['The user launches a fiery ball at the foe.','向对手发射火球。'],
    ['The user strikes as a sword, dealing double the damage to Mega Pokemon.','化为剑攻击对超级宝可梦双倍伤害。'],
    ['Uses defense for damage calculation. Double damage vs Mega Pokemon.','用防御值计算伤害。对超级宝可梦双倍。'],
    ['Electric or Dark based on effectiveness. Raises Speed.','电或恶属性取决于效果。提升速度。'],
    ['The user swings at both foes with its tail, lowering the foes\' Attack stat.','用尾巴扫向两侧对手降低其攻击。'],
    ['The user attacks the foe by poking it with a sharply pointed branch.','用尖锐树枝戳刺对手攻击。'],
    ['The user twangs its guitar to attack both foes with a huge, echoing boom.','拨动吉他用巨大回声攻击两侧对手。'],
    ['An acidic liquid attack created from tart apples. Lowers the foe\'s Sp. Def.','酸苹果制成的酸性液体攻击降低对手特防。'],
    ['Drops an apple on the foe, lowering the foe\'s Defense. Throw-based.','向对手投下苹果降低其防御。投掷系。'],
    ['A forceful, spirit-breaking attack that lowers the foe\'s Sp. Atk stat.','强有力的破魂一击降低对手特攻。'],
    ['The user attacks by emitting steam.','喷出蒸汽攻击。'],
    ['The user restores the HP of itself and its allies with mysterious water.','用神秘之水恢复自身和队友HP。'],
    ['Protects the user, and lowers the Defense of foes that make contact.','保护使用方降低接触攻击者的防御。'],
    ['The user pretends to bow, then stabs its foe. This move never misses.','假装鞠躬然后刺向对手必定命中。'],
    ['Attacks wildly with a thick leek.','用粗壮大葱狂乱攻击。'],
    ['Eternatus\'s most powerful move. On the next turn, the user must rest.','无极汰那最强招式下一回合必须休息。'],
    ['Fires a powerful beam of steel.','发射强力钢属性光束。'],
    ['This move\'s power goes up and damages all foes while on Psychic Terrain.','精神场地上威力提升攻击所有对手。'],
    ['Rolls over the opponent while destroying terrain.','碾过对手同时破坏场地。'],
    ['Hits 2 to 5 times. Boosts Speed, but lowers Defense.','连续攻击2到5次提升速度降低防御。'],
    ['A 2-turn move that gathers space power raising Sp. Attack before attacking.','2回合招式收集宇宙能量提升特攻后攻击。'],
    ['Physical or special damage, whichever is more effective May poison the foe.','物理或特殊伤害取决于更有效的。可能中毒。'],
    ['Attacks everything and faints the user.','攻击所有目标自身昏厥。'],
    ['Gliding on the ground, it attacks. Always goes first on Grassy Terrain.','贴地滑行攻击草场地上必定先手。'],
    ['Its power doubles on Electric Terrain when the target is grounded.','电气场地上目标接地时威力翻倍。'],
    ['This move\'s type and power changes depending on the terrain when used.','属性和威力取决于使用时的场地。'],
    ['The user skitters behind the foe to attack.','溜到对手背后攻击。'],
    ['Attacks both foes jealously. Has 50% burn chance.','嫉妒地攻击两侧对手50%灼伤几率。'],
    ['+20 BP for each negative stat stage and ignores negative attack stages.','能力值下降越多威力越大且无视攻击下降。'],
    ['Controls the foe\'s item to attack. It fails if the foe has no item.','操纵对手道具攻击无道具时失败。'],
    ['Highly acidic gas that melts items held by every surrounding Pokémon.','腐蚀性气体融化周围所有宝可梦道具。'],
    ['The user properly coaches its ally Pokémon, upping their Attack and Defense.','好好指导队友宝可梦提升攻击和防御。'],
    ['The user strikes, and then switches with a waiting party Pokémon.','攻击后与等待中的队友交换。'],
    ['A 3-kick attack. More powerful with each successive hit.','三连踢每击威力递增。'],
    ['The user slams the foe with its wings. Hits twice. Air-based.','用翅膀拍击对手两次飞行系。'],
    ['Throws scorching sand at the target.','向目标投掷灼热沙子。'],
    ['Becomes one with the jungle, healing HP and status of itself and allies.','融入丛林恢复自身和队友HP与状态。'],
    ['Having mastered the Dark style, strikes with a fierce blow.','掌握恶之流派发出猛烈一击。'],
    ['Having mastered the Water style, strikes 3 critical hits with a flowing motion.','掌握水之流派连续三次暴击。'],
    ['The user traps the foe in a cage of electricity for four or five turns.','将对手困在电气牢笼中四到五回合。'],
    ['The higher the user\'s HP, the more powerful it is.','使用方HP越高威力越大。'],
    ['The user shoots psychic power from its eyes to attack.','从眼睛发射念力攻击。'],
    ['It uses its wrath to fuel a fire-like aura attack.','用怒火化为火焰气场攻击。'],
    ['Fast lightning kick. It lowers the foe\'s Defense. Striker boost.','快速电踢降低对手防御。打击手加成。'],
  ];

  // Try direct match first
  for (const [en, zh] of phrases) {
    if (t.startsWith(en)) {
      const suffix = t.slice(en.length);
      return zh + translateSegment(suffix);
    }
  }

  // Common endings
  const endings = [
    ['burning lash that lowers its Defense stat.','灼烧鞭降低防御。'],
    ['burning lash that lowers its Defense.','灼烧鞭降低防御。'],
    ['lowers its Defense stat.','降低其防御。'],
    ['lowers its Defense.','降低其防御。'],
    ['lowers the foe\'s Defense.','降低对手防御。'],
    ['lowers the foe\'s Attack stat.','降低对手攻击。'],
    ['lowers the foe\'s Attack.','降低对手攻击。'],
    ['lowers the foe\'s Speed stat.','降低对手速度。'],
    ['lowers the foe\'s Speed.','降低对手速度。'],
    ['lowers the foe\'s Sp. Def.','降低对手特防。'],
    ['lowers the foe\'s SpAtk','降低对手特攻。'],
    ['lowers the user\'s SpAtk','降低使用方特攻。'],
    ['lowers the user\'s Defense stat.','降低使用方防御。'],
    ['lowers the user\'s Defense.','降低使用方防御。'],
    ['lowers the user\'s speed.','降低使用方速度。'],
    ['lowers the user\'s Speed.','降低使用方速度。'],
    ['lowers its own HP.','消耗自身HP。'],
    ['Raises Speed.','提升速度。'],
    ['raises its Defense stat.','提升防御。'],
    ['raises its Defense.','提升防御。'],
    ['raises the user\'s Speed.','提升使用方速度。'],
    ['raises the foe\'s Atk','提升对手攻击。'],
    ['Mega Launcher boost.','超级发射器加成。'],
    ['Strong Jaw boost.','强壮之颚加成。'],
    ['Iron Fist boost.','铁拳加成。'],
    ['Keen Edge boost.','锐利之刃加成。'],
    ['Mighty Horn boost.','大角加成。'],
    ['Striker boost.','打击手加成。'],
    ['Archer boost.','弓箭手加成。'],
    ['Super Slammer boost.','超级摔打加成。'],
    ['Hammer-based.','锤系。'],
    ['Horn-based.','角系。'],
    ['Arrow-based.','弓箭系。'],
    ['Throw-based.','投掷系。'],
    ['Sound-based.','声音系。'],
    ['Bone-based.','骨头系。'],
    ['Field-based.','场地系。'],
    ['Weather-based.','天气系。'],
    ['Ice-based.','冰系。'],
    ['Grass-based.','草系。'],
    ['Bug-based.','虫系。'],
    ['Dark-based.','恶系。'],
    ['Dragon-based.','龙系。'],
    ['Electric-based.','电系。'],
    ['Fire-based.','火系。'],
    ['Ghost-based.','幽灵系。'],
    ['Ground-based.','地面系。'],
    ['Psychic-based.','超能力系。'],
    ['Rock-based.','岩石系。'],
    ['Steel-based.','钢系。'],
    ['Fairy-based.','妖精系。'],
    ['Normal-based.','一般系。'],
    ['Poison-based.','毒系。'],
    ['Flying-based.','飞行系。'],
    ['Fighting-based.','格斗系。'],
    ['Water-based.','水系。'],
    ['.+3 priority.','+3先制度。'],
    ['+3 priority.','+3先制度。'],
    ['+1 priority.','+1先制度。'],
    ['+1 priority.','+1先制度。'],
    ['+1 crit.','+1暴击。'],
    ['+1 crit','+1暴击'],
    ['-1 priority.','-1先制度。'],
    ['-2 priority.','-2先制度。'],
    ['-3 priority.','-3先制度。'],
    ['-6 priority.','-6先制度。'],
    ['33% recoil.','33%反冲。'],
    ['33% recoil damage.','33%反冲伤害。'],
    ['50% recoil damage.','50%反冲伤害。'],
    ['High crit.','高暴击率。'],
    ['High crit ratio.','高暴击率。'],
    ['High crit ratio','高暴击率'],
    ['High-crit.','高暴击率。'],
    ['Cannot miss.','必定命中。'],
    ['Can\'t miss.','必定命中。'],
    ['Can\'t be used twice in a row.','连续使用会失败。'],
    ['Can only be used every-other turn.','每隔一回合才能使用。'],
    ['Never misses.','必定命中。'],
    ['Ignores Abilities.','无视特性。'],
    ['Ignores Protect.','无视守住。'],
    ['Ignores stat boosts.','无视能力值提升。'],
    ['Ignores target\'s stat changes.','无视目标能力值变化。'],
    ['Hits through Protect.','可穿透守住。'],
    ['Can hit through protect.','可穿透守住。'],
    ['Mega Launcher boost','超级发射器加成'],
    ['Strong Jaw boost','强壮之颚加成'],
    ['Iron Fist boost','铁拳加成'],
    ['Keen Edge boost','锐利之刃加成'],
    ['Mighty Horn boost','大角加成'],
    ['Striker boost','打击手加成'],
    ['Archer boost','弓箭手加成'],
  ];

  for (const [en, zh] of endings) {
    if (t.endsWith(en)) {
      const prefix = t.slice(0, t.length - en.length);
      return translateSegment(prefix) + zh;
    }
  }

  // Number patterns
  t = t.replace(/(\d+)%/g, '$1%');
  t = t.replace(/(\d+) BP/g, '$1 BP');

  return t; // Return as-is if no match
}

// Load batch tasks and translate
for (const n of [144, 145, 146]) {
  const bt = JSON.parse(fs.readFileSync(path.join(ROOT, 'report/batches', `batch-${n}.json`), 'utf8'));
  const out = bt.tasks.map(t => ({ id: t.id, zh: translateEn(t.en, t.codes) }));

  // Verify: all entries have zh, count matches
  const noZh = out.filter(x => !x.zh);
  if (noZh.length) console.log(`batch-${n}: ${noZh.length} entries with empty zh`);

  // Verify placeholder counts
  let phMismatch = 0;
  for (const t of bt.tasks) {
    const entry = out.find(e => e.id === t.id);
    const enPH = (t.en.match(/\{\{C\d+\}\}/g) || []).length;
    const zhPH = (entry.zh.match(/\{\{C\d+\}\}/g) || []).length;
    if (enPH !== zhPH) phMismatch++;
  }
  console.log(`batch-${n}: ${out.length} entries, placeholder mismatches: ${phMismatch}`);

  fs.writeFileSync(path.join(OUT, `batch-${n}.json`), JSON.stringify(out, null, 1));
  console.log(`batch-${n}: written`);
}
