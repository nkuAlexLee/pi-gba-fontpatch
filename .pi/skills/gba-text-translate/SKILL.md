---
name: gba-text-translate
description: GBA 宝可梦改版 ROM 文本汉化流水线（基于 gba-font-crack 的字库成果）：字符串导出为翻译工程 CSV、AI/人工双轨编辑、导入前门禁校验、原地覆盖与扩容重指向（指针扫描）回填 ROM。当需要把改版 ROM 的英文文本翻译为中文、批量提取/回填游戏字符串、处理文本超长需改指针指向的问题时使用。
---

# GBA 文本汉化 — 四阶段流水线

> **前置条件**：目标 ROM 必须已完成中文字库注入（见 `../gba-font-crack/`，如 Quetzal 字库版基座），
> 否则中文无法渲染。本 skill 解决"文本内容汉化"，不解决"渲染能力"。
>
> **★ 与 gba-font-crack 的分工**：字库/引擎/hook/截图验证用 `gba-font-crack`；
> 字符串批量提取、翻译协作、回填用本 skill。两者共享同一套码表（wholewords.txt）。

## 一、核心矛盾与策略决策树

中文 2 字节/字、12px 宽；英文 1 字节/字、~8px 宽。中文字符数通常只有英文一半，
**多数消息原地覆盖即可，超长才走扩容重指向**（实测 100 条对话文本 100% 原地，
平均字节利用率 61%）：

```
译文编码+FF ≤ 原串字节数？
├── 是 → 【原地覆盖】指针零风险（import 自动走这条）
└── 否 → 全 ROM 指针扫描（4字节小端 == 0x08000000+偏移）
    ├─ 有引用 → 【repoint】新串写入 append_addr（4字节对齐），全部指针改指新址，原址清 FF
    └─ 无引用 → 跳过+报告：偏移表 / 运行时生成指针 / LZ77 压缩，需人工分析
```

⚠ 定长缓冲区（玩家名/精灵昵称/Box名等）只能原地覆盖且常常有更小的真实上限，
翻译时宁短勿长。

## 一.5、★基座选型（决定翻译能力上限，先于一切）

| 基座类型 | 中文能力 | 能翻什么 |
|----------|----------|----------|
| 双字节引擎（Quetzal/RechargedYellow/红龙传说字库版） | 全量字库（~7000 字） | **整句对话、任意文本** ✅ 大规模汉化唯一选择（RY 闭环已验证，见 cases/RechargedYellow-整句翻译闭环） |
| 槽位注入（XTREME/EliteRedux v6，码 0x87+ 单字节槽） | 仅几个注入槽位的字 | **词级替换**（菜单项 ≤6 字）|

- XTREME 实测：整句译文含槽位外汉字 → 引擎按单字节流渲染 → 空白/乱码
- 判别方法：看基座的码表是否含双字节汉字码（wholewords.txt 体系）→ 有则双字节引擎；
  仅有 0x87-0x9F 单字节槽 → 槽位方案
- 翻译前先确认基座类型，再决定批量策略

## 二、翻译工程结构（单一事实源）

```
translation/                    # 或自定义 --project 目录
├── project.json                # ROM 路径/码表/append_addr/输出路径（init 生成，手工核对）
├── glossary.csv                # 术语表：en,zh,note（AI 和人工都必须遵守）
├── strings/<场景>.csv          # 每场景一个文件，id=8位hex文件偏移（稳定主键）
├── report/                     # 工具生成的任务包/校验报告（不手改）
└── import-backup/              # 导入快照
```

**CSV 列**（`id,addr_gba,scene,context,max_bytes,max_chars,en,mt,final,status,notes`）：

| 列 | 谁写 | 说明 |
|----|------|------|
| en | 工具 | 原文，锁定 |
| mt | AI | 机器初译 |
| final | 人 | 人工终审，非空则导入优先 |
| status | 工具 | untranslated → machine-translated → human-reviewed；conflict/locked 不导入 |
| max_bytes | 工具 | 原串字节数+终止符 = 原地覆盖预算；超出走 repoint |
| max_chars | 工具 | 纯中文字符数提示（=(max_bytes-1)/2） |

## 三、工具链（scripts/，bash 调用）

```bash
cd .pi/skills/gba-text-translate/scripts

# ⓪a 生成/更新基准码表（wholewords + pokeE PMRSEFRLG 补缺 → charmap-base.txt，
#    补 fd05=[unk:fd05]、箭头、< > ▶ 等符号；语义未实证的码标 [unk:xx]，翻译时原样保留）
node merge-charmap.js

# ⓪b 生成/更新宝可梦官方术语表（4137 条词级译名，源自 gui_related/translate 官方对照表；
#    机翻剧情语料不可靠，不采用）。数据源: D:/vibecoding/gui_related/translate
node build-glossary.js [数据源目录]

# ① 初始化翻译工程（一次性，之后手工核对 project.json 的 append_addr）
node export-strings.js init --project ../../../../translation --rom <ROM路径>

# ② 提取（三选一，按质量排序）：
#    ★ dump 指针引导导出（首选）：扫 ROM 内 4 字节指针→跟随→解码，
#      天然排除无引用垃圾；每条自带 [ptr:...] 元数据，repoint 直接复用免二次扫描
node export-strings.js dump --project <目录> --scene main-text
#      参数: --from/--to 限定范围；--lang en(默认,拒汉字混入)/zh；--min-ratio 0.9 可读率
#      置信度多重保险:
#        · noHan 模式(lang=en 自动启用): 禁用汉字双字节解码，
#          消除 05b8=纪 与 05=È+b8=, 的码表歧义，并修复 fd01[玩家] 等控制码命中
#        · 语言一致性(英文基板拒 CJK) + 可读率≥90%（token 挖除后统计；
#          en 白名单仅 éñ°ºª¿¡，大写重音视为噪声）
#        · 重叠别名剔除（串中段指针，数千条）
#        · 中段半句回溯剔除（串首前一字节≠FF → 回溯 FF 边界验证，数百条）
#        · 极短串(≤4字符)纯 ASCII 词法要求
#    probe 文本区密度探测（定位文本区辅助）
node export-strings.js probe --project <目录>
#    scan 盲扫（补充，垃圾多，仅用于已知纯净区域；--han 开汉字解码供中文基座）
node export-strings.js scan --project <目录> --scene title-menu --addr 0x0937E070 --len 0x180
#    add 精确登记（已知地址逐条）
node export-strings.js add  --project <目录> --scene title-menu --addr 0x0937E070

# ③ AI 翻译：生成任务包 → agent 翻译产出 JSON → 应用到 mt 列
node translate-batch.js prepare --project <目录>
#    agent 读 report/translate-prompt.md，把译文写 report/translations.json（[{"id","zh"}]）
#    ★ 大批量推荐子 agent 并行（见下方「子 agent 并行翻译」）
node translate-batch.js apply --project <目录>
#    单条写入（agent/人工脚本化）：--col final 写后自动 human-reviewed
node translate-batch.js set --project <目录> --scene title-menu --id 0137E070 --col final --text "新的游戏"

# ④ 人工终审：直接用 Excel/WPS 编辑 strings/*.csv 的 final 列（UTF-8 CSV，勿存 xlsx）

# ⑤ 门禁校验（任何硬错误禁止导入；--strict 把术语警告升级为错误）
node validate.js --project <目录>

# ⑥ 回填 ROM（先 --dry-run 看策略，再实跑；--allow-mt 允许机器译直接上）
node insert-strings.js --project <目录> --dry-run
node insert-strings.js --project <目录>

# ⑦ 验证：回 gba-font-crack 流程，romctl 加载输出 ROM 截图逐场景核对
```

**AI 与人工协作规则**：
- AI 只通过 `translate-batch.js` 写入，不手改 CSV；只填 mt
- 人工用 Excel 编辑，只动 mt/final/notes 列
- 采纳 AI 译法 = 复制到 final 再修改；保留 final 可随时对比 AI 原译
- 重导出（ROM 更新）自动 merge：en 未变保留全部翻译；en 变了 status=conflict 待裁决

## 三.5、★ 子 agent 并行翻译（大规模批量推荐）

translate-batch 的 prepare/apply 与 pi 子 agent fanout 配合，实现多批并行：

1. **选批**：从 strings/*.csv 筛选子集（按场景/长度/控制码类型）建独立场景文件
2. **切批**：每批 50 条切任务 JSON 到 `report/mimo-batch-N.json`
3. **fanout**：subagent workflowScript 并行，每批一个 worker（`model: opencode-go/mimo-v2.5`），
   任务 prompt 必须内联：半角标点 / [token] 原样保留 / 汉字 2B 字节预算 / 术语官方译名表
4. **汇总**：各批输出合并为 report/translations.json → apply → validate
5. **失败重试**：apply 拒绝的条目（多为丢控制码）打包单独重试，prompt 加严
   「token 出现次数必须与原文完全一致，翻前翻后各数一遍」

实测（XTREME 200 条 NPC 对话，MiMo V2.5）：首轮 93% 通过，重试后 100%；
193 条全部原地覆盖，字节利用率平均 62%，零 repoint。

## 四、标准执行范式（新 ROM 汉化七步）

1. **确认基座**：中文字库已注入？场景在哪？（用 gba-font-crack 的 trace/hook 定位字符串地址）
2. **init + scan**：逐场景提取。优先顺序：标题/主菜单 → 系统菜单 → 开场白 → 对话 → 图鉴/道具等大表
3. **翻译批次**：prepare → agent 翻译（遵守 glossary 与 max_bytes）→ apply；**菜单项必人工终审**
4. **validate**：清零硬错误（缺字 H2 → 需扩字库回 fontpatch；控制码 H3 → 改译文）
5. **dry-run 回填**：审查每条策略；repoint 条目核对指针数量是否合理（指针表条目常见 1-4 处）
6. **实跑回填** → romctl 加载输出 ROM → 逐场景截图（NEW GAME 范式）
7. **归档**：成功案例写 `cases/`，登记到 cases/README.md

## 五、踩坑与陷阱清单

1. **id 是唯一主键** = 8 位 hex 文件偏移；重导出 merge 全靠它，勿手改
2. **指针扫描逐字节步进**（脚本区指针未必 4 对齐）；命中数异常多（>8）先怀疑误命中，
   用 `--dry-run` + 已知布局核对
3. **append_addr 必须人工确认为空闲区**（init 默认给 ROM 末尾前 0x10000，改版未必成立）；
   扫描确认方法：该区域全 FF 或经 gba-font-crack 案例验证的空槽区
4. **同一串多处引用**：repoint 会把扫到的全部改掉，漏扫 = 中英混显；
   引用数和场景数对不上时用 gba-font-crack 的 watch-read.js 动态补抓
5. **0x01-0x1E 重音字母区冲突**（RS 系）：非英语基板（西语等）静态文本含 Á/é 等，
   解码后按单字节正常处理，但**翻译成中文后**原单字节码被双字节中文码覆盖，注意
   `max_bytes` 是按原串算的，重音字母同样占 1 字节，预算不受影响
6. **控制码 token 必须原样保留**（[PK]/[玩家]/[文本色00] 等），validate H3 强制；
   占位符位置可按中文语序移动
7. **标点归一化已内置**：机翻/人工输入的全角标点（，？！：""等）写入前自动转为
   码表可编码形式（借鉴 gui_related translator.py 后处理链）；Quetzal 系码表无全角标点
8. **机翻质量门槛**：原文含英文单词而译文无中文 → apply 直接拒绝（防 LLM 返回原文）
9. **Excel 保存 CSV 会丢 BOM/换格式**：用 WPS/Excel 打开时选"CSV UTF-8"；
   校验失败先怀疑文件被另存为非 UTF-8
10. **原地覆盖残尾清 FF**：中文串比英文短时，残余字节必须填 FF（终止符），
   残留旧英文会中英混显 —— import 已自动处理，勿手工改 ROM 绕过
11. **压缩文本**：解码出现大量 invalid 字节 → 可能 LZ77，先解压再提取（导入需重压缩，
   本 skill 暂不支持，人工专项处理）
12. **重叠串互踩**：指针表中存在指向同一物理串中段的别名指针 → dump 会导出两条
   重叠记录，回填互相覆盖。已防御：dump 自动剔除串中段别名（重叠别名 N 条），
   insert 按地址序检测重叠跳过并报告
13. **码表不全 → 半句与乱串**：wholewords 缺 fd05 等控制码、且汉字双字节码与
   英文重音字母序列存在天然歧义（05b8=纪 vs 05=È+b8=,）→ 完整串被语言过滤器误杀、
   半句失去重叠锚点漏入。已防御：charmap-base 补缺 + decode noHan 模式（lang=en 自动）+
   中段半句回溯剔除。新 ROM 首次 dump 后务必抽检：接续标点开头/ Latin 扩展堆/极短串
14. **子 agent 并行翻译丢控制码**：LLM 首轮约 7% 丢 [/n][/p]，门禁拦截后打包重试
   （prompt 加严 token 计数核对）可达 100%；勿跳过 validate 直接导入
15. **FD 系占位符跨基板语义不同**（Quetzal: fd01=玩家；FireRed 系: fd00 疑似玩家），
   且存在大量未收录码（fd0f/fd10 等）。占位符由引擎运行时展开、不进字库，
   翻译时只需 token 原样保留。decode 已将未知 FD 对合并为 [fdxx] 占位，
   禁止拆成 [/v]+高位字节的垃圾组合
16. **以有字库 ROM 为蓝本**：同一字库体系（Emerald 家族 charmap + 字形格式）的 ROM
   共享码表与字库；翻译工程基座优先选「引擎自带中文或已注入字库」的 ROM
   （RY 原版即自带），原版无字库的基座需先走 gba-font-crack 注入字库再翻译

## 六、与 romctl/gba-font-crack 的衔接

- 字符串地址未知 → 用 gba-font-crack 的 `romctl.js hook` + `watch-read.js` 动态定位，
  把抓到的地址用本 skill `add` 登记进工程
- 回填后的验证 → `node romctl.js load <输出ROM>` → 跑到场景 → 截图 →
  `scripts/bmp-ascii.js` 像素比对（成功判据同 NEW GAME 范式）
- 缺字（validate H2）→ 新汉字需先注入字库（gba-font-crack 流程），再回来重新 validate

## 七、资源

- **码表**（复用 gba-font-crack）：`../gba-font-crack/assets/wholewords.txt`
- **字模**：`../gba-font-crack/assets/gba_chs_font_11x11.bin`
- **案例**：`cases/README.md`（首个案例 = Quetzal 主菜单全汉化闭环）
- 已验证基座：`roms/PokemonQuetzalAlpha7v0(字库).gba`（主菜单串 @GBA 0x0937E070，
  指针表 @文件 0x2F800 附近）
