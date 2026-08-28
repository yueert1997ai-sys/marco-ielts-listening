# 项目当前状态与交接

这份文档只描述当前仍然成立的事实。历史改动统一查看 [`CHANGELOG.md`](../CHANGELOG.md)。接手 Agent 不应仅凭聊天记忆判断版本或发布状态。

## 线上入口

- 训练端：<https://yueert1997ai-sys.github.io/marco-ielts-listening/>
- 词库后台：<https://marco-vocabulary-admin.marco-vocabulary-admin.workers.dev/>
- GitHub：<https://github.com/yueert1997ai-sys/marco-ielts-listening>

## 当前发布状态

<!-- VOCAB_STATUS_START -->
- 训练端程序版本：`v2.12.0`
- 后台程序版本：`v1.0.0`
- 正式词库：694 张主卡；听写 272 项；识词 473 项
- 个人错词：52 条；基础词覆盖：5 条；已停用：0 条
- 最后自动词库同步：2026-08-28，GitHub Issue #5
<!-- VOCAB_STATUS_END -->

- 最后完成线上运行态验收的提交：`83b7f07`
- 训练端由 GitHub Pages 托管；后台由 Cloudflare Worker + D1 托管。
- 词库后台只管理正式词库，不同步手机浏览器里的训练进度和记忆曲线。
- 训练端采用手机优先的墨黑中性色界面；首页不使用图形进度条，完成状态以文字数字表达，正确/错误反馈仅保留必要语义色。

## 系统结构

```text
飞书快照 ─────────────┐
个人错词 ─────────────┼─> build_listening.py ─> data/listening.json ─> GitHub Pages
基础词覆盖/停用 ──────┘                 └────> audio/ + data/audit.json

后台录入/编辑 ─> Cloudflare D1 队列 ─> GitHub Issue
               └─────────────────────> sync-wrong-words.yml ─> 校验、提交、发布
```

正式数据真相源：

- `source/feishu_listening.json`：飞书基础词快照
- `source/custom_words.json`：个人错词
- `source/vocabulary_overrides.json`：基础词修订和停用状态

不要直接维护 `data/listening.json`、`data/audit.json` 或音频清单；这些都应由构建流程生成。

## 版本规则

- 训练端代码或体验变化：提升 `version.json`、页面资源版本和 Service Worker 版本。
- 后台代码变化：提升 `admin/package.json` 的后台版本。
- 单纯新增或更新词汇：训练端程序版本不变，以 Git 提交、Issue 编号和最后同步日期作为词库版本。
- 手机上看到旧版时，先核对线上 `version.json` 和 `sw.js`，再判断是否是浏览器缓存。

## Agent 接手流程

1. 读取根目录 `CLAUDE.md`（`AGENTS.md` 是同源入口）、`README.md`、本文件和 `CHANGELOG.md` 顶部记录。
2. `git fetch origin main`，确认工作基准来自最新 `origin/main`。
3. 优先使用独立任务分支；修改前确认工作区没有未识别的用户改动。
4. 只改真相源，按 `CLAUDE.md` 运行对应构建和验证。
5. 同一提交更新 `CHANGELOG.md`；当前事实变化时同步更新本文件。
6. 推送后等待相关 GitHub Actions 完成，并回读公开训练端或后台。

## 发布与运维要点

- GitHub Issue 同步只接受仓库所有者创建的 `[错词同步]` 或 `[词库管理]` Issue。
- 自动同步成功后应提交源数据、构建数据、音频、`CHANGELOG.md` 和本文件，并关闭 Issue。
- Cloudflare Worker 所需 Secret：`ADMIN_PASSWORD_HASH`、`SESSION_SECRET`、`GITHUB_TOKEN`；不得记录具体值。
- `GITHUB_TOKEN` 应保持为仅该仓库、仅 Issues 读写的 fine-grained token。
- 本机浏览器验收使用 `scripts/run_playwright.sh`，不要自行拼接 Node/OpenSSL 环境变量。

## 最小验收

```bash
python scripts/check_docs_sync.py
python scripts/validate_release.py
node tests/test_logic.js
python -m unittest tests/test_vocabulary_admin.py tests/test_project_docs.py
cd admin && npm test
```

发布后至少回读：

- `version.json` 的程序版本
- `sw.js` 的 `APP_VERSION`
- `data/listening.json` 的主卡数量及本次目标词
- GitHub Actions 和同步 Issue 的最终状态

## 已知边界

- 手机训练进度只保存在对应浏览器本地，不在后台跨端同步。
- 本地模型只在词典缺失且浏览器支持 WebGPU 时按需使用；模型资源不随仓库发布。
- 没有确认中的产品或技术待办；新需求以 GitHub 最新状态为起点重新评估。
