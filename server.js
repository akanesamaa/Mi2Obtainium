import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import QRCode from 'qrcode';

import { PUBLIC_DIR } from './lib/paths.js';
import {
  loadStore,
  allApps,
  getApp,
  deleteApp,
  appCount,
} from './lib/store.js';
import {
  resolveApp,
  normalizePackage,
  ResolveError,
  isFreshForDownload,
} from './lib/xiaomi.js';
import {
  buildDeepLink,
  buildManual,
  buildConfig,
  renderObtainiumPage,
  pageUrl,
  apkUrl,
  proxyUrl,
  escapeHtml,
} from './lib/obtainium.js';
import { proxyApk } from './lib/apk.js';
import { qrDataUri } from './lib/qr.js';
import { searchApps, getSearchStatus } from './lib/search.js';
import { getIcon, getIconDataUri } from './lib/icon.js';

const VERSION = '1.0.0';

function detectLanIp() {
  const candidates = [];
  for (const [name, addresses] of Object.entries(os.networkInterfaces())) {
    for (const address of addresses || []) {
      if (address.family !== 'IPv4' || address.internal) continue;
      if (/^198\.18\./.test(address.address)) continue; // fake-IP proxy range
      if (/^169\.254\./.test(address.address)) continue; // link-local
      candidates.push({ name, address: address.address });
    }
  }
  const preferred = candidates.find((item) =>
    /wlan|wi-?fi|ethernet|以太网|无线/i.test(item.name),
  );
  return (preferred || candidates[0])?.address || '127.0.0.1';
}

const PORT = Number(process.env.PORT) || 8787;
const PUBLIC_HOST = process.env.PUBLIC_HOST || detectLanIp();
const STARTED_AT = Date.now();

function baseUrlFor(req) {
  const proto = req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
  const host = req.headers.host;
  if (host) {
    const hostname = host.split(':')[0].replace(/^\[|\]$/g, '');
    if (!/^(localhost|127\.0\.0\.1|::1)$/i.test(hostname)) {
      return `${proto}://${host}`;
    }
  }
  return `http://${PUBLIC_HOST}:${PORT}`;
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
    'X-Content-Type-Options': 'nosniff',
    // Windows + a local proxy can make browsers reuse a half-closed socket;
    // one request per connection is far more reliable for this tool.
    Connection: 'close',
  });
  res.end(body);
}

function sendHtml(res, status, html, extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    Connection: 'close',
    ...extraHeaders,
  });
  res.end(html);
}

function errorHtml(title, message, detail = '') {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>body{font-family:"Segoe UI","Microsoft YaHei",sans-serif;background:#f7f4ef;color:#241b14;margin:0;padding:48px 20px}
main{max-width:680px;margin:auto;background:#fff;border:1px solid #eadfd3;border-radius:20px;padding:32px;box-shadow:0 18px 50px rgba(70,40,10,.08)}
h1{font-size:22px;margin:0 0 12px}p{line-height:1.7;color:#6b5c4f}code{background:#f6efe7;padding:2px 6px;border-radius:6px}</style>
</head><body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(
    message,
  )}</p>${detail ? `<p><code>${escapeHtml(detail)}</code></p>` : ''}</main></body></html>`;
}

function publicApp(app) {
  return {
    pkg: app.pkg,
    name: app.name,
    author: app.author,
    version: app.version,
    icon: app.icon,
    sizeText: app.sizeText,
    updated: app.updated,
    category: app.category,
    appId: app.appId,
    apkHash: app.apkHash || '',
    apkSizeKb: app.apkSizeKb || 0,
    targetType: app.targetType || '',
    cdnUrl: app.targetUrl || '',
    checkedAt: app.checkedAt || 0,
    resolvedAt: app.resolvedAt || 0,
    stale: !!app.stale,
    warning: app.warning || '',
  };
}

async function inlineIcon(url) {
  if (!url) return '';
  const text = String(url);
  if (text.startsWith('data:')) return text;
  try {
    return (await getIconDataUri(text)) || text;
  } catch {
    return text;
  }
}

async function payloadFor(app, baseUrl) {
  const fullConfig = buildConfig(app, baseUrl);
  const deepLink = buildDeepLink(app, baseUrl);
  const quickOpen = `${baseUrl}/?pkg=${encodeURIComponent(app.pkg)}`;
  const uiApp = { ...app, icon: await inlineIcon(app.icon) };
  return {
    ok: true,
    app: publicApp(uiApp),
    baseUrl,
    pageUrl: pageUrl(app, baseUrl),
    apkUrl: apkUrl(app, baseUrl),
    proxyUrl: proxyUrl(app, baseUrl),
    directUrl: app.targetType === 'hash' ? apkUrl(app, baseUrl) : '',
    deepLink,
    quickOpen,
    deepQr: await qrDataUri(quickOpen, 260),
    manual: buildManual(app, baseUrl),
    config: fullConfig,
    stale: !!app.stale,
    warning: app.warning || '',
  };
}

async function readJsonBody(req, limit = 64 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) {
      throw new ResolveError('请求内容太大。', 'BAD_INPUT', 413);
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(text);
  } catch {
    throw new ResolveError('请求 JSON 格式不正确。', 'BAD_INPUT', 400);
  }
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
};

function serveStatic(req, res, pathname, base = PUBLIC_DIR) {
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = path.resolve(base, relative);
  if (!filePath.startsWith(base + path.sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  if (!stat.isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': ['.html', '.css', '.js'].includes(ext)
      ? 'no-cache'
      : 'public, max-age=3600',
    Connection: 'close',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  fs.createReadStream(filePath).pipe(res);
}

async function handle(req, res) {
  const method = req.method || 'GET';
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);
  const baseUrl = baseUrlFor(req);

  if (method === 'GET' && pathname === '/health') {
    return sendJson(res, 200, { ok: true, uptime: Date.now() - STARTED_AT });
  }

  if (method === 'GET' && pathname === '/api/status') {
    return sendJson(res, 200, {
      ok: true,
      version: VERSION,
      lanIp: PUBLIC_HOST,
      port: PORT,
      baseUrl,
      node: process.version,
      platform: `${process.platform} ${process.arch}`,
      apps: appCount(),
      uptime: Date.now() - STARTED_AT,
      siteQr: await qrDataUri(baseUrl),
    });
  }

  if (method === 'GET' && pathname === '/api/icon') {
    const iconUrl = url.searchParams.get('url') || '';
    try {
      const icon = await getIcon(iconUrl);
      res.writeHead(200, {
        'Content-Type': icon.type,
        'Content-Length': icon.buf.length,
        'Cache-Control': 'public, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
        Connection: 'close',
      });
      res.end(icon.buf);
    } catch {
      res.writeHead(404, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end('icon not found');
    }
    return;
  }

  if (method === 'GET' && pathname === '/api/search/status') {
    return sendJson(res, 200, { ok: true, ...getSearchStatus() });
  }

  if (method === 'GET' && pathname === '/api/search') {
    const query = (url.searchParams.get('q') || '').trim();
    if (query.length > 120) {
      return sendJson(res, 400, {
        ok: false,
        error: { code: 'QUERY_TOO_LONG', message: '搜索词太长。' },
      });
    }
    if (!query) return sendJson(res, 200, { ok: true, apps: [] });
    const limit = Math.min(
      20,
      Math.max(1, Number(url.searchParams.get('limit')) || 8),
    );
    try {
      const apps = await searchApps(query, limit);
      const enriched = await Promise.all(
        apps.map(async (app) => ({
          ...app,
          icon: await inlineIcon(app.icon),
        })),
      );
      return sendJson(res, 200, { ok: true, apps: enriched });
    } catch (error) {
      throw new ResolveError(
        `搜索索引建立失败：${error.message}`,
        'SEARCH_FAILED',
        502,
      );
    }
  }

  if (method === 'GET' && pathname === '/api/apps') {
    return sendJson(res, 200, {
      ok: true,
      apps: allApps().map(publicApp),
    });
  }

  if (method === 'POST' && pathname === '/api/resolve') {
    const body = await readJsonBody(req);
    const pkg = normalizePackage(body.input || body.url || body.pkg);
    const force = body.force === true;
    const app = await resolveApp(pkg, { force });
    return sendJson(res, 200, await payloadFor(app, baseUrl));
  }

  if (method === 'POST' && pathname.startsWith('/api/apps/') && pathname.endsWith('/refresh')) {
    const pkg = normalizePackage(pathname.slice('/api/apps/'.length, -'/refresh'.length));
    const app = await resolveApp(pkg, { force: true });
    return sendJson(res, 200, await payloadFor(app, baseUrl));
  }

  if (method === 'DELETE' && pathname.startsWith('/api/apps/')) {
    const pkg = normalizePackage(pathname.slice('/api/apps/'.length));
    const removed = deleteApp(pkg);
    return sendJson(res, 200, { ok: true, removed });
  }

  if (method === 'GET' && pathname.startsWith('/api/app/')) {
    const pkg = normalizePackage(pathname.slice('/api/app/'.length));
    const app = await resolveApp(pkg);
    return sendJson(res, 200, await payloadFor(app, baseUrl));
  }

  if (method === 'GET' && pathname.startsWith('/o/')) {
    const pkg = normalizePackage(pathname.slice('/o/'.length));
    let app;
    try {
      app = await resolveApp(pkg);
    } catch (error) {
      const cached = getApp(pkg);
      if (cached?.targetUrl) {
        app = {
          ...cached,
          stale: true,
          warning: '暂时联系不上小米应用商店，本次使用缓存结果。',
        };
      } else {
        return sendHtml(
          res,
          error.status || 502,
          errorHtml(
            '暂时无法生成 Obtainium 页面',
            error.message || String(error),
            '稍后在本地网站里重试；如果小米应用商店接口变了，需要更新解析器。',
          ),
        );
      }
    }
    const html = renderObtainiumPage(app, baseUrl);
    return sendHtml(res, 200, html, {
      'X-Mi-Package': app.pkg,
      'X-Mi-Version': app.version,
      ...(app.stale ? { 'X-Mi-Stale': '1' } : {}),
    });
  }

  if (method === 'GET' || method === 'HEAD') {
    if (pathname.startsWith('/apk/')) {
      const rest = pathname.slice('/apk/'.length);
      const slash = rest.indexOf('/');
      if (slash < 0) {
        return sendJson(res, 404, { ok: false, error: { code: 'BAD_PATH', message: '缺少版本文件名。' } });
      }
      const pkg = normalizePackage(rest.slice(0, slash));
      const file = rest.slice(slash + 1);
      if (!file.toLowerCase().endsWith('.apk')) {
        return sendJson(res, 404, { ok: false, error: { code: 'BAD_PATH', message: '链接必须以 .apk 结尾。' } });
      }
      const requestedVersion = file.slice(0, -4);

      let app = getApp(pkg);
      const needsResolve =
        !app ||
        !app.targetUrl ||
        app.version !== requestedVersion ||
        !isFreshForDownload(app);

      if (needsResolve) {
        try {
          app = await resolveApp(pkg, {
            force: !app || app.version !== requestedVersion || app.targetType === 'signed',
          });
        } catch (error) {
          if (!app?.targetUrl) {
            res.writeHead(error.status || 502, {
              'Content-Type': 'text/plain; charset=utf-8',
              'Cache-Control': 'no-store',
            });
            res.end(`无法获取 APK：${error.message}`);
            return;
          }
        }
      }

      if (!app?.targetUrl) {
        res.writeHead(502, {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        res.end('没有可用的 APK 直链。');
        return;
      }

      const filename = `${app.pkg}-${app.version}.apk`;
      return proxyApk(req, res, app.targetUrl, filename, app.sourceUrl);
    }

    if (pathname === '/qr') {
      const data = url.searchParams.get('data') || '';
      if (!data) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Missing data');
        return;
      }
      if (data.length > 2000) {
        res.writeHead(414, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('QR payload too long');
        return;
      }
      const svg = await QRCode.toString(data, {
        type: 'svg',
        margin: 1,
        width: 240,
        errorCorrectionLevel: 'M',
        color: { dark: '#1b120c', light: '#ffffff' },
      });
      res.writeHead(200, {
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
        Connection: 'close',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(svg);
      return;
    }
  }

  if (method === 'GET' || method === 'HEAD') {
    return serveStatic(req, res, pathname);
  }

  res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Method not allowed');
}

const server = http.createServer((req, res) => {
  const started = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - started;
    const target = (req.url || '').split('?')[0];
    console.log(`${req.method} ${target} ${res.statusCode} ${ms}ms`);
  });

  handle(req, res).catch((error) => {
    const status = Number.isInteger(error.status) ? error.status : 500;
    const code = error.code || 'INTERNAL';
    console.error(`[error] ${req.method} ${req.url}:`, error);
    if (res.headersSent) {
      res.destroy();
      return;
    }
    if ((req.url || '').startsWith('/api/')) {
      sendJson(res, status, {
        ok: false,
        error: { code, message: error.message || String(error) },
      });
    } else {
      sendHtml(
        res,
        status,
        errorHtml('出错了', error.message || String(error), code),
      );
    }
  });
});

loadStore();

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(
      `端口 ${PORT} 已被占用。请关掉占用它的程序，或者用 PORT=另一个端口 启动。`,
    );
  } else {
    console.error('服务器启动失败：', error);
  }
  process.exit(1);
});

server.listen(PORT, '0.0.0.0', () => {
  const lines = [
    '',
    '小米应用商店 → Obtainium 本地桥已启动',
    `  本机访问 : http://127.0.0.1:${PORT}`,
    `  手机访问 : http://${PUBLIC_HOST}:${PORT}`,
    `  数据目录 : ${path.join(process.cwd(), 'data')}`,
    '',
    '手机与电脑需要连同一个 Wi-Fi。第一次运行时 Windows 可能会询问防火墙权限，请允许“专用网络”。',
    '',
  ];
  console.log(lines.join('\n'));
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log('\n正在关闭…');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  });
}





