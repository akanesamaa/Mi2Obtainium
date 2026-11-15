const BASE = 'https://app.mi.com';
const CDN_HOST = 'https://f5.market.xiaomi.com/download/';
const PAGES_BASE = 'https://akanesamaa.github.io/Mi2Obtainium';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const CATEGORY_MAP = {
  金融理财: [1],
  聊天社交: [2],
  旅行交通: [3],
  居家生活: [4],
  实用工具: [5],
  摄影摄像: [6],
  图书阅读: [7],
  体育运动: [8],
  时尚购物: [9],
  效率办公: [10],
  新闻资讯: [11],
  学习教育: [12],
  娱乐消遣: [13],
  医疗健康: [14],
  网游RPG: [15, 16, 19, 21],
  动作枪战: [17],
  赛车体育: [18],
  棋牌桌游: [20],
  格斗快打: [22],
  休闲创意: [23],
  飞行空战: [25],
  跑酷闯关: [26],
  影音视听: [27],
  塔防迷宫: [28],
  模拟经营: [29],
};

const PACKAGE_RE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/;

export class WorkerError extends Error {
  constructor(message, code = 'RESOLVE_FAILED', status = 502) {
    super(message);
    this.name = 'WorkerError';
    this.code = code;
    this.status = status;
  }
}

export function normalizePackage(input) {
  const text = String(input ?? '').trim();
  if (!text) throw new WorkerError('请提供包名或小米链接', 'BAD_INPUT', 400);
  const idMatch = text.match(/[?&]id=([A-Za-z0-9._]+)/);
  if (idMatch) return checkPackage(idMatch[1]);
  const pkgMatch = text.match(/([A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+)/);
  if (pkgMatch) return checkPackage(pkgMatch[1]);
  throw new WorkerError('没有在输入里找到包名', 'BAD_INPUT', 400);
}

function checkPackage(pkg) {
  if (!PACKAGE_RE.test(pkg) || pkg.length > 200) {
    throw new WorkerError(`包名格式不正确：${pkg}`, 'BAD_INPUT', 400);
  }
  return pkg;
}

function decodeEntities(text) {
  return String(text)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    );
}

function textOf(html) {
  return decodeEntities(
    String(html)
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' '),
  ).trim();
}

async function request(url, { timeout = 15000, retries = 1 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': UA,
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.5',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(timeout),
      });
      if (response.status >= 500 && attempt < retries) {
        lastError = new Error(`HTTP ${response.status}`);
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
    }
  }
  throw new WorkerError(
    `连接小米应用商店失败：${lastError?.message || '网络错误'}`,
    'UPSTREAM',
    502,
  );
}

export async function fetchDetails(pkg) {
  const url = `${BASE}/details?id=${encodeURIComponent(pkg)}`;
  const response = await request(url);
  if (!response.ok) {
    throw new WorkerError(
      `小米应用商店没有找到 ${pkg}（HTTP ${response.status}）`,
      'NOT_FOUND',
      404,
    );
  }
  const html = await response.text();

  const nameMatch = html.match(
    /<div[^>]*class="[^"]*intro-titles[^"]*"[^>]*>[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>/i,
  );
  const name = textOf(nameMatch?.[1] || '');
  if (!name) {
    throw new WorkerError(
      `小米应用商店没有找到 ${pkg}，或者应用已下架`,
      'NOT_FOUND',
      404,
    );
  }

  const fields = {};
  const fieldRe =
    /<div class="float-(?:left|right)">\s*<div[^>]*>([\s\S]*?)<\/div>\s*<div[^>]*>([\s\S]*?)<\/div>/gi;
  for (const match of html.matchAll(fieldRe)) {
    const key = textOf(match[1]).replace(/\s+/g, '');
    const value = textOf(match[2]);
    if (key && value && fields[key] === undefined) fields[key] = value;
  }

  const version = fields['版本号'] || '';
  if (!version) {
    throw new WorkerError(
      `没有在 ${pkg} 页面读到版本号，页面结构可能变了`,
      'PARSE_FAILED',
      502,
    );
  }

  const categoryLineMatch = html.match(
    /<p[^>]*class="[^"]*action[^"]*"[^>]*>([\s\S]*?)<\/p>/i,
  );
  const categoryLine = textOf(categoryLineMatch?.[1] || '');
  const category =
    (categoryLine.match(/分类[：:]\s*([^|]+)/) || [])[1]?.trim() || '';

  let signedUrl = '';
  const downloadTag = html.match(
    /<a\b[^>]*class="[^"]*allowDownload[^"]*"[^>]*>/i,
  )?.[0];
  if (downloadTag) {
    const src = downloadTag.match(/\bsrc="([^"]+)"/i)?.[1];
    const href = downloadTag.match(/\bhref="([^"]+)"/i)?.[1];
    const candidate = src || href || '';
    if (candidate && !/^javascript:/i.test(candidate)) {
      signedUrl = decodeEntities(candidate).trim();
      if (signedUrl && !/^https?:/i.test(signedUrl)) {
        signedUrl = new URL(signedUrl, BASE).toString();
      }
      if (!/^https?:/i.test(signedUrl)) signedUrl = '';
    }
  }

  const iconMatch =
    html.match(
      /<img[^>]*class="[^"]*yellow-flower[^"]*"[^>]*src="([^"]+)"/i,
    ) || html.match(/<div class="app-info">[\s\S]*?<img[^>]*src="([^"]+)"/i);
  let icon = decodeEntities(iconMatch?.[1] || '').trim();
  if (icon.startsWith('//')) icon = `https:${icon}`;
  if (icon.startsWith('http://')) icon = `https://${icon.slice(7)}`;

  const appId =
    (fields['appID'] || '').replace(/\D/g, '') ||
    (signedUrl.match(/\/download\/(\d+)/) || [])[1] ||
    '';

  return {
    pkg,
    name,
    author: fields['开发者'] || '小米应用商店',
    version,
    icon,
    sizeText: fields['软件大小'] || '',
    updated: fields['更新时间'] || '',
    category,
    appId,
    signedUrl,
    sourceUrl: url,
  };
}

async function fetchCategoryApps(id, page) {
  const url = `${BASE}/categotyAllListApi?page=${page}&categoryId=${id}&pageSize=5000`;
  const response = await request(url);
  if (!response.ok) return [];
  const json = await response.json();
  return Array.isArray(json.data) ? json.data : [];
}

export async function findApkHash(category, pkg) {
  let ids = CATEGORY_MAP[category] || [];
  const fallback = ids.length === 0;
  if (fallback) {
    ids = Array.from({ length: 45 }, (_, index) => index + 1);
  }
  for (let page = 0; page < (fallback ? 1 : 3); page += 1) {
    const pages = await Promise.all(
      ids.map((id) => fetchCategoryApps(id, page).catch(() => [])),
    );
    for (const list of pages) {
      const hit = list.find((item) => item?.packageName === pkg && item?.apk);
      if (hit) {
        return {
          apk: hit.apk,
          appId: hit.appId || '',
          apkSizeKb: Number(hit.apkSize) || 0,
        };
      }
    }
  }
  return null;
}

export async function resolveApp(input) {
  const pkg = normalizePackage(input);
  const details = await fetchDetails(pkg);
  const hashInfo = await findApkHash(details.category, pkg);
  const targetType = hashInfo?.apk ? 'hash' : details.signedUrl ? 'signed' : '';
  const targetUrl = hashInfo?.apk
    ? `${CDN_HOST}${hashInfo.apk}/${encodeURIComponent(details.version)}.apk`
    : details.signedUrl;
  if (!targetType || !targetUrl) {
    throw new WorkerError(
      `${pkg} 没有可用的下载直链`,
      'NO_DOWNLOAD',
      422,
    );
  }

  const app = {
    ...details,
    appId: details.appId || hashInfo?.appId || '',
    apkHash: hashInfo?.apk || '',
    apkSizeKb: hashInfo?.apkSizeKb || 0,
    targetType,
    targetUrl,
    directUrl: targetType === 'hash' ? targetUrl : '',
    proxyUrl: '',
    cdnUrl: targetType === 'hash' ? targetUrl : details.signedUrl,
  };

  return { app, pkg, version: app.version };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildConfig(app, origin) {
  const pageUrl = `${origin}/o/${encodeURIComponent(app.pkg)}`;
  const filename = `${app.pkg}-${app.version}.apk`;
  const apkUrl = app.targetUrl;
  return {
    id: app.pkg,
    url: pageUrl,
    author: app.author,
    name: app.name,
    latestVersion: app.version,
    apkUrls: JSON.stringify([[filename, apkUrl]]),
    preferredApkIndex: 0,
    additionalSettings: JSON.stringify({
      versionExtractionRegEx: '([^/]+)\\.apk',
      matchGroupToUse: '$1',
      versionDetection: true,
      autoApkFilterByArch: false,
      refreshBeforeDownload: app.targetType !== 'hash',
    }),
    overrideSource: 'HTML',
  };
}

function renderPage(app, origin) {
  const config = buildConfig(app, origin);
  const deepLink = `obtainium://app/${encodeURIComponent(JSON.stringify(config))}`;
  const pageUrl = config.url;
  const filename = `${app.pkg}-${app.version}.apk`;
  const icon = String(app.icon || '').replace(/^http:\/\//i, 'https://');
  const letter = String(app.name || app.pkg || '?').slice(0, 1);
  const typeLabel =
    app.targetType === 'hash' ? '分类索引哈希' : '页面签名链接';
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta id="themeColor" name="theme-color" content="#ffffff">
<link id="favicon" rel="icon" href="${PAGES_BASE}/favicon-light.svg?v=3" type="image/svg+xml">
<title>${escapeHtml(app.name)} · Obtainium</title>
<script>
(function () {
  try {
    var theme = localStorage.getItem('mi-theme');
    if (theme !== 'light' && theme !== 'dark') theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    document.documentElement.dataset.theme = theme;
    var favicon = document.getElementById('favicon');
    if (favicon) favicon.href = theme === 'dark' ? '${PAGES_BASE}/favicon.svg?v=5' : '${PAGES_BASE}/favicon-light.svg?v=3';
    var lang = localStorage.getItem('mi-lang');
    if (lang !== 'zh-Hans' && lang !== 'zh-Hant' && lang !== 'en') {
      lang = 'zh-Hans';
      var list = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || 'zh-CN'];
      for (var i = 0; i < list.length; i += 1) {
        var code = String(list[i] || '').toLowerCase();
        if (code.indexOf('zh') === 0) lang = /hant|tw|hk|mo/.test(code) ? 'zh-Hant' : 'zh-Hans';
        else lang = 'en';
        break;
      }
    }
    document.documentElement.lang = lang === 'zh-Hant' ? 'zh-Hant' : lang === 'en' ? 'en' : 'zh-CN';
  } catch (error) {}
})();
</script>
<style>
@import url('${PAGES_BASE}/fonts/manrope/Manrope.css');
@import url('${PAGES_BASE}/fonts/noto-sans-sc/NotoSansSC.css');
@font-face{font-family:'Google Sans';font-style:normal;font-weight:400 700;font-display:swap;src:url('${PAGES_BASE}/fonts/GoogleSans-var.woff2') format('woff2')}
:root{color-scheme:light;--bg:#fff;--text:#0a0a0a;--muted:#777;--muted2:#9a9a9a;--line:#e6e6e6;--soft:#f5f5f5;--soft2:#fafafa;--xiaomi:#ff6900;--obtainium:#7c4dff;--font:"Manrope","Noto Sans SC","Google Sans","Microsoft YaHei","PingFang SC",system-ui,sans-serif}
:root[data-theme="dark"]{color-scheme:dark;--bg:#0f0f10;--text:#f3f3f1;--muted:#a5a5a0;--muted2:#777773;--line:#2b2b2e;--soft:#1a1a1c;--soft2:#141416}
*{box-sizing:border-box}body{margin:0;padding:34px 18px 60px;background:var(--bg);color:var(--text);font-family:var(--font);-webkit-font-smoothing:antialiased;font-size:15px;line-height:1.6;transition:background-color .18s ease,color .18s ease}
a{color:inherit;text-decoration:none}.wrap{width:min(720px,100%);margin:0 auto}
.top-controls{position:absolute;top:17px;right:20px;z-index:40;display:flex;align-items:center;gap:8px}.lang-switch{display:flex;align-items:center;height:27px;padding:2px;border:1px solid var(--line);border-radius:6px;background:var(--soft)}.lang-switch button{height:100%;border:0;border-radius:4px;display:flex;align-items:center;justify-content:center;background:transparent;color:var(--muted);padding:0 8px;font-size:11px;line-height:1;font-family:var(--font);cursor:pointer}.lang-switch button:hover{color:var(--text)}.lang-switch button[aria-pressed="true"]{background:var(--bg);color:var(--text);box-shadow:0 1px 4px rgba(0,0,0,.1)}.theme-toggle{width:27px;height:27px;padding:0;border:1px solid var(--line);border-radius:4px;display:grid;place-items:center;background:var(--bg);color:var(--text);cursor:pointer}.theme-toggle:hover{background:var(--soft);border-color:var(--muted2)}.theme-toggle svg{width:15px;height:15px;display:block}.theme-toggle .icon-moon{display:none}:root[data-theme="dark"] .theme-toggle .icon-sun{display:none}:root[data-theme="dark"] .theme-toggle .icon-moon{display:block}
.top{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:34px;color:var(--muted);font-size:12px}
.top a{color:var(--muted)}.top a:hover{color:var(--text)}.top span{color:var(--muted2)}
.brand{display:flex;align-items:center;gap:9px;font-weight:700;color:var(--text);font-size:14px;letter-spacing:-.2px}
.brand-xiaomi{color:var(--xiaomi)}.brand-obtainium{color:var(--obtainium)}.brand-sep{color:var(--muted2);font-weight:400}
.mark{width:28px;height:28px;border-radius:9px;background:#111;color:#fff;display:grid;place-items:center;font-size:13px;font-weight:700}
.card{background:#fff;border:1px solid var(--line);border-radius:10px;padding:24px;box-shadow:0 20px 55px -34px rgba(0,0,0,.35)}
.head{display:flex;align-items:flex-start;gap:15px}
.icon{position:relative;width:64px;height:64px;flex:0 0 auto;border-radius:10px;overflow:hidden;background:#f5f5f5;border:1px solid var(--line);display:grid;place-items:center;font-size:23px;font-weight:700;color:#555}
.icon img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.title{min-width:0;flex:1}.title h1{margin:0;font-size:23px;line-height:1.25;letter-spacing:-.6px;overflow-wrap:anywhere}
.badge{display:inline-block;margin-left:5px;padding:2px 9px;border-radius:999px;background:#111;color:#fff;font-family:"Cascadia Code",Consolas,monospace;font-size:11px;font-weight:700;vertical-align:2px}
.pkg{margin:3px 0 0;font-family:"Cascadia Code",Consolas,monospace;font-size:11.5px;color:var(--muted);word-break:break-all}
.byline{margin:4px 0 0;font-size:12px;color:var(--muted2)}
.actions{display:flex;flex-wrap:wrap;gap:7px;margin-top:18px}
.btn{display:inline-flex;align-items:center;justify-content:center;border:1px solid transparent;border-radius:4px;padding:9px 14px;font-size:12.5px;font-weight:700;line-height:1.2;cursor:pointer;white-space:nowrap;font-family:var(--font)}
.btn.primary{background:#111;color:#fff;box-shadow:0 10px 20px -12px rgba(0,0,0,.4)}.btn.obtainium{background:var(--obtainium);color:#fff;box-shadow:0 10px 24px -14px rgba(124,77,255,.7)}.btn.obtainium:hover{background:#6a3fe8}
.btn.ghost{background:#fafafa;border-color:var(--line);color:#555}
.meta{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px;margin-top:18px}
.meta div{padding:10px 11px;border-radius:6px;background:#fafafa;border:1px solid #f0f0f0;min-width:0}
.meta span{display:block;color:var(--muted2);font-size:10.5px}.meta strong{display:block;margin-top:2px;font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.source{margin-top:18px;padding-top:15px;border-top:1px solid var(--line);display:flex;align-items:center;gap:7px;min-width:0}
.source span{flex:0 0 auto;color:var(--muted2);font-size:10.5px}.source code{flex:1;min-width:0;font-family:"Cascadia Code",Consolas,monospace;font-size:10.5px;color:var(--muted);overflow-x:auto;overflow-y:hidden;text-overflow:clip;white-space:nowrap;scrollbar-width:thin;-webkit-overflow-scrolling:touch}
.apk-line{display:flex;align-items:center;gap:7px;margin-top:9px;min-width:0}.apk-line span{flex:0 0 auto;color:var(--muted2);font-size:10.5px}
.apk-line .apk{flex:1;min-width:0;font-family:"Cascadia Code",Consolas,monospace;font-size:10.5px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-decoration:underline;text-underline-offset:2px}
.hint{margin:16px 0 0;color:var(--muted2);font-size:11px;line-height:1.7}
.foot{margin-top:22px;text-align:center;color:var(--muted2);font-size:10.5px;line-height:1.7}
@media(max-width:560px){body{padding:48px 13px 50px}.card{padding:18px;border-radius:10px}.head{gap:11px}.icon{width:56px;height:56px;border-radius:9px}.title h1{font-size:20px}.meta{grid-template-columns:repeat(2,minmax(0,1fr))}.top{margin-bottom:24px}.actions .btn.primary{flex:1}}
@media(max-width:720px){.top-controls{top:12px;right:14px;gap:6px}.lang-switch{height:25px}.lang-switch button{padding:0 7px;font-size:10.5px}.theme-toggle{width:25px;height:25px}}
@media(max-width:380px){.lang-switch button{padding:0 6px;font-size:10px}}
:root[data-theme="dark"] .card{background:#141416;border-color:var(--line);box-shadow:0 20px 55px -34px rgba(0,0,0,.9)}
:root[data-theme="dark"] .mark{background:var(--text);color:var(--bg)}
:root[data-theme="dark"] .icon{background:var(--soft);border-color:var(--line)}
:root[data-theme="dark"] .badge{background:var(--text);color:var(--bg)}
:root[data-theme="dark"] .btn.primary{background:var(--text);color:var(--bg);box-shadow:0 10px 20px -12px rgba(0,0,0,.8)}
:root[data-theme="dark"] .btn.ghost{background:var(--soft2);border-color:var(--line);color:var(--muted)}
:root[data-theme="dark"] .meta div{background:var(--soft2);border-color:var(--line)}
:root[data-theme="dark"] .source{border-top-color:var(--line)}
:root[data-theme="dark"] .top-controls{color:var(--text)}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}
</style>
</head>
<body data-app-type="${escapeHtml(app.targetType)}">
<div class="top-controls">
  <div class="lang-switch" role="group" aria-label="语言 / Language">
    <button type="button" data-lang="zh-Hans" aria-pressed="true">简中</button>
    <button type="button" data-lang="zh-Hant" aria-pressed="false">繁中</button>
    <button type="button" data-lang="en" aria-pressed="false">EN</button>
  </div>
  <button id="themeToggle" class="theme-toggle" type="button" aria-label="切换深色模式" title="切换深色模式">
    <svg class="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="3.5"></circle><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"></path></svg>
    <svg class="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.4 14.2A8.5 8.5 0 0 1 9.8 3.6 8.5 8.5 0 1 0 20.4 14.2Z"></path></svg>
  </button>
</div>
<main class="wrap">
  <header class="top">
    <a class="brand" href="${PAGES_BASE}/"><span class="mark">米</span> <span class="brand-xiaomi" id="storeTitle">小米应用商店</span> <span class="brand-sep">›</span> <span class="brand-obtainium">Obtainium</span></a>
    <span id="serviceLabel">Cloudflare Worker</span>
  </header>

  <article class="card">
    <div class="head">
      <span class="icon">${escapeHtml(letter)}${icon ? `<img src="${escapeHtml(icon)}" alt="" onerror="this.remove()">` : ''}</span>
      <div class="title">
        <h1>${escapeHtml(app.name)} <span class="badge">v${escapeHtml(app.version)}</span></h1>
        <p class="pkg">${escapeHtml(app.pkg)}</p>
        <p class="byline">${escapeHtml(app.author)}${app.category ? ` · ${escapeHtml(app.category)}` : ''}</p>
      </div>
    </div>

    <div class="meta">
      <div><span data-i18n="version">版本</span><strong>${escapeHtml(app.version)}</strong></div>
      <div><span data-i18n="size">大小</span><strong id="sizeValue" data-empty="${app.sizeText ? '0' : '1'}">${escapeHtml(app.sizeText || '未知')}</strong></div>
      <div><span data-i18n="updated">更新日期</span><strong id="updatedValue" data-empty="${app.updated ? '0' : '1'}">${escapeHtml(app.updated || '未知')}</strong></div>
      <div><span data-i18n="sourceType">直链来源</span><strong id="sourceValue" data-type="${escapeHtml(app.targetType)}">${typeLabel}</strong></div>
    </div>

    <div class="actions">
      <a class="btn obtainium" id="addBtn" href="${escapeHtml(deepLink)}" data-i18n="addObtainium">在 Obtainium 中添加</a>
      <button class="btn ghost" id="copyDeep" type="button" data-deep="${escapeHtml(deepLink)}" data-i18n="copyDeep">复制深链</button>
      <a class="btn ghost" id="downloadApk" href="${escapeHtml(app.targetUrl)}" target="_blank" rel="noreferrer" data-i18n="downloadApk">下载 APK</a>
    </div>

    <div class="source"><span data-i18n="htmlSource">HTML 源</span><code title="${escapeHtml(pageUrl)}" tabindex="0">${escapeHtml(pageUrl)}</code></div>
    <div class="apk-line"><span class="source-label">APK</span><a class="apk" href="${escapeHtml(app.targetUrl)}">${escapeHtml(filename)}</a></div>
    <p class="hint" id="hint">APK 由手机直连小米 CDN 下载；Obtainium 每次检查都会重新解析这个 Worker 页面。</p>
  </article>

  <p class="foot" id="foot">由 Cloudflare Worker 实时解析 · ${escapeHtml(PAGES_BASE.replace(/^https?:\/\//, ''))}</p>
</main>
<script>
(function () {
  var LANG_KEY = 'mi-lang';
  var THEME_KEY = 'mi-theme';
  var LANGS = ['zh-Hans', 'zh-Hant', 'en'];
  var STR = {
    'zh-Hans': {
      storeName: '小米应用商店', languageGroup: '语言',
      themeToDark: '切换深色模式', themeToLight: '切换浅色模式',
      version: '版本', size: '大小', updated: '更新日期', sourceType: '直链来源',
      hashSource: '分类索引哈希', signedSource: '页面签名链接', unknown: '未知',
      addObtainium: '在 Obtainium 中添加', copyDeep: '复制深链', downloadApk: '下载 APK', copied: '已复制',
      htmlSource: 'HTML 源',
      hint: 'APK 由手机直连小米 CDN 下载；Obtainium 每次检查都会重新解析这个 Worker 页面。',
      foot: '由 Cloudflare Worker 实时解析 · {base}'
    },
    'zh-Hant': {
      storeName: '小米應用商店', languageGroup: '語言',
      themeToDark: '切換深色模式', themeToLight: '切換淺色模式',
      version: '版本', size: '大小', updated: '更新日期', sourceType: '直連來源',
      hashSource: '分類索引雜湊', signedSource: '頁面簽名連結', unknown: '未知',
      addObtainium: '在 Obtainium 中加入', copyDeep: '複製深層連結', downloadApk: '下載 APK', copied: '已複製',
      htmlSource: 'HTML 來源',
      hint: 'APK 由手機直連小米 CDN 下載；Obtainium 每次檢查都會重新解析這個 Worker 頁面。',
      foot: '由 Cloudflare Worker 即時解析 · {base}'
    },
    en: {
      storeName: 'Xiaomi App Store', languageGroup: 'Language',
      themeToDark: 'Switch to dark mode', themeToLight: 'Switch to light mode',
      version: 'Version', size: 'Size', updated: 'Updated', sourceType: 'Source',
      hashSource: 'Category index hash', signedSource: 'Signed page URL', unknown: 'Unknown',
      addObtainium: 'Add in Obtainium', copyDeep: 'Copy deep link', downloadApk: 'Download APK', copied: 'Copied',
      htmlSource: 'HTML source',
      hint: 'The APK downloads directly from Xiaomi CDN on your phone; Obtainium re-resolves this Worker page on every check.',
      foot: 'Resolved live by Cloudflare Worker · {base}'
    }
  };
  var lang = document.documentElement.lang === 'zh-Hant' ? 'zh-Hant' : document.documentElement.lang === 'en' ? 'en' : 'zh-Hans';

  function t(key, vars) {
    var table = STR[lang] || STR['zh-Hans'];
    var text = table[key] || STR['zh-Hans'][key] || key;
    return String(text).replace(/\\{(\\w+)\\}/g, function (_, name) { return String((vars || {})[name] || ''); });
  }

  function applyTheme(next, persist) {
    var theme = next === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.theme = theme;
    if (persist) { try { localStorage.setItem(THEME_KEY, theme); } catch (e) {} }
    var meta = document.getElementById('themeColor');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0f0f10' : '#ffffff');
    var favicon = document.getElementById('favicon');
    if (favicon) favicon.href = theme === 'dark' ? '${PAGES_BASE}/favicon.svg?v=5' : '${PAGES_BASE}/favicon-light.svg?v=3';
    var button = document.getElementById('themeToggle');
    if (button) {
      var label = theme === 'dark' ? t('themeToLight') : t('themeToDark');
      button.setAttribute('aria-label', label);
      button.setAttribute('title', label);
    }
  }

  function applyLanguage(next, persist) {
    lang = LANGS.indexOf(next) >= 0 ? next : 'zh-Hans';
    if (persist) { try { localStorage.setItem(LANG_KEY, lang); } catch (e) {} }
    document.documentElement.lang = lang === 'zh-Hant' ? 'zh-Hant' : lang === 'en' ? 'en' : 'zh-CN';
    var store = document.getElementById('storeTitle');
    if (store) store.textContent = t('storeName');
    document.querySelectorAll('[data-i18n]').forEach(function (node) {
      node.textContent = t(node.getAttribute('data-i18n'));
    });
    var source = document.getElementById('sourceValue');
    if (source) source.textContent = t(source.getAttribute('data-type') === 'hash' ? 'hashSource' : 'signedSource');
    var size = document.getElementById('sizeValue');
    if (size && size.getAttribute('data-empty') === '1') size.textContent = t('unknown');
    var updated = document.getElementById('updatedValue');
    if (updated && updated.getAttribute('data-empty') === '1') updated.textContent = t('unknown');
    var hint = document.getElementById('hint');
    if (hint) hint.textContent = t('hint');
    var foot = document.getElementById('foot');
    if (foot) foot.textContent = t('foot', { base: '${escapeHtml(PAGES_BASE.replace(/^https?:\/\//, ''))}' });
    var group = document.querySelector('.lang-switch');
    if (group) group.setAttribute('aria-label', t('languageGroup'));
    document.querySelectorAll('[data-lang]').forEach(function (button) {
      button.setAttribute('aria-pressed', String(button.getAttribute('data-lang') === lang));
    });
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light', false);
  }

  document.querySelectorAll('[data-lang]').forEach(function (button) {
    button.addEventListener('click', function () { applyLanguage(button.getAttribute('data-lang'), true); });
  });
  var themeToggle = document.getElementById('themeToggle');
  if (themeToggle) themeToggle.addEventListener('click', function () {
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark', true);
  });
  try {
    var media = matchMedia('(prefers-color-scheme: dark)');
    if (media.addEventListener) media.addEventListener('change', function (event) {
      try { if (localStorage.getItem(THEME_KEY)) return; } catch (e) {}
      applyTheme(event.matches ? 'dark' : 'light', false);
    });
  } catch (e) {}
  try {
    window.addEventListener('languagechange', function () {
      try { if (localStorage.getItem(LANG_KEY)) return; } catch (e) {}
      var next = navigator.languages && navigator.languages.length ? navigator.languages[0] : navigator.language;
      next = String(next || '').toLowerCase();
      applyLanguage(!next.indexOf('zh') ? (/hant|tw|hk|mo/.test(next) ? 'zh-Hant' : 'zh-Hans') : 'en', false);
    });
  } catch (e) {}

  var button = document.getElementById('copyDeep');
  if (button) {
    button.addEventListener('click', async function () {
      var text = button.getAttribute('data-deep') || '';
      var ok = false;
      try { await navigator.clipboard.writeText(text); ok = true; }
      catch (e) {
        var area = document.createElement('textarea');
        area.value = text; area.style.position = 'fixed'; area.style.opacity = '0';
        document.body.appendChild(area); area.select();
        try { ok = document.execCommand('copy'); } catch (error) {}
        area.remove();
      }
      button.textContent = ok ? t('copied') : t('copyDeep');
      setTimeout(function () { button.textContent = t('copyDeep'); }, 1500);
    });
  }

  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light', false);
  applyLanguage(lang, false);
})();
</script>
</body>
</html>`;
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

async function handle(request) {
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  if (url.pathname === '/health') {
    return Response.json({ ok: true, service: 'mi2obtainium-worker' });
  }

  if (url.pathname === '/api/resolve') {
    try {
      const input = url.searchParams.get('input') || url.searchParams.get('pkg');
      const resolved = await resolveApp(input);
      const config = buildConfig(
        resolved.app,
        `${url.protocol}//${url.host}`,
      );
      return Response.json(
        {
          ok: true,
          app: resolved.app,
          pageUrl: config.url,
          apkUrl: resolved.app.targetUrl,
          deepLink: `obtainium://app/${encodeURIComponent(
            JSON.stringify(config),
          )}`,
        },
        { headers: corsHeaders() },
      );
    } catch (error) {
      return Response.json(
        {
          ok: false,
          error: { code: error.code || 'ERROR', message: error.message },
        },
        {
          status: error.status || 500,
          headers: corsHeaders(),
        },
      );
    }
  }

  const match = url.pathname.match(/^\/o\/([^/]+)\/?$/);
  if (!match) {
    return new Response('mi2obtainium worker: use /o/<package>', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  const pkg = decodeURIComponent(match[1]);
  try {
    const { app } = await resolveApp(pkg);
    const html = renderPage(app, `${url.protocol}//${url.host}`);
    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control':
          app.targetType === 'hash'
            ? 'public, max-age=900, s-maxage=900'
            : 'no-store',
      },
    });
  } catch (error) {
    return new Response(
      `<h1>解析失败</h1><p>${escapeHtml(error.message)}</p>`,
      {
        status: error.status || 502,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      },
    );
  }
}

export default {
  fetch(request) {
    return handle(request);
  },
};
















