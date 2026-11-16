# 项目决策记录

## 时间线

### 2026-11-14

项目起点是 xiaomi.eu 上安装小米应用商店后无法正常安装 APK，但用户仍想继续使用小米应用商店。

早期尝试过本地服务：

- 本地 Node 服务提供搜索、结果页和二维码
- 通过局域网访问
- 依赖本机运行

后来确认这条路线不适合长期使用，开始改为全量在线方案。

### 2026-11-15

GitHub 仓库重建为空的 `mi2obtainium`，重新做了一次干净提交。

同一天完成了：

- Worker + Pages 架构
- 本地服务、Docker、启动脚本删除
- Worker 结果页改用共享 `public/styles.css`
- Worker 端生成二维码
- Cache API 默认开启
- 主题和语言在 Pages / Worker 之间同步

## 当前架构

```text
GitHub Pages
  搜索首页 + search-index.json
        │
        ▼
Cloudflare Worker
  /o/<包名> 实时解析 + 缓存
        │
        ▼
小米 CDN
  APK 下载
```

## 关键决策

### 不保留本地服务

项目只保留 Worker + Pages，不再维护本地 Node UI。

因此：

- 不新增 `server.js`
- 不新增本地启动脚本
- 不把本地页面作为功能依赖

### Worker 与 Pages 共用一套样式

Worker 结果页直接引用 Pages 上的：

```text
/styles.css
```

不再维护 Worker 内联样式。

### 字体必须使用相对路径

`styles.css` 位于 Pages 的子路径下，字体必须写：

```css
@import url("fonts/manrope/Manrope.css");
```

不能写：

```css
@import url("/fonts/manrope/Manrope.css");
```

否则会请求到域名根目录并 404。

### 二维码由 Worker 生成

Worker 端使用 `qrcode` 生成二维码，二维码指向 Pages 的：

```text
/?pkg=<包名>
```

不再依赖本地 `/qr` 接口。

### 主题和语言跨域同步

Pages 和 Worker 是不同域名，`localStorage` 不共享。

同步方式：

- 用户手动切换后，Pages 链接带上 `?theme=` 和 `?lang=`
- Worker 读取后写入自己的 `localStorage`
- 参数应用后从地址栏移除
- 没有手动切换时，不带参数，继续跟随系统

### Cache API 默认启用

Worker 默认使用：

```js
caches.default
```

- 小米详情页缓存 15 分钟
- 分类接口缓存 15 分钟
- 哈希直链结果页缓存 15 分钟
- 签名链接页面不缓存

响应头用 `X-Cache: HIT / MISS` 观察命中。

## 已经踩过的坑

- 目录改名后 pnpm junction 失效
- `packages.json` 为空导致 Pages 构建失败
- Pages 导出漏掉 `styles.css`
- 字体使用根路径导致搜索后字体丢失
- 重构时漏掉二维码
- 删除 `lib/qr.js` 后 Pages 构建找不到模块
- `pages.yml` 没监听 `scripts/pages-home.html`
- 连续切换主题导致颜色错乱
- 主题修改过度导致失去过渡
- 手机端长 placeholder 和英文标题溢出

## 发布约定

每次 push 前必须完成：

- 桌面端 1280 验收
- 手机端 390 验收
- 简中 / 繁中 / EN
- 浅色 / 深色
- Pages 构建通过
- Worker 语法检查通过

具体规则见根目录 `AGENTS.md`。
