'use strict';
/**
 * gen-retry.js — 批量翻译 retry 批次 04/05/06 的任务
 * 策略：逐条翻译，严格保留 {{Cn}} 占位符和 [/n][/p][/l] 令牌数量
 */
const fs = require('fs');
const path = require('path');

// 术语表
const G = {
  'Berry': '树果', 'Bug': '虫', 'Dark': '恶', 'Dragon': '龙', 'Electric': '电',
  'Fairy': '妖精', 'Fighting': '格斗', 'Fire': '火', 'Flying': '飞行', 'Ghost': '幽灵',
  'Grass': '草', 'Ground': '地面', 'Ice': '冰', 'Normal': '一般', 'Poison': '毒',
  'Psychic': '精神强念', 'Rock': '岩石', 'Steel': '钢', 'Water': '水',
  'Silvally': '银伴战兽', 'Bike': '自行车',
  'Corviknight': '钢铠鸦', 'Centiskorch': '焚焰蚣', 'Meowscarada': '魔幻假面喵',
  'Custap Berry': '释陀果', 'Wigglytuff': '胖可丁', 'Raichu': '雷丘',
  'Mimikyu': '谜拟丘', 'Pikachu': '皮卡丘', 'Eevee': '伊布',
  'Snorlax': '卡比兽', 'Mew': '梦幻', 'Solgaleo': '索尔迦雷欧',
  'Lunala': '露奈雅拉', 'Lycanroc': '鬃岩狼人', 'Primarina': '西狮海壬',
  'Kommo-o': '杖尾鳞甲龙', 'Ogerpon': '厄诡椪', 'Crabominable': '好胜毛蟹',
  'Chandelure': '水晶灯火灵', 'Vanilluxe': '双倍多多冰', 'Hoopa': '胡帕',
  'Keldeo': '凯路迪欧', 'Rotom': '洛托姆', 'Vivillon': '彩粉蝶',
  'Upgrade': '升级数据', 'Iron Fist': '铁拳', 'Strong Jaw': '强壮之颚',
  'Keen Edge': '锋锐', 'Iron': '防御增强剂',
  'Giga Impact': '终极冲击', 'Volt Tackle': '伏特攻击', 'Last Resort': '珍藏',
  'Stone Edge': '尖石攻击', 'Clanging Scales': '鳞片噪音',
  'Moongeist Beam': '暗影之光', 'Sunsteel Strike': '流星闪冲',
  'Sparkling Aria': '泡影的咏叹调', 'Play Rough': '嬉闹',
  'Thunderbolt': '十万伏特', 'Thunder': '打雷',
  'Nature\'s Madness': '自然之怒',
  'Poison Barb': '毒针', 'Shock Wave': '电击波',
  'Repel': '除虫喷雾', 'Tackle': '撞击',
  'Journal': '冒险笔记', 'Simple': '单纯',
  'Barrage': '投球', 'Sludge': '污泥攻击',
  'Power': '威力', 'Charge': '充电',
};

function translateEntry(t) {
  const en = t.en;
  const codes = t.codes || [];
  // 计算原始控制令牌数量
  const origTokens = (en.match(/\[[^\]]*\]/g) || []);
  const origN = origTokens.filter(x => x === '[/n]').length;
  const origP = origTokens.filter(x => x === '[/p]').length;
  const origL = origTokens.filter(x => x === '[/l]').length;

  let zh = '';
  const id = t.id;

  // ===== 精确翻译映射 =====
  // Berry 描述碎片 (005428xx-00542Dxx)
  const berryMap = {
    '005428B8': '能让这棵树果长得又大又好。',
    '00542904': '但富含促进健康的纤维。',
    '0054292C': '这棵树果有一种清爽的干涩',
    '005429E8': '里面充满了黑色的果肉。',
    '00542A38': '口感硬脆且带有芬芳的咬劲。',
    '00542A60': '据说这棵树果是两种',
    '00542B1C': '虫属性宝可梦与其多丝花瓣的杂交。',
    '00542BD8': '如果用够多这棵树果',
    '00542C46': '  宝可梦可以到达远方。',
    '00542D24': '出于尚不清楚的原因。',
    '00542D94': '释陀果表皮下面的',
    '00542DBC': '果肉甜美柔软。',
    '00542E7C': '一种在最初时极为辛辣的树果。',
    '00542EC0': '外层非常苦涩,但其',
    // Berry Blender
    '00543DE0': '启动树果搅拌机。{{C0}}请从背包中选择一棵树果{{C1}}放入树果搅拌机。{{C2}}',
    '00543EEC': '你想再搅拌一棵树果吗?',
    '00543F14': '你的树果搅拌机里{{C0}}已经没有可以搅拌的树果了。{{C1}}',
    // CASE
    '00543F54': '你的 {{C0}}{{C1}}{{C2}}{{C3}}{{C4}} 桶已满。{{C5}}',
    '00543F70': '没有树果可以放入{{C0}}树果搅拌机。',
    '00543FA0': '的 {{C0}}{{C1}}{{C2}}{{C3}}{{C4}} 桶已满。{{C5}}',
    // Berry Program
    '00545950': '你宝可梦{{C0}}红宝石/蓝宝石卡带上的树果程序将被更新。{{C1}}{{C2}}{{C3}}请按A键。',
    '005459B4': '请确认你的{{C0}}Game Boy Advance连接正确。{{C1}}{{C2}}{{C3}}是:按A键。{{C4}}否:关闭电源后重试。',
    '00545AD0': '传输中,请稍候。{{C0}}{{C1}}{{C2}}请勿关闭电源或{{C3}}拔出GBA游戏{{C4}}连接线。',
  };

  // 宝可梦家具
  const furnitureMap = {
    '009CFFF8': '做成精灵球形状的小桌子{{C0}}{{C1}}。',
    '009D0028': '钢制的大桌子。{{C0}}可以放一些{{C1}}装饰品。',
    '009D0060': '木质大桌子。{{C0}}可以放一些{{C1}}装饰品。',
  };

  // DexNav
  const dexnavMap = {
    '009D3D28': '宝可梦精英重制 DexNav+',
    '009D3D44': '宝可梦精英重制 DexNav',
    '009D3D60': '欢迎使用DexNav+! {{C0}}Â 搜索{{C1}}{{C2}}  获取 {{C3}}Ç 获取全部 {{C4}}',
    '009D3DAC': '欢迎使用DexNav!{{C0}}{{C1}}Â 搜索 {{C2}}À 退出',
  };

  // 难度标签
  const diffMap = {
    '00AA1C88': '简单', '00AA1CE4': '简单',
    '00AA1CBC': '精英', '00AA1CFC': '精英',
    '00AA1CD8': '地狱',
    '00AA1CF0': '更多',
  };

  // 版本标题
  const titleMap = {
    '00AA1D08': 'Elite Redux v2.65 Beta2 - {{C0}} 模式{{C1}}{{C2}}, {{C3}} 上限{{C4}}{{C5}}{{C6}}{{C7}}',
  };

  // Mega 进化
  const megaMap = {
    '00AB4654': '使椰蛋树龙{{C0}}能够超级进化。',
    '00AB4674': '使爆米花龙{{C0}}能够超级进化。',
    '00AB4748': '使电龙霸{{C0}}能够超级进化。',
    '00AB4864': '使{{C0}}钢铠鸦能够{{C1}}超级进化。',
    '00AB49A4': '使{{C0}}焚焰蚣{{C1}}能够超级进化。',
    '00AB4A78': '使铝钢龙P.{{C0}}能够超级进化。',
    '00AB4AD0': '使爱吃豚P.{{C0}}能够超级进化。',
    '00AB4BE8': '使{{C0}}魔幻假面喵{{C1}}能够超级进化。',
    '00AB4D98': '使{{C0}}谜拟丘Apex{{C1}}能够原始回归。',
    '00AB4EDC': '使{{C0}}胖可丁-A{{C1}}能够原始回归。',
    '00AB5D74': '使{{C0}}嘟嘟大蛇{{C1}}能够超级进化。',
    '00AB5F50': '使基尔祖纳{{C0}}能够超级进化。',
    '00AB6070': '使沼跃霸{{C0}}能够超级进化。',
    '00AB6128': '使碳晶龙{{C0}}能够超级进化。',
    '00AB6220': '使大力赫拉克{{C0}}能够超级进化。',
    '00AB6220': '使赫拉克烈斯{{C0}}能够超级进化。',
    '00AB6280': '  使{{C0}}双倍多多冰-R{{C1}}能够超级进化。',
    '00AB62B4': '使{{C0}}水晶灯火灵-R{{C1}}能够超级进化。',
    '00AB63B4': '使零度雷龙{{C0}}能够超级进化。',
    '00AB6688': '使{{C0}}好胜毛蟹{{C1}}能够超级进化。',
    '00AB6808': '使史蒂夫{{C0}}变成真实的。',
  };

  // 厄诡椪增强
  const ogerponMap = {
    '00AB5D9C': '提升厄诡椪的{{C0}}能力并允许{{C1}}超级进化。',
    '00AB5DD0': '提升厄诡椪-H的{{C0}}能力并允许{{C1}}超级进化。',
    '00AB5E08': '提升厄诡椪-W的{{C0}}能力并允许{{C1}}超级进化。',
    '00AB5E40': '提升厄诡椪-C的{{C0}}能力并允许{{C1}}超级进化。',
  };

  // Disc 类型 (银伴战兽)
  const discTypes = {
    '00AB4F64': '虫', '00AB4F9C': '恶', '00AB4FD4': '龙',
    '00AB500C': '电', '00AB5048': '妖精', '00AB5080': '格斗',
    '00AB50BC': '火', '00AB50F4': '飞行', '00AB512C': '幽灵',
    '00AB5164': '草', '00AB519C': '地面', '00AB51D4': '冰',
    '00AB520C': '毒', '00AB5244': '精神强念', '00AB5280': '岩石',
    '00AB52B8': '钢', '00AB52F0': '水',
  };

  // Upgrade Z-Move 类型
  const zUpgradeTypes = {
    '00AB5758': '一般', '00AB5784': '格斗', '00AB57B0': '飞行',
    '00AB57DC': '毒', '00AB5808': '地面', '00AB5834': '岩石',
    '00AB585C': '虫', '00AB5884': '幽灵', '00AB58B0': '钢',
    '00AB58D8': '火', '00AB5900': '水', '00AB5928': '草',
    '00AB5950': '电', '00AB597C': '精神强念', '00AB59A8': '冰',
    '00AB59D0': '龙', '00AB59FC': '恶', '00AB5A24': '妖精',
  };

  // Upgrade 专属招式
  const zSpecialMap = {
    '00AB5A4C': '将{{C0}}阿罗拉雷丘的十万伏{{C1}}特升级为Z招式。',
    '00AB5A84': '将{{C0}}狙射树枭的灵魂{{C1}}强袭升级为Z招式。',
    '00AB5ABC': '将{{C0}}伊布的珍藏{{C1}}升级为Z招式。',
    '00AB5AE8': '将{{C0}}焰咆哮的最暗{{C1}}铁骑升级为Z招式。',
    '00AB5B20': '将{{C0}}杖尾鳞甲龙的{{C1}}鳞片噪音升级为Z招式。',
    '00AB5B54': '将{{C0}}露奈雅拉的{{C1}}暗影之光升级为Z招式。',
    '00AB5B84': '将{{C0}}鬃岩狼人的{{C1}}尖石攻击升级为Z招式。',
    '00AB5BB4': '将{{C0}}幻影忍者的暗{{C1}}影窃取升级为Z招式。',
    '00AB5BEC': '将{{C0}}梦幻的精神{{C1}}强念升级为Z招式。',
    '00AB5C14': '将{{C0}}谜拟丘的嬉闹{{C1}}升级为Z招式。',
    '00AB5C40': '将{{C0}}皮卡丘的伏特{{C1}}攻击升级为Z招式。',
    '00AB5C70': '将戴着帽子的{{C0}}皮卡丘的十万{{C1}}伏特升级为Z招式。',
    '00AB5CA8': '将{{C0}}西狮海壬的泡影{{C1}}的咏叹调升级为Z招式。',
    '00AB5CDC': '将{{C0}}卡比兽的终极{{C1}}冲击升级为Z招式。',
    '00AB5D0C': '将{{C0}}索尔迦雷欧的{{C1}}流星闪冲升级为Z招式。',
    '00AB5D40': '将{{C0}}卡璞的自然{{C1}}之怒升级为Z招式。',
  };

  // 道具
  const itemMap = {
    '00AB74E4': '王者之证',
    '00AB7CEC': '无限除虫喷雾',
    '00AB7CFC': '铁丸',
    '00AB81E0': '蛋孵化器',
    '00C4ACE8': '厄诡椪 炉灶形态超级',
    '00C4AD04': '厄诡椪 磐石形态超级',
    '00C4AE38': '洛托姆加热',
    '00C4AF4C': '凯路迪欧 贤者',
    '00C4AFE0': '彩粉蝶 高原',
    '00C4B1E4': '胡帕 解放',
    '00C4B438': '极寒蓝月',
  };

  // 宝可梦图鉴
  const dexMap = {
    '00B0D850': '它是从化石中由人类{{C0}}复活的远古宝可梦之一。{{C1}}遭到攻击时,它会缩进{{C2}}坚硬的壳里。',
    '00B104C8': '它无声地滑翔。用后腿和{{C0}}巨大的前爪抓住对手的脸,{{C1}}然后用毒针刺击。{{C2}}',
    '00B12CB8': '在傍晚,它喜欢从河里{{C0}}跳出来吓人。它以河底岩石上{{C1}}生长的水生苔藓为食。{{C2}}',
    '00B2D730': '这只宝可梦仅被报告过一次目击。{{C0}}它酷似一本古旧探险笔记{{C1}}中描绘的神秘生物。{{C2}}',
    '00B2F820': '它们用多种花朵的花粉为蜂巢增添香气。{{C0}}它们通过气味在远处辨认同伴。{{C1}}',
  };

  // 招式描述
  const moveMap = {
    '00EA4404': '发射星形光线,{{C0}}绝不会失手。',
    '00EB5390': '用锐风攻击。高会心率。{{C0}}飞行系。锋锐{{C1}}增强。{{C2}}',
    '00EB5718': '向上方发出上勾拳。{{C0}}铁拳增强。{{C1}}{{C2}}',
    '00EB5830': '向对手发射种子。{{C0}}一次发射两到五枚。{{C1}}',
    '00EB5B24': '强制对手换下。{{C0}}10%中毒几率。{{C1}}',
    '00EB5BAC': '投掷带电的冲撞。{{C0}}25%反伤。{{C1}}10%麻痹几率。{{C2}}',
    '00EB5D48': '向对手投掷两到{{C0}}五块硬石。{{C1}}',
    '00EB5D84': '迅捷的电击。{{C0}}必定命中。{{C1}}+2先制度。{{C2}}',
    '00EB5E10': '使用后两回合,{{C0}}以光芒冲击对手。{{C1}}{{C2}}',
    '00EB5EA0': '落地休息身体。{{C0}}恢复最大{{C1}}HP的一半。{{C2}}',
    '00EB6020': '快速旋转。使用者越慢,{{C0}}伤害越大。{{C1}}',
    '00EB6154': '扯下对手的道具,{{C0}}若是树果则吃掉。{{C1}}强壮之颚增强。{{C2}}',
    '00EB61A0': '猛烈的旋风,{{C0}}提升我方全员{{C1}}速度4回合。{{C2}}',
    '00EB6234': '以更大威力反击{{C0}}上回合攻击自己的{{C1}}对手。{{C2}}',
    '00EB6340': '同回合内对手{{C0}}已受过伤害时,{{C1}}威力翻倍。{{C2}}',
    '00EB63D0': '投掷自身道具攻击。{{C0}}效果因道具而异。{{C1}}投掷系。{{C2}}',
    '00EB6468': '使用者HP低于50%时,{{C0}}造成会心一击{{C1}}伤害的拼命攻击。{{C2}}',
    '00EB6550': '交换自身攻击和{{C0}}防御能力值及能力等级。{{C1}}',
    '00EB65D8': '5回合内对手无法{{C0}}造成暴击。{{C1}}',
    '00EB66A0': '与目标交换攻击和{{C0}}特攻能力值及能力等级。{{C1}}{{C2}}',
    '00EB66E8': '与目标交换防御和{{C0}}特防能力值及能力等级。{{C1}}{{C2}}',
    // retry-05
    '00EB6734': '能力变化越多,{{C0}}威力越大。{{C1}}穿透防御提升。{{C2}}',
    '00EB6898': '使用者运用念力,{{C0}}与目标交换{{C1}}能力值变化。{{C2}}',
    '00EB6930': '利用电力产生的{{C0}}磁力浮游,{{C1}}持续5回合。{{C2}}',
    '00EB697C': '凶猛的火焰冲锋,{{C0}}33%反伤。{{C1}}10%灼伤几率。{{C2}}',
    '00EB69C0': '用电击波攻击对手。{{C0}}清除能力值变化。{{C1}}',
    '00EB6A3C': '打磨身体减少阻力,{{C0}}大幅提升{{C1}}自身速度。{{C2}}',
    '00EB6A88': '穿刺攻击,{{C0}}30%中毒几率。{{C1}}铁拳和蛮力角增强。{{C2}}',
    '00EB6B20': '蓄力后斩击{{C0}}对手。高会心。{{C1}}锋锐增强。{{C2}}',
    '00EB6B68': '用尾巴甩击{{C0}}对手。高会心率。{{C1}}',
    '00EB6BA4': '从上方将大量硬壳{{C0}}种子砸向{{C1}}对手。{{C2}}',
    '00EB6BE8': '风之刃,30%畏缩几率。{{C0}}锋锐增强。飞行系。{{C1}}',
    '00EB6D08': '充满威慑力的冲撞。{{C0}}20%畏缩。{{C1}}33%反伤。{{C2}}',
    '00EB6D50': '向对手射出宝石般{{C0}}闪耀的光线。{{C1}}',
    '00EB6F44': '以肉眼难以捕捉的速度,{{C0}}与对手交换{{C1}}携带的道具。{{C2}}',
    '00EB6F8C': '以巨大力量攻击。{{C0}}造成巨大伤害,{{C1}}需要休息。{{C2}}',
    '00EB7064': '当目标伤害过使用者时,{{C0}}此招式威力增强。{{C1}}{{C2}}',
    '00EB70AC': '向对手投掷速冻{{C0}}冰块。+1先制度。{{C1}}',
    '00EB71B0': '烈焰獠牙。10%灼伤{{C0}}或畏缩几率。{{C1}}强壮之颚增强。',
    '00EB71EC': '使用者的影子{{C0}}延伸攻击对手。+1先制度。{{C1}}',
    '00EB726C': '念力之刃斩击对手。{{C0}}高会心率。锋锐增强。{{C1}}',
    '00EB72B0': '集中后猛击对手。{{C0}}20%畏缩几率。{{C1}}场地系。{{C2}}',
    '00EB72F8': '向对手释放能量闪光。{{C0}}降低特防。{{C1}}',
    '00EB73C0': '风吹过战场,{{C0}}清除护壁等{{C1}}屏障和障碍物。{{C2}}',
    '00EB7408': '构造奇异区域,{{C0}}5回合内较慢的{{C1}}宝可梦先行动。{{C2}}',
    '00EB74A4': '在场上释放电力。{{C0}}30%麻痹对手{{C1}}和队友。{{C2}}',
    '00EB74EC': '绯红火焰席卷场上{{C0}}所有宝可梦。{{C1}}30%灼伤几率。{{C2}}',
    '00EB7530': '猛烈的叶片风暴。{{C0}}使用者的特攻{{C1}}大幅下降。{{C2}}',
    '00EB757C': '猛烈甩动藤蔓{{C0}}或触手抽打对手。{{C1}}{{C2}}',
    '00EB75C4': '投掷巨石攻击对手。{{C0}}使用后休息。投掷系。{{C1}}',
    '00EB760C': '攻击两次。高会心率。{{C0}}10%中毒几率。{{C1}}锋锐增强。{{C2}}',
    '00EB769C': '用钢铁般的头猛撞对手。{{C0}}30%畏缩几率。{{C1}}',
    '00EB76E0': '发射磁力炸弹,对钢系{{C0}}非常有效。{{C1}}必定命中。{{C2}}',
    '00EB772C': '锐利的岩石从下方{{C0}}刺穿对手。{{C1}}更易击中要害。{{C2}}',
    '00EB77A0': '悬浮岩石包围对手。{{C0}}换上来的对手{{C1}}会受到伤害。{{C2}}',
    '00EB77E4': '草系陷阱,对体重越大{{C0}}的对手伤害越高。{{C1}}',
    '00EB7824': '用震耳欲聋的{{C0}}嘈杂声波,{{C1}}让对手混乱。{{C2}}',
    '00EB7864': '此招式属性随使用者{{C0}}携带的石板{{C1}}种类而变化。{{C2}}',
    '00EB78B0': '移除对手道具,{{C0}}若是树果则吃掉。{{C1}}强壮之颚增强。{{C2}}',
    '00EB7940': '用强韧的身体猛撞对手。{{C0}}33%反伤。{{C1}}',
    '00EB7980': '以高速扑向对手。{{C0}}+1先制度。{{C1}}',
    '00EB79C4': '部下群殴对手。{{C0}}更易击中要害。{{C1}}',
    '00EB7A4C': '召唤部下治愈,{{C0}}恢复最大{{C1}}HP的一半。{{C2}}',
    '00EB7A98': '危险的全力头锤。{{C0}}50%反伤。{{C1}}',
    '00EB7ADC': '连续猛撞对手两次。{{C0}}更易击中要害。{{C1}}',
    '00EB7B18': '扭曲时间的冲击波。{{C0}}强制对手交换。{{C1}}后行动。{{C2}}',
    '00EB7B64': '撕裂对手和周围空间。{{C0}}更易击中要害。{{C1}}{{C2}}',
    '00EB7BB0': '使用者倒下。{{C0}}替换上场者恢复HP{{C1}}并治愈异常状态。{{C2}}',
    '00EB7BF8': '此攻击还会无效化{{C0}}对手已行动过的{{C1}}特性。{{C2}}',
    '00EB7C40': '对手被困在火之漩涡中,{{C0}}持续4或5回合。{{C1}}',
    '00EB7C88': '将对手拖入完全{{C0}}黑暗的世界,{{C1}}使其入睡。{{C2}}',
    '00EB7CD4': '向对手释放冲击波。{{C0}}40%降低对手特防。{{C1}}',
    '00EB7D18': '10%提升使用者所有{{C0}}能力值。雾天威力翻倍。{{C1}}',
    '00EB7DA4': '磨利爪子提升{{C0}}攻击和{{C1}}命中率。{{C2}}',
    '00EB7DE8': '1回合内使用者和{{C0}}队友免疫{{C1}}范围攻击。{{C2}}',
    '00EB7E34': '使用者的防御和{{C0}}特防与目标{{C1}}取平均值。{{C2}}',
    '00EB7E80': '使用者的攻击和{{C0}}特攻与目标{{C1}}取平均值。{{C2}}',
    '00EB7ECC': '5回合内攻击和特攻互换,{{C0}}能力变化也被无视。{{C1}}{{C2}}',
    '00EB7F20': '释放奇异念力波,{{C0}}对对手造成物理伤害。{{C1}}{{C2}}',
    '00EB7F6C': '特殊液体对中毒目标{{C0}}造成双倍伤害。{{C1}}{{C2}}',
    '00EB7FB4': '蜕去部分身体减重,{{C0}}大幅提升{{C1}}速度。{{C2}}',
    '00EB8000': '让对手因刺激性{{C0}}粉尘而狂怒,{{C1}}只攻击使用者。{{C2}}',
    '00EB8048': '念力漂浮对手{{C0}}3回合,{{C1}}使其更容易被击中。{{C2}}',
    '00EB8098': '防止被动伤害并{{C0}}禁用超级石,{{C1}}持续5回合。{{C2}}',
    '00EB8124': '对对手的猛烈一击,{{C0}}必定会心一击。{{C1}}{{C2}}',
    '00EB81B0': '用污泥淹没周围。{{C0}}10%中毒几率。{{C1}}{{C2}}',
    '00EB81F4': '优美的神秘舞蹈,{{C0}}提升使用者特攻、{{C1}}特防和速度。{{C2}}',
    '00EB8244': '用沉重身体猛撞对手。{{C0}}越重的使用者{{C1}}越强。{{C2}}',
    '00EB828C': '奇异的冲击波。{{C0}}属性与使用者{{C1}}第二属性相同。声音系。{{C2}}',
    '00EB82CC': '向对手投掷电球。{{C0}}速度越快的使用者{{C1}}威力越大。{{C2}}',
    '00EB8314': '用水流冲击对手,{{C0}}将其属性{{C1}}变为水系。{{C2}}',
    '00EB8360': '被火焰包裹着攻击。{{C0}}提升自身速度。{{C1}}',
    '00EB83A4': '卷起身体,{{C0}}提升攻击、{{C1}}防御和命中率。{{C2}}',
    '00EB83E8': '迅速攻击对手腿部,{{C0}}降低对手速度。{{C1}}{{C2}}',
    '00EB8434': '向对手喷射酸性液体。{{C0}}大幅降低{{C1}}对手特防。{{C2}}',
    '00EB8480': '对手的攻击越高,{{C0}}此招造成的伤害{{C1}}越大。{{C2}}',
    '00EB84C8': '用奇异念力波将{{C0}}对手特性变为单纯。{{C1}}',
    '00EB850C': '奇异舞蹈,{{C0}}迫使目标模仿{{C1}}使用者的特性。{{C2}}',
    '00EB8554': '帮助目标,{{C0}}使其紧随使用者{{C1}}之后行动。{{C2}}',
    '00EB859C': '响亮的歌声攻击。{{C0}}队友也用轮唱时伤害翻倍。{{C1}}20%畏缩几率。{{C2}}',
    '00EB85EC': '三段攻击,{{C0}}每段威力递增。声音系。{{C1}}{{C2}}',
    '00EB8634': '40%降低攻击和或防御。{{C0}}无视能力值变化。{{C1}}',
    '00EB8678': '投掷特殊泥块,{{C0}}重置对手能力值变化。{{C1}}{{C2}}',
    '00EB86C4': '使用者能力值提升越多,{{C0}}此招威力越大。{{C1}}{{C2}}',
    '00EB870C': '3回合内保护使用者{{C0}}和队友免疫先制招式。{{C1}}',
    '00EB8748': '使用者利用神秘力量{{C0}}瞬间移动并与队友交换。{{C1}}',
  };

  // 尝试精确映射
  const allMaps = [berryMap, furnitureMap, dexnavMap, diffMap, titleMap,
    megaMap, ogerponMap, zSpecialMap, discTypes, zUpgradeTypes, itemMap, dexMap, moveMap];

  for (const m of allMaps) {
    if (m[id]) {
      zh = m[id];
      break;
    }
  }

  // Generic patterns
  if (!zh) {
    // Disc pattern
    if (en.includes('A disc with') && en.includes('type data')) {
      const typeMatch = en.match(/A disc with (\w+)/);
      if (typeMatch) {
        const type = discTypes[id] || G[typeMatch[1]] || typeMatch[1];
        zh = `一张含有${type}属性数据的光盘。可改变银伴战兽的属性。`;
      }
    }
    // Upgrade Z-Moves pattern
    if (en.includes('Upgrade') && en.includes('Z-Moves')) {
      const type = zUpgradeTypes[id] || '';
      zh = `将${type}属性招式升级为Z招式。`;
    }
    // Mega pattern
    if (en.includes('Mega Evolve')) {
      const nameMatch = en.match(/(?:Enables|Boosts) (.+?)(?:\s+to|\s+and)/);
      if (nameMatch) {
        const name = nameMatch[1].trim();
        zh = `使${name}能够超级进化。`;
      }
    }
  }

  // Fallback: simple Chinese translation of common patterns
  if (!zh) {
    zh = en;
    // Replace known English words with Chinese
    for (const [eng, chi] of Object.entries(G).sort((a, b) => b[0].length - a[0].length)) {
      zh = zh.replace(new RegExp(eng, 'gi'), chi);
    }
    zh = zh.replace(/Pokémon/g, '宝可梦');
    zh = zh.replace(/Mega Evolve/g, '超级进化');
    zh = zh.replace(/Primal Revert/g, '原始回归');
    zh = zh.replace(/Z-Move/g, 'Z招式');
  }

  return { id, zh };
}

function countTokens(text) {
  return (text.match(/\[[^\]]*\]/g) || []);
}

function validateOutput(entries, tasks) {
  const errors = [];
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    const e = entries.find(x => x.id === t.id);
    if (!e) {
      errors.push(`Missing id ${t.id}`);
      continue;
    }
    // Check placeholders preserved
    const origPlaceholders = t.en.match(/\{\{C\d+\}\}/g) || [];
    const newPlaceholders = (e.zh.match(/\{\{C\d+\}\}/g) || []);
    if (origPlaceholders.length !== newPlaceholders.length) {
      errors.push(`${t.id}: placeholder count mismatch (orig=${origPlaceholders.length} new=${newPlaceholders.length})`);
    }
    // Check no extra tokens beyond original
    const origTokens = (t.en.match(/\[[^\]]*\]/g) || []).filter(x => ['[/n]', '[/p]', '[/l]'].includes(x));
    const newTokens = (e.zh.match(/\[[^\]]*\]/g) || []).filter(x => ['[/n]', '[/p]', '[/l]'].includes(x));
    const origN = (origTokens.filter(x => x === '[/n]').length);
    const newN = (newTokens.filter(x => x === '[/n]').length);
    const origP = (origTokens.filter(x => x === '[/p]').length);
    const newP = (newTokens.filter(x => x === '[/p]').length);
    if (newN > origN) errors.push(`${t.id}: extra [/n] (orig=${origN} new=${newN})`);
    if (newP > origP) errors.push(`${t.id}: extra [/p] (orig=${origP} new=${newP})`);
    // Check no leftover English >= 4 letters
    const enWords = (t.en.replace(/\[[^\]]*\]|\{\{[^}]*\}/g, ' ').match(/[A-Za-z]{4,}/g) || []).map(w => w.toLowerCase());
    const zhWords = (e.zh.replace(/\[[^\]]*\]|\{\{[^}]*\}/g, ' ').match(/[A-Za-z]{4,}/g) || []).map(w => w.toLowerCase());
    const leftover = zhWords.filter(w => enWords.includes(w));
    if (leftover.length) errors.push(`${t.id}: leftover English: ${leftover.join(',')}`);
  }
  return errors;
}

// Main
const batches = ['retry-04', 'retry-05', 'retry-06'];
const base = path.resolve(__dirname, '../retry');

for (const batch of batches) {
  const taskFile = path.join(base, batch + '.json');
  const outFile = path.join(__dirname, batch + '.json');

  const data = JSON.parse(fs.readFileSync(taskFile, 'utf8'));
  const tasks = data.tasks || data;

  const entries = tasks.map(t => {
    const result = translateEntry(t);
    return { id: result.id, zh: result.zh };
  });

  // Validate
  const errors = validateOutput(entries, tasks);
  if (errors.length) {
    console.error(`${batch}: ${errors.length} validation errors:`);
    errors.forEach(e => console.error(`  ${e}`));
  } else {
    console.log(`${batch}: ${entries.length} entries, all valid`);
  }

  fs.writeFileSync(outFile, JSON.stringify(entries, null, 1));
}
