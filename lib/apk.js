import http from 'node:http';
import https from 'node:https';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const MAX_REDIRECTS = 5;

function safeFilename(name) {
  return String(name)
    .replace(/["\\\r\n]/g, '_')
    .replace(/[^\x20-\x7E]/g, '_')
    .slice(0, 180);
}

/**
 * Stream an APK from Xiaomi's CDN through this server. Range headers are
 * forwarded so Obtainium's resumable download keeps working, and a proper
 * filename is attached for the Android installer.
 */
export function proxyApk(req, res, targetUrl, filename, referer) {
  return start(req, res, targetUrl, filename, referer, 0);
}

function start(req, res, targetUrl, filename, referer, redirects) {
  let url;
  try {
    url = new URL(targetUrl);
  } catch {
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Invalid CDN URL');
    return;
  }

  const transport = url.protocol === 'https:' ? https : http;
  const headers = {
    'User-Agent': UA,
    Accept: '*/*',
    Referer: referer || 'https://app.mi.com/',
  };
  if (req.headers.range) headers.Range = req.headers.range;
  if (req.headers['if-range']) headers['If-Range'] = req.headers['if-range'];

  const upstream = transport.request(
    url,
    { method: req.method === 'HEAD' ? 'HEAD' : 'GET', headers },
    (up) => {
      const status = up.statusCode || 502;
      const location = up.headers.location;

      if (
        [301, 302, 303, 307, 308].includes(status) &&
        location &&
        redirects < MAX_REDIRECTS
      ) {
        up.resume();
        const next = new URL(location, url).toString();
        start(req, res, next, filename, referer, redirects + 1);
        return;
      }

      if (status >= 400) {
        up.resume();
        if (!res.headersSent) {
          res.writeHead(502, {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-store',
          });
        }
        res.end(`Xiaomi CDN returned HTTP ${status}`);
        return;
      }

      // A signed download link that has expired falls back to the details
      // page. Never let Obtainium install an HTML page as an APK.
      const contentType = String(up.headers['content-type'] || '');
      if (
        status === 200 &&
        (/text\/html/i.test(contentType) ||
          url.pathname.startsWith('/details'))
      ) {
        up.resume();
        if (!res.headersSent) {
          res.writeHead(502, {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-store',
          });
        }
        res.end('Xiaomi returned an HTML page instead of an APK (link expired).');
        return;
      }

      if (!res.headersSent) {
        const out = {
          'Content-Type':
            up.headers['content-type'] ||
            'application/vnd.android.package-archive',
          'Content-Disposition': `attachment; filename="${safeFilename(
            filename,
          )}"`,
          'Cache-Control': 'public, max-age=3600',
          'X-Content-Type-Options': 'nosniff',
          Connection: 'close',
        };
        for (const key of [
          'content-length',
          'content-range',
          'accept-ranges',
          'etag',
          'last-modified',
        ]) {
          if (up.headers[key]) out[key] = up.headers[key];
        }
        res.writeHead(status, out);
      }

      if (req.method === 'HEAD') {
        up.resume();
        res.end();
        return;
      }

      up.pipe(res);
      up.on('error', () => res.destroy());
      res.on('close', () => {
        if (!up.destroyed) up.destroy();
      });
    },
  );

  upstream.on('error', (error) => {
    if (!res.headersSent) {
      res.writeHead(502, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
      });
    }
    res.end(`CDN request failed: ${error.message}`);
  });

  upstream.setTimeout(45000, () => {
    upstream.destroy(new Error('CDN timeout'));
  });
  upstream.end();
}

