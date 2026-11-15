import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, '.pages-cache');
const OUT = path.join(ROOT, '_site');

// Keep the build cache out of the real data/apps.json.
process.env.MI_DATA_DIR = CACHE;
await fs.mkdir(CACHE, { recursive: true });
await fs.rm(OUT, { recursive: true, force: true });
await fs.mkdir(OUT, { recursive: true });
await fs.cp(path.join(ROOT, 'public', 'fonts'), path.join(OUT, 'fonts'), {
  recursive: true,
});
await fs.copyFile(
  path.join(ROOT, 'public', 'favicon.svg'),
  path.join(OUT, 'favicon.svg'),
);
await fs.copyFile(
  path.join(ROOT, 'public', 'favicon-light.svg'),
  path.join(OUT, 'favicon-light.svg'),
);
await fs.copyFile(
  path.join(ROOT, 'public', 'styles.css'),
  path.join(OUT, 'styles.css'),
);

// Reuse the category-name -> id map when present, so a Pages build does not
// have to probe ~30 tiny endpoints every time.
try {
  await fs.copyFile(
    path.join(ROOT, 'data', 'categories.json'),
    path.join(CACHE, 'categories.json'),
  );
} catch {
  /* The resolver will probe the live category list if the cache is absent. */
}

const { resolveApp, directApkUrl } = await import('../lib/xiaomi.js');
const { ensureSearchIndex } = await import('../lib/search.js');
const {
  buildConfig,
  buildDeepLink,
  renderObtainiumPage,
  pageUrl,
  apkUrl,
  escapeHtml,
} = await import('../lib/obtainium.js');
const { qrDataUri } = await import('../lib/qr.js');

function baseUrl() {
  let raw = (process.env.BASE_URL || '').trim();
  if (!raw) {
    const repo = (process.env.GITHUB_REPOSITORY || '').trim();
    if (repo) {
      const [owner, name] = repo.split('/');
      raw =
        name.toLowerCase() === `${owner.toLowerCase()}.github.io`
          ? `https://${owner}.github.io`
          : `https://${owner}.github.io/${name}`;
    } else {
      raw = 'http://localhost:8787';
    }
  }
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  return raw.replace(/\/+$/, '');
}

const BASE = baseUrl();
const WORKER = (() => {
  let raw = (process.env.WORKER_URL || '').trim();
  if (!raw) return '';
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  return raw.replace(/\/+$/, '');
})();

async function readPackages() {
  const raw = JSON.parse(
    await fs.readFile(path.join(ROOT, 'packages.json'), 'utf8'),
  );
  const list = Array.isArray(raw) ? raw : raw.apps;
  if (!Array.isArray(list)) {
    throw new Error('packages.json 必须是 ["包名"] 或 { "apps": ["包名"] }');
  }
  const packages = [
    ...new Set(
      list
        .map((item) => (typeof item === 'string' ? item : item?.pkg))
        .filter(Boolean)
        .map((item) => String(item).trim())
        .filter(Boolean),
    ),
  ];
  if (packages.length === 0) throw new Error('packages.json 里没有包名');
  return packages;
}

function iconHtml(app) {
  const letter = escapeHtml(String(app.name || '?').trim().slice(0, 1) || '?');
  const img = app.icon
    ? `<img src="${escapeHtml(app.icon)}" alt="" onerror="this.remove()">`
    : '';
  return `<span class="icon"><span class="letter">${letter}</span>${img}</span>`;
}

function appCard(item) {
  const { app, config, deepLink, sourceUrl, download } = item;
  const stale = app.stale
    ? '<span class="badge stale">缓存</span>'
    : '';
  return `<article class="app">
    <div class="app-head">
      ${iconHtml(app)}
      <div class="app-title">
        <h3>${escapeHtml(app.name)} <span class="version">v${escapeHtml(
          app.version,
        )}</span>${stale}</h3>
        <p class="pkg">${escapeHtml(app.pkg)}</p>
        <p class="meta">${[
          app.sizeText,
          app.updated ? `更新于 ${app.updated}` : '',
          app.author,
        ]
          .filter(Boolean)
          .map(escapeHtml)
          .join(' · ')}</p>
      </div>
    </div>
    <div class="actions">
      <a class="btn primary" href="${escapeHtml(
        deepLink,
      )}">在 Obtainium 中添加</a>
      <button class="btn ghost" type="button" data-copy="${escapeHtml(
        deepLink,
      )}">复制深链</button>
      <a class="btn ghost" href="${escapeHtml(
        download,
      )}" target="_blank" rel="noreferrer">下载 APK</a>
    </div>
    <div class="source">
      <code>${escapeHtml(sourceUrl)}</code>
      <button type="button" data-copy="${escapeHtml(sourceUrl)}">复制源</button>
    </div>
    <details>
      <summary>手动配置 / 不弹 Obtainium 时</summary>
      <table>
        <tr><td>来源</td><td><code>HTML</code></td></tr>
        <tr><td>页面地址</td><td><code>${escapeHtml(sourceUrl)}</code></td></tr>
        <tr><td>版本正则</td><td><code>([^/]+)\\.apk</code></td></tr>
        <tr><td>匹配组</td><td><code>$1</code></td></tr>
      </table>
      <button class="btn ghost small" type="button" data-copy="${escapeHtml(
        JSON.stringify(config, null, 2),
      )}">复制配置 JSON</button>
    </details>
  </article>`;
}

const SEARCH_TEMPLATE = await fs.readFile(
  new URL('./pages-home.html', import.meta.url),
  'utf8',
);

function searchHtml(total) {
  return SEARCH_TEMPLATE.replaceAll(
    '__WORKER__',
    JSON.stringify(WORKER),
  ).replaceAll('__TOTAL__', String(total));
}

function landingHtml(items, errors, siteQr) {
  const generated = new Date().toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
  });
  const errorBlock = errors.length
    ? `<details class="errors"><summary>${errors.length} 个应用这次没有生成，展开查看原因</summary><ul>${errors
        .map(
          (e) =>
            `<li><code>${escapeHtml(e.pkg)}</code>：${escapeHtml(e.error)}</li>`,
        )
        .join('')}</ul></details>`
    : '';
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#f4efe8">
<title>小米应用商店 → Obtainium</title>
<style>
@font-face{font-family:'Google Sans';font-style:normal;font-weight:400 700;font-display:swap;src:url('fonts/GoogleSans-var.woff2') format('woff2')}:root{--bg:#ffffff;--surface:#ffffff;--surface2:#fafafa;--line:#e6e6e6;--text:#0a0a0a;--muted:#6f6f6f;--muted2:#9a9a9a;--accent:#111111;--accent2:#222222;--green:#111111;--greenbg:#f0f0f0;--red:#b42318;--radius:22px;--font:"MiSans VF","MiSans","Google Sans","Noto Sans SC","Microsoft YaHei","PingFang SC",system-ui,sans-serif;--mono:"Cascadia Code",Consolas,monospace}
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:var(--bg);color:var(--text);font-family:var(--font);font-size:15px;line-height:1.6}
a{color:inherit;text-decoration:none}code{font-family:var(--mono);font-size:.86em;background:var(--surface2);border:1px solid rgba(0,0,0,.08);border-radius:6px;padding:1px 6px;word-break:break-all}
.shell{width:min(1040px,calc(100% - 32px));margin:0 auto;padding:26px 0 48px}
.top{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:24px}
.brand{display:flex;align-items:center;gap:12px}.mark{width:44px;height:44px;border-radius:14px;background:#111;color:#fff;display:grid;place-items:center;font-size:21px;font-weight:800;box-shadow:0 10px 22px -10px rgba(0,0,0,.25)}
.brand h1{margin:0;font-size:17px;letter-spacing:-.2px}.brand p{margin:0;color:var(--muted);font-size:12px}
.build{color:var(--muted2);font-size:12px}
.hero{background:#fff;border:1px solid var(--line);border-radius:28px;padding:30px;display:grid;grid-template-columns:1fr auto;gap:28px;align-items:center;box-shadow:0 20px 50px -30px rgba(0,0,0,.22);margin-bottom:24px}
.eyebrow{margin:0 0 8px;color:var(--accent);font-size:11px;font-weight:700;letter-spacing:.2em}
.hero h2{margin:0 0 10px;font-size:clamp(24px,3.4vw,36px);letter-spacing:-1px;line-height:1.15}
.lede{margin:0;color:var(--muted);font-size:14px;max-width:58ch}.warn{margin:10px 0 0;color:var(--muted2);font-size:12px}
.qr{text-align:center}.qr img{width:190px;height:190px;background:#fff;border:1px solid var(--line);border-radius:16px;padding:6px;display:block}.qr p{margin:6px 0 0;font-size:10.5px;color:var(--muted2);word-break:break-all;max-width:190px}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
.app{background:#fff;border:1px solid var(--line);border-radius:var(--radius);padding:18px;box-shadow:0 14px 34px -24px rgba(0,0,0,.18);min-width:0}
.app-head{display:flex;gap:12px;align-items:flex-start;min-width:0}
.icon{position:relative;width:54px;height:54px;flex:0 0 auto;border-radius:15px;overflow:hidden;background:#f5f5f5;border:1px solid var(--line)}
.icon .letter{position:absolute;inset:0;display:grid;place-items:center;color:#333;font-weight:800;font-size:20px}.icon img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}
.app-title{min-width:0;flex:1}.app-title h3{margin:0;font-size:15.5px;line-height:1.35;overflow-wrap:anywhere}.version{display:inline-block;margin-left:4px;padding:1px 8px;border-radius:999px;background:var(--greenbg);color:var(--green);font-family:var(--mono);font-size:10.5px;font-weight:700;vertical-align:2px}
.badge.stale{display:inline-block;margin-left:4px;padding:1px 7px;border-radius:999px;background:#f5f5f5;color:#555;font-size:10px;vertical-align:2px}
.pkg{margin:2px 0 0;font-family:var(--mono);font-size:11px;color:var(--muted);word-break:break-all}.meta{margin:3px 0 0;font-size:11px;color:var(--muted2)}
.actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:13px}.btn{display:inline-flex;align-items:center;justify-content:center;border:1px solid transparent;border-radius:10px;padding:8px 12px;font-size:12px;font-weight:700;line-height:1.2;cursor:pointer;white-space:nowrap}
.btn.primary{background:#111;color:#fff;box-shadow:0 10px 20px -12px rgba(0,0,0,.35)}.btn.ghost{background:var(--surface2);border-color:var(--line);color:var(--muted)}.btn.small{padding:6px 10px;font-size:11.5px}
.source{display:flex;align-items:center;gap:6px;margin-top:11px;min-width:0}.source code{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10.5px;background:transparent;border:0;padding:0}.source button{border:0;background:transparent;color:var(--muted);font-size:10.5px;padding:3px 5px;border-radius:6px}
details{margin-top:11px;border-top:1px dashed var(--line);padding-top:9px}summary{cursor:pointer;font-size:11.5px;color:var(--muted);font-weight:700}table{width:100%;border-collapse:collapse;margin-top:8px;font-size:11px}td{padding:4px 6px;border-bottom:1px solid var(--line);vertical-align:top}td:first-child{width:84px;color:var(--muted2)}
.errors{background:#fafafa;border:1px solid var(--line);border-radius:16px;padding:12px 16px;margin-bottom:20px;color:#333;font-size:12px}.errors ul{margin:8px 0 0;padding-left:18px}.errors li{margin:3px 0;word-break:break-all}
.foot{margin-top:28px;color:var(--muted2);font-size:11px;line-height:1.7;text-align:center}
@media(max-width:760px){.hero{grid-template-columns:1fr;padding:22px}.qr{display:none}.grid{grid-template-columns:1fr}.app{padding:15px}.actions .btn.primary{flex:1}}
</style>
</head>
<body>
<main class="shell">
  <header class="top">
    <div class="brand"><span class="mark">米</span><div><h1>小米应用商店 → Obtainium</h1><p>GitHub Pages 静态更新源</p></div></div>
    <div class="build"><a class="btn primary small" href="search.html">搜索全部应用</a> <span>生成于 ${escapeHtml(generated)}</span></div>
  </header>

  <section class="hero">
    <div>
      <p class="eyebrow">GITHUB PAGES</p>
      <h2>不用局域网，也不用开电脑</h2>
      <p class="lede">这些页面由 GitHub Actions 定时生成。点应用卡片上的「在 Obtainium 中添加」，或者在 Obtainium 里手动填 HTML 源。APK 直连小米 CDN，不经过任何中转服务器。</p>
      <p class="warn">静态快照：新版本要等下一次 Action 运行后才会出现。默认每 6 小时一次，也可以在 Actions 里手动运行。</p>
    </div>
    <div class="qr"><img src="${siteQr}" alt="本页二维码"><p>${escapeHtml(
      BASE + '/',
    )}</p></div>
  </section>

  ${errorBlock}

  <section class="grid">
    ${items.map(appCard).join('\n')}
  </section>

  <footer class="foot">
    <p>页面地址：<code>${escapeHtml(
      BASE + '/',
    )}</code></p>
    <p>APK 来自 <code>f5.market.xiaomi.com</code> · 版本/名称来自 <code>app.mi.com</code></p>
    <p>由 GitHub Actions 生成，仅供个人更新备份使用。</p>
  </footer>
</main>
<script>
document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-copy]');
  if (!button) return;
  const text = button.getAttribute('data-copy');
  const original = button.textContent;
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch {}
  if (!ok) {
    const area = document.createElement('textarea');
    area.value = text; area.style.position = 'fixed'; area.style.opacity = '0';
    document.body.appendChild(area); area.select();
    try { ok = document.execCommand('copy'); } catch {}
    area.remove();
  }
  button.textContent = ok ? '已复制' : '复制失败';
  setTimeout(() => { button.textContent = original; }, 1200);
});
</script>
</body>
</html>`;
}

const packages = await readPackages();
const results = [];
const errors = [];

console.log(`Base URL: ${BASE}`);
console.log(`Packages: ${packages.length}`);

for (const pkg of packages) {
  const started = Date.now();
  try {
    const app = await resolveApp(pkg, { force: true });
    if (!directApkUrl(app)) {
      throw new Error('没有哈希直链（只有签名链接，静态站无法代理）');
    }
    if (app.stale) console.warn(`  ! ${pkg} 使用缓存结果`);
    await fs.mkdir(path.join(OUT, 'o', pkg), { recursive: true });
    await fs.writeFile(
      path.join(OUT, 'o', pkg, 'index.html'),
      renderObtainiumPage(app, BASE),
      'utf8',
    );
    results.push({
      app,
      config: buildConfig(app, BASE),
      deepLink: buildDeepLink(app, BASE),
      sourceUrl: pageUrl(app, BASE),
      download: apkUrl(app, BASE),
      elapsed: Date.now() - started,
    });
    console.log(`  ✓ ${pkg} ${app.version} (${Date.now() - started}ms)`);
  } catch (error) {
    errors.push({ pkg, error: error.message });
    console.error(`  ✗ ${pkg}: ${error.message}`);
  }
}

let searchApps = [];
try {
  searchApps = await ensureSearchIndex();
} catch (error) {
  console.warn(`[pages] search index failed: ${error.message}`);
}
await fs.writeFile(
  path.join(OUT, 'search-index.json'),
  JSON.stringify({ builtAt: Date.now(), apps: searchApps }),
  'utf8',
);
const homeHtml = searchHtml(searchApps.length);
await fs.writeFile(path.join(OUT, 'index.html'), homeHtml, 'utf8');
await fs.writeFile(path.join(OUT, 'search.html'), homeHtml, 'utf8');
console.log(
  `[pages] search index: ${searchApps.length} apps; worker: ${
    WORKER || '(not configured)'
  }`,
);

await fs.writeFile(path.join(OUT, '.nojekyll'), '', 'utf8');
await fs.writeFile(
  path.join(OUT, 'robots.txt'),
  'User-agent: *\nDisallow: /\n',
  'utf8',
);
await fs.writeFile(
  path.join(OUT, 'apps.json'),
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      baseUrl: BASE,
      apps: results.map((item) => ({
        pkg: item.app.pkg,
        name: item.app.name,
        version: item.app.version,
        updated: item.app.updated,
        sizeText: item.app.sizeText,
        pageUrl: item.sourceUrl,
        apkUrl: item.download,
        deepLink: item.deepLink,
        config: item.config,
        stale: !!item.app.stale,
      })),
      errors,
    },
    null,
    2,
  ),
  'utf8',
);

console.log(`\nGenerated ${results.length} app(s), ${errors.length} error(s)`);
console.log(`Output: ${OUT}`);

if (results.length === 0) {
  console.error('没有生成任何应用，构建失败。');
  process.exit(1);
}











