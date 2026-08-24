# IELTS Listening 50

手机端 IELTS Listening 基础词训练：每天 25 个听音拼写 + 25 个快速看义，支持分页浏览、全词发音、重点词、记忆阶段和跨端错词同步。

## 记录新错词

- 任意 ChatGPT：让它输出 `term / meaning / mode / reason` 的 JSON，粘贴进网页“错词收件箱”。
- 任意 Codex：项目根目录的 `AGENTS.md` 会指导它通过 `scripts/import_wrong_words.py` 入库。
- 跨设备同步：网页会生成 GitHub 同步单；仅仓库所有者提交的同步单会触发自动校验、音频生成和发布。
- 分类规则：听错或拼错进入 `spelling`，不认识或词义混淆进入 `recognition`，两种情况进入两类。
- 单数和规则复数只保留一张主卡，不会把 `curtain` / `curtains` 当成两个挑战；英美拼写差异仍分别保留。

## 数据来源

- 飞书文档：`IELTS Listening 基础必备词汇表｜真题反推版 V1`
- 文档 token：`PMXRdM6RFouDlwxRZsWc3phPndf`
- `source/feishu_listening.json` 保存可复现快照
- `data/audit.json` 保存每次发布的词库审计结果

## 更新词库

```powershell
python scripts/fetch_feishu.py
python scripts/build_listening.py
python scripts/generate_audio.py
python scripts/validate_release.py
node tests/test_logic.js
```

网页本身是静态文件。训练进度、重点词和未提交的个人错词保存在当前浏览器，并可在首页导入、导出；提交到 GitHub 的错词会进入公共词库，在所有设备生效。
