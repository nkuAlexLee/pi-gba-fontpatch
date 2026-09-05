---
name: gba-font-crack
description: GBA 宝可梦改版 ROM 中文字库破解全流程：正向分析范式（定位引擎→控制流→探针实证）、无头调试（romctl/serve 实时交互）、整库插入+渲染 hook 为标准路线（ESC 编码、多字号渲染器），槽位注入仅限验证、字符串修改与 NEW GAME 截图像素校验、回归 vs 模拟器缺陷的对照实验二分法。当需要给 Pokemon 改版 ROM 打中文字库、改菜单文本为中文、分析中文渲染引擎、用 romctl 调试 GBA 内存/hook/截图、处理字形格式（2bpp 压缩、LUT 展开、1bpp 位流）、排查 hook 后乱码/卡死问题时使用。
---

# GBA 中文字库破解

> **★ 分工**：渲染能力（字库/hook/验证）= 本 skill；翻译内容回填 = `../gba-text-translate/`。
> **★ 接任务先查 `cases/README.md` 索引**，找同基板/同引擎的成功案例照搬已验证手段；
> 每次成功破解必须按阶段 6 归档并登记索引。

## 〇、路线决策树（先读这个）

```
引擎已支持中文（双字节取字特征 probe-dualbyte / 已有字库版）？
├── 是 → 【方案 A】只改字符串，翻译走 gba-text-translate
└── 不支持 → 目标是整游戏汉化？
    ├── 是 → 【方案 C ★标准路线】整库插入 + RenderText hook（ESC 编码）→ 走六阶段
    └── 只需验证字库格式逆向（≤3 个字）→ 【方案 B】槽位注入（零 hook，必然兼容）
```

- 方案 B 与原版渲染同路径必然兼容，但槽位天花板极低（EliteRedux 仅剩 3 空槽），
  **只用于验证；不要用槽位方案堆字数**
- **改菜单/界面串为中文 = 字库验证手段，不是翻译**；正式翻译一律 gba-text-translate 回填
- 方案 C 的 hook 跳板必须逐条核对本 ROM 实际指令排布

## 一、工具链速查

### romctl.js（无头调试引擎，状态跨命令连续；均先 `cd gbajs2`）

```bash
node romctl.js load <rom.gba>          # 加载（重置状态，hook 需重新 add）
node romctl.js run [frames]            # ⚠单批上限 3600，长时序分多次
node romctl.js key A,START [frames]    # 按住按键跑 N 帧后松开
node romctl.js screenshot [out.bmp]    # 截图（read 工具直接查看）
node romctl.js memread <addr> [len] / memwrite <addr> <hex>
node romctl.js disasm <addr> [n] / regs / info
node romctl.js snap <name> / diff <name>       # 快照 / 对比找内存变化
node romctl.js hook add <addr|preset rs|emerald> [name]
node romctl.js hook events [--chars] / hook clear
```
产物全在 `tmp/`（state json、截图、hook-events.jsonl）。

### serve 即时存档（命名多槽位快照，2026-09-05 新增）

```bash
curl "http://127.0.0.1:8645/snap?op=save&name=标题屏"   # 存当前状态 → tmp/snaps/标题屏.json
curl "http://127.0.0.1:8645/snap?op=load&name=标题屏"   # 读档（逐字节确定性恢复）
curl "http://127.0.0.1:8645/snap?op=list"               # 列出快照（含 frames/emuVer/verMatch）
curl "http://127.0.0.1:8645/snap?op=del&name=旧档"
```
- **emuVer 版本防护**：快照记录模拟器语义代码（js/core|arm|thumb|mmu|irq|io|gba|video|audio|savedata|gpio|keypad.js）内容哈希；load 时版本不符**默认拒绝**（防旧 bug 代码产出的脏状态污染新代码排查），确信无影响才 `&force=1`
- **排查纪律**：① 每次改模拟器代码后，用于对照实验的基准快照必须在新代码下**重录**；② 快照只恢复机器状态，不恢复 watch/hook 事件缓冲（恢复后重新 arm）；③ 读档后跑 1 帧（/run?frames=1）再截图，否则读到的是恢复前的像素缓冲

### serve 实时调试服务器（★优先）

`node romctl.js serve [port=8645]` 后台启动，状态常驻、CLI 命令互通：

```bash
curl "http://localhost:8645/status"
curl "http://localhost:8645/run?frames=600"        # /key?keys=DOWN&frames=40
curl "http://localhost:8645/shot?name=s1"          # 截图 → read 看 → 决定下一步按键
curl "http://localhost:8645/memread?addr=0x02000000&len=32"
curl "http://localhost:8645/hookadd?addr=0x080653D8&name=printtext"
curl "http://localhost:8645/hookevents?tail=50"
curl "http://localhost:8645/load?rom=path.gba"     # 换 ROM（重置状态与 hook）
```
★交互循环：/shot 看画面 → 决定按键 → 再 /shot，避免预录长键序时序错位。
结束：netstat 找 PID → taskkill。

**会话录制与确定性重放**（memview 联机模式或纯 HTTP）：
```bash
curl "http://localhost:8645/session?op=start"   # 存 tmp/session/snap-start.json（含屏幕像素）
#   ...用户在 memview 玩/AI 下 /key /play 指令，自动记录 steps.jsonl + 每步截图...
curl "http://localhost:8645/session?op=stop"    # 存 snap-end.json；静默推帧段自动补记为 run 步
curl "http://localhost:8645/session?op=steps"   # AI 拉取全部操作+截图
curl "http://localhost:8645/session?op=replay"  # 从起始快照重放全部操作：
#   shot 步复刻为 replay-s-XXXX.bmp；返回 deterministic 字段。
#   实测：帧号与结束快照一致、重放截图与原截图逐像素差异 0。
```
用途：复现 bug（重放到崩溃点挂 /watchwrite）、验证汉化后行为不变（重放前后像素 diff）、
AI 离线分析用户会话。快照仅存这两个文件，每次录制覆盖。

### 离线分析

```bash
node scripts/disasm-offline.js <rom.gba> <GBA地址hex> [指令数] [--arm]
```
- `scripts/bmp-ascii.js` — 截图像素校验（NEW GAME 范式判定工具）
- `scripts/trace-after-hook.js` — hook 命中后逐指令 trace，反查异版本引擎函数
- `scripts/watch-read.js` — 监视内存区间读取并记录读取者 PC（零假设定位大杀器）
- `scripts/patch-elite-redux-2651.js` — EliteRedux 槽位注入（v6 早期验证路线）
- `fontpatch/armips-src/armips.exe` + `fontpatch/tileconv_elite.s`（Thumb 注入范例）
- `../gba-text-translate/scripts/` — 文本翻译/回填相关工具

---

## 二、标准工作流（六阶段）

> 主范式 = 正向分析：定位引擎 → 梳理渲染控制流 → 探针实证数据格式 →
> 最低风险修改点。每个结论都要**静态反汇编 + 动态运行时证据**双重支撑。
> 实战样本：cases/EliteRedux-正向分析（第三方补丁盲改多日无果，正向分析一次打通）。

**阶段 0 侦察**：ROM 头定基板（BPEE=Emerald 系/BPRE=FRLG 系）；文件大小定扩容；
现成中文版 ROM 只用于 diff 学习格式，**不要搬它的 hook/地址**（decomp 重编译布局必变，
且补丁本身可能有原理性缺陷）。

**阶段 1 定位文本引擎与 hook 点**——特征搜索（命中率从高到低）：
1. 已知版本函数签名搜索 + 平移规律（同引擎函数群常整体平移，EliteRedux -0x532C）
2. 控制符判断特征（版本而异：stock Emerald `sub r0,#0xF8+cmp #7`；EliteRedux `(c+8)&0xFF≤7`）
3. currChar 模式 `ldr rX,[rY]; ldrb rZ,[rX]` 后紧跟 `adds #1; str`
4. 跳转表分发 `mov pc,r3`（469F）附近 pool
5. 已知明文/编码字符串反查（Emerald charmap：A=0xBB.. 小写 a=0xD6..，FF=结束符）

动态互证：IWRAM/EWRAM 搜字符串指针定窗口结构体；快照 diff 找渲染缓冲；
hook 候选地址看触发。⚠ pool 字面量是指针值不是表（`ldr r2,=X` 的 X = 指针数组首址）。
**hook 点**：读字符后、控制符分发前；跳板完整复现被覆盖指令；失败路径回流下一条未覆盖指令。

**阶段 3 逆向渲染管线**：沿执行流逐层 dump（分发器→字体 handler→解压函数→
写入目标与消费者）。数据格式**用探针实证而非理论推导**：写全值/非对称图案 →
真实渲染 → 读回缓冲逐字节比对（一次确定 2bpp 语义、半字装配、像素序三件事）。

**阶段 4 修改**：方案取舍见 〇 决策树。整库路线要点见四 EliteRedux v7 小节。

**阶段 5 验证（NEW GAME 范式）**：主菜单是第一个渲染的文本 = 最小验证载体，
改串为中文仅为验证渲染链（正式翻译走 gba-text-translate）。判据 = 截图像素分析
（`scripts/bmp-ascii.js`，不靠目测）：
1. 定位：标题屏 START 进菜单；ASCII→charmap 搜串（"New Game" = C8D9EB00C1D5E1D9FF）
2. 替换：等长优先；改短用 FF 收尾+00 填充；编码查 assets/wholewords.txt
3. 时序：先 run 到标题屏亮起再按 START（按早被吞）。Emerald 系 = run 3600+1500 → START → 600
4. 像素分析：ASCII 图与预期字形逐行一致；包围盒宽 = N字×步进（不足 = 右列被裁）
5. 回归：方向键切换重渲染不变坏；进子界面确认英文路径无损
6. 对照：保留"英文原串+其他修改"对照 ROM（控制变量法）

**阶段 6 归档**：版本号递增存 tmp/；结论实时写入本 skill；失败路径也要记。
成功后 `cases/<案例名>/`（README 实录 + scripts/ + data/ + artifacts/）并登记索引。

---

## 三、踩坑知识库

### 症状速查（→ 条目号）

| 症状 | 条目 |
|------|------|
| hook 零事件/不触发 | 4, 7, 36, 37 |
| 中文不显示/空白/被裁 | 26, 29(右列), 33, 34, 39 |
| 中文变重音字母乱码 | 22, 23, 24 |
| 游戏崩溃/跳飞/Illegal instruction | 13, 14, 15, 16, 17, 18, 28 |
| 死循环/渲染失控 | 28, 12(残留污染) |
| 修好的东西突然全坏 | 10, 21, 12 |
| 时序错位/按键落错状态 | 3, 9 |
| 黑屏（转场/场景） | 11(先做对照实验!) |
| 自检 100% 但整字全错 | 39 |
| 工具显示/输出异常 | 31, 35, 36 |
| LUT/映射表全错 | 35, 38 |
| 写了没效果 | 29, 30 |

### 模拟器/工具（1-12）

1. **必须软件渲染器**：memview/romctl 不加载 `js/video/proxy.js`（Worker 渲染静默黑屏）
2. **gba.freeze() 不可用**：Serializer.prefix 依赖浏览器 Blob；romctl 用自己的 JSON 快照，恢复前必须先 setRom
3. **romctl run 单批 3600 帧上限**（静默截断）——长时序分多次 run，否则按键时序全错
4. **进程崩溃时 hook 事件不 flush**（runFrames 中途 throw）——0 事件 ≠ 没触发
5. VRAM 无 overwrite()，用 `vram.buffer.set()`；OAM/Palette 用 overwrite
6. 截图全黑但能操作 = 渲染路径问题；画面冻结 = 每帧异常被 pause（看 stderr）
7. **hook 前必须 load**：load 重置 state 会清掉 hook
8. **hook preset（rs/emerald）是美版地址**：非美版/改版基板引擎整体平移且**各区域平移量不同**（蓝宝石：文本区 +0x134、战斗区 +0x324），preset 不触发 ≠ 函数不存在——先用 trace 法重定位（cases/红龙传说 §三）；非美版查 `assets/symbols/` 对照表
8b. **★serve 下截图/音频的正确姿势（2026-09-04 教训）**：serve 运行时 `node romctl.js screenshot`（CLI）是只读访问，读到的是**落盘快照（最多滞后 600 帧）**——白屏/黑屏诊断若全靠 CLI 截图会全错！必须用 HTTP 端点 `curl "http://127.0.0.1:8645/shot?file=x.bmp"`（活体画面）。实证：地图实际渲染了 56-151 色，CLI 截图却永远白屏。音频同理：Node 无 Web Audio，serve 端用 `GET /audio`（float32 交错 L/R，32768Hz）拉流、浏览器 Web Audio 播放；memview 已内置。

8c. **★serve-only 架构（2026-09-04 定稿）**：memview 页面只做手柄+屏幕+内存监视，模拟器只在 serve 侧；页面由 serve 静态提供（同源免 CORS）且启动时自动开浏览器、自动接续 serve 已载 ROM（autoStartIfLoaded）。截图/音频/推帧全走 HTTP。音频=复用 gbajs2 原版 GameBoyAdvanceAudio 消费器（四个隐式陷阱：clear() 初始化+补假 core、手动 connect destination、环扩 2s、outputPointer 从写指针后方起步），推帧必须实时节流（帧数×16.7ms）。详细见技术报告 §4.7。

8e. **★WebSocket 推送通道（2026-09-04 定稿）**：serve 内置手写 WS 服务器（无 npm 依赖）。**服务端帧泵**=每帧 runFrames(1)+推 BMP+推音频+setImmediate 让栈+忙等补齐 16.7ms；实测 60fps 视觉+音频 100% 实时、按键<5ms。三个坑：①画面攒批=视觉掉到 4fps（必须每帧推）；②Windows 15.6ms 定时器粒度量化一切睡眠（残余用忙等消除）；③同步泵不还栈会饿死全部 I/O（每循环 setImmediate）。memview：按键走 WS 即达，面板/加载仍走 HTTP。详见技术报告 §4.8。

8f. **★Windows 定时器粒度（通用坑）**：所有睡眠原语（setTimeout/Atomics.wait/uv 条件变量）在 Windows 被量化到 15.6ms——"睡 5ms 实际睡 15.6ms"。精确节流的解法只有忙等（performance.now 自旋）或接受粒度误差。另：终止 serve 用锁文件 PID 重启机制，不要 taskkill 全部 node（会杀掉 pi agent 自己）。

8d. **★写只读寄存器 open-bus 语义（mGBA vs gbajs2 核心差异）**：gbajs2 对写只读 DMA/FIFO 寄存器的读取恒返回 badMemory[0]；游戏（EliteRedux 声音驱动轮询 0x040000C4）等的标志永不出现→无限轮询→runFrames 永不返回→单线程 HTTP 整体饿死（无画面无声音）。已在 js/io.js 改为返回 registers 最后写入值（与 mGBA 一致）。同类症状"哔哔声"=游戏逻辑冻结后方波寄存器残值恒响；音频寄存器 1 秒零变化=引擎冻结判据。
8g. **★BIOS 区保护读 open-bus（已修复，踩坑 11 突破的根因）**：真机/mGBA 语义 = 返回 biosPrefetch（最后一次 BIOS 预取的指令字，恒为 0xE... 负数）；坏实现返回当前指令半字复制（正数）。凡游戏把 [0x0-0x3FFF] 读值当有符号数判负的代码（如地图连接 NULL 检查）在旧 gbajs2 下判定翻转。凡遇"健康流程依赖 BIOS 垃圾值"类卡死先查此语义。
8i. **★CPU 半字访问对齐/符号扩展（已修复；2026-09-05 修正：与 pker 转场黑屏无关）**：ARM7TDMI 硬件：LDRH/STRH/LDRSH 地址 bit0 强制清零（非对齐读下沉到偶地址）；LDRSH/LDRSB 结果符号扩展到 32 位。坏实现（gbajs2 旧码）：奇地址直接按字节序读 + 无符号值直接入寄存器 → 读错字节 + 0x8000 变 +32768。修复本身与 mGBA isa-thumb.c:288/isa-arm.c:560 语义一致（对真 LDRSH 是正确性改进），保留。**但 pker mapcb gate 的 0x57DF 实为 LDRSB（bits[11:9]=011）而非 ldrsh**——项目 thumb-disassembler.js Format8 H/S 位映射 bug（误用 bit9 当 S 位；正确 H=bit11、S=bit10）把 0x57DF 误标 ldrsh，据此建立的"gate 判定翻转"假设已被运行时证伪（LDRSB 读 [0x020391F3]=0x80 → SXT8=-128，mGBA/gbajs2 一致；gate 失败路径是正常行为）。排查口诀：反汇编输出必须人工复核 bits[11:9]（011=LDRSB, 101=LDRH, 111=LDRSH）；pker 黑屏真根因见踩坑 11 的 2026-09-05 条目。
8h. **★romctl watchwrite 长度参数陷阱（已修复）**：len=0x1C 这类 0x 前缀曾被 parseInt(…,10) 解析成 0 → 监视范围长度为 0 → 永不命中且无报错——“零写入”结论前先跑 /wwdebug 或用十进制 len 验证；另 /load 会重建内存块使旧包装失效，现已自动重包装，但 hook 仍需重新 add
9. **预录长按键序列极易时序错位**——改用 serve 模式逐步交互（/shot 看画面 → 决定按键）
10. **注入函数严禁越界覆盖**：算准 bin 大小与空区边界（曾把 96B 写进 48B 空隙覆盖跳板前半）
11. **★回归 vs 模拟器缺陷的二分法（serve 对照实验）**：疑似补丁卡死/黑屏，先在 serve 模式用**完全相同的按键流程跑原版 base** 到同一位置——原版也黑 = gbajs2 模拟缺口（非补丁问题），换 mGBA/实机验证补丁。实证：EliteRedux 开场后转场，base 与补丁版同样黑屏不恢复
   **★★2025-09 决定性突破（两 ROM 黑屏共同根因之一，已修复）**：gbajs2 BIOS 保护读（PC 在 BIOS 外读 0x0-0x3FFF）走 BadMemory 返回“当前指令半字复制”（恒正），真机/mGBA 返回 biosPrefetch=最后 BIOS 预取指令字（0xE...恒负）。红龙传说 InitBackupMapLayoutConnections 对 connections==NULL 解引用 [0]，靠返回值为负使 ble 跳过——gbajs2 返回正数 → 17.5 亿次循环卡死黑屏。修复=mmu.js biosPrefetch+BIOSView 保护读返回切片、core.js raiseTrap/raiseIRQ 设出口指令字、irq.js HLE swi 设 0xE3A02004。修复后红龙传说 NEW GAME 全链通关（过场/野外/战斗）；pker 转场缺口收敛为 fade+14 恒 -1 无人写（详见技术报告 §4.9）。
   **mGBA 健康 dump 对照纠偏**：LOADER/WORKSYS 的 0x0FFF0FFF 哨兵、03003898=00、状态字节 0 均为健康态——此前“层2/层3 修复”（清哨兵、tick poke=1）是误判作废；pker 卡死唯一缺口 = 转场后 +14 应被写成 ≥0 地图组号但 gbajs2 下零写入 → gate12 每帧装卸翻转 → 队列消费者饿死
   **★2024 深挖（EliteRedux 开场转场黑屏根因链，romctl serve 新端点 diag）**：
   - 误判排除：DISPCNT=0x7F60 是正常 mode0（之前字节序读反）；IE=0x0500 读数是
     寄存器读路径假象（写入侧 watchio 实际全是 0x5=VBlank|VCOUNT）；CPU 没死锁
     （每帧 ~31k 步，VBlank+VCOUNT 2 IRQ/帧正常派发，IntrWait 循环健康）
   - 真实机制：EliteRedux boot 时经 COPYFUNC(0x08005800) 把 0xE64 字节的
     IRQ-handler/音频引擎代码异步拷贝到 EWRAM 0x02027FC8（队列指针叠写在
     gIntrHandlers DMA1-3 槽位 0x03001F94+，回调注册在 T1/T2/DMA0 槽位）。
     **该异步拷贝引擎在 gbajs2 下从未执行**（watchwrite/watchdma 双验证零写入），
     VBlank handler 槽指向零区 → IntrMain 派发 NOP 滑梯落入 f1 直拷的上块
     (0x0202849C，DMA 0x08004F8C→0x0202849C 1200 半字) 碰巧可执行 → 游戏能跑，
     但开场→本体转场依赖的后续异步文件加载(0x08117FF0, file=0x40E3)永不完成
     → 转场前 fade 从未启动（BLDCNT/BLDY 零写入）→ 永久黑屏
   - ★★战斗转场黑屏补完（2024 续，pker.gba 实录会话取证）：
     - 现象：菜单/走路全正常，进战斗按 A 后 fade 到黑 → 永不恢复（调色板全零、VRAM/引擎缓冲 8000+ 帧零写入）
     - 取证链：/session?op=replay 确定性重放到黑屏 → /irqcount 证明 IRQ 派发正常(3次/帧两态相同) → 引擎区对比发现 **EWRAM 0x02027FC8+0xE64 在录制起点就已死**（与 ROM 源码差 1128 字节，VBlank 槽 0x02028398 全零）——不是转场清零，是会话从死引擎的状态文件恢复的；战斗转场只是第一个真正依赖引擎的功能
     - **修复：serve 启动即默认开启 guardian（/guardian?on=1）**；转场开始前引擎存活则稳定复活（实测 fixes=6 → 900 帧内战斗界面完整）。卡死很深（黑屏 8000+ 帧）后才注入不可靠（fixes=2 仍黑），应从快照重开
     - ★★★深挖续（2024 三轮）：起名→博士→转场黑屏，全新 boot + 引擎全程存活仍卡死。逐层排除后确认：**队列是空的**（64×68B 对象池，"卡死请求"首字节 bit0=0=空闲槽，之前误判）、**地图资源加载从未被触发**（VRAM 全 0xFF/调色板全零/队列空，转场特效计数器却在空转）→ 根因 = EliteRedux 主状态机触发 map 加载的前置条件在 gbajs2 下不满足。再往下是 decomp 主状态机/脚本引擎逆向（表驱动 + 每类对象 handler 链 0x08252B40→0x82551B8(bx r3 跳板)→entry.field28），另一量级工作。已验证的小事实：① 0x08254480 起是 sprite 位置系统 ② 0x03000410 每帧写 3136B = 转场特效缓冲 ③ IE 全程只有 VBlank|VCOUNT(0x5)，游戏从不写 TM/DMA 位 ④ Flash Savedata 128K 检测正确、开场流程不碰 flash（vanilla 行为）
     - 实用结论：**NEW GAME 开场链在 gbajs2 不可用（转场必卡死）**，进游戏走存档导入：mGBA/EmulatorJS 过开场存档 → gbajs2 载入 .sav → CONTINUE。游戏内功能（战斗等）guardian 已修
     - 教训②：诊断时 memread 的 hex 是小端字节序，parseInt(hex,16) 会把 "8500" 读成 0x8500（实际 0x0085）——曾据此误判 IE 寄存器分叉，浪费数轮排查。多字节寄存器一律 readUInt16LE
     - 教训③：callertrace/pchist 的 pc 字符串无前导零（'0x8168560' 不是 '0x08168560'）；Thumb handler 要用偶地址做 target
     - 教训④：快照恢复后 audio 内部态与 IO 寄存器失配 → audio.updateTimers 零 interval 无限自递归 → JS 栈溢出；已在 io.defrost 重放 0x60-0xB4 声音寄存器修复
    - 教训①：romctl serve 新增端点 /regs /pchist /watchio /watchwrite /watchdma
      /callertrace /guardian（watchwrite 包 EWRAM block store，**DMA 快路径
      destView.setInt32 绕过 store32 不可见**，DMA 写必须用 /watchdma）
   - **★★★2026-09-05 第二轮深挖（根因链闭环，详见技术报告 §8-§12）**：
     - **两层根因**：①初始分歧 = EliteRedux 自定义 boot/相位初始化函数
       （0x0800Axxx/Bxxx，指针表 0x084B2298）在 gbajs2 从不执行（14 入口全 hook 0 命中）
       → EWRAM 文件系统表从未建立：扩展条目表（blob=0x0202A9A4 的 +0x1C78..+0x1E78，
       fileid≥0x4000）只被相位初始化（帧 ~12655-12897 的 memset trio 0x8117D04）清零、
       永不填充；submit(0x40E3)=u16[blob+0x1E3E]=0（正确值 0x082C，ROM 主表 0x09098362）；
       FAT 姊妹表（[0x03003410]=0x02029C48 稀疏、[0x03003414]=0x0202DC08 全零）同样缺失
       → 文件加载在 0x805B0A8 提前退出、地图描述符零表构建、队列记录 src=文件区基址
       0x089E63C0+0（垃圾）→ 瓦片/调色板永不到位、淡入永不发出。
       ②永久化机制 = gate12 安装/卸载竞态 + fade 锁存死锁：转场期 fade 活动（byte7=0x80）
       进入 mapcb → 入口 gate 失败每帧卸载、退出安装；VBlank wrapper 恰在 mapcb 主体中部
       （tickC 与 fadetickDC 之间）读 gate 槽 → 永远读 0 → gate12 永不派发 → fadetick90
       永不运行 → fade+0xC 锁存（FFFFFFFF）永不清 → 永久黑屏。
     - **解锁实验**：memwrite [0x020391F3]=0（伪造 fade 完成）→ gate12 常驻、
       wrapper 每帧派发、队列被消费、瓦片入 VRAM——但 PAL/palbuf 全零仍黑屏
       → 竞态只是永久化机制，初始分歧在数据加载层。
     - **注入实验**：向 0x0202C61C 注入 512B ROM 主表条目（无论卡死态还是
       相位初始化 clear 刚结束）→ 队列 src 仍为垃圾 → 描述符构建与 clear 同窗或更早，
       且加载链还依赖同样缺失的 FAT——**单修条目表不够，缺失的 boot 初始化影响整组表**。
     - **关键函数地图**：setentry=0x8118084（40+ 调用方，gbajs2 只执行过标题画面
       setentry(0x40F9,0)×23）；submit=0x8117FF0；flagtest=0x811824C；
       enqueue2=0x8253810（唯一调用方 0x81B7A66：src=[desc+12]+s16([[desc+8]+b42*4]+b43*4)×SXT8(0x08E26904[idx])，
       dst=0x06010000+(u16[desc+4]&0xFC00)>>5）；recordloader=0x818250C（从 ROM 0x0909789C
       拷记录，执行且成功）；相位初始化=0x0817F8C4 区域；相位加载器=0x8182CA0；
       fade 复位=0x8186480（16 通道 0x0203912C）；fadetickDC=0x81863DC（锁存早退）；
       fadetick90=0x8186390（DMA 调色板+清锁存+步进）。
     - **旧结论修正**：踩坑 11 的"发现① [0x02032038] 未写入"系误判（真实门槛
       IWRAM [0x03003424]==0x08183B15 卡死态正确通过）；"COPYFUNC 从不执行"过时
       （帧 5102/5704 执行，是引擎实例构造器非 memcpy）。
     - **遗留**：boot 表派发器未定位（无 bl/指针引用，必为间接派发）；下一步：
       构建 mGBA 无头对照（源码 /mnt/d/code/mgba-master）dump 同点位表值与
       0x0800Axxx/Bxxx PC 轨迹；或 rompatch 强制 bl boot 表函数验证充分性；
       排查模拟器检测分支（读 open-bus/BIOS 区按值分支——8g 的同类先例）。
   - 教训②：memread 对 IO 的读数不可信（读写路径不一致），诊断以 watchio
     写入侧为准
   - 教训③：一次性内存补丁会被游戏场景切换清 EWRAM 冲掉；/guardian 是周期重注入
   - 玩法建议：此 ROM 在 gbajs2 内无法过开场（引擎级缺口），字库验证用
     主菜单阶段即可（START 前正常），完整游玩用 mGBA/EmulatorJS
12. **★函数区指令流零分叉 = 洞无辜的实锤**：trace-after-hook 采 base 与补丁版同函数区域指令流做 pc/寄存器对齐比对，零分叉则立即转向洞外因素（实例：RT 洞 1705 条零分叉，真凶是 GSW 区 v1 残留污染）

### 地址与汇编（13-21）

13. **GBA 地址 = 0x08000000 + 文件偏移**，算错 0x01000000 → 崩溃信息含 ICACHE_PAGE_BITS = 跳到不存在的内存 region
14. **push/pop 必须平衡**：push 20B 配 pop 16B = 每次调用泄漏 4B 栈，多次后栈污染跑野地址
15. **decomp 重编译版不能搬 hook 字节**：地址一致但指令排布全新，hook 移植必须连被覆盖指令差异一起适配
16. **跳板里改寄存器必须在 push 之后**：之前执行 = pop 恢复脏值
17. **跳板返回点 = 被覆盖指令的下一条，一条不能跳过**（跳过 = 查表索引错乱）
18. **崩在 mov pc,rX 且 rX=垃圾** = 跳转表/函数指针路径错乱（lr 残留在渲染函数中部）；先核对失败分支回流地址
19. **仓库 baserom 全是 FF 占位文件**（法律原因），不能当字节参照；验证用真 ROM diff
20. **代码写入位置**：补丁区尾部/原版空区；armips .org 必须用正确 GBA 地址（pool 字面量跟着 .org 走）
21. **armips Thumb 语法**：`orr rd, rm` 两操作数；寄存器移位 `lsl rd, rm` 两操作数

### 字形与编码（22-30）

22. **★多字号渲染器（FRLG 系通用结构）**：fontid 分发表 @0x0825738C pool→0x0901C2AC，四套字形渲染器：fontid 0→0x08257CD8（小字，base 0x0904F718，[buf+0x81]=13）、1→0x08257FFC（普通，0x09067D18，15）、7→0x08257D98（0x09057918，15）、8→0x08257E58（0x09047518，12）。四套宽字形 blit 模式相同（4×16B chunk，dst=0x03005600+0x20k），窄字形（≤8px）跳过 TR/BR chunk。**hook 只覆盖一个 fontid → 其它字号的窗口把双字节中文码当普通字符渲染成重音字母乱码**
23. **窗口 variant 门不能加**：[win+0x21]≠0 的窗口（标题栏等）也走渲染；加 variant==0 过滤 = 这些窗口漏拦截 → 乱码。正确做法：fontid 全放行
24. **全角标点码位字形不可靠**：merged charmap 给 。！？：等全角字分配了码位（0x2C/0x3C/0x3D/0x3E），能编码≠能渲染（。→看着像 "er"）。翻译产出一律半角标点
25. **X+0x20 是阴影层不是下半 tile**：写进去 = 主体新字形+旧字母阴影叠加 = 乱码
26. **宽字形塞 8px 槽必须整 8 像素对齐拆分**（左=列0-7 右=列8-10补空），拆错跳过中间列缺笔画
27. **引擎对 glyph 编码有区间修正**（0x01-05→-1、0x07-1A→-2、0x1C-1E→-3 等），自选槽位显示错位——黑盒探针法（每槽写可识别图案再渲染）测真实映射
28. **中文字节会撞游戏控制码**：Emerald 系 0x01-0x1B 区有控制符，字符串预处理/复制函数会吃掉或转义它们（hi=0x03 曾致渲染死循环）。选编码避开控制码区。**非英语基板另撞重音字母**：RS charmap 0x01-0x1E 是 Á/É/Ñ/é 字形字节，西语 GetStringWidth 会把重音字+后一字节当中文对（cases/红龙传说 §七）
29. **字体数组空槽/空字形 = 跳板代码的天然藏身处**（零扩容注入），但确认该槽不被引擎读作数据
30. **work buf/中间缓冲必须有消费者**：搜全 ROM 确认合法 pool 字面量引用，否则写了也白写（EliteRedux 第三方补丁用 0x030064EC 但真缓冲 = 0x03005600）

### 反汇编与编码器/验证（31-39）

31. **工具输出与预期不符时，人工核对原始字节**：thumb-disassembler 曾把 LSR 恒显示为 LSL（已修复）、误判条件分支 off-by-2——先逐位重推编码再改工具
32. **编码器必须有自检回路**：自编码→自解码→与源字模逐像素比对（<<1 vs <<2 这类 bug 肉眼难发现）
33. **字符步进 < 字形内容宽 → 右列被后字覆盖**：内容必须完整落在步进窗口内
34. **中文宽度 = 两个英文字符位**（2×6=12px），advance 与字形内容宽一起设计；拉丁字形自带右下阴影，中文补阴影才风格一致
35. **LUT 是运行时数据时转录极易出错**：从 memread 原文程序化转录，用已知字形（如 'N'）回代验证
36. **工具地址显示易看漏位**：手抄地址看漏一位 = 全部 hook 永不命中。零事件时先做对照实验（挂 0x08000000 重启向量）区分「地址错」vs「机制坏」
37. **romctl hook 按基本块首 PC 匹配**：函数中部地址可能在已编译块内部永不命中；跳表目标/函数入口安全。零事件 ≠ 没执行，用 watch-read 双验证
38. **同族引擎字形像素语义必须逐版探针实证**：XTREME 实证 1=深墨、2/3=灰影（与 Quetzal 0/3=透明 1=前景 2=阴影 不同）——LUT 运行时按文字色重填；自检比对锚点会造成假阴性
39. **★像素自检无法发现字库索引映射错误**：编码与比对共用同一解码函数时自洽但可能全错（XTREME：×256 索引把"新"渲染成"研"，自检仍 100%）。权威索引 = **(hi修正)×0xF7 + lo**（pokeE DecompressGlyph_Chinese）；必须外部参照验证（宋体/黑体栅格化对比）

---

## 四、游戏知识库

### 编码体系（Emerald 系通用）
- 文本 = charmap 单字节；中文 = 双字节 [hi][lo]，hi∈0x01-0x1E（排除 0x00/0x06/0x1B），lo<0xF7
- 码表 `fonts/wholewords.txt`（hex=汉字，~6768 字）：新=0E4D 的=030B 游=0F7C 戏=0DDB
- 字库索引 = (hi-修正)×0xF7 + lo
- charmap 字母：A=0xBB、G=0xC1、N=0xC8、小写 a=0xD6..、空格=0x00、FF=串结束

### Emerald 字形格式（2bpp 压缩 + LUT，Quetzal 验证）
- 字体数组（Quetzal）@文件 0x1400BF4，64B/编码 = [主体 32B][阴影层 32B]
- 主体 = 16 行×u16(LE)，每行 8px×2bpp；值 0/3=透明 1=前景 2=阴影
- 运行时双 LUT 展开：LUT4 @0x08369CF4（ROM）、LUT5 @0x03000948（IWRAM），nibble A=透明 B=前景 C=阴影

### Quetzal（✅"新的游戏"上屏）
- 基座：`roms/PokemonQuetzalAlpha7v0(字库).gba`（已含中文引擎）+ 字符串改写
- 一键：`cd fontpatch && node patch-newgame-string.js`
- 主菜单串 @文件 0x137E070；hook@RenderText+0xBA(0x0800586E) → 跳板@0x081400C34 → 字库@0x1B7FFCC
- 关键地址（同 stock Emerald 布局）：RenderText=0x080057B4、GetStringWidth=0x08005ED8、DecompressGlyphTile=0x08004C04

### EliteRedux 2.65.1（✅ v7 整库路线；详细实录 cases/EliteRedux-正向分析/README.md）
- 与 beta2 完全不同代码布局（diff 59%）：文本引擎三函数整体平移 -0x532C：
  RenderText=0x08257010、GetStringWidth=0x082576E4、DecompressGlyphTile=0x08256CB0
- PokemonER 第三方补丁在本引擎**原理性不可行**（失败路径返回点落控制码跳转表内；
  gCurGlyph=0x030064EC 零合法引用，真缓冲=0x03005600）——勿再移植
- **FONT_NORMAL（fontid=1）字形数组** @文件 0x1067D18，64B/字 = 四个 8x8 tile，
  每行 u16：高字节=px0-3（2bpp MSB pair first）低字节=px4-7；宽度表 @0x106FD18
- 解压链：0x082572FA → bl 0x08257FFC → 宽>8 调 0x082562A8 ×4（src 步进 0x10 →
  dst=0x03005600 步进 0x20）→ 宽度写 [buf+0x80] → 公共后继 0x0825728C
- 像素语义（探针实证）：0/3=透明 1=前景 2=阴影；LUT4@0x090191E0 + LUT3@IWRAM 0x03005550（勿手抄）
- **v6 槽位注入（早期验证）**：空槽 0x0A/0x18/0x1F；字模 pokeE gba_chs_font_11x11.bin
  （glyphId=(hi修正)×0xF7+lo）；H_OFF=1 V_OFF=2 阴影(r+1,c+1) 宽 12；
  菜单串 @0xEFB11C（文字起点 x=16）——⚠ 改串仅为字库验证，翻译走 gba-text-translate；
  复现脚本 scripts/patch-elite-redux-2651.js
- **★v7 整库中文插入（标准路线）**：
  - ESC 编码 [F7][hi][lo] 3B/汉字；记录索引 = corrected_hi×256+lo
  - 字库全量 @GBA 0x0968A4D8（0xED700B，64B/字），代码洞 @0x09777C58；
    RenderText 截流 @0x08257098（12B detour）；GetStringWidth 不挂（挂了会因
    残留污染 GSW 函数体致 Option 页挂死，踩坑 12）
  - RT 洞支持 fontid 0-8（四渲染器），出口按 fontid 写 [buf+0x81]；不加 variant 门
  - 回填 = gbajs2/translation-er 工程（gba-text-translate，escPrefix=f7），
    成品 roms/..._汉化beta.gba，覆盖 24352/27408 串（88.9%）
  - ★改 .s 后必须 rebuild → insert → 拷贝成品（否则翻译与硬编码串全丢）
- 时序：load → run 3600 → run 1500（标题屏）→ START → run 600 → 菜单
- 已知限制：开场后转入本体的转场在 gbajs2 **曾黑屏，SWI 0x04/0x05 IntrWait 修复后已解决**（base 同样，模拟器缺口，踩坑 11）。
  2026-09-05 晚间根因闭环 + 修复：gbajs2 swi() case 0x04/0x05（IntrWait/VBlankIntrWait）清 IF 后 `raiseTrap()`（跳 stub BIOS 立即返回），**完全不等待**——真 BIOS/mGBA 应 HALT 到 VBlank IRQ 实际交付。
  后果：主循环每帧以 SWI 0x05 结束却立即返回 → VBlank IRQ 恒落 mapcb 体中部 → gate 槽读 0 → gate12 永不派发 → fadetick90 永不跑 → fade 锁存不清 → fade#3 永不完成 → byte7=0x80 → 地图加载进度门槛挡住 → flag 死锁 → runner 死 → boot 脚本不启动 → 黑屏。
  修复（js/irq.js + js/core.js）：swi 0x04 改为带 mask 语义的 waitForIRQ 真等待；新增 intrWaitReturn（switchMode 离 IRQ 模式时调）+ intrWaitPoll（step() 顶部调，延迟执行避免嵌套 switchMode 冲突）。
  run12 验证：gate12 常驻、fade 完成、死锁解除、卧室渲染（右 60%）、START 菜单可交互。
  **遗留**：mGBA 无头对照显示两模拟器逻辑状态完全一致（flag/grid/cell/entry/gateslot 全相同），但 mGBA 全画渲染（9.8% 黑）、gbajs2 仅右 60%（52% 黑）——瓦片图形数据载入不完整（BG1 tile char base 0x06004000+0x1000 起 4KB 全零），tilemap 与调色板已一致，分歧在 tile char data 载入链。详见技术报告 §13-§14。
  旧结论修正：§9.4"扩展文件表条目永不被写入是初始分歧"——**推翻**（mGBA 同 entry40E3=0000 但全画）；§11.1"派发器未定位"——**已解决**（special 408 → 0x0800B054 → boot 表 0x084B224C[index]→bx）。

### 红龙传说（西语蓝宝石改版，✅"新的游戏"上屏；实录 cases/红龙传说-西语蓝宝石移植/README.md）
- 非美版布局（各区域平移量不同：文本区 +0x134、战斗区 +0x324），必须逐函数重映射
  （pokesapphire_de.sym 恰好与本 ROM 一致）
- trace 定位法（最可靠）：已知串地址 → 代码块 → hook 触发 → 逐指令 trace 8 万步，
  用字形值序列匹配函数地址（双证据）
- 地址映射：GetGlyphWidth=0x08004A1C、GetStringWidth=0x08004D00、DrawGlyphTiles=0x080069A8、
  DrawGlyphTile_ShadowedFont=0x080057B4、CpuSet=0x081ED6EC；字库改放 0x09200000/0x09300000
- ⚠ 西语与 pokeRS 方案冲突（RS charmap 0x01-0x1E 全是重音字母）——不保西语则无需处理

### FRLG（火红）
- 参考 `../../../../gui_related/font_patch.py`（跳板签名 3068037801303060 同源）
- 函数入口见 `pokeRS/include/OriginSymbols_R.s`

### Pokemon 窗口结构体（r0 指向）
```
[0x01] fontNum 0/3=普通字库 1/2/4/5=小字库   [0x02] language
[0x0E] spacing     [0x1E] textIndex(u16)     [0x20] *text 文本缓冲指针
```
EliteRedux 窗口：+0=currChar 指针、+0x14=fontId（低 4 位）、+0x21=字体变体标志

### 汉字码合成（hook 解码用）
```
修正: glyph 0x01-05→-1 | 0x07-1A→-2 | 0x1C-1E→-3 | 0x06/0x1B→0
charId = ((glyph - 修正) << 8) | text[textIndex]   # 0x0100-0x1FF6 即汉字
```

---

## 五、资源与相关文件（路径均相对本目录）

**自带脚本（scripts/）**：bmp-ascii.js（像素校验）、disasm-offline.js、trace-after-hook.js、
watch-read.js（监视读取定位消费者）、patch-elite-redux-2651.js（v6 槽位注入）；
文本翻译/回填工具见 ../gba-text-translate/scripts/。

**自带资源（assets/）**：gba_chs_font_11x11.bin（中文字模）、wholewords.txt（码表）、
charmap_rs.txt（RS 家族 charmap；0x01-0x1E 重音字母区）、
symbols/pokesapphire{,_de}.sym（蓝宝石符号表；非美版先对照 de 版重映射）

**外部文件（相对 gbajs2/ 根）**：romctl.js、js/thumb-disassembler.js、
fontpatch/ELITEREDUX-STATUS.md、docs/memview开发经验与调试记录.md、
../fonts/绿宝石字库.bin、../roms/、../testfiles/
