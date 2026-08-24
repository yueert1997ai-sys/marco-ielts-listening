# IELTS 错词入库约定

当用户要求新增阅读或听力错词时：

1. 从原话中提取英文、准确中文义、错误原因。
2. 听错、拼错、单复数或词形错误归 `spelling`；不认识、词义混淆、选项没看懂归 `recognition`；两种问题都有则同时加入两类。
3. 使用 `scripts/import_wrong_words.py` 更新 `source/custom_words.json`，不要直接手改生成文件 `data/listening.json`。
4. 依次运行 `scripts/build_listening.py`、`scripts/generate_audio.py`、`scripts/validate_release.py` 和 `node tests/test_logic.js`。
5. 报告新增、合并、拒绝的条目以及验证结果。没有用户明确授权时不要推送仓库。

通用输入格式：

```json
[
  {
    "term": "accommodation",
    "meaning": "住宿",
    "mode": "spelling",
    "reason": "拼错了双 c 和双 m"
  }
]
```

Windows、macOS、Linux 和 Codex 云端均使用同一 Python 脚本。网页 ChatGPT 只需输出上述 JSON，用户可粘贴到网页的“错词收件箱”。
