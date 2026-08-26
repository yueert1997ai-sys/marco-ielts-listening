# IELTS Listening 50

手机端 IELTS Listening 基础词训练：每天 25 个听音拼写 + 25 个快速看义，支持分页浏览、全词发音、重点词、记忆阶段和跨端错词同步。首页另有独立的“方位检测”：标准模式用 10 道、2 秒限时题训练八方位，困难模式用 1.4 倍速音频只考四个 45° 方位，并要求 1 秒内作答；两种模式都不影响每日词汇进度。

## 记录新错词

- 手机端可直接粘贴带编号的单词列表、“单词+中文”或原有 JSON；页面会去编号并生成可编辑预览。
- 主词库已有的词会自动补中文释义；全新词在确认前需要补齐准确中文义。
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

## 手机端自动更新

- 手机始终使用同一个 GitHub Pages 链接，不需要为每个版本重新找地址。
- 网页首次打开、从后台回到主页、以及结束训练返回主页时会检查最新版本；发现更新后自动刷新。
- 自动更新不会在答题过程中强制打断，训练进度仍保存在手机浏览器中。

## 刷题节奏

- 答对后只显示短暂确认并自动进入下一题；答错、超时和“不会”仍保留完整复盘页。
- 听写题会自动聚焦输入框，下一题音频会提前加载。
- 短屏手机会自动压缩非必要留白，识义选项和结果页按钮优先保持在首屏内。

本地浏览器验收使用 `scripts/run_playwright.sh`，脚本已内置 Node/npm/npx 路径与 OpenSSL 兼容处理。
