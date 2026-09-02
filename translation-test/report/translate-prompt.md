# 翻译任务（Game Boy Advance 宝可梦改版汉化）

## 规则
1. 译文为简体中文，风格贴合宝可梦官方译名习惯
2. `glossary` 命中的术语必须使用指定译名
3. `[方括号]` 内为游戏引擎控制码/占位符，必须原样保留，位置可按中文语序调整
4. 编码后每汉字 2 字节，译文含控制码字节总长不得超过 `max_bytes`（含 1 字节终止符）
5. 输出 JSON 数组到 report/translations.json: [{"id":"...","zh":"..."}]，不要输出其他内容

## 任务
[
  {
    "id": "0137E070",
    "scene": "title-menu",
    "en": "NEW GAME",
    "context": "标题画面后的主菜单",
    "max_bytes": 9,
    "hint": "纯中文≤4字；每汉字2字节；控制码[...]原样保留",
    "glossary": [
      "NEW GAME→新的游戏"
    ]
  },
  {
    "id": "0137E079",
    "scene": "title-menu",
    "en": "CONTINUE",
    "context": "标题画面后的主菜单",
    "max_bytes": 9,
    "hint": "纯中文≤4字；每汉字2字节；控制码[...]原样保留",
    "glossary": [
      "CONTINUE→继续游戏"
    ]
  },
  {
    "id": "0137E082",
    "scene": "title-menu",
    "en": "OPTION",
    "context": "标题画面后的主菜单",
    "max_bytes": 7,
    "hint": "纯中文≤3字；每汉字2字节；控制码[...]原样保留",
    "glossary": [
      "OPTION→选项"
    ]
  },
  {
    "id": "0137E089",
    "scene": "title-menu",
    "en": "MYSTERY GIFT",
    "context": "标题画面后的主菜单",
    "max_bytes": 13,
    "hint": "纯中文≤6字；每汉字2字节；控制码[...]原样保留",
    "glossary": []
  },
  {
    "id": "0137E096",
    "scene": "title-menu",
    "en": "MYSTERY GIFT",
    "context": "标题画面后的主菜单",
    "max_bytes": 13,
    "hint": "纯中文≤6字；每汉字2字节；控制码[...]原样保留",
    "glossary": []
  },
  {
    "id": "0137E0A3",
    "scene": "title-menu",
    "en": "MYSTERY EVENTS",
    "context": "标题画面后的主菜单",
    "max_bytes": 15,
    "hint": "纯中文≤7字；每汉字2字节；控制码[...]原样保留",
    "glossary": []
  },
  {
    "id": "0137E0B2",
    "scene": "title-menu",
    "en": "The Wireless Adapter is not[/n]connected.",
    "context": "标题画面后的主菜单",
    "max_bytes": 39,
    "hint": "纯中文≤19字；每汉字2字节；控制码[...]原样保留",
    "glossary": []
  },
  {
    "id": "0137E0D9",
    "scene": "title-menu",
    "en": "MYSTERY GIFT can't be used while[/n]the Wireless Adapter is attached.",
    "context": "标题画面后的主菜单",
    "max_bytes": 67,
    "hint": "纯中文≤33字；每汉字2字节；控制码[...]原样保留",
    "glossary": []
  },
  {
    "id": "0137E11C",
    "scene": "title-menu",
    "en": "MYSTERY EVENTS can't be used while[/n]the Wireless Adapter is attached.",
    "context": "标题画面后的主菜单",
    "max_bytes": 69,
    "hint": "纯中文≤34字；每汉字2字节；控制码[...]原样保留",
    "glossary": []
  },
  {
    "id": "0137E161",
    "scene": "title-menu",
    "en": "Updating save file using external[/n]data. Please wait.",
    "context": "标题画面后的主菜单",
    "max_bytes": 53,
    "hint": "纯中文≤26字；每汉字2字节；控制码[...]原样保留",
    "glossary": []
  },
  {
    "id": "0137E196",
    "scene": "title-menu",
    "en": "The save file has been updated.",
    "context": "标题画面后的主菜单",
    "max_bytes": 32,
    "hint": "纯中文≤15字；每汉字2字节；控制码[...]原样保留",
    "glossary": []
  },
  {
    "id": "0137E1B6",
    "scene": "title-menu",
    "en": "The save file is corrupted. The[/n]previous save file will be loaded.",
    "context": "标题画面后的主菜单",
    "max_bytes": 67,
    "hint": "纯中文≤33字；每汉字2字节；控制码[...]原样保留",
    "glossary": []
  }
]