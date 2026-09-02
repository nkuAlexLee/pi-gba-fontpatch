# memview.html 开发经验与调试记录

> 记录 `memview.html`（游戏画面 + 内存监视 + 反汇编页面）开发过程中遇到的坑、
> 根因分析与解决方案，供后续开发 `index.html` / `debugger.html` 相关功能时参考。

## 1. 概念澄清：不存在"把 GBA 指令翻译为 Thumb"

GBA 的 CPU 是 **ARM7TDMI**，原生支持两套指令集：

| 指令集 | 宽度 | 切换方式 | 项目中的对应 |
|--------|------|----------|--------------|
| ARM    | 32 位 | CPSR 的 T 位 / `BX` 指令 | `cpu.execMode == MODE_ARM`，`instructionWidth = 4` |
| Thumb  | 16 位 | 同上 | `cpu.execMode == MODE_THUMB`，`instructionWidth = 2` |

- Pokemon 游戏代码绝大部分**本来就是 Thumb 代码**，无需"翻译"。
- 实际需要的是**反汇编器（disassembler）**：把机器码解码为可读汇编助记符，
  并根据 `cpu.execMode` 自动区分当前指令流是 Thumb 还是 ARM。
- 注意 Thumb 的流水线效应：读取 `gprs[15]` 得到的 PC 值 = 当前指令地址 + 4（Thumb）/ + 8（ARM），
  反汇编"当前执行指令"时要减回去。

相关文件：`js/thumb-disassembler.js`（含 Thumb 全部 19 种指令格式 + 常用 ARM 指令）。

## 2. memview.html 架构要点

- **不加载 `js/video/proxy.js`**（原因见 §3.1），强制走主线程软件渲染器
- 左侧游戏画布 480×320（`offsetWidth != 240` 时 `gba.setCanvas` 自动走
  indirectCanvas 放大路径），右侧内存 Hex 视图 + 变化日志 + 反汇编面板
- 内存读取统一走 `gba.mmu.loadU8(addr)`，跨区域（EWRAM/IWRAM/VRAM/...）无差别
- 刷新定时器（默认 250ms）独立于模拟器主循环，主循环是 `setTimeout(f, 16)` 链式调度
  （`gba.js` 的 `queueFrame`），两者互不阻塞

## 3. 踩过的坑

### 3.1 Web Worker 渲染路径静默黑屏（最重要）

**现象**：有声音、按键有反馈（游戏在跑），但画面纯黑，控制台无报错。

**根因**：`js/video.js` 构造函数：

```js
try {
    this.renderPath = new GameBoyAdvanceRenderProxy();   // Web Worker 渲染
} catch (err) {
    this.renderPath = new GameBoyAdvanceSoftwareRenderer(); // 主线程渲染
}
```

浏览器中 `proxy.js` 正常加载 → 走 Worker 路径。Worker（`js/video/worker.js`）
负责逐扫描线渲染再 postMessage 传回主线程贴画布。**Worker 内部抛异常时主线程
完全无感知**——CPU、音频、输入都不受影响，只是永远等不到 'finish' 帧消息 → 黑屏。

**解决**：`memview.html` 不引入 `js/video/proxy.js`，`new GameBoyAdvanceRenderProxy()`
抛 ReferenceError 被 catch → 回退主线程软件渲染器。好处：

1. 无 Worker 静默失败风险
2. 软件渲染器直接读 mmu 内存，无 Worker 内存副本，内存监视数据更准确
3. 性能足够：主线程渲染实测 ~300fps（headless 300 帧仅 1 秒）

**遗留**：`index.html` 仍加载 proxy.js，同样存在此隐患；若它黑屏可用同样方法修。

**教训**：`try/catch` 包裹 Worker 构造只兜住了"构造失败"，兜不住"运行后失败"。
Worker 内部应有 onerror 上报机制，否则渲染类故障极难定位。

### 3.2 缺少 resources/biosbin.js → 每帧异常 → 画面静止

**现象**：状态栏报 `运行出错: > at runFunc (gba.js:227)`，画面不动。

**根因**：`memview.html` 初版漏了 `<script src="resources/biosbin.js"></script>`，
`biosBin` 未定义 → BIOS 区域是空 buffer → CPU 取指每帧抛异常 → `gba.pause()`。

**排查特征**：`gba.js` 的 runFunc 把异常原样抛出并 pause，现象是"画面冻住"；
对照 `index.html` 的脚本引用清单逐项核对即可发现缺漏。

**教训**：新增 HTML 页面时，**脚本引入清单以 `index.html` 为基准逐项核对**
（util/core/arm/thumb/mmu/io/audio/video/software/irq/keypad/sio/savedata/gpio/gba/
resources/biosbin.js，按此顺序）。

### 3.3 错误对象直接拼字符串 → 日志不可读

`setStatus('出错: ' + error)` 打印 Error 对象只显示 `>` 加堆栈片段。
需区分处理：

```js
if (error instanceof Error) msg = error.message + '\n' + error.stack.split('\n').slice(1, 4).join('\n');
else if (error && error.message) msg = error.message;
```

### 3.4 AudioContext 自动播放策略

`new AudioContext()` 在页面加载时（无用户手势）创建会处于 `suspended` 状态。
虽然 gbajs2 的主循环不依赖音频（不会因此卡死），但要在**用户手势事件内**
主动 `resume()`（memview.html 放在 ROM 选择 onchange 里），否则无声音。

### 3.5 浏览器缓存导致"改了没生效"

一次修复后用户仍见旧版页面行为（旧版缺 biosbin.js 引用）。HTML 页面可能被缓存，
修改后务必 **Ctrl+F5 强刷**，或在验证时用 `console.log` 打印版本号确认加载的是新代码。

## 4. Headless 测试：环境差异会掩盖 Bug

`test/headless-test.js` 用 Node + stub DOM 直接跑模拟器主循环：

```bash
node test/headless-test.js "../testfiles/PokemonQuetzalAlpha7v0.gba" 300
```

- stub 掉 canvas（`createImageData/putImageData/drawImage/setAttribute`）、
  `window/document/localStorage/atob`，AudioContext 置空走无音频分支
- 所有模拟器脚本 + 测试体拼接成**单份代码**一起 eval
 （顶层 class 声明在 eval 内部不可跨作用域访问，必须拼在一起）
- 每帧调用 `gba.advanceFrame()`，对 `putImageData` 的像素做哈希，
  统计 unique frames 判断"画面是否真的在变化"

**价值**：快速验证 CPU/渲染/内存子系统是否正常（300 帧、20 个不同画面、零异常）。

**局限性（本次的关键教训）**：Node 无 Worker → `GameBoyAdvanceRenderProxy`
构造抛异常 → 自动回退软件渲染器 → 测试通过。而浏览器走的是 Worker 路径——
**headless 环境把"Worker 路径黑屏"这个真正的 Bug 完全掩盖了**。

结论：headless 测试通过 ≠ 浏览器行为正确。涉及 Worker/Service Worker/
AudioContext/自动播放策略等浏览器特性的功能，必须在真实浏览器里验证；
headless 只能证明"回退路径"是好的。

## 5. 现场调试方法论：按子系统隔离

"有声音、能操作、但黑屏"这类复合症状，说明各子系统状态如下：

| 子系统 | 现象 | 结论 |
|--------|------|------|
| CPU 主循环 | 按键有反馈 | ✅ setTimeout 调度链正常 |
| 音频 | 有声音 | ✅ 与视频共享 advanceFrame |
| 视频输出 | 黑屏 | ❌ 问题被隔离在"渲染→贴画布"路径 |

由此可直接把怀疑范围缩小到 `renderPath → putImageData → drawCallback →
drawImage` 这条链，而不必怀疑 CPU/内存/加载流程。memview.html 据此内置了
诊断：状态栏实时显示 `FPS + 帧累计`，用 `gba.reportFPS` 和 vblankCallback
计数区分"没在跑"（FPS=0）与"在跑但没画出来"（FPS≈60 但黑屏）两种故障。

## 6. romctl.js 无头调试引擎（第二轮开发）

在 headless 测试基础上正式化，供 AI 通过 bash 驱动完整调试循环。
用法与领域知识见 `.pi/skills/gba-font-crack/SKILL.md`。

### 6.1 gba.freeze() 序列化链路完全不可用

想给一次性命令进程做状态持久化，首先尝试 `gba.freeze()/defrost()`，发现三处断裂：

1. `Serializer.prefix`（util.js）内部用 `new Blob(...)` —— Node 无 Blob
2. `prefix` 是**实例方法**却被静态调用（`Serializer.prefix(x)`），本身就是坏的
3. 软件渲染器的 `freeze()/defrost()` 是**空实现** —— 调色板/VRAM/OAM 不会被保存

**解决**：自己实现 JSON 快照，恢复时用各子系统现成的入口：

| 子系统 | 保存 | 恢复 |
|--------|------|------|
| CPU | `cpu.freeze()`（纯数字，JSON 安全） | `cpu.defrost()` |
| WRAM/IWRAM | `mmu.memory[REGION].buffer` | `mmu.defrost({ram, iram})` |
| IO | `io.registers`（Uint16Array→数组） | `io.defrost({registers})` |
| Palette | `palette.colors[0/1]` 拼成 u16 数组 | `palette.overwrite()`（同步 adjustedColors 缓存） |
| VRAM | `vram.buffer`（Uint16Array） | **无 overwrite()**，直接 `vram.buffer.set()` |
| OAM | `oam.buffer` | `oam.overwrite()`（同步 objs 缓存） |

**且恢复前必须先 setRom**（触发 resetCPU 与内存映射），否则 CPU 未初始化，
`cpu.defrost` 里 `bankedRegisters` 为 undefined 直接崩。

### 6.2 hook 机制设计

- 这个 fork 的 `cpu.step` 已被前期工作加入 `skipInstruction` 动态跳过机制；
  romctl 不用它，而是包装 `cpu.step` 做断点式跟踪
- 当前指令地址判定：`step()` 入口处 `gprs[15]` 已指向下一条，
  **当前指令 = `gprs[15] - instructionWidth`**
- hook 点选**函数入口**：r0-r3 正好是参数，无需跳过原指令，零侵入
- 预设地址源自 `Pokemon_GBA_Font_Patch/pokeRS/include/OriginSymbols_R.s`
  与 `symbols/pokeemerald/pokeemerald.sym`；**改版 ROM 地址可能偏移**，
  hook 无事件时先 `disasm <addr>` 验证入口是否像函数头（push {r4-r7,lr}）
- 事件含寄存器 + 窗口结构体解码 + 汉字码合成
 （glyph 修正表：1-5→1, 7-1A→2, 1C-1E→3，来源原版补丁 GetGlyphWidthChinese.s）
- 性能：逐指令 JS 检查约几十 ms/帧，捕获会话几百帧在秒级，可接受

### 6.3 实战验证记录（Pokemon Quetzal，Emerald 改版）

- 1746 帧跑到模式选择菜单，截图确认渲染正常
- hook DecompressGlyphTile(0x08004C10) 后按 A，捕获 70 次调用
- 验证了 "snap → key → diff" 找内存变化的完整工作流

## 7. 相关文件

- `memview.html` — 内存监视页（浏览器可视化）
- `romctl.js` — 无头调试引擎（AI/脚本驱动，首选入口）
- `.pi/skills/gba-font-crack/SKILL.md` — AI 调试技能包（用法配方 + 领域知识）
- `js/thumb-disassembler.js` — Thumb/ARM 反汇编器
- `test/headless-test.js` — 无头冒烟测试
- `hook-events.jsonl` — hook 捕获的事件流（hook add 后自动生成）
- `js/video/proxy.js` / `js/video/worker.js` — Worker 渲染路径（memview/romctl 均已弃用）
- `js/video/software.js` — 主线程软件渲染器（实际使用）

- `memview.html` — 内存监视页（本记录的主角）
- `js/thumb-disassembler.js` — Thumb/ARM 反汇编器
- `test/headless-test.js` — 无头冒烟测试
- `js/video/proxy.js` / `js/video/worker.js` — Worker 渲染路径（memview 已弃用）
- `js/video/software.js` — 主线程软件渲染器（memview 实际使用）

## 8. 实战：Quetzal 中文字库分析与 "NEW GAME → 新的游戏"（第二轮开发）

### 8.1 现成字库版 ROM 是最佳分析样本

`testfiles/PokemonQuetzalAlpha7v0(字库).gba` 是已实现中文字库的成品。
**diff 原版与成品 = 完整的修改清单**，比移植第三方补丁（pokeE）可靠得多：

| 修改点 | GBA 地址 | 内容 |
|--------|----------|------|
| 引擎 hook | 0x0800586E (RenderText+0xBA) | 10B → `ldr r3,[pc,#4]; mov pc,r3` 跳跳板 |
| 跳板代码 | 0x081400C34 (字体数组空槽 code≈1) | 136B 手写 Thumb：复现被覆盖指令 + 中文判断分流 |
| 中文字库 | 0x1B7FFCC 起 ~963KB | 分页结构（页 0x4000，页内每编码 64B） |
| 宽度表 | 0x14009F5 (2B) | 特定编码宽度 6→12 / 6→10（全角/半角） |

中文判断规则（跳板逆向）：`currChar ∈ 0x01-0x1E`（排除 0x00/0x06）= 中文双字节高位；
与 fonts/wholewords.txt 码表配套（0E4D=新 等）。

### 8.2 pokeE 移植失败的教训

- Quetzal 是 **decomp 重新编译版**：函数地址与 stock Emerald 一致
 （RenderText/GetStringWidth/DecompressGlyphTile 全部对上），
  但**字节内容全新**——pokeE 的 hook 字节（含"复现被覆盖指令"逻辑）不能照搬
- 判断"地址一致"≠"可以搬字节"；hook 移植必须连被覆盖指令的差异一起适配
- baserom_E.gba / baserom_E_chs.gba 在仓库里都是全 FF 占位文件，不能当字节参照

### 8.3 最终交付

`tmp/PokemonQuetzal字库版_新的游戏.gba`：字库版 ROM + 字符串修改
（0x137E070: `C8 BF D1 00 C1 BB C7 BF` → `0E 4D 03 0B 0F 7C 0D DB`），
模拟器截图确认主菜单显示"新的游戏"。
