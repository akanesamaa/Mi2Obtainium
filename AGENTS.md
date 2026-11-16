# 项目约定

## 项目背景

Mi2Obtainium 解决 xiaomi.eu 上无法通过小米应用商店安装 APK 的问题，把小米应用商店页面转换成 Obtainium 可读取的更新源。

当前架构只有：

- GitHub Pages：搜索首页、搜索索引、共享 CSS / 字体
- Cloudflare Worker：解析、二维码、缓存

本地 Node 服务、Docker、本地 UI 已删除，不要重新引入。

详细决策和踩坑记录见 [docs/decision-log.md](docs/decision-log.md)。

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
