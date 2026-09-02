pi-gba-fontpatch
======

基于 gbajs2 模拟器构建的 **GBA 宝可梦改版 ROM 中文字库破解与补丁工具集**。通过在模拟器层 Hook 文本渲染函数，实现对游戏字符显示的捕获、分析，并自动生成中文字库补丁。

仓库地址：<https://github.com/nkuAlexLee/pi-gba-fontpatch>

## 核心组件

| 组件 | 说明 |
|------|------|
| `romctl.js` | 无头调试引擎（首选入口）：加载 ROM、跑帧、按键、截图、内存读写/快照对比、反汇编、文本函数 hook。`node romctl.js` 查看帮助 |
| `memview.html` | 浏览器可视化内存监视页：游戏画面 + 内存变化 + 反汇编 |
| `js/thumb-disassembler.js` | Thumb/ARM 离线反汇编器 |
| `js/fontcracker*.js` 等 | 字库扫描、码表推断、字形推理、补丁生成等破解工具链 |
| `fontpatch/` | 基于 armips 的 ROM 中文字库补丁源码（hook 点、汉字渲染函数、字库注入） |
| `.pi/skills/gba-font-crack/` | 破解全流程技能指南：正向分析范式、romctl 配方、槽位注入、案例库 |
| `docs/` | 开发文档（memview 架构与调试记录、字库扫描说明等） |

## 典型工作流

1. 将 `baserom_**.gba` 放入 `roms/` 目录（已 gitignore，不入库）
2. 用 `romctl.js` 或 `memview.html` 运行 ROM，hook 文本渲染函数（GetGlyphWidth / GetStringWidth / DrawGlyphTiles）捕获字符
3.结合码表（`wholewords.txt`）与字库（`.bin` 字模）推断字符编码映射
4. 用 `fontpatch/` 中的 armips 脚本将中文字库与渲染逻辑注入 ROM
5. 截图像素校验渲染结果，回归测试各场景（战斗、菜单、PC 等）

> 注：本仓库仅供学习研究，请自行准备 ROM 并遵守当地法律。

## AI Agent 驱动开发

本项目的 ROM 逆向分析与补丁制作主要由 **[pi](https://pi.dev/) 编码智能体** 调用本仓库内置的 skill（`.pi/skills/gba-font-crack/`）自动完成，涵盖定位渲染引擎、控制流分析、探针实证、字模槽位注入、字符串修改与截图像素校验等全流程。

**推荐配置**：

- 套餐：[OpenCode Go 套餐](https://opencode.ai)
- 模型：GLM-5.3-Flash

在 pi agent 中打开本仓库，agent 会自动加载 `gba-font-crack` skill 并按 SKILL.md 中的配方调用 `romctl.js` 等工具完成分析任务。

---

## gbajs2 -- Community Fork (Original)

gbajs2 is a Game Boy Advance emulator written in Javascript from scratch using HTML5 technologies like Canvas and Web Audio. 
It is freely licensed and works in any modern browser without plugins.

Use it online! <https://andychase.me/gbajs2>

See the [issues page](https://github.com/andychase/gbajs2/issues) for feature suggestions and ways you can help contribute!

## Feature List

* Playable compatibility, see [compatibility](https://github.com/andychase/gbajs2/wiki/Compatibility-List)
* Acceptable performance on modern browsers
* Pure javascript, allowing easy API access
* Realtime clock gamepad support (Pokemon Ruby)
* Save games

## License
Original work by Endrift. Repo: (Archived / No longer maintained) https://github.com/endrift/gbajs

Copyright © 2012 – 2013, Jeffrey Pfau
Copyright © 2020, Andrew Chase

All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice, this
  list of conditions and the following disclaimer.

* Redistributions in binary form must reproduce the above copyright notice,
  this list of conditions and the following disclaimer in the documentation
  and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
POSSIBILITY OF SUCH DAMAGE.
