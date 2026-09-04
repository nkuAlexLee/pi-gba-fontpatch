'use strict';
const fs = require('fs');
const path = require('path');

// ========== COMPREHENSIVE NAME MAPS ==========

const creditRoles = {
  'Berry Program Update': '树果程序更新',
  'Ruby/Sapphire': '红宝石/蓝宝石',
  'Emerald': '绿宝石',
  'POKéMON EMERALD VERSION': '宝可梦绿宝石版',
  'Credits': '制作人员',
  'Executive Director': '总导演',
  'Director': '导演',
  'Art Director': '美术总监',
  'Battle Director': '战斗总监',
  'Main Programmer': '主程序员',
  'Battle System Programmers': '战斗系统程序员',
  'Field System Programmer': '地形系统程序员',
  'Programmers': '程序员',
  'Main Graphic Designer': '主美术设计',
  'Graphic Designers': '美术设计',
  'POKéMON Designers': '宝可梦设计',
  'Music Composition': '音乐作曲',
  'Sound Effects & POKéMON Voices': '音效与宝可梦配音',
  'Game Designers': '游戏设计',
  'Scenario Plot': '剧情设定',
  'Scenario': '剧本',
  'Script Designers': '脚本设计',
  'Map Designers': '地图设计',
  'Map Data Designers': '地图数据设计',
  'Parametric Designers': '参数设计',
  'POKéDEX Text': '宝可图鉴文字',
  'Environment & Tool Programmers': '环境与工具程序员',
  'NCL Product Testing': 'NCL产品测试',
  'Special Thanks': '特别鸣谢',
  'Coordinators': '协调员',
  'Producers': '制作人',
  'Executive Producers': '监制',
  'Information Supervisors': '信息监督',
  'Task Managers': '任务管理',
  'Braille Code Check': '盲文编码检查',
  'World Director': '世界观总监',
  'Battle Frontier Data': '对战开拓区数据',
  'Support Programmers': '支援程序员',
  'Artwork': '美术作品',
  'Lead Programmer': '首席程序员',
  'Lead Graphic Artist': '首席美术师',
  'Japan Braille Library': '日本盲文图书馆',
  'Package & Manual Illustration': '包装与说明书插画',
  'English Version Coordinators': '英文版协调员',
  'Translator': '翻译',
  'Text Editor': '文字编辑',
  'NCL Coordinator': 'NCL协调员',
  'Graphic Designer': '美术设计',
  'NOA Product Testing': 'NOA产品测试',
  'National Federation of the Blind': '美国全国盲人联合会',
  'European Blind Union': '欧洲盲人联盟',
  'Australian Braille Authority': '澳大利亚盲文协会',
  'Royal New Zealand Federation for the Blind': '新西兰皇家盲人联合会',
  ' The level is ': ' 等级为 ',
  ', and the feel is ': '，手感为',
  ' HITEMON': ' 宝可梦',
  'P WOBET': ' 宝可梦',
};

// Trainer/character names
const trainerNames = {
  'May': '小光', 'Brendan': '小悠', 'Archie': '水梧桐', 'Maxie': '赤焰松',
  'Wally': '政明', 'Wallace': '亚当', 'Grunt': '手下',
  'Steven': '大吾', 'Cynthia': '竹兰',
  'Sawyer': '索耶', 'Gabrielle': '加布丽艾勒',
  'Courtney': '小枫', 'Tabitha': '火焰',
  'Gabby & Ty': '嘉百丽和达也',
  'Lola': '罗拉', 'Austina': '奥丝蒂娜',
  'Gwen': '格温', 'Ricky': '里奇',
  'Isaac': '刚太', 'Davis': '达夫', 'Mitchell': '米切尔',
  'Lydia': '莉迪亚', 'Halle': '哈莉', 'Garrison': '加里森',
  'Jackson': '杰克逊', 'Lorenzo': '洛伦佐',
  'Sebastian': '塞巴斯蒂安', 'Catherine': '凯瑟琳',
  'Jenna': '杰娜', 'Sophia': '索菲亚',
  'Julio': '胡里奥', 'Lucy': '露琪',
  'Marc': '马尔科', 'Brenden': '布兰登',
  'Lilith': '莉莉丝', 'Cristian': '克里斯蒂安',
  'Sylvia': '西尔维娅', 'Leonardo': '莱昂纳多',
  'Athena': '雅典娜', 'Harrison': '哈里森',
  'Clarence': '克拉伦斯',
  'Johanna': '约翰娜', 'Gerald': '杰拉德',
  'Vivian': '薇薇安', 'Danielle': '丹妮尔',
  'Hideo': '秀夫', 'Keigo': '圭吾',
  'Riley': '莱利', 'Flint': '火渡',
  'Ashley': '艾什莉',
  'Spenser': '斯宾塞',
  'Dez & Luke': '德兹和卢克',
  'Lea & Jed': '莉亚和杰德',
  'Kira & Dan': '希拉和丹',
  'Leah': '莉雅', 'Daisy': '达斯',
  'Rose': '露丝', 'Felix': '菲利克斯',
  'Violet': '薇奥莉特',
  'Dusty': '达斯提', 'Chip': '奇普',
  'Foster': '福斯特',
  'Fredrick': '弗雷德里克', 'Matt': '马特',
  'Zander': '赞德', 'Shelly': '琉璃',
  'Leroy': '勒罗伊', 'Wilton': '威尔顿',
  'Edgar': '埃德加', 'Albert': '艾伯特',
  'Samuel': '塞缪尔', 'Vito': '维托',
  'Owen': '欧文', 'Warren': '沃伦',
  'Mary': '玛丽', 'Alexia': '阿莱克西亚',
  'Jody': '乔蒂', 'Wendy': '温迪',
  'Keira': '凯拉', 'Brooke': '布鲁克',
  'Jennifer': '珍妮弗', 'Hope': '霍普',
  'Shannon': '香农', 'Michelle': '米歇尔',
  'Caroline': '卡洛琳', 'Julie': '朱莉',
  'Patricia': '帕特里夏', 'Kindra': '金德拉',
  'Tammy': '塔米', 'Valerie': '瓦莱丽',
  'Tasha': '塔莎', 'Cindy': '辛迪',
  'Daphne': '达芙妮', 'Brianna': '布里安娜',
  'Naomi': '娜奥米', 'Melissa': '梅丽莎',
  'Sheila': '希拉', 'Shirley': '雪莉',
  'Jessica': '杰西卡', 'Connie': '康妮',
  'Bridget': '布里奇特', 'Olivia': '奥利维亚',
  'Tiffany': '蒂芙尼', 'Alannah': '阿兰娜',
  'Drew': '德鲁', 'Beau': '博',
  'Larry': '拉里', 'Shane': '谢恩',
  'Justin': '贾斯汀', 'Ethan': '伊桑',
  'Autumn': '奥特姆', 'Travis': '特拉维斯',
  'Eliza': '伊丽莎', 'Forrest': '福斯特',
  'Harold': '哈罗德',
  'Kody': '科迪', 'Annika': '安妮卡',
  'Jazmyn': '贾兹敏', 'Jonas': '乔纳斯',
  'Kayley': '凯莉', 'Auron': '奥伦',
  'Kelvin': '凯尔文', 'Marley': '马利',
  'Reyna': '蕾娜', 'Hudson': '哈德森',
  'Conor': '康纳', 'Edwin': '埃德温',
  'Hector': '赫克托',
  'Buffel': '比弗', 'Oldplayer': '老玩家',
  'Nate': '纳特', 'Kathleen': '凯瑟琳',
  'Clifford': '克利福德', 'Nicholas': '尼古拉斯',
  'Macey': '梅茜', 'Paxton': '帕克斯顿',
  'Isabella': '伊莎贝拉', 'Jonathan': '乔纳森',
  'Tiana': '蒂安娜', 'Haley': '海莉',
  'Janice': '珍妮丝', 'Vivi': '薇薇',
  'Sally': '萨莉', 'Robin': '罗宾',
  'Andrea': '安德莉亚', 'Crissy': '克莉丝',
  'Rick': '瑞克', 'Lyle': '莱尔',
  'Jose': '何塞', 'Doug': '道格',
  'Greg': '格雷格', 'Kent': '肯特',
  'James': '詹姆斯', 'Brice': '布莱斯',
  'Trent': '特伦特', 'Lenny': '伦尼',
  'Lucas': '卢卡斯', 'Alan': '艾伦',
  'Clark': '克拉克', 'Eric': '埃里克',
  'Mike': '迈克',
};

// Pokemon names (official Chinese)
const pokemonNames = {
  'Shellder': '大舌贝', 'Cloyster': '刺壳贝',
  'Abra': '凯西', 'Kadabra': '勇基拉',
  'Alakazam': '胡地', 'Machop': '腕力',
  'Machoke': '豪力', 'Machamp': '怪力',
  'Geodude': '小拳石', 'Graveler': '隆隆石',
  'Golem': '隆隆岩', 'Onix': '大岩蛇',
  'Drowzee': '催眠貘', 'Hypno': '引梦貘人',
  'Krabby': '大钳蟹', 'Kingler': '巨钳蟹',
  'Voltorb': '霹雳电球', 'Electrode': '顽皮雷弹',
  'Exeggcute': '蛋蛋', 'Exeggutor': '椰蛋树',
  'Cubone': '卡拉卡拉', 'Marowak': '嘎啦嘎啦',
  'Hitmonlee': '飞腿郎', 'Hitmonchan': '快拳郎',
  'Lickitung': '大舌头', 'Koffing': '瓦斯弹',
  'Weezing': '双弹瓦斯', 'Rhyhorn': '独角犀牛',
  'Rhydon': '钻角犀兽', 'Chansey': '吉利蛋',
  'Tangela': '蔓藤怪', 'Kangaskhan': '袋兽',
  'Horsea': '墨海马', 'Seadra': '海刺龙',
  'Goldeen': '角金鱼', 'Seaking': '金鱼王',
  'Staryu': '海星星', 'Starmie': '宝石海星',
  'Mr. Mime': '催眠魔', 'Scyther': '飞天螳螂',
  'Jynx': '迷唇姐', 'Electabuzz': '电击兽',
  'Magmar': '鸭嘴火兽', 'Pinsir': '凯罗斯',
  'Tauros': '肯泰罗', 'Magikarp': '鲤鱼王',
  'Gyarados': '暴鲤龙', 'Lapras': '拉普拉斯',
  'Ditto': '百变怪', 'Eevee': '伊布',
  'Vaporeon': '水伊布', 'Jolteon': '雷伊布',
  'Flareon': '火伊布', 'Porygon': '多边兽',
  'Omanyte': '菊石兽', 'Omastar': '多刺菊石兽',
  'Kabuto': '化石盔', 'Kabutops': '镰刀盔',
  'Aerodactyl': '化石翼龙', 'Snorlax': '卡比兽',
  'Articuno': '急冻鸟', 'Zapdos': '闪电鸟',
  'Moltres': '火焰鸟', 'Dratini': '迷你龙',
  'Dragonair': '哈克龙', 'Dragonite': '快龙',
  'Mewtwo': '超梦', 'Mew': '梦幻',
  'Chikorita': '菊草叶', 'Bayleef': '月桂叶',
  'Meganium': '大竺葵', 'Cyndaquil': '火球鼠',
  'Quilava': '火岩鼠', 'Typhlosion': '火暴兽',
  'Totodile': '小锯鳄', 'Croconaw': '蓝鳄',
  'Feraligatr': '大力鳄', 'Sentret': '尾立',
  'Furret': '大尾立', 'Hoothoot': '咕咕',
  'Noctowl': '猫头夜鹰', 'Ledyba': '圆翅萤',
  'Ledian': '安瓢虫', 'Spinarak': '圆丝蛛',
  'Ariados': '阿利多斯', 'Crobat': '叉字蝠',
  'Chinchou': '灯笼鱼', 'Lanturn': '电灯怪',
  'Pichu': '皮丘', 'Cleffa': '皮宝宝',
  'Igglybuff': '宝宝丁', 'Togepi': '波克比',
  'Togetic': '波克基古', 'Natu': '天然雀',
  'Xatu': '天然鸟', 'Mareep': '咩利羊',
  'Flaaffy': '绵绵', 'Ampharos': '电龙',
  'Bellossom': '美丽花', 'Marill': '玛力露',
  'Azumarill': '玛力露丽', 'Sudowoodo': '树才怪',
  'Politoed': '蚊香蛙皇', 'Hoppip': '毽子草',
  'Skiploom': '毽子花', 'Jumpluff': '毽子棉',
  'Aipom': '长尾怪手', 'Sunkern': '向日种子',
  'Sunflora': '向日花怪', 'Yanma': '蜻蜻蜓',
  'Wooper': '乌波', 'Quagsire': '沼王',
  'Espeon': '太阳伊布', 'Umbreon': '月亮伊布',
  'Murkrow': '黑暗鸦', 'Slowking': '呆呆王',
  'Misdreavus': '梦妖', 'Unown': '未知图腾',
  'Wobbuffet': '果然翁', 'Girafarig': '麒麟奇',
  'Pineco': '榛果球', 'Forretress': '佛烈托斯',
  'Dunsparce': '土龙弟弟', 'Gligar': '天蝎',
  'Steelix': '大钢蛇', 'Snubbull': '布鲁',
  'Granbull': '布鲁皇', 'Qwilfish': '千针鱼',
  'Scizor': '巨钳螳螂', 'Shuckle': '壶壶',
  'Heracross': '赫拉克罗斯', 'Sneasel': '狃拉',
  'Teddiursa': '熊宝宝', 'Ursaring': '圈圈熊',
  'Slugma': '熔岩虫', 'Magcargo': '熔岩蜗牛',
  'Swinub': '小山猪', 'Piloswine': '长毛猪',
  'Corsola': '太阳珊瑚', 'Remoraid': '铁炮鱼',
  'Octillery': '章鱼桶', 'Delibird': '信使鸟',
  'Mantine': '乘龙', 'Skarmory': '盔甲鸟',
  'Houndour': '戴鲁比', 'Houndoom': '黑鲁加',
  'Kingdra': '刺龙王', 'Phanpy': '小小象',
  'Donphan': '顿甲', 'Porygon2': '多边兽II',
  'Stantler': '惊角鹿', 'Smeargle': '图图犬',
  'Tyrogue': '无畏小子', 'Hitmontop': '战舞郎',
  'Smoochum': '迷唇娃', 'Elekid': '电击怪',
  'Magby': '鸭嘴宝宝', 'Miltank': '大奶罐',
  'Blissey': '幸福蛋', 'Raikou': '雷公',
  'Entei': '炎帝', 'Suicune': '水君',
  'Larvitar': '幼基拉斯', 'Pupitar': '沙基拉斯',
  'Tyranitar': '班基拉斯', 'Lugia': '洛奇亚',
  'Ho-Oh': '凤王', 'Celebi': '时拉比',
  'Treecko': '木守宫', 'Grovyle': '森林蜥蜴',
  'Sceptile': '蜥蜴王', 'Torchic': '火稚鸡',
  'Combusken': '力壮鸡', 'Blaziken': '火焰鸡',
  'Mudkip': '水跃鱼', 'Marshtomp': '沼跃鱼',
  'Swampert': '巨沼怪', 'Poochyena': '土狼犬',
  'Mightyena': '大土狼犬', 'Zigzagoon': '蛇纹熊',
  'Linoone': '直冲熊', 'Wurmple': '刺尾虫',
  'Silcoon': '甲壳茧', 'Beautifly': '狩猎凤蝶',
  'Cascoon': '盾甲茧', 'Dustox': '毒粉蝶',
  'Lotad': '莲叶童子', 'Lombre': '莲帽小童',
  'Ludicolo': '乐天河童', 'Seedot': '橡实果',
  'Nuzleaf': '长鼻叶', 'Shiftry': '斗笠怪',
  'Taillow': '傲骨燕', 'Swellow': '大王燕',
  'Wingull': '长翅鸥', 'Pelipper': '大嘴鸥',
  'Ralts': '拉鲁拉丝', 'Kirlia': '奇鲁莉安',
  'Gardevoir': '沙奈朵', 'Surskit': '溜溜糖球',
  'Masquerain': '雨翅蛾', 'Shroomish': '蘑蘑菇',
  'Breloom': '斗笠菇', 'Slakoth': '懒人獭',
  'Vigoroth': '过动猿', 'Slaking': '请假王',
  'Nincada': '土居忍士', 'Ninjask': '铁面忍者',
  'Shedinja': '脱壳忍者', 'Whismur': '咕噜妞',
  'Loudred': '吼鲸王', 'Exploud': '爆音怪',
  'Makuhita': '幕下力士', 'Hariyama': '超力王',
  'Azurill': '露力丽', 'Nosepass': '朝北鼻',
  'Skitty': '向尾喵', 'Delcatty': '优雅猫',
  'Sableye': '勾魂眼', 'Mawile': '大嘴娃',
  'Aron': '可可多拉', 'Lairon': '可多拉',
  'Aggron': '波士可多拉', 'Meditite': '玛沙那',
  'Medicham': '恰雷姆', 'Electrike': '落雷兽',
  'Manectric': '雷电兽', 'Plusle': '正电拍拍',
  'Minun': '负电拍拍', 'Volbeat': '电萤虫',
  'Illumise': '甜甜萤', 'Roselia': '毒蔷薇',
  'Gulpin': '溶食兽', 'Swalot': '吞食兽',
  'Carvanha': '利牙鱼', 'Sharpedo': '巨牙鲨',
  'Wailmer': '吼吼鲸', 'Wailord': '吼鲸王',
  'Numel': '呆火驼', 'Camerupt': '喷火驼',
  'Torkoal': '煤炭龟', 'Spoink': '跳跳猪',
  'Grumpig': '噗噗猪', 'Spinda': '晃晃斑',
  'Trapinch': '大颚蚁', 'Vibrava': '超音波幼虫',
  'Flygon': '沙漠蜻蜓', 'Cacnea': '刺球仙人掌',
  'Cacturne': '仙人掌怪', 'Swablu': '青绵鸟',
  'Altaria': '七夕青鸟', 'Zangoose': '猫鼬斩',
  'Seviper': '饭匙蛇', 'Lunatone': '月石',
  'Solrock': '太阳岩', 'Barboach': '泥泥鳅',
  'Whiscash': '鲶鱼王', 'Corphish': '铁螯龙虾',
  'Crawdaunt': '铁臂枪虾', 'Baltoy': '天秤偶',
  'Claydol': '念力土偶', 'Lileep': '触手百合',
  'Cradily': '摇篮百合', 'Anorith': '太古羽虫',
  'Armaldo': '太古盔甲', 'Feebas': '丑丑鱼',
  'Milotic': '美纳斯', 'Castform': '漂浮泡泡',
  'Kecleon': '变隐龙', 'Shuppet': '怨影娃娃',
  'Banette': '诅咒娃娃', 'Duskull': '夜巡灵',
  'Dusclops': '彷徨夜灵', 'Tropius': '热带龙',
  'Chimecho': '风铃铃', 'Absol': '阿勃梭鲁',
  'Wynaut': '小果然翁', 'Snorunt': '雪童子',
  'Glalie': '冰鬼护', 'Spheal': '海豹球',
  'Sealeo': '海魔狮', 'Walrein': '帝牙海狮',
  'Clamperl': '心鳞宝', 'Huntail': '猎斑鱼',
  'Gorebyss': '樱花鱼', 'Relicanth': '古空棘鱼',
  'Luvdisc': '爱心鱼', 'Bagon': '宝贝龙',
  'Shelgon': '甲壳龙', 'Salamence': '暴飞龙',
  'Beldum': '铁哑铃', 'Metang': '金属怪',
  'Metagross': '巨金怪', 'Regirock': '雷吉洛克',
  'Regice': '雷吉艾斯', 'Registeel': '雷吉斯奇鲁',
  'Latias': '拉帝亚斯', 'Latios': '拉帝欧斯',
  'Kyogre': '盖欧卡', 'Groudon': '固拉多',
  'Rayquaza': '烈空坐', 'Jirachi': '基拉祈',
  'Deoxys': '代欧奇希斯',
};

// Special long strings (with placeholders)
const longStrings = {
  'The Berry Program on your Pokémon{{C0}}Ruby/Sapphire Game Pak will be updated.{{C1}}{{C2}}':
    '你的宝可梦{{C0}}红宝石/蓝宝石游戏卡的树果程序将被更新。{{C1}}{{C2}}',
  'Please ensure the connection of your{{C0}}Game Boy Advance system matches this.{{C1}}{{C2}}':
    '请确保你的{{C0}}GBA掌机连接方式与此匹配。{{C1}}{{C2}}',
  'Please turn on the power of Pokémon{{C0}}Ruby/Sapphire while holding START and{{C1}}SELECT.{{C2}}{{C3}}':
    '请按住START和{{C1}}SELECT键，然后开启宝可梦{{C0}}红宝石/蓝宝石的电源。{{C2}}{{C3}}',
  'Transmitting. Please wait.{{C0}}{{C1}}{{C2}}Please do not turn off the power or{{C3}}unplug the link cable.{{C4}}':
    '传输中，请稍候。{{C0}}{{C1}}{{C2}}请勿关闭电源或{{C3}}拔出连接线。{{C4}}',
  'Please follow the instructions on your{{C0}}Pokémon Ruby/Sapphire screen.':
    '请按照你的宝可梦{{C0}}红宝石/蓝宝石画面上的指示操作。',
  'Transmission failure.{{C0}}{{C1}}{{C2}}Please try again.':
    '传输失败。{{C0}}{{C1}}{{C2}}请重试。',
};

// ========== TRANSLATE ==========
function translateBatch(batchNum) {
  const bn = String(batchNum).padStart(3, '0');
  const batchFile = path.join(__dirname, 'batch-' + bn + '.json');
  const tasks = JSON.parse(fs.readFileSync(batchFile, 'utf8')).tasks;
  const results = [];

  for (const t of tasks) {
    const en = t.en;
    let zh = en; // default: keep as-is

    // 1. Exact match in long strings (with placeholders)
    if (longStrings[en]) { zh = longStrings[en]; }

    // 2. Exact match in credit roles
    else if (creditRoles[en]) { zh = creditRoles[en]; }

    // 3. Exact match in trainer names
    else if (trainerNames[en]) { zh = trainerNames[en]; }

    // 4. Exact match in Pokemon names
    else if (pokemonNames[en]) { zh = pokemonNames[en]; }

    // 5. Check glossary
    else if (t.glossary && t.glossary.length > 0) {
      zh = en;
      for (const [src, tgt] of t.glossary) {
        const re = new RegExp(src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
        zh = zh.replace(re, tgt);
      }
    }

    // 6. Person names in credits (English romanized Japanese names): keep as-is
    //    (detected by: no known role/trainer/pokemon match, short string, no placeholders)
    // This is the default path — keep as-is

    results.push({ id: t.id, zh });
  }

  return results;
}

// ========== EXECUTE ==========
for (const bn of [96, 97, 98]) {
  const res = translateBatch(bn);
  const bnStr = String(bn).padStart(3, '0');
  const outFile = path.join(__dirname, '..', 'out/batch-' + bnStr + '.json');
  fs.writeFileSync(outFile, JSON.stringify(res, null, 1));

  // Self-check
  const tasks = JSON.parse(fs.readFileSync(path.join(__dirname, 'batch-' + bnStr + '.json'), 'utf8')).tasks;
  const countMatch = res.length === tasks.length;
  const phCheck = res.every((r, i) => {
    const enPh = (tasks[i].en.match(/\{\{C\d+\}\}/g) || []).length;
    const zhPh = (r.zh.match(/\{\{C\d+\}\}/g) || []).length;
    return enPh === zhPh;
  });
  console.log('batch-' + bnStr + ': ' + res.length + '条 | count=' + countMatch + ' ph=' + phCheck);
}
