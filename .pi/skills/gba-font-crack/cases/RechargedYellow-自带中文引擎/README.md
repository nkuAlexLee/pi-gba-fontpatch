# Recharged Yellow v1.9.4 — 自带中文引擎发现实录（2026-09）

## 结论速览

**该改版（BPRE 头，32MB）自带完整中文渲染引擎与字库，无需注入任何代码或字形。**
编码与 `fonts/wholewords.txt` 完全一致，直接按码表写双字节字符串即可上屏。
✅ 已验证：主菜单"新的游戏/选项"上屏（截图像素校验）+ 光标重绘/Option 子界面/进游戏全回归通过。

- 成品：`testfiles/Recharged Yellow v1.9.4_中文字库.gba`（仅菜单两串改动，diff 16 字节 @0x8F3350-0x8F336E）
- 复现：`node .pi/skills/gba-font-crack/scripts/patch-ry-chs.js <in.gba> <out.gba>`（成品已验证逐字节一致）
- **本次最大教训：接到新 ROM 先怀疑"引擎已自带中文"**——本案例一开始按"引擎被改、需重定位 hook"路线走了很久，
  实际上现代中文系改版（本 ROM 疑似中文团队出品，引擎为 Emerald 家族双字节增强版）字库引擎是标配。

## 侦察

- ROM 头：`POKEMON FIRE` / BPRE / 32MB 扩容 → FireRed 美版基板（头衔屏作者 KOFELECOM/AIZY2U）
- **布局判定：非原版 FRLG**。stock 地址（pokeFRLG/pokefirered.sym 的 RenderText=0x08005790 等）
  处的字节完全不同（0x08005790 处是 ARM 代码，而 FRLG 引擎是 Thumb）→ 全 ROM 重编译布局，
  符号表与 pokeFRLG 补丁地址一律不可用
- "New Game" 字符串 @文件 0x8F3350（charmap 同 RS/FRLG：A=0xBB…N=0xC8，小写 a=0xD5…），指针表 @0x8F354C

## 定位过程（watch-read 法，本案例新武器）

1. 静态反查失败：字符串指针的代码引用全是字面量池假阳性；RAM 中搜不到字符串拷贝（引擎直接读 ROM 串）
2. **`scripts/watch-read.js`（本案例新增工具）：监视指定内存区间的读取并记录读取者 PC**
   - 原理：包装 `gba.mmu.loadU8/U16/…`，命中区间时记 `(pc, addr, lr, sp)`
   - 前置：`tmp/romctl.state.json` 停在静态画面；按键触发重绘（本例 Option→B 返回主菜单）
   - 结果：0x088F3350("New Game") 被 **0x081BA852/0x081BA85E** 读取
3. 反汇编 0x081BA84E：经典 RenderText 字符读取模式（`ldr r1,[r4]; ldrb r0,[r1]; add/str; ldrb r6,[r1,#1]` 窥视下一字节
   + `(currChar+8)&0xFF≤7` 控制码分发 + `mov pc,r3` 跳表）→ 与 EliteRedux 2.65.1 引擎同款 → Emerald 家族双字节增强引擎

## 引擎逆向结论（静态 + 动态双重实证）

| 组件 | 地址 | 说明 |
|------|------|------|
| RenderText 字符分发 | 0x081BA84E | r4=窗口，r1=[r4] currChar 指针，r6=下一字节（双字节窥视） |
| 首字节检测 | 0x080B1010 | 判断 currChar 是否双字节引导字节 |
| DecompressGlyphTile | 0x080B1088 | 参数 (charId:16, fontId)；fontId==6→Braille 分支 |
| sGlyphBuffer | 0x03005E24 | 解压目标缓冲，expand@0x080B1154 四次调 0x081B9D50 |

**双字节路径**（charId≥0x100）：
- 修正：hi≤0x06→-1；0x07≤hi≤0x1B→-2；hi>0x1B→-3
- charId = ((hi-修正)<<8) | lo；字形槽 = charId×64
- 字库（2bpp，64B/字 = 4×8×8 tile 两层，与 Emerald 系格式同源）：
  - fontId&~8==0（主字体）→ **0x086365E0**
  - 其他（小字体）→ **0x086A51E0**（间距 0x6EC00 = 7080 字容量）
- 单字节路径字库：主 0x0889B5C0 / 小 0x088B3BC0
- 中文标点：charId 0x30 及 0x36-0x3F（≠0x38）走主字库低位槽

**编码 = wholewords.txt**：渲染实证 新=0E4D 的=030B 游=0F7C 戏=0DDB 选=0E8A 项=0E1B 全部正确上屏。

## 验证（NEW GAME 范式）

1. 改串：0x8F3350 `New Game`→`0E4D030B0F7C0DDBFF`（新的游戏，等长 9B）；
   0x8F3368 `Option`→`0E8A0E1BFF000000`（选项，缩短填充）
2. 时序：load → run 3600 → START(60f) → run 300 → 菜单
3. 截图 + bmp-ascii 像素校验：四字字形与预期一致
4. 回归：DOWN 光标移动重绘 ✅；A 进 Option 子界面英文正常 ✅；A 进游戏（该改版有
   "Select Difficulty/Built-in Modes"自定义菜单）运行正常 ✅

## 复现步骤

```bash
cd gbajs2
node .pi/skills/gba-font-crack/scripts/patch-ry-chs.js "../testfiles/Recharged Yellow v1.9.4.gba" tmp/RY_repro.gba
node romctl.js load tmp/RY_repro.gba
node romctl.js run 3600 && node romctl.js key START 60 && node romctl.js run 300
node romctl.js screenshot tmp/verify.bmp   # 应见"新的游戏/选项"
```

## 归档内容

| 文件 | 说明 |
|------|------|
| `scripts/patch-ry-chs.js` | 补丁脚本（工作副本在 `.pi/skills/gba-font-crack/scripts/`，此处为归档快照） |

## 已知问题 / 后续

- 全部文本翻译 = 找到 ROM 内字符串后按 wholewords 码表等长/缩短改写即可（缩短用 FF 截断 + 00 填充）
- 变长字库（7080 字容量 vs 码表 6768 字）：若码表缺字，可直接往 0x086365E0 数组空槽写新字形
  （格式同 Emerald 系 64B/字，先黑盒探针确认 tile 内像素序）
- 未验证：战斗字体/小字体路径（0x086A51E0）的实机表现；字符串长度影响布局的场景（宽度函数未逆向，
  但引擎按 charId 索引宽度，双字节字宽度由宽度表决定，改中文串后若换行异常需查宽度逻辑）
