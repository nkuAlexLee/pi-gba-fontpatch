# Elite Redux 2.65.1 正向分析实录（v3→v5，"新游戏" 上屏全记录）

> ⚠ **路线沿革**：本案例记录的是 v6 槽位注入（3 字上限，仅字库格式验证用）。
> 正式整库汉化已升级为 **v7 整库插入+ESC 渲染 hook**（gba-font-crack SKILL.md
> EliteRedux 节 + gbajs2/translation-er 工程 + ../gba-text-translate 案例
> EliteRedux-ESC编码整桶翻译）。本案例的字形格式/引擎分析结论仍然有效。

> 本文是 `SKILL.md` 主范式的实战样本：全程正向分析，不依赖现成补丁。
> 成品：`testfiles/Pokémon Elite Redux (2.65.1 beta reupload)_新游戏字库.gba`
> 可复现脚本：`fontpatch/patch-elite-redux-2651.js`

## 0. 任务与最终技术路线

- 输入：`Pokémon Elite Redux (2.65.1 beta reupload).gba`（BPEE，32MB，decomp 重编译改版）
- 目标：主菜单 "New Game" → 中文
- 最终路线：**方案 B 字体数组槽位注入**（零 hook，100% 原生渲染路径）
  - 空槽 0x0A/0x18/0x1F 写入"新/游/戏"字形（引擎原生 64B 四-tile 2bpp 格式）
  - 宽度表写 12（中文占两个英文字符位 = 2×6px）
  - 字符串 0xEFB11C 改为 `0A 18 1F FF`
- 关键参数（v6 最终）：H_OFF=1（水平偏移），V_OFF=2（垂直居中），右下阴影
  （v5 为 V_OFF=3 偏下，v6 上移 1px）

## 1. 为什么必须正向分析：第三方补丁的三重根因

先试了现成 PokemonER 补丁（beta2 版地址直接汇编"成功"），结果乱码/崩溃。
正向分析证明它在本引擎上**原理性不可行**，修地址也没用：

1. **失败路径返回点错误**：hook 覆盖 RenderText+0x88..+0x8F（4 条指令），
   但返回点设为 +0x9A —— 落在控制码跳转表分发内部（`lsl r3,#2; ldr r3,[r6,r3]; mov pc,r3`），
   跳过了 +0x90..+0x98（r5 加载 + 控制码判断 + 正常分支）。
   任何普通字符（如 'N'，(0xC8+8)&0xFF=0xD0>7）都以错误索引进跳转表 → 必崩。
2. **成功路径没有消费者**：+0x23E 不是 "CopyGlyphToWindow 之后"，而是
   **fontid 二级分发入口**；补丁把字形写入 gCurGlyph=0x030064EC，但该地址全 ROM
   合法（4 字节对齐的 pool 字面量）引用为零 → 字形永远不会上屏。
   真正的工作缓冲是 **0x03005600**（0x08257FFC 的 pool 字面量）。
3. **hook 字节不可移植**：beta2 与 2.65.1 文本函数整体平移 -0x532C 且 pool 不同。

**教训：拿到第三方补丁，先正向验证它的每一个假设（hook 位置、返回点、数据流向），
再决定是移植还是重做。** 三天盲改不如两小时正向梳理。

## 2. 定位文本引擎（静态签名 + 动态 hook 互证）

- 静态：在 2.65.1 中搜索 beta2 已知函数签名（`f0b5 ce46 4746 80b5` 等），
  RenderText/GetStringWidth/DecompressGlyphTile 三函数恰好整体平移 **-0x532C**：
  RenderText=0x08257010、GetStringWidth=0x082576E4、DecompressGlyphTile=0x08256CB0
- ⚠ 签名（`f0 b5 ce 46 ...` = push 序列）全 ROM 命中 100+ 处，不能只信静态；
  用动态 hook 互证。
- 动态：hook 分发点 0x082571EE / 0x082571FE，跑菜单按方向键，读
  `tmp/hook-events.jsonl`（含 r0-r3）：
  - r2=0x0901C2AC（**fontId→handler 指针表**，不是"表基址"！）
  - r3=0x082572FA（=指针表[1] → fontid=1 的内联 handler，就在 RenderText 体内）
  - r0 序列 = c8 d9 eb 00 c1 d5 e1 d9 = "New Game" ✓
- **教训：pool 字面量加载的是"指针值"；`ldr r2,=X` 后 `ldr r3,[r2,r3*4]` 的 X 是
  指针表的地址。静态把它当成"跳转表基址"导致长期误读。**

## 3. 正向梳理 RenderText 控制流（hook 设计的依据）

```
+0x80 ldr r6,=0x08257380          ; 控制码跳转表（0xF8-0xFF 共 8 项）
+0x82 ldr r1,[r4]                 ; r1 = currentChar 指针
+0x84 ldrb r0,[r1]                ; r0 = currChar
+0x86 adds r3,r1,#1
+0x88 str r3,[r4]                 ← 覆盖起点（4 条指令 8 字节）
+0x8A lsl r3,r0,#0
+0x8C adds r3,#8
+0x8E lsls r3,r3,#24
+0x90 ldrb r5,[r1,#1]             ; r5 = nextChar
+0x92 lsrs r3,r3,#24              ; r3 = (currChar+8)&0xFF
+0x94 cmp r3,#7
+0x96 bls +0xAA                   ; 0xF8-0xFF → 控制码跳转表
+0x98 b   +0x23E                  ; 普通字符 → fontid 分发
+0x9A lsl r3,r3,#2 ; ldr r3,[r6,r3] ; mov pc,r3   ← 跳转表分发（勿落入！）
```

fontid 分发（0x082571EE）：
```
ldrb r3,[r4,#20] ; lsl/lsr #28（取低 4 位）; cmp #8; bhi 跳过
ldr r2,=0x0901C2AC ; ldr r3,[r2,fontid*4] ; mov pc,r3
```
指针表 0x0901C2AC：fontid 1 → 0x082572FA（FONT_NORMAL 内联处理器）。

FONT_NORMAL 处理器（0x082572FA）：
```
mov r3,#0x21 ; ldrb r1,[r4,r3]   ; 字体变体标志（菜单=0）
bl  0x08257FFC                    ; 真正的字形解压 (r0=currChar, r1=标志)
b   0x0825728C                    ; 公共后继（把 0x03005600 内容拷入窗口）
```

## 4. 字形管线与格式（全部经探针实证）

`0x08257FFC(currChar, variant)`：
- glyphAddr = **0x09067D18 + currChar×64**（直接按 charmap 码索引！pool@0x08258094）
- width = 宽度表[currChar]，宽度表 @0x0906FD18（pool@0x08258098）
- 宽>8 → 4 次 `bl 0x082562A8(src=glyph+k*0x10, dst=0x03005600+k*0x20)`（k=0..3）
- 宽≤8 → 2 次（只写左半，右半 tile 保持 0）
- 宽度写 [0x03005600+0x80]

`0x082562A8`：每行 u16 → 8 像素 4bpp u32。
两级 LUT：`LUT4`（ROM 0x090191E0，byte→idx）+ `LUT3`（**IWRAM 0x03005550**，idx*2→u16）。
u32 = (M[hi]<<16) | M[lo]，像素 = nibble（LSN first，标准 GBA 4bpp tile 序）。

**探针字形实证法**（绕开对 LUT 的理论分析）：
1. 空槽 0x0A 写入全值行 `[0x0000,0x5555,0xAAAA,0xFFFF,0x6C6C,0x6C6C,0x0000,0xFFFF]`×4 tile
2. 宽度表 0x0A=12（触发 4-tile 宽路径），菜单串 'N'(0xC8)→0x0A
3. 跑到菜单，读 0x03005600：0x5555 行展开为 BBBB、0xAAAA→CCCC、0xFFFF→AAAA、
   0x6C6C→AACBAACB
4. 结论：**2bpp 值 0/3=透明(A) 1=前景(B) 2=阴影(C)；u32=(M[hi]<<16)|M[lo]；
   像素序=标准 4bpp nibble LSN first；源字节内 pair 序 = MSB first（px0=bits7:6）**
5. 用 48 种（24 源位序 × 2 输出序 × 2 半字装配）穷举验证一致性，唯一解与上述吻合

拉丁 'N' 字形（0xC8）解码验证 + 阴影规律：**shadow = (r+1, c+1)**（右下）。

## 5. 注入实现与四个 bug

- **空槽扫描**：码 0x0A/0x18/0x1F（64B 全零 + 宽度 0）。
  ⚠ 0xF8-0xFF 是控制码不能用；0x00 是空格不能动；码表序即 GB 序
- **bug 1**：16 像素塞进一个 u16。tile 只有 8 像素宽，左右半分属两个 tile。
  （探针全用均匀行，掩盖了此 bug —— 探针要包含非对称行才能暴露此类错误）
- **bug 2**：`packTileRow` 移位 `<<1` 应为 `<<2`（每像素 2 位）。
  **自编码→自解码→与源字模逐像素比对**的自检回路是发现这两个 bug 的关键
- **bug 3（右侧缺笔画）**：11px 内容放 col 2-12，步进 12px → col 12 被后一字形覆盖。
  H_OFF 改 1（内容 col 1-11）。⚠ 排查时注意菜单文字实际起点 x=16，不是 13
- **bug 4（风格不一致，"差一点"）**：拉丁字形自带右下阴影，中文无阴影显得单薄。
  加 shadow=(r+1,c+1) + V_OFF=2 垂直居中 → v5/v6（v6=最终）

## 6. 绿宝石字库.bin 部分发现（备用路线，未完成）

- 972672B = 0xED780；**记录格式与引擎字形格式完全相同**（64B 四-tile 2bpp）
- 记录顺序：gid0 = 阿(0x0100) 符合线性公式 (hi-1)*0xF7+lo，
  但 新(0x0E4D) 在 3222 ≠ 公式 3041 → 高区顺序疑似按码表条目顺序而非线性公式，
  **整库插入前必须先解决索引映射**（可用锚字扫描法：一/口/新 等特征字）
- 整库插入参考 `gui_related/font_patch.py`：扩容区找 ≥0xED788 的 FF 空区，
  基址须整八字节对齐，基址 + 基址+0x80000 双指针（大/小字库），宽度表改 0x0C
- 若走整库路线需自写 hook（参考本文第 3-4 节：hook +0x88、失败路径回 +0x90 并
  重建 r3=(currChar+8)<<24、成功路径调 0x082562A8 四次写 0x03005600 + 宽度、
  跳 0x0825728C）

## 7. 工具 bug 与验证方法

- `js/thumb-disassembler.js` Format 1 用 `hw>>13` 判断 LSL/LSR/ASR，
  但 LSR 编码 00001 的高 3 位也是 000 → **LSR 恒显示为 LSL**（已修复：改用 op 位段）
- 条件分支目标公式 `addr+4+off*2` 是对的 —— 曾误判为 off-by-2，实为手算错误。
  **工具输出与人工解码冲突时，先怀疑自己，逐位重推编码，再改工具**
- romctl `hook events` 控制台只显示 r0/r1，**完整 r0-r3 在 `tmp/hook-events.jsonl`**

## 归档内容

| 文件 | 说明 |
|------|------|
| `scripts/patch-elite-redux-2651.js` | v6 槽位注入脚本（工作副本在 `gbajs2/fontpatch/` 与 skill `scripts/`，此处为归档快照） |

## 8. 命令序列（可复现）

```bash
cd gbajs2
node fontpatch/patch-elite-redux-2651.js   # 生成补丁 ROM
node romctl.js load tmp/EliteRedux_chs_v6.gba
node romctl.js run 3600 && node romctl.js run 1500
node romctl.js key START 60 && node romctl.js run 600
node romctl.js screenshot tmp/menu.bmp     # 应显示 新游戏
node romctl.js key DOWN 30 && node romctl.js run 120   # 回归：切换选中项
```
