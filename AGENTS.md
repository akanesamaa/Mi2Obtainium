# 项目约定

## Push 前必须验收

每次 push 前，先完成桌面端和手机端验收，再提交和推送。

最低检查项：

- 桌面端 1280 宽度
- 手机端 390 宽度
- 简体中文 / 繁体中文 / 英文三种语言
- 浅色 / 深色两种主题
- 搜索框 placeholder 不截断、不溢出
- 结果页卡片、二维码、footer 不溢出
- Pages 构建通过
- Worker 语法检查通过

推荐命令：

```bash
node --check worker/index.js
node scripts/export-pages.mjs
```

未完成两端验收时，不 push。
