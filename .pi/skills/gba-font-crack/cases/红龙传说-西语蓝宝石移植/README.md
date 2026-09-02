# 红龙传说（西语蓝宝石改版）字库移植实录

> 2025-09 完成。目标：给 `testfiles/宝可梦红龙传说.gba`（AXPE 头蓝宝石改版）打上中文字库。
> 成品：`testfiles/宝可梦红龙传说_字库.gba`，主菜单 "新的游戏" 上屏验证通过。

## 一、结论速览

| 项目 | 结论 |
|------|------|
| 基板 | AXPE 头 / POKEMON SAPP / lang='E'，**实为非美版布局的蓝宝石改版**（菜单文本为西语 PARTIDA NUEVA） |
| 代码布局 | 与 `pokesapphire_de.sym`（德语版）完全一致；**各区域平移量不同**（文本区 +0x134、战斗区 +0x324），禁止全局偏移，逐函数重映射 |
| 引擎 | 与 pokeRS（Pokemon_GBA_Font_Patch/pokeRS）同一套 RS 文本引擎，GetGlyphWidth/GetStringWidth/DrawGlyphTiles 结构原样 |
| 方案 | pokeRS 三函数移植（方案 C 变体：仅重映射地址，逻辑零修改） |
| 字库 | pokeRS 自带 PokeRSFontChsNormal/Small（16×16 4bpp，128B/字，0xE0000=7168 槽），放 0x09200000/0x09300000 |

## 二、侦察与基板判定

1. ROM 头：AXPE + POKEMON SAPP + lang byte 0x45('E') → 表面是美版蓝宝石 v1.0，32MB 扩容。
2. **美版地址证伪**：US 的 GetGlyphWidth @0x080048E8 处反汇编得到的是别的函数结尾（pop/bx），引擎必然平移。
3. ASCII 搜 "NEW GAME" 无果（宝可梦用自家 charmap），用 pokeRS charmap.txt 解码才搜索有效。
4. 菜单截图显示 "PARTIDA NUEVA / OPCIONES" → 西语文本。charmap 搜索 PARTIDA @文件 0x41109C（US gMainMenuString_NewGame 0x0840DD2C + 0x3370，数据区平移与代码平移不同）。
5. GBATK 工具箱 rawfile 里的 "红龙传说(字库).gba" 与原版 md5 相同——所谓字库版没打补丁，无捷径。

## 三、引擎定位（指针追踪 → 动态 trace）

静态搜签名失败（没有美版 ROM 做字节参照），改走**数据流 + 动态 trace**：

1. 搜指向菜单串的 32 位指针 → 命中 0x9E28-0x9F00 的字面量池（改版自定义菜单代码区）。
2. 反汇编 0x08009E34：`bl 0x08072324`（wrapper）→ `bl 0x080653D8`（文本打印入口，窗口指针从 [0x0202C8E8] 读）。
3. romctl hook 0x080653D8，触发主菜单重绘（从 Options 按 B 返回）确认命中。
4. **trace 法（本案例关键手段，已工具化为 `scripts/trace-after-hook.js`）**：hook 命中后逐指令记录 (pc,r0-r3) 共 8 万步；
   在 trace 里用 r1 字形值序列（P=0xCA,A=0xBB,R=0xCC,T=0xCE...）匹配渲染流：
   - `0x08003A34 → bl 0x08004A1C` = **GetGlyphWidth**（3 次/帧）
   - `0x08003A76 → bl 0x080069A8` = **DrawGlyphTiles**
   - 与 pokesapphire_de.sym 地址完全一致 → 双证据定案。
5. GetStringWidth 自洽验证：0x08004D00+0x100 处 `bl 0x08004A1C`（GetGlyphWidth）+ 循环收尾指令与 pokeRS hook 期望逐字节吻合。

> 经验：**trace + 已知字符序列匹配**是异版本引擎定位的通用大杀器，不依赖任何字节参照 ROM。
> 另：菜单选中项移动不触发重绘（文字只在进菜单时画一次，高亮是调色板切换）——验证 hook 时要
> 用"进 Options 再按 B 返回"强制重绘。

## 四、地址重映射表

```asm
;include/Symbols.s（来源 pokesapphire_de.sym + trace 实证）
GetGlyphWidth                  equ 0x08004A1C   ;US 0x080048E8 +0x134，trace 实证
GetStringWidth                 equ 0x08004D00   ;US 0x08004BCC +0x134，+0x100 处 bl 自洽
DrawGlyphTiles                 equ 0x080069A8   ;US 0x08006874 +0x134，trace 实证
DrawGlyphTile_ShadowedFont     equ 0x080057B4
UpdateTilemap                  equ 0x08006A88
GetCursorTileNum               equ 0x08006B0C
GetExpandedPlaceholder         equ 0x0800712C
gMiscBlank_Gfx                 equ 0x08215940   ;hack 函数区（0x800 空白图形资源）
CpuSet                         equ 0x081ED6EC
sGlyphBuffer                   equ 0x03000360   ;IWRAM 同址（0x030003A4=.colors）
gMainMenuString_NewGame        equ 0x0841109C   ;"PARTIDA NUEVA"
;Phase2（未验证，DE 表尺寸不完全吻合，需逐个核验后再 hook）
UpdateNickInHealthbox          equ 0x080454C4   ;US 0x080451A0 +0x324
UpdateSafariBallsTextInHealthbox equ 0x08045BD4
UpdateLeftNoOfBallsTextOnHealthbox equ 0x08045CBC
GetBattlerPosition             equ 0x08078BEC   ;+0x3C0！又一个不同平移
sub_8097F58                    equ 0x080980A8   ;+0x150
```

关键点：
- **bl 距离限制 ±4MB**：hack 函数放 gMiscBlank_Gfx（0x08215940），与 hook 点距离 ≈0x21 万 OK；
  字库用 `ldr =绝对地址` 访问，可放 0x09200000 任意远。
- **扩容区占用**：改版自己用了 0x09000000-0x09200000（约 1.8MB），pokeRS 默认字库地址撞车，
  后移到 0x09200000（Normal）/0x09300000（Small），0x09200000 之后 14MB 全空。
- gMiscBlank_Gfx 内容是"空白 tilemap 资源"（几乎全 0 + 少量 0x0E20/0x0F20 词），pokeRS 同款方案。

## 五、移植与构建

pokeRS 三函数（GetGlyphWidthChinese / GetStringWidthChinese / DrawGlyphTilesChinese）**逻辑零修改**，
仅通过 Symbols.s 重映射其内部引用。工程 `D:/vibecoding/Pokemon_GBA_Font_Patch-main/pokeRS_redragon/`：

```
main.asm          ; .open baserom.gba → 红龙传说_字库.gba
include/Symbols.s ; 上面那张表
include/hack.s    ; HackFunctionAddresses=gMiscBlank_Gfx; 字库 0x09200000/0x09300000
src/*.s           ; pokeRS 三函数原样拷贝
graphic/fonts/    ; PokeRSFontChsNormal(0xE0000).bin + Small
charmap.txt       ; pokeRS 版（含中文双字节键 0E4D=新 等）
tools/armips/armips.exe
```

hook 写入（与 pokeRS 相同的跳板语义）：
- DrawGlyphTiles+2（4B）：Chinese 入口自带 `sub sp,0x1C` 恰好复刻被覆盖的 `sub sp,#28; add r6,r0` 栈帧
- GetGlyphWidth+2（4B）：origin 路径 `mov r2,r0; mov r3,r1; bx lr` 复刻 `add r2,r0; add r3,r1`
- GetStringWidth+0x100（0x12B）：`push lr; bl Chinese; pop r0; mov lr,r0; b +0x112`

菜单字符串原地等长替换（0x0841109C，14B）：
`PARTIDA NUEVA\0` → `新的游戏` (0E4D 030B 0F7C 0DDB) + FF + 5×A1 补齐，指针表无需改动。

## 六、验证（NEW GAME 范式）

1. load patched ROM → run 3600×2 → key A,START 120 → run 600 → 标题屏 → START → 主菜单
2. 截图：**"新的游戏" 4 个汉字清晰上屏**，"OPCIONES" 西语完好
3. bmp-ascii 像素级：4 字 ×16px 字形笔画完整
4. 回归：方向键切换重绘 ✓、进/出 Options ✓、NEW GAME 流程与原版行为一致（改版自带的精灵展示
   循环，未打补丁同样存在，非补丁引入）✓

## 归档内容

| 文件 | 说明 |
|------|------|
| `scripts/main.asm` | pokeRS_redragon 工程入口（armips，快照自 `D:/vibecoding/Pokemon_GBA_Font_Patch-main/pokeRS_redragon/`） |
| `scripts/Symbols.s` | 非美版地址重映射表（本案例核心成果） |
| `scripts/charmap.txt` | RS 家族 charmap |
| `scripts/pokeRS_redragon-src/*.s` | 中文渲染三函数源码（GetGlyphWidth/GetStringWidth/DrawGlyphTiles Chinese） |
| （外部） | 完整工程（baserom、字库 bin、armips 工具、成品 ROM）在上述外部路径，ROM/大文件不入库 |

## 七、已知问题与边界

- **西语重音字符与中文 hi 字节冲突**：RS charmap 0x01-0x1E 全是欧洲重音字母（Á=0x02、É=0x04、
  Ú=0x12、Ñ=0x14、é=0x1B）。pokeRS 方案按英语设计（只有 é，已被排除），西语文本的
  GetStringWidth 会把 "Á+后一字节" 误判为中文对 → 宽度多算 → 个别词换行（RÁPIDA）。
  **用户确认西语后续全部替换为中文，不修**。若需保西语：改转义前缀方案（如 0xF8 前缀 +
  3 字节/汉字，需改三个 Chinese 函数的判别分支与 textIndex 步进，字库文件不用动）。
- Phase2 未做：战斗 HP 框/狩猎/寄放系统 hook。战斗区平移 +0x324、+0x3C0、+0x150 不统一，
  DE 符号表尺寸不完全吻合（如 US sub_80981F0 size 0xC2 在 DE 无对应），需逐个反汇编核验后再 hook。
- 中文文本控制码避坑照旧：hi 字节避开 0x06/0x1B（pokeRS 修正表已处理），lo ≤ 0xF6。

## 八、复现步骤

```bash
cd D:/vibecoding/Pokemon_GBA_Font_Patch-main/pokeRS_redragon
./tools/armips/armips.exe main.asm        # 产出 红龙传说_字库.gba

# 验证（romctl 时序，逐段执行）
cd D:/vibecoding/gba-font-cracker-js/gbajs2
node romctl.js load "../../Pokemon_GBA_Font_Patch-main/pokeRS_redragon/红龙传说_字库.gba"
node romctl.js run 3600 && node romctl.js run 3600
node romctl.js key A,START 120 && node romctl.js run 600   # 标题屏
node romctl.js key START 120  && node romctl.js run 600    # 主菜单 → 应见"新的游戏"
```
