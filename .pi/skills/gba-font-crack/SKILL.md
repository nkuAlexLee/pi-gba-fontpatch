---
name: gba-font-crack
description: GBA 宝可梦改版 ROM 中文字库破解全流程：正向分析范式（定位引擎→控制流→探针实证）、无头调试（romctl）、字模槽位注入、字符串修改与 NEW GAME 截图像素校验。当需要给 Pokemon 改版 ROM 打中文字库、改菜单文本为中文、分析中文渲染引擎、用 romctl 调试 GBA 内存/hook/截图、处理字形格式（2bpp 压缩、LUT 展开、1bpp 位流）时使用。
---

# GBA 中文字库破解 — 完整执行范式

> **★ 第一步：查案例库（cases/）**。接到任务先读 `cases/README.md` 索引，找同基板/同引擎/同方法的
> 成功案例照搬已验证手段（trace 定位、地址映射、构建方案），不要从零开始。每完成一次成功破解，
> 必须按 §阶段 6 归档一篇实录并登记索引。

## 一、工具链速查

### romctl.js（无头调试引擎，bash 调用，状态跨命令连续）

```bash
cd gbajs2
node romctl.js load <rom.gba>          # 加载 ROM（重置状态，hook 需重新 add）
node romctl.js run [frames]            # 运行 N 帧 ⚠单批上限 3600，长时序分多次
node romctl.js key A,START [frames]    # 按住按键跑 N 帧后松开
node romctl.js screenshot [out.bmp]    # 截图（直接用 read 工具查看）
node romctl.js memread <addr> [len]    # 内存十六进制查看
node romctl.js memwrite <addr> <hex>   # 写内存
node romctl.js disasm <addr> [n]       # 反汇编（自动 Thumb/ARM）
node romctl.js regs / info             # 寄存器现场 / 状态摘要
node romctl.js snap <name> / diff <name>   # 快照 / 对比找内存变化
node romctl.js hook add <addr|preset rs|emerald> [name]  # 装 hook（入口处记 r0-r3）
node romctl.js hook events [--chars] / hook clear
node romctl.js serve [port=8645]       # ★HTTP 实时调试服务器（推荐，见下）
```
产物全在 `tmp/`（state json、截图、hook-events.jsonl）。

### serve 实时调试服务器（★优先用这个）

`node romctl.js serve [port=8645]` 启动后**状态常驻内存**，AI 逐步发 HTTP 请求即可边跑边看：

```bash
# 后台启动（状态自动接续 romctl.state.json，与 CLI 命令互通）
node romctl.js serve 8645 > tmp/serve.log 2>&1 &
curl "http://localhost:8645/status"              # rom/frames/pc/hooks
# ★交互循环：截图看画面 → 决定按键 → 再截图，避免一次性预录长按键序列时序错位
curl "http://localhost:8645/shot?file=s1.bmp"     # 截图到 tmp/，用 read 工具直接看
curl "http://localhost:8645/key?keys=DOWN&frames=40"
curl "http://localhost:8645/run?frames=600"
curl "http://localhost:8645/memread?addr=0x02000000&len=32"
curl "http://localhost:8645/memwrite?addr=0x08123456&hex=AABB"
curl "http://localhost:8645/disasm?addr=0x08004A1C&n=8&mode=thumb"  # serve 内默认 mode 可能是 ARM，Thumb 代码要显式传 mode
curl "http://localhost:8645/hookadd?addr=0x080653D8&name=printtext"
curl "http://localhost:8645/hookevents?tail=50"
curl "http://localhost:8645/load?rom=path.gba"    # 换 ROM（重置状态与 hook）
# 结束：netstat -ano | grep 8645 找 PID → taskkill //PID <pid> //F
```
每步都 saveState，中途改用 CLI 命令或重启 server 均无缝衔接。

### 离线分析（不启模拟器）

```bash
node scripts/disasm-offline.js <rom.gba> <GBA地址hex> [指令数] [--arm]   # 离线反汇编（已修复 LSL/LSR 显示 bug）
```

```js
// ROM Buffer 反汇编 mock（thumb-disassembler.js 直接喂文件偏移）
const d = new ThumbDisassembler({ loadU16:a=>rom.readUInt16LE(a & 0x1FFFFFF), loadU32:a=>rom.readUInt32LE(a & 0x1FFFFFF), load32:a=>rom.readUInt32LE(a & 0x1FFFFFF) });
d.disassemble(0x08xxxxxx, n, 'thumb');

// diff 两份 ROM 聚合差异段（容差 256-512B）
for (i) if (a[i]!==b[i]) 聚合到当前段（gap ≤ 容差则并入）
```

- `scripts/disasm-offline.js` — 离线反汇编（封装版，见上）
- `scripts/patch-elite-redux-2651.js` — **EliteRedux 槽位注入权威脚本**（fontpatch/ 下同名文件为旧副本）
- `fontpatch/armips-src/armips.exe` — armips 汇编器（写 Thumb 函数注入用）
- `fontpatch/tileconv_elite.s` — armips 写 Thumb 函数的完整范例

---

## 二、标准执行范式（正向分析为主，六阶段）

> **主范式 = 正向分析**：定位引擎 → 逐条梳理渲染控制流 → 探针实证数据格式 →
> 选择最低风险修改点。每个结论都要有**静态反汇编 + 动态运行时证据**双重支撑。
> 实战样本见 `cases/EliteRedux-正向分析/README.md`：第三方补丁盲改多日无果，
> 正向分析一次打通（并证明该补丁原理性不可行）。

### 阶段 0：侦察

1. ROM 头（0xA0）：标题、game code（BPEE=Emerald 系 / BPRE=FRLG 系）→ 定基板
2. 文件大小（32MB=扩容 ROM；页结构/寻址上限按此算）
3. **现成实现仅作参考**：目录里的 `_chs`/`字库` 版可用于 diff 和格式学习，
   但**不要直接搬它的 hook/地址**——decomp 重编译版布局必变，
   且补丁本身可能有原理性缺陷（见 cases/EliteRedux-正向分析/README.md：PokemonER 补丁
   工作缓冲地址错误 + 返回点错误，永远无法上屏）

### 阶段 1：定位文本引擎与 hook 点

**特征搜索（静态）**，按命中率从高到低：
1. 已知版本的函数签名搜索（如 beta2 的 RenderText 开头 `f0b5 ce46 4746 80b5`）——
   命中多处时结合平移规律（同一引擎的函数群常整体平移，如 EliteRedux -0x532C）
2. 控制符判断特征**因引擎版本而异**：stock Emerald 是 `sub r0,#0xF8 + cmp r0,#7`，
   EliteRedux 2.65.1 是 `adds r3,#8 + lsls/lsrs #24 + cmp r3,#7`（即 (currChar+8)&0xFF≤7）
3. currChar 模式 `ldr rX,[rY]; ldrb rZ,[rX]` 后紧跟 `adds ...,#1; str ...,[rY]`
4. 跳转表分发 `mov pc,r3`（469F）附近的 pool
5. 已知明文/编码字符串反查（ASCII 先试；Emerald charmap：A=0xBB..N=0xC8，小写 a=0xD6..，空格=0x00，FF=结束符）

**动态定位（静态搜不到/需互证时）**：
1. 跑到目标画面，在 IWRAM/EWRAM 搜索指向字符串的指针 → 定位窗口结构体
   （窗口+0 = currChar 指针；崩在渲染的现场寄存器 r1 常直接暴露字符串地址）
2. 快照/diff 找“每帧被写的渲染缓冲”
3. hook 候选地址看是否触发（hook 无事件 ≠ 没执行，见踩坑；
   完整 r0-r3 在 `tmp/hook-events.jsonl`，控制台只显示部分）
4. **pool 字面量是指针值不是表**：`ldr r2,=X; ldr r3,[r2,idx*4]; mov pc,r3`
   的 X 是“指针数组首址”，不要误当成跳转表基址（EliteRedux 实录教训）

**hook 点选择原则**：选**读字符后、控制符分发前**的位置（RenderText 的"字符读取+指针推进"处），
跳板必须**完整复现被覆盖的全部指令**（含副作用），失败路径回流到**下一条未覆盖指令**。

### 阶段 3：逆向渲染管线（正向逐层 + 探针实证）

沿执行流逐层 dump：分发器 → 字体 handler → 解压函数（输入格式/输出缓冲/advance 逻辑）
→ **确认最终写入目标是谁、谁消费它**（pool 字面量引用 + 运行时读缓冲验证）。
**数据格式用探针实证而非纯理论推导**：往可控位置写入全值/非对称图案，
跑真实渲染，读回缓冲逐字节比对（cases/EliteRedux-正向分析/README.md：探针一次确定 2bpp 语义、
半字装配、像素序三件事）。hook 记录每层入口寄存器，对照静态反汇编验证。

### 阶段 4：修改（按风险从低到高）

| 方案 | 风险 | 适用 |
|------|------|------|
| A. 改字符串（双字节/单字节编码） | 最低 | 引擎已支持中文 |
| B. 字形槽注入（转格式写入字体数组空槽 + 单字节 code） | 中 | 引擎不支持中文但字体数组有空槽 |
| C. hook 引擎 + 自写渲染（跳板/解压/转换全套） | 高 | 无现成实现 |

方案 B **与原版渲染 100% 同路径，必然兼容**——只要能逆向字体数组格式，
优先于任何 hook 方案。方案 C 的跳板必须逐条核对本 ROM 实际指令排布。

### 阶段 5：验证 — "NEW GAME 范式"（统一成功判据）

**主菜单 NEW GAME 是全游戏第一个渲染的文本**：位置固定、字符确定、出现早、
主菜单循环每帧重绘（改坏立刻空白/乱码），是**最小可行验证载体**。
**后续所有字库破解均以 "NEW GAME 位置显示预期文字" 作为唯一成功判据，
用截图像素分析判定，不靠目测。**

1. **定位**：标题屏出现后按 START 进主菜单；字符串搜索 ASCII→charmap
   （英文版 "New Game" = `C8 D9 EB 00 C1 D5 E1 D9 FF`；新版首字母大写小写混合）
2. **替换**：优先等长替换不破坏后续偏移；改短时用 FF 提前收尾 + 00 填充
   （下一字符串边界前，EliteRedux 实测可行）；编码查 `assets/wholewords.txt`
3. **时序控制**（成败关键）：先 run 到标题屏亮起（截图确认）再按 START，
   START 按早了会被吞。例：Emerald 系 = run 3600 + run 1500 → START → run 600
4. **截图像素分析**（用 `scripts/bmp-ascii.js`，不靠目测）：
   ```bash
   node romctl.js screenshot tmp/menu.bmp
   node scripts/bmp-ascii.js tmp/menu.bmp 8 4 120 26    # 菜单区域 ASCII
   node scripts/bmp-ascii.js tmp/menu.bmp --bbox        # 墨迹包围盒
   ```
   - ASCII 图应与预期字形逐行一致（含阴影行 'o'）；
   - ⚠ 采样窗口要含文字真实起点（EliteRedux 菜单文字 x=16，边框 x9-12 易混入）；
   - 包围盒宽度 = N 字 × 步进（如 3 字×12px=36px），宽度不足 = 右列被裁
5. **回归验证**：方向键切换选中项强制重渲染（截图像素不变坏）；
   进 Option 等子界面确认英文路径无损；挂起时 `regs` 看 lr 残留判断卡在哪
6. **回归对照**：保留一份"英文原串 + 全部其他修改"的对照 ROM，
   确认修改没有破坏非中文路径（控制变量法，一次只动一个变量）

### 阶段 6：归档

每轮实验版本号递增存 tmp/；结论实时写入本 skill；失败路径也要记（现场寄存器特征）。
**成功后归档**：在 `cases/` 新建**案例文件夹**（规范见 `cases/README.md`）：
`cases/<案例名>/` 下放 `README.md`（实录，结构参考现有篇目：结论速览→侦察→定位→映射→构建→
验证→已知问题→复现步骤）、`scripts/`（补丁/校验脚本）、`data/`（diff/字形/映射等最小数据）、
`artifacts/`（关键截图），并在 `cases/README.md` 索引表登记一行。

---

## 三、踩坑总表（血泪，按主题）

### 模拟器/工具
1. **必须软件渲染器**：memview/romctl 不加载 `js/video/proxy.js`（Worker 渲染静默黑屏）
2. **gba.freeze() 不可用**：Serializer.prefix 依赖浏览器 Blob；romctl 用自己的 JSON 快照，恢复前必须先 setRom
3. **romctl run 单批 3600 帧上限**（静默截断！）——长时序分多次 run，否则按键时序全错
4. **进程崩溃时 hook 事件不 flush**（runFrames 中途 throw）——0 事件 ≠ 没触发
5. VRAM 无 overwrite()，用 `vram.buffer.set()`；OAM/Palette 用 overwrite
6. 截图全黑但能操作 = 渲染路径问题；画面冻结 = 每帧异常被 pause（看 stderr）
7. **hook 前必须 load**：load 重置 state 会清掉 hook
8. **hook preset（rs/emerald）是美版地址**：非美版/改版基板引擎整体平移且**各区域平移量不同**（蓝宝石：文本区 +0x134、战斗区 +0x324），preset 不触发 ≠ 函数不存在——先用 trace 法重定位（见 cases/红龙传说-西语蓝宝石移植/README.md §三）；非美版可查 `assets/symbols/` 对照表
9. **预录长按键序列极易时序错位**：菜单项数量、弹窗、动画等待都会让同一段键序落到不同状态（本实录中 DOWN 多按一次直接误进 NEW GAME）。改用 **serve 模式逐步交互**：/shot 看画面 → 决定按键 → 再 /shot；确需 CLI 批量跑时，每个按键之间必须 screenshot 确认状态
10. **注入函数严禁越界覆盖**：算准 bin 大小与目标空区边界——曾把 96B 函数写进 48B 空隙
   覆盖了跳板前半，导致"修好的东西突然全坏"（v4/v5 教训）

### 地址与汇编
11. **算术陷阱：GBA 地址 = 0x08000000 + 文件偏移**。曾把 pool 写成 0x081EExxx
   （多算了 0x01000000），跳过去 memory[0x81] = undefined →
   `Cannot read properties of undefined (reading 'ICACHE_PAGE_BITS')`。
   **崩溃信息含 ICACHE_PAGE_BITS = 跳到了不存在的内存 region**
12. **push/pop 必须平衡**：push {r4-r7,lr} 20B 配 pop {r4-r7} 16B = 每次调用泄漏 4B 栈，
    多次调用后栈污染跑到野地址（`Illegal instruction` / pc=EWRAM）
13. **decomp 重编译版不能搬 hook 字节**：函数地址一致但指令排布全新。
    pokeE hook 移植 Quetzal 中文失败路径双重 sub → 跳转表索引错乱 → `mov pc` 跳飞。
    **hook 移植必须连被覆盖指令的差异一起适配**
14. **跳板里改寄存器必须在 push 之后**：`ldrb r6,[r1,#1]` 在 push {r0-r6} 前执行，
    pop 恢复的是脏值（Elite Redux 补丁 bug #1）
15. **跳板返回点 = 被覆盖指令的下一条，一条都不能跳过**： Elite Redux 补丁返回
    0x082570AA 跳过了 lsr/ldrb 两条 → 查表索引错乱（bug #2）
16. **崩在 mov pc,rX 且 rX=垃圾** = 跳转表/函数指针路径错乱，特征现场是
    lr 残留在跳板/渲染函数中部。先核对 hook 失败分支回流地址与该 ROM 实际指令排布
17. **仓库 baserom 全是 FF 占位文件**（法律原因），不能当字节参照；验证用真 ROM diff
18. **代码写入位置**：优先补丁区尾部/原版空区；离热路径近更好；armips .org 必须
    用正确 GBA 地址（pool 字面量跟着 .org 走）
19. **armips Thumb 语法**：`orr rd, rm`（两操作数）；寄存器移位 `lsl rd, rm`（两操作数）

### 字形与编码
20. **X+0x20 是阴影层不是下半 tile**：写进去 = 主体新字形+旧字母阴影叠加 = 乱码
21. **宽字形塞 8px 槽必须整 8 像素对齐拆分**（左=列0-7 右=列8-10补空），
    拆错会跳过中间列缺笔画
22. **引擎对 glyph 编码有区间修正**（0x01-05→-1、0x07-1A→-2、0x1C-1E→-3 等），
    自选 code 槽位显示会错位——黑盒探针法（每槽写可识别图案再渲染）测真实映射
23. **中文字节会撞游戏控制码**：Emerald 系文本流 0x01-0x1B 区有控制符（颜色/换行/
    暂停/回退），字符串**预处理/复制函数**会吃掉或转义它们——
    hi=0x03 曾导致渲染流死循环。选编码避开控制码区，或用引擎自带安全区（如 [0x36,0x3E]）。
    **非英语基板另撞重音字母**：RS charmap 0x01-0x1E 在欧洲语系文本里是 Á/É/Ñ/é 等字形字节
    （pokeRS 修正表只排除 é=0x1B），西语等语言的 GetStringWidth 会把重音字+后一字节误判为
    中文对（cases/红龙传说-西语蓝宝石移植/README.md §七）；用户确认不保留原语言则无需处理
24. **字体数组空槽/空字形 = 跳板代码的天然藏身处**（零扩容注入），
    但确认该槽真的不被引擎读作数据
25. **work buf/中间缓冲必须有消费者**：搜全 ROM 确认合法（4 字节对齐 pool 字面量）引用存在，
    否则写了也白写（EliteRedux 第三方补丁用 0x030064EC 但真缓冲是 0x03005600 ——
    从解压函数的 pool 字面量反查才是可靠方法）

### 反汇编与编码器
26. **工具输出与预期不符时，人工核对原始字节**：thumb-disassembler 曾把 LSR
    恒显示为 LSL（Format 1 用 hw>>13 判断位段错误，已修复）；
    也曾误判条件分支 off-by-2（实为手算错误）—— 先逐位重推编码再改工具
27. **编码器必须有自检回路**：自编码→自解码→与源字模逐像素比对。
    移位 <<1 vs <<2（每像素 2 位）这类 bug 靠肉眼 ASCII 难发现，回环比对立即暴露
28. **字符步进 < 字形内容宽 → 右列被后字覆盖**：11px 内容放 col2-12 会被 12px
    步进的下一字裁掉右列（“文字右边少一块”）；内容必须完整落在步进窗口内
29. **中文宽度 = 两个英文字符位**（如 2×6=12px），宽度表/advance 与字形内容宽度
    要一起设计；拉丁字形自带右下阴影（shadow=(r+1,c+1)），中文补阴影才风格一致
30. **LUT 是运行时数据时，转录极易出错**：先写一行错导致整个映射表全错。
    应从 memread 原文程序化转录，并用已知字形（如 'N'）回代验证映射正确性
31. **工具地址显示易看漏位**：disasm-offline 用 padStart(8,'0') 显示（如 0x08234ac0），
    手抄 hook 地址时看漏一位（0x080234ac0）会导致全部 hook 永不命中。零事件时先做
    对照实验（挂 0x08000000 重启向量）区分「地址错」vs「机制坏」
32. **romctl hook 按基本块首 PC 匹配**（cpu.step 入口）：函数中部地址可能在已编译块内部
    而永不命中；跳表目标/函数入口安全。零事件 ≠ 没执行，用 watch-read 双验证
33. **同族引擎字形像素语义必须逐版探针实证**：XTREME（BPEE 重编译）实证 1=深墨、2/3=灰影
    （与 Quetzal 笔记 0/3=透明 1=前景 2=阴影 不同）——LUT 运行时按文字色重填，
    同一紧凑值在不同窗口/路径颜色不同；四 tile 槽 [TL][TR][BL][BR]、宽度>8 走全 4 tile 宽路径；
    自检比对锚点（对齐偏移、颜色分类、box 边框）都会造成假阴性
34. **★像素自检无法发现字库索引映射错误**：编码与比对共用同一解码函数时自洽但可能全错
    （XTREME 实录：×256 索引把“新”渲染成“研”，自检仍 100%）。gba_chs_font_11x11.bin
    权威索引 = **(hi修正)×0xF7 + lo**（pokeE DecompressGlyph_Chinese），不是 ×256；
    必须外部参照验证：宋体/黑体栅格化后与字库字形图案对比，或放大人眼确认

---

## 四、游戏知识库

### 编码体系（Emerald 系通用）
- 文本 = charmap 单字节；中文 = 双字节 [hi][lo]，hi∈0x01-0x1E（排除 0x00/0x06/0x1B），lo<0xF7
- 码表 `fonts/wholewords.txt`（`hex=汉字`，~6768 字）：新=0E4D 的=030B 游=0F7C 戏=0DDB
- 字库索引 = (hi-修正)×0xF7 + lo
- charmap 字母：A=0xBB、G=0xC1、N=0xC8、小写 a=0xD6..、空格=0x00、FF=串结束

### Emerald 字形格式（2bpp 压缩 + LUT，Quetzal 验证）
- 字体数组（Quetzal）@文件偏移 0x1400BF4，64B/编码 = [主体 32B][阴影层 32B]
- 主体 = 16 行×u16(LE)，每行 8px×2bpp；值 0/3=透明 1=前景 2=阴影
- 运行时双 LUT 展开：LUT4 @0x08369CF4（ROM）、LUT5 @0x03000948（IWRAM），
  nibble A=透明 B=前景 C=阴影

### Quetzal（已验证 ✅"新的游戏"上屏）
- 方案：`roms/PokemonQuetzalAlpha7v0(字库).gba` 为基座（已含中文引擎）+ 字符串改写
- 一键：`cd fontpatch && node patch-newgame-string.js` → `tmp/PokemonQuetzal字库版_新的游戏.gba`
- 主菜单字符串 @文件偏移 0x137E070
- 字库版引擎：hook@RenderText+0xBA(0x0800586E) → 跳板@0x081400C34（字体数组空槽）
  → 字库@0x1B7FFCC（页 0x4000，页内每编码 64B）
- 关键地址（与 stock Emerald 布局一致）：RenderText=0x080057B4、GetStringWidth=0x08005ED8、
  DecompressGlyphTile=0x08004C04（pokeE 误写 0x08004C10）

### Elite Redux 2.65.1（✅ “新游戏” 菜单上屏，正向分析路线，详细实录见 `cases/EliteRedux-正向分析/README.md`）
- **与 v2.65-beta2-debug 完全不同的代码布局**（全 ROM diff 59%）：文本引擎三函数整体平移 -0x532C：
  RenderText=0x08257010、GetStringWidth=0x082576E4、DecompressGlyphTile=0x08256CB0
- **PokemonER 第三方补丁在本引擎上原理性不可行**（勿再尝试移植）：
  1) 失败路径返回点 RenderText+0x9A 落在控制码跳转表内部，普通字符必崩
  2) +0x23E 是 fontid 二级分发非消费点；gCurGlyph=0x030064EC 零合法引用，
     真正工作缓冲 = 0x03005600（0x08257FFC 的 pool 字面量）
- **已验证路线 = 方案 B 槽位注入（零 hook，v6）**：
  - FONT_NORMAL（菜单字体，fontid=1）字形数组 @文件 0x1067D18（GBA 0x09067D18），
    直接按 charmap 码索引，64B/字 = [左上16B][右上16B][左下16B][右下16B] 四个 8x8 tile，
    每行 u16：高字节 = px0-3（每像素 2bpp，MSB pair first），低字节 = px4-7
    宽度表 @文件 0x106FD18，每码 1B
  - 解压链：0x082572FA → bl 0x08257FFC(currChar,[tp+0x21]) → 宽>8 调 0x082562A8 四次
    （src 步进 0x10 → dst=0x03005600 步进 0x20）→ 宽度写 [buf+0x80] → 公共后继 0x0825728C
  - 像素语义（探针实证）：2bpp 值 0/3=透明(A) 1=前景(B) 2=阴影(C)；
    LUT4@ROM 0x090191E0 + LUT3@IWRAM 0x03005550（运行时按文字色填充，勿手抄）
  - 空槽：码 0x0A、0x18、0x1F；0xF8-0xFF 控制码、0x00 空格不可用
  - 字模源：pokeE gba_chs_font_11x11.bin（1bpp 11x11，16B/字，bit7=左，
    glyphId=(hi修正)*0xF7+lo）；H_OFF=1（内容 col1-11，防右列被裁）、
    V_OFF=2（垂直居中）、右下阴影 (r+1,c+1)、宽度 12 = 两个英文字符位
  - 菜单字符串 @文件 0xEFB11C（文字实际起点 x=16；后面 0xEFB128 是下一字符串）
  - 成品：tmp/EliteRedux_chs_v6.gba = testfiles/...新游戏字库.gba；
    可复现脚本 fontpatch/patch-elite-redux-2651.js（自检回路内置）
  - ⚠ 若需超过 3 个字：空槽只剩 0x0A/0x18/0x1F 三个；更多文字需整库插入路线
    （绿宝石字库.bin 格式与引擎一致但记录顺序非线性公式，见 cases/EliteRedux-正向分析/README.md 第 6 节）
- 时序：load → run 3600 → run 1500（标题屏）→ START → run 600 → 菜单

### 红龙传说（西班牙语蓝宝石改版，✅“新的游戏”菜单上屏，2025-09）
**详细实录见 `cases/红龙传说-西语蓝宝石移植/README.md`**（含 trace 定位法、地址映射表、复现步骤）。要点：
- **基板判定**：AXPE 头/POKEMON SAPP/lang='E'，但菜单为西语（PARTIDA NUEVA）→ 实为**非美版布局的蓝宝石改版**；US 蓝宝石符号表地址全部失效，且**各区域平移量不同**（文本区 +0x134、战斗区 +0x324），不能全局偏移，必须逐函数重映射（pokesapphire_de.sym 恰好与本 ROM 布局一致）
- **定位手段（trace 法，最可靠）**：西语菜单串 PARTIDA NUEVA @文件 0x41109C（US 0x0840DD2C+0x3370）；含字符串指针的代码块 @0x08009E34 → bl 0x08072324(改版自定义 wrapper) → bl 0x080653D8(printtext)；romctl hook 0x080653D8 触发后**逐指令 trace 8 万步**，用 r1 字形值序列（P=CA,A=BB,R=CC...）匹配出 GetGlyphWidth=0x08004A1C、DrawGlyphTiles=0x080069A8（与 pokesapphire_de.sym 完全一致，双证据）
- **成品**：`testfiles/宝可梦红龙传说_字库.gba`；可复现工程 `D:/vibecoding/Pokemon_GBA_Font_Patch-main/pokeRS_redragon/`（main.asm + Symbols.s 重映射表 + pokeRS 三函数原样）
- **地址映射**：GetGlyphWidth=0x08004A1C、GetStringWidth=0x08004D00（+0x100 处 `bl 0x08004A1C` 自洽验证）、DrawGlyphTiles=0x080069A8、DrawGlyphTile_ShadowedFont=0x080057B4、UpdateTilemap=0x08006A88、GetCursorTileNum=0x08006B0C、GetExpandedPlaceholder=0x0800712C、gMiscBlank_Gfx=0x08215940（hack 函数区，0x800B）、CpuSet=0x081ED6EC、sGlyphBuffer=0x030003A4（IWRAM 同址）；**字库改放 0x09200000/0x09300000**（改版自己占用了 0x09000000-0x09200000）
- **⚠ 西语与 pokeRS 方案冲突**：RS charmap 0x01-0x1E 全是重音字母（Á=0x02、É=0x04、Ú=0x12、Ñ=0x14、é=0x1B），pokeRS 方案按英语设计只排除 é，西语文本的 GetStringWidth 会把 Á+后一字节当中文对 → 布局偏移（如 RÁPIDA 换行）。**用户确认不保留西语**（后续全替换为中文），故不修；若需保西语，改转义前缀方案（如 0xF8 前缀 + 3 字节/汉字，需改三个 Chinese 函数的判别与 textIndex 步进）
- Phase2 未做：战斗 HP 框/狩猎/寄放系统 hook（UpdateNickInHealthbox=0x080454C4 等已映射但 DE 表尺寸不完全吻合，需逐个验证）

### FRLG（火红）
- 参考 `../../../../gui_related/font_patch.py`（跳板签名 3068037801303060 同源）
- 函数入口见 `pokeRS/include/OriginSymbols_R.s`

### Pokemon 窗口结构体（r0 指向）
```
[0x01] fontNum 0/3=普通字库 1/2/4/5=小字库   [0x02] language
[0x0E] spacing     [0x1E] textIndex(u16)     [0x20] *text 文本缓冲指针
```
Elite Redux 窗口（0x0203F2A4 样本）：+0=currChar 指针、+0x14=fontId（低 4 位有效，
分发用）、+0x21=字体变体标志（0=主路径 1=小字体路径，入 0x08257FFC）

### 汉字码合成（hook 解码用）
```
修正: glyph 0x01-05→-1 | 0x07-1A→-2 | 0x1C-1E→-3 | 0x06/0x1B→0
charId = ((glyph - 修正) << 8) | text[textIndex]   # 0x0100-0x1FF6 即汉字
```

---

## 五、本 skill 自带资源与相关文件（路径均相对本目录）

**自带脚本（scripts/）**：
- `scripts/bmp-ascii.js` — 截图像素校验（NEW GAME 范式的判定工具）
- `scripts/disasm-offline.js` — 离线反汇编（依赖 gbajs2 根目录 js/thumb-disassembler.js）
- `scripts/trace-after-hook.js` — hook 命中后逐指令 trace (pc,r0-r3)，用已知字符/参数序列匹配反查异版本引擎函数地址（用法与案例见文件头注释与 cases/红龙传说-西语蓝宝石移植/README.md §三）
- `scripts/watch-read.js` — **监视指定内存区间的读取并记录读取者 PC**（零假设引擎定位大杀器：盯住已知字符串/字形数据，直接抓到消费者；需 romctl 先调好状态+触发重绘，用法见文件头，案例见 cases/RechargedYellow-自带中文引擎/README.md）
- `scripts/patch-elite-redux-2651.js` — Elite Redux 槽位注入（含自检回路，可换字）

**自带资源（assets/）**：
- `assets/gba_chs_font_11x11.bin` — 中文字模（1bpp 11x11，16B/字，码表序）
- `assets/wholewords.txt` — 码表（hex=汉字）
- `assets/charmap_rs.txt` — RS 家族（红宝石/蓝宝石/绿宝石）charmap（hex=字符，含中文双字节键）；注意 0x01-0x1E 是重音字母区，非英语基板会与中文 hi 字节冲突
- `assets/symbols/pokesapphire.sym`、`assets/symbols/pokesapphire_de.sym` — 蓝宝石美版/德语版全符号表；**非美版基板先对照 de 版重映射，且各区域平移量不同，必须逐函数验证**

**外部文件（相对 gbajs2/ 根）**：
- `romctl.js` — 无头调试引擎（本 skill 各命令均先 `cd gbajs2`）
- `js/thumb-disassembler.js` — 反汇编器实现
- `fontpatch/ELITEREDUX-STATUS.md` — Elite Redux 状态文档
- `docs/memview开发经验与调试记录.md` — memview 开发踩坑
- `../fonts/绿宝石字库.bin` 等 — 大字库源文件（备用）
- `../roms/`（Quetzal 原版/字库版）、`../testfiles/`（Elite Redux 原版/成品）— 测试 ROM
