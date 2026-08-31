# IELTS Listening 项目协作规则

本文件是 Codex、Claude 和其他开发 Agent 的共同规则真相源。`AGENTS.md` 必须保持为指向本文件的软链接。

## 开始工作前

1. 先同步并核对 `origin/main`，不要把本地分支名或旧记忆当成线上事实。
2. 依次阅读 `README.md`、`docs/HANDOFF.md` 和 `CHANGELOG.md` 顶部记录。
3. 检查工作区已有改动；没有用户明确授权时，不覆盖、删除或发布他人的改动。

## 数据与代码真相源

- 飞书基础词快照：`source/feishu_listening.json`
- 个人错词：`source/custom_words.json`
- 基础词修订和停用：`source/vocabulary_overrides.json`
- `data/listening.json`、`data/audit.json` 和 `audio/` 是构建产物，禁止绕过源数据直接维护。
- 易混词独立使用 `source/confusions.json`，由 `scripts/build_confusions.py` 生成 `confusions/data/confusions.json`；不得写入 Listening 源数据或 `marcoIeltsListening.v1`。
- 训练端、后台和词库是三个独立版本；只新增词汇时不得提升训练端程序版本。

## 错词入库

- 听错、拼错、单复数或词形错误归 `spelling`；不认识、词义混淆、选项没看懂归 `recognition`；两种问题都有则同时加入。
- 单复数及规则词形必须归并到主词，不生成重复挑战。
- Codex 通过 `scripts/import_wrong_words.py` 更新源数据；网页端通过词库后台提交 GitHub Issue。
- 输入不确定时保留不确定性，不得静默补成确定结论。

## 验证与发布

词库或训练逻辑变更至少运行：

```bash
python scripts/build_listening.py
python scripts/generate_audio.py
python scripts/validate_release.py
node tests/test_logic.js
python scripts/build_confusions.py
python scripts/validate_confusions.py
node tests/test_confusions_logic.js
python -m unittest tests/test_vocabulary_admin.py
```

后台变更还要在 `admin/` 运行 `npm test`。真实浏览器验收统一使用 `scripts/run_playwright.sh`。用户明确要求推送或发布后，必须等待 GitHub Actions 完成并回读线上版本、词库和 Service Worker。

## 文档与交接硬规则

- 每次代码、配置、数据、工作流或文档改动，都必须在同一提交更新 `CHANGELOG.md`。
- 版本、部署、数据规模、接口、真相源或发布流程变化时，还必须就地更新 `docs/HANDOFF.md`。
- 自动错词工作流必须运行 `scripts/update_project_docs.py`，让词库批次同样留下记录。
- 提交前运行 `python scripts/check_docs_sync.py`；不得绕过失败结果。
- `README.md` 只维护当前产品入口和使用方式，不写开发流水账。

## 安全边界
- 密码、Cookie、GitHub Token 和 Cloudflare Secret 不进入代码、日志或文档。
- `admin/.dev.vars` 必须保持忽略；文档只记录 Secret 名称，不记录值。
- 默认一项需求使用一个分支；多人或多 Agent 并行时，先同步 `origin/main` 再合并，避免互相覆盖。

## 深入文档
- 当前可运行状态与接手步骤：`docs/HANDOFF.md`
- 全部变更记录：`CHANGELOG.md`
- 后台部署和运维：`admin/README.md`
