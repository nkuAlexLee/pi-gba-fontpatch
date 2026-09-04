// batch-304 专项：招式名翻译 + 从 CSV 恢复空 id + 右对齐空格公式
'use strict';
const fs = require('fs');
const { loadCharmap, encode } = require('../.pi/skills/gba-text-translate/scripts/lib/charmap');
const csv = require('../.pi/skills/gba-text-translate/scripts/lib/csv');

const cm = loadCharmap(__dirname + '/../.pi/skills/gba-text-translate/assets/charmap-base.txt');
const batch = require('../translation-er/report/batches/batch-304.json');

// 官方/通用译名表（键 = 去空格后的英文招式名）
const T = {
'Mirror Shot':'镜光射击','Flash Cannon':'加农光炮','Rock Climb':'攀岩','Trick Room':'戏法空间',
'Draco Meteor':'流星群','Lava Plume':'喷烟','Leaf Storm':'飞叶风暴','Power Whip':'强力鞭打',
'Rock Wrecker':'岩石炮','Cross Poison':'十字毒刃','Gunk Shot':'垃圾射击','Iron Head':'铁头',
'Magnet Bomb':'磁铁炸弹','Stone Edge':'尖石攻击','Stealth Rock':'隐形岩','Grass Knot':'打草结',
'Bug Bite':'虫咬','Charge Beam':'充电光束','Wood Hammer':'木槌','Aqua Jet':'水流喷射',
'Attack Order':'攻击指令','Defend Order':'防御指令','Heal Order':'回复指令','Head Smash':'双刃头锤',
'Double Hit':'二连击','Roar of Time':'时光咆哮','Spacial Rend':'亚空裂斩','Lunar Dance':'新月舞',
'Crush Grip':'捏碎','Magma Storm':'熔岩风暴','Dark Void':'暗黑洞','Seed Flare':'种子闪光',
'Ominous Wind':'奇异之风','Shadow Force':'暗影潜袭','Hone Claws':'磨爪','Wide Guard':'广域防守',
'Guard Split':'防守平分','Power Split':'力量平分','Wonder Room':'奇妙空间','Rage Powder':'愤怒粉',
'Magic Room':'魔法空间','Smack Down':'击落','Storm Throw':'山岚摔','Flame Burst':'烈焰溅射',
'Sludge Wave':'污泥波','Quiver Dance':'蝶舞','Heavy Slam':'重磅冲撞','Electro Ball':'电球',
'Flame Charge':'蓄能焰袭','Low Sweep':'下盘踢','Acid Spray':'酸液炸弹','Foul Play':'欺诈',
'Simple Beam':'单纯光束','After You':'您先请','Echoed Voice':'回声','Chip Away':'逐步击破',
'Clear Smog':'清除之烟','Stored Power':'辅助力量','Quick Guard':'快速防守','Ally Switch':'交换场地',
'Shell Smash':'破壳','Heal Pulse':'治愈波动','Sky Drop':'自由落体','Shift Gear':'换档',
'Circle Throw':'巴投','Reflect Type':'镜面属性','Final Gambit':'搏命','Water Pledge':'水之誓约',
'Fire Pledge':'火之誓约','Grass Pledge':'草之誓约','Volt Switch':'伏特替换','Struggle Bug':'虫之抵抗',
'Frost Breath':'冰息','Dragon Tail':'龙尾','Wild Charge':'疯狂伏特','Drill Run':'直冲钻',
'Dual Chop':'二连劈','Heart Stamp':'爱心印章','Horn Leech':'木角','Sacred Sword':'圣剑',
'Razor Shell':'贝壳刃','Heat Crash':'高温重压','Cotton Guard':'棉花防守','Night Daze':'暗黑爆破',
'Tail Slap':'扫尾拍打','Head Charge':'爆炸头突击','Gear Grind':'齿轮飞盘','Searing Shot':'火焰弹',
'Techno Blast':'高科技光炮','Relic Song':'古老之歌','Secret Sword':'神秘之剑','Bolt Strike':'雷击',
'Blue Flare':'青焰','Fiery Dance':'火之舞','Freeze Shock':'冰冻伏特','Ice Burn':'极寒冷焰',
'Icicle Crash':'冰柱坠击','Fusion Flare':'交错火焰','Flying Press':'飞身重压','Mat Block':'掀榻榻米',
'Sticky Web':'黏黏网','Fell Stinger':'致命针刺','Phantom Force':'潜灵奇袭','Trick-Or-Treat':'万圣夜',
'Noble Roar':'战吼','Ion Deluge':'等离子浴','Parabolic Charge':'抛物面充电',"Forest's Curse":'森林诅咒',
'Petal Blizzard':'落英缤纷','Freeze-Dry':'冷冻干燥','Disarming Voice':'魅惑之声','Parting Shot':'抛下狠话',
'Topsy-Turvy':'颠倒','Draining Kiss':'吸取之吻','Crafty Shield':'戏法防守','Flower Shield':'鲜花防守',
'Grassy Terrain':'青草场地','Misty Terrain':'薄雾场地','Play Rough':'嬉闹','Fairy Wind':'妖精之风',
'Fairy Lock':'妖精之锁',"King's Shield":'王者盾牌','Play Nice':'和睦相处','Diamond Storm':'钻石风暴',
'Steam Eruption':'蒸汽爆炸','Hyperspace Hole':'异次元洞','Water Shuriken':'飞水手里剑','Mystical Fire':'魔法火焰',
'Spiky Shield':'尖刺防守','Aromatic Mist':'芳香薄雾','Eerie Impulse':'怪异电波','Venom Drench':'毒液陷阱',
'Magnetic Flux':'磁场操控','Happy Hour':'欢乐时光','Electric Terrain':'电气场地','Dazzling Gleam':'魔法闪耀',
'Hold Hands':'牵手','Baby-Doll Eyes':'圆瞳','Hold Back':'手下留情','Power-Up Punch':'增强拳',
'Oblivion Wing':'死亡之翼','Thousand Arrows':'千箭齐发','Thousand Waves':'千波激荡',"Land's Wrath":'大地神力',
'Light Of Ruin':'破灭之光','Origin Pulse':'根源波动','Precipice Blades':'断崖之剑','Dragon Ascent':'画龙点睛',
'Hyperspace Fury':'异次元猛攻','First Impression':'迎头一击','Baneful Bunker':'碉堡','Spirit Shackle':'缝影',
'Darkest Lariat':'极暗金勾臂','Sparkling Aria':'泡影咏叹调','Ice Hammer':'冰锤','Floral Healing':'花疗',
'High Horsepower':'十万马力','Strength Sap':'吸取力量','Solar Blade':'日光刃','Toxic Thread':'毒丝',
'Laser Focus':'磨砺','Throat Chop':'地狱突刺','Pollen Puff':'花粉团','Anchor Shot':'掷锚',
'Psychic Terrain':'精神场地','Fire Lash':'火焰鞭','Power Trip':'嚣张','Speed Swap':'速度互换',
'Smart Strike':'修长之角','Revelation Dance':'觉醒之舞','Core Enforcer':'核心惩罚者','Trop Kick':'热带踢',
'Beak Blast':'鸟嘴加农炮','Clanging Scales':'鳞片噪音','Dragon Hammer':'龙锤','Brutal Swing':'狂舞挥打',
'Aurora Veil':'极光幕','Shell Trap':'陷阱甲壳','Fleur Cannon':'花朵加农炮','Psychic Fangs':'精神之牙',
'Stomping Tantrum':'跺脚','Shadow Bone':'暗骨','Prismatic Laser':'棱镜镭射','Spectral Thief':'暗影偷盗',
'Sunsteel Strike':'流星闪冲','Moongeist Beam':'暗影之光','Tearful Look':'泪眼汪汪','Zing Zap':'麻麻刺刺',
"Nature's Madness":'自然之怒','Multi-Attack':'多属性攻击','Mind Blown':'惊爆大头','Plasma Fists':'等离子闪电拳',
'Photon Geyser':'光子喷涌','Zippy Zap':'电电加速','Splishy Splash':'滔滔冲浪','Floaty Fall':'飘飘坠落',
'Pika Papow':'闪闪雷光','Bouncy Bubble':'活活气泡','Buzzy Buzz':'麻麻电击','Sizzly Slide':'熊熊火爆',
'Glitzy Glow':'哗哗气场','Baddy Bad':'坏坏领域','Sappy Seed':'茁茁轰炸','Freezy Frost':'冰冰霜冻',
'Sparkly Swirl':'亮亮风暴','Veevee Volley':'砰砰击破','Double Iron Bash':'钢拳双击','Dynamax Cannon':'极巨炮',
'Snipe Shot':'狙击','Jaw Lock':'紧咬不放','Stuff Cheeks':'大快朵颐','Tar Shot':'沥青射击',
'Magic Powder':'魔法粉','Dragon Darts':'龙箭','Bolt Beak':'电喙','Fishious Rend':'鳃咬',
'Court Change':'换场','Clangorous Soul':'魂舞烈音爆','Body Press':'扑击','Drum Beating':'鼓击',
'Snap Trap':'捕兽夹','Pyro Ball':'火焰球','Behemoth Blade':'巨兽斩','Behemoth Bash':'巨兽弹',
'Aura Wheel':'气场轮','Breaking Swipe':'广域破坏','Branch Poke':'木枝突刺','Apple Acid':'苹果酸',
'Grav Apple':'万有引力','Spirit Break':'灵魂冲击','Strange Steam':'神奇蒸汽','Life Dew':'水露',
'False Surrender':'假跪真撞','Meteor Assault':'流星突击','Steel Beam':'铁蹄光线','Expanding Force':'广域战力',
'Steel Roller':'铁滚轮','Scale Shot':'鳞射','Meteor Beam':'流星光束','Shell Side Arm':'臂贝武器',
'Grassy Glide':'青草滑梯','Rising Voltage':'电力上升','Terrain Pulse':'大地波动','Skitter Smack':'爬击',
'Burning Jealousy':'妒火','Corrosive Gas':'腐蚀气体','Flip Turn':'快速折返','Triple Axel':'三旋击',
'Dual Wingbeat':'双翼','Scorchng Sands':'灼热沙地','Jungle Healing':'丛林治疗','Wicked Blow':'暗冥强击',
'Surging Strikes':'水流连打','Thunder Cage':'雷电囚笼','Dragon Energy':'巨龙威能','Freezing Glare':'冰冷视线',
'Fiery Wrath':'怒火中烧','Thunderous Kick':'雷鸣蹴击','Glacial Lance':'雪矛','Astral Barrage':'星碎',
'Eerie Spell':'诡异咒语','Aqua Fang':'水流之牙','Wave Crash':'波动冲','Seismic Fist':'震地之拳',
'Iron Fangs':'钢铁之牙','Shadow Fangs':'暗影之牙','Lovely Bite':'可爱之咬','Jagged Fangs':'锯齿之牙',
'Scorched Earth':'灼烧大地','Raging Fury':'大愤慨','Plasma Pulse':'等离子脉冲','Primal Beam':'原始光束',
'Draconic Fangs':'龙族之牙','Pixie Beam':'妖精光束','Pixie Slash':'妖精劈斩','Seismic Blade':'震地之刃',
'Mountain Chunk':'山岩重块','Archer Shot':'弓手射击','Frost Brand':'寒霜烙印','Frost Bolt':'寒霜冰箭',
'Glacier Crash':'冰川冲撞','Supersonic Shot':'超音波射击','Zephyr Rush':'疾风冲刺','Shocking Jab':'雷电戳击',
'Shocking Edge':'电击之刃','Lightning Strike':'雷霆一击','Volt Bolt':'电压弹','Kinetic Barrage':'动能弹幕',
'Fertile Fangs':'繁茂之牙','Scatter Blast':'散射爆破','Jagged Punch':'锯齿重拳','Cutsie Slap':'卖萌拍打',
'Fairy Spheres':'妖精之球','Bramble Blast':'荆棘爆破','Asteroid Shot':'星屑射击','Aqua Bash':'水流重击',
'Tectonic Fangs':'大地锐牙','Cupid Shot':'爱神箭','Clay Dart':'黏土飞镖','Diamond Arrow':'钻石之箭',
'Diamond Blade':'钻石之刃','Venom Bolt':'剧毒电矢','Fumigation Bomb':'熏蒸炸弹','Black Magic':'黑魔法',
'Flame Tongue':'火焰之舌','Blazing Arrow':'炽炎之箭','Rocket Shot':'火箭射击','Web Shot':'蛛网射击',
'Aura Force':'波导之力','Draco Missile':'龙之导弹','Lotus Shower':'莲花骤雨','Jagged Horns':'锯齿之角',
'Blood Shot':'鲜血射击','Flash Freeze':'瞬间冰冻','Phantom Glove':'幽灵之拳','Homing Fletch':'追踪箭羽',
'Bitter Malice':'冤冤相报','Infernal Parade':'群魔乱舞','Devious Shot':'狡诈射击','Cheap Shot':'卑鄙偷袭',
'Torrent Fist':'激流之拳','Star Crash':'星辰冲撞','Stone Axe':'岩斧','Energy Wave':'能量波',
'Fluttering Leaf':'飘落之叶','Headlong Rush':'突飞猛扑','Revival Blessing':'复生祈祷','Whirling Strikes':'回旋连击',
'Mind Break':'摧心','Wyrm Wind':'蛟龙狂风','Shed Tail':'断尾','Berry Smash':'树果粉碎',
'Hydro Steam':'水流蒸汽','Boiling Flame':'沸腾烈焰','Triple Arrows':'三连箭','Double Lariat':'双重抡击',
'Leech Blade':'吸血之刃','Yggdrasil Force':'世界树之力','Drain Brain':'脑力吸取','Psychokinetic Slam':'念力重压',
'Mortal Spin':'晶光转转','Gem Missile':'宝石导弹','Rider Kick':'骑士踢','Aqua Cutter':'水波刀',
'Inverse Room':'逆转空间','Blazing Bone':'炽燃之骨','Chilling Water':'泼冷水','Ghastly Echo':'阴森回响',
'Chilly Reception':'冷笑话','Ice Spinner':'冰旋','Population Bomb':'鼠数儿','Raging Souls':'愤怒之魂',
'Twin Beam':'双光束','Armor Cannon':'铠农炮','Bitter Blade':'悔念剑','Soil Drain':'泥土吸取',
'Gigaton Hammer':'巨力锤','Triple Dive':'三连钻','Jet Punch':'喷射拳','Rage Fist':'愤怒之拳',
'Wicked Torque':'黑暗暴冲','Blazing Torque':'灼热暴冲','Noxious Torque':'剧毒暴冲','Magical Torque':'魔法暴冲',
'Combat Torque':'格斗暴冲','Kowtow Cleave':'仆刀','Flower Trick':'千变万花','Aqua Step':'流水旋舞',
'Torch Song':'闪焰高歌','Glaive Rush':'巨剑突击','Silk Trap':'线阱','Last Respects':'扫墓',
'Lumina Crash':'琉光冲激','Spicy Extract':'辣椒精华','Spin Out':'疾速转轮','Salt Cure':'盐腌',
'Fillet Away':'甩肉','Raging Bull':'怒牛','Make It Rain':'淘金潮','Collision Course':'全开猛撞',
'Electro Drift':'闪电猛冲','Hyper Drill':'强力钻','Double Shock':'电光双击','Blood Moon':'血月',
'Axe Kick':'下压踢','Barb Barrage':'毒千针',"Smashin' Realities":'击碎现实','Creeping Thorns':'蔓延荆棘',
'Matcha Gotcha':'抹茶突袭','Syrup Bomb':'糖浆炸弹','Ivy Cudgel':'藤蔓棍击','Electro Shot':'电气射击',
'Fickle Beam':'变幻光束','Burning Bulwark':'燃烧壁垒','Tachyon Cutter':'超光速切','Hard Press':'硬压',
'Dragon Cheer':'龙之助威','Alluring Voice':'迷人之声','Mighty Cleave':'威猛劈斩','Temper Flare':'怒火喷发'
};

// 1) CSV 建立 en → id 队列（物理串唯一，按出现顺序分配）
const rows = csv.readObjects(__dirname + '/../translation-er/strings/main-text.csv');
const enQueue = new Map();
for (const r of rows) {
	const k = r.en.replace(/\s+$/, '');
	if (!enQueue.has(k)) enQueue.set(k, []);
	enQueue.get(k).push(r.id);
}
const used = new Set();

const out = [];
let missing = [];
for (const item of batch.items) {
	const trim = item.en.trim();
	const lead = item.en.length - trim.length;
	const cn = T[trim];
	if (cn === undefined) { missing.push(item.en); continue; }
	// 2) 恢复 id
	let id = '';
	const q = enQueue.get(item.en.replace(/\s+$/, '')) || [];
	for (let i = 0; i < q.length; i++) {
		if (!used.has(q[i])) { id = q[i]; used.add(q[i]); break; }
	}
	if (!id && q.length) { id = q[0]; }   // 全用过 → 复用第一个（同串同译）
	// 3) 右对齐空格公式: pad = (lead + trimLen) - 3*han，至少 1
	const han = [...cn].filter(c => c.codePointAt(0) >= 0x2E80).length;
	let pad = (lead + [...trim].length) - 3 * han;
	if (pad < 1) pad = 1;
	const zh = ' '.repeat(pad) + cn;
	// 4) 预算自检
	const enc = encode(zh, cm, { escPrefix: 'f7' });
	const budget = item.budget;
	out.push({ id, zh, _check: { bytes: enc.bytes.length + 1, budget: budget * 3 + 5, ok: enc.unknown.length === 0 } });
}
if (missing.length) console.error('未覆盖译名:', JSON.stringify(missing));
const over = out.filter(o => !o._check.ok);
if (over.length) { console.error('超预算:', over.length); for (const o of over.slice(0, 10)) console.error(' ', o.zh, o._check); }
fs.writeFileSync(__dirname + '/../translation-er/report/batches/batch-304-out.json',
	JSON.stringify(out.map(({ id, zh }) => ({ id, zh })), null, 1), 'utf8');
console.log('写出', out.length, '条 | 未覆盖译名', missing.length, '| 超预算', over.length, '| 空 id', out.filter(o => !o.id).length);
