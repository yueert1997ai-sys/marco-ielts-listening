# IELTS Listening 50

手机端 IELTS Listening 基础词训练：每天 25 个听音拼写 + 25 个快速看义。

## 数据来源

- 飞书文档：`IELTS Listening 基础必备词汇表｜真题反推版 V1`
- 文档 token：`PMXRdM6RFouDlwxRZsWc3phPndf`
- `source/feishu_listening.json` 保存可复现快照
- `data/audit.json` 保存每次发布的词库审计结果

## 更新词库

```powershell
python scripts\fetch_feishu.py
python scripts\build_listening.py
python scripts\generate_audio.py
python scripts\validate_release.py
node tests\test_logic.js
```

网页本身是静态文件，学习进度只保存在当前手机浏览器，并可在首页导入、导出。
