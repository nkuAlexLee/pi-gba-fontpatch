# Pokemon Emerald XTREME (v100 rev-3) — BPEE 重编译改版槽位注入实录（2026-03）

## 结论速览

- 基板：**BPEE（绿宝石）32MB 扩容，decomp 重编译布局**（与 stock Emerald 第 0 字节起全不同，
  stock/pokeE 地址一律失效）。菜单文字英文。
- 引擎：**Emerald 家族文本引擎的自定义变体**（`RenderText` @`0x08234AC0`，
  取字符 = `ldrb r5,[r2]; add r3,r2,#1; str r3,[r4]`，控制码分发 = `(char+8)&0xFF≤7` →
  0xF8-0xFF 跳表；**无 RY 式双字节汉字路径**，宽度表仅 0x200 项）→ 不支持中文，走**方案 B 槽位注入**。
- 成品：`testfiles/Pokemon Emerald XTREME (v100 rev-3)_中文字库.gba`（改动 405B/3 段，纯数据零 hook）。
- 可复现：`cd gbajs2/fontpatch && node patch-xtreme-chs.js`（自检回路内置）。
- ✅ NEW GAME 范式：主菜单“新的游戏”（选中项）与“选项”（未选中项）截图像素比对 **100% 一致**
  （v5 修正版，含字形放大图人眼确认）；光标重绘 / Option 子界面英文 / 开场白英文全部回归通过。

## 引擎逆向（本案例关键结论）

### fontid 二级分发（window+0x23 低 nibble，14 项）
- 跳表 @`0x08C19570`，每 fontid 一个 handler；**fontid1 = 主字体**（菜单/对话框），
  handler @`0x08234E28`。
- handler 结构：`字形槽 = charId×64`；数组 @**0x08C22508**（fontid1），
  宽度表 @**0x08C22308**（1B/码，仅 0x200 项 = 单字节码空间），
  工作缓冲 **0x030016DC**，颜色字节 wb[0x81]=15，wb[0x80]=宽度。
- 取字符无下一字节窥视 → **charId = 单字节**，槽位范围 0x00-0xFF。

### 字形槽格式（探针实证，与 Quetzal 紧凑格式同源）
- 64B/槽 = `[TL 16B][TR 16B][BL 16B][BR 16B]`，每 tile = 8 行 × u16 LE，
  **每行 2B = 8 像素 × 2bpp，MSB pair first**。
- width≤8（窄路径）：只展开 TL、BL → 8px 宽 × 16 行。
- width>8（宽路径 @0x08235290）：TL→wb0、TR→wb+0x20、BL→wb+0x40、BR→wb+0x60，
  即 wb = [左上][右上][左下][右下]，16×16 全渲染；**渲染像素值 1=深墨、2/3=灰影**
  （XTREME 风格 = 深边浅心；拉丁字形 fill=3 灰 + 边 1 深）。
- 展开器 @`0x08231F28`：16B→32B（8 行×u16 → 8 行×u32），双 LUT 字节重映射
  （LUT 指针 pool@0x08231FE4 → EWRAM 0x02038030，**运行时按文字色重填**，勿抄静态值）。
- 公共后继 @`0x08234D64` → `bl 0x08232AD4`（换行/贴瓦片），wb 消费者 @0x08232438 附近。

### [F8][lo] 转义通道（本案例发现，未采用）
- 0xF8 = 双字节转义：描述符表 = pool@0x08234D9C(→0x08C19628)+0x7C+lo×4，
  条目 `[off(s8,×32B), ?, cnt<<3, ?]`；字形源 = pool@0x08234DA0(→0x08C73508)+off×32；
  每 strip = 主 32B(@+n×32，**预展开** 8 行×4B) + 影 32B(@+0x200+n×32)，width 硬编码 8，
  cnt 次（水平拼接）。原 17 个条目 lo=0x00-0x16 有定义（勿覆盖）。
- 未采用原因：strip 仅 8px 高，汉字放不下；且 fontNum==0 分支共用表（pool 另指但同址）。

## 方案（v4，最终）

- **码位 0x87-0x8C（6 个）**：charmap 未定义 + 字形全零 + 宽度 3 → 安全空槽
  （安全空槽共 25 个：0x87-0x9F；其余 0x2F-0x76 段有游戏文本碰撞风险）。
- 字形：11x11 点阵（`gba_chs_font_11x11.bin`，**11bit/行顺序打包**，16B/字），
  **索引 = (hi修正)×0xF7 + lo**（新=3041 的=505 游=3335 戏=2936 选=3102 项=2991）
  居中（col0-10，row2-12），墨=1、影=右下偏移 1px 值 2；width=12。
- 字符串："NEW GAME"→`87 88 89 8A FF`+填充；"OPTION"→`8B 8C FF`+填充
  （@0xBA9200/0xBA9210，等长缩短 + FF 截断）。

## 踩坑（本案例新增，均已入库 SKILL）

1. **disasm-offline 地址显示 padStart(8,'0')**：`0x08234ac0` 一眼看漏一位抄成
   `0x080234ac0` → 全部 hook 打不中，浪费大量时间。hook 不中先怀疑地址抄写，
   再怀疑机制（对照实验：挂 0x08000000 重启向量）。
2. **romctl hook 按块首 PC 匹配**：函数中部地址可能永不命中（icache 基本块入口才算）；
   跳表目标/函数入口安全。零事件 ≠ 没执行，用 watch-read 双验证。
3. **字形紧凑格式的像素语义必须探针实证**：本引擎 1=深墨 2/3=灰（与 Quetzal 笔记
   "0/3=透明 1=前景 2=阴影" 不同——LUT 运行时重填，同一值不同窗口/路径颜色不同）。
4. **单字节码修正陷阱**：自检发现字形数据写对了但渲染不不变 → 先确认
   charId→槽位映射是恒等（本例实证恒等，r5 直通）。
5. 11x11 字库是 **11bit/行打包**（不是 1B/行 bit7=left），解码错会得到“貌似汉字”的错字形。
6. **★字库索引公式：glyphId = (hi修正)×0xF7 + lo（NOT ×256！）**：×256 定位到别的字
   （新→研），且像素自检仍 100% 通过（编码与比对用同一错误解码，自洽但错）——
   **像素自检不能发现映射错误，必须用外部参照（宋体栅格化比对或放大人眼/图案验证）**。
   正确索引实证：新=3041 的=505 游=3335 戏=2936 选=3102 项=2991（pokeE text.s
   DecompressGlyph_Chinese 权威公式，大字库 16B/字）

## 复现步骤

```bash
cd gbajs2/fontpatch
node patch-xtreme-chs.js "../../testfiles/Pokemon Emerald XTREME (v100 rev-3).gba" "../tmp/XTREME_chs_v4.gba"
cd ..
node romctl.js load tmp/XTREME_chs_v4.gba
node romctl.js run 3600 && node romctl.js run 3500
node romctl.js key START 60 && node romctl.js run 400
node romctl.js screenshot tmp/v4_menu.bmp   # 主菜单应显示"新的游戏/选项"
```

## 归档内容

| 文件 | 说明 |
|------|------|
| `scripts/patch-xtreme-chs.js` | 补丁脚本（双级自检回路；工作副本在 `gbajs2/fontpatch/`，此处为归档快照） |
| `scripts/verify-render.py` | 渲染像素校验（独立可运行：`python verify-render.py <截图.bmp>`，PASS 阈值 95%） |
| `data/diff-segments.json` | 成品 vs 原版逐段 diff（3 段 404B，含 before/after 十六进制） |
| `data/changed-bytes.bin` | 全部改动字节顺序拼接（404B） |
| `artifacts/menu-新的游戏-zoom.png` | 选中项放大证据（6×） |
| `artifacts/menu-选项-zoom.png` | 未选中项放大证据（6×） |
| `artifacts/menu-full.bmp` | 完整菜单截图（verify-render.py 的默认校验输入） |
| `artifacts/regression-option-menu.bmp` | 回归：Option 子界面英文无损 |
| `artifacts/regression-intro.bmp` | 回归：开场白英文无损 |

## 已知问题 / 后续

- 剩余安全空槽 19 个（0x8D-0x9F），可继续扩词；更多字需整库替换路线（换 fontid1 数组
  指针 pool@0x0823513C 或扩容重排）。
- width=12 硬编码在宽度表，可按码位单独调整。
- 战斗字体/小字体（fontid 0/2-5 各自数组）未注入；对话框剧情文本汉化需先扩码位或转双字节 hook。
- OPTION 子界面内部文本（TEXT SPEED 等）未动，全部英文可用原 charmap 改写。
