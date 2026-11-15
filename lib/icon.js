const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const TTL = 6 * 60 * 60 * 1000;
const MAX = 240;

/** @type {Map<string, {buf:Buffer,type:string,t:number}>} */
const cache = new Map();

function normalize(raw) {
  let url = String(raw || '').trim();
  if (!url) throw new Error('missing icon url');
  if (url.startsWith('//')) url = `https:${url}`;
  if (url.startsWith('http://')) url = `https://${url.slice(7)}`;
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') throw new Error('icon url must be https');
  if (
    !/(^|\.)market\.xiaomi\.com$/i.test(parsed.hostname) &&
    !/(^|\.)mi-img\.com$/i.test(parsed.hostname)
  ) {
    throw new Error('icon host not allowed');
  }
  return url;
}

export async function getIconDataUri(rawUrl) {
  if (!rawUrl) return '';
  const icon = await getIcon(rawUrl);
  return `data:${icon.type};base64,${icon.buf.toString('base64')}`;
}

export async function getIcon(rawUrl) {
  const url = normalize(rawUrl);
  const hit = cache.get(url);
  if (hit && Date.now() - hit.t < TTL) return hit;

  const response = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'image/*' },
    signal: AbortSignal.timeout(6000),
  });
  if (!response.ok) {
    throw new Error(`icon HTTP ${response.status}`);
  }
  const type = response.headers.get('content-type') || 'image/png';
  if (!type.toLowerCase().startsWith('image/')) {
    throw new Error('icon response is not an image');
  }
  const buf = Buffer.from(await response.arrayBuffer());
  if (buf.length === 0 || buf.length > 2 * 1024 * 1024) {
    throw new Error('icon size out of range');
  }

  const item = { buf, type, t: Date.now() };
  cache.set(url, item);
  if (cache.size > MAX) {
    const oldest = [...cache.entries()]
      .sort((a, b) => a[1].t - b[1].t)
      .slice(0, 16);
    for (const [key] of oldest) cache.delete(key);
  }
  return item;
}

