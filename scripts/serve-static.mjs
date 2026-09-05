/**
 * 정적 미리보기 서버 — 의존성 없음
 *
 *   node scripts/serve-static.mjs <디렉터리> [포트]
 *
 * firebase.json의 헤더 규칙을 그대로 흉내낸다: sw.js·index.html·매니페스트는
 * no-cache, 해시가 붙은 자산은 오래 캐시. 그래서 `npm run build` 결과를 배포된 것과
 * 같은 캐시 조건에서 확인할 수 있다 — 서비스워커가 옛 파일을 붙들고 있으면
 * 고친 게 화면에 안 나온다.
 *
 * SPA라서 없는 경로는 index.html로 넘긴다(Firebase Hosting의 rewrite와 같다).
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, sep, resolve } from 'node:path';

// 인자로 받은 경로는 슬래시 방향이 제각각이다. 아래 경로 비교가 문자열 비교라
// 여기서 한 번 정규화해두지 않으면 'C:/fitlog'와 'C:\fitlog'가 서로 남이 된다.
const ROOT = resolve(process.argv[2] ?? process.cwd());
const PORT = Number(process.argv[3] ?? 5174);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.zip': 'application/zip',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

/** 앱 껍데기와 서비스워커는 캐시하지 않는다 — firebase.json과 같은 규칙. */
const NO_CACHE = new Set(['.js', '.mjs', '.css', '.html', '.json', '.webmanifest']);

/**
 * 파일 이름에 내용 해시가 박힌 자산은 내용이 바뀌면 이름도 바뀐다. 그러니 오래 캐시해도
 * 안전하고, firebase.json도 /assets/** 를 1년 immutable로 준다.
 * 여기서 같이 맞춰두지 않으면 배포본과 다른 캐시 조건에서 확인하게 된다.
 */
function cacheControl(pathname, ext) {
  if (/^\/assets\/.+-[A-Za-z0-9_-]{8,}\.[a-z]+$/.test(pathname)) {
    return 'public, max-age=31536000, immutable';
  }
  return NO_CACHE.has(ext) ? 'no-cache' : 'public, max-age=3600';
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';

    // 루트 밖으로 나가는 경로는 막는다
    const target = join(ROOT, normalize(pathname).replace(/^([/\\])+/, ''));
    if (!target.startsWith(ROOT + sep) && target !== ROOT) {
      res.writeHead(403).end('forbidden');
      return;
    }

    let info;
    try {
      info = await stat(target);
    } catch {
      // 없는 경로는 index.html로 — 라우팅을 해시로 하든 경로로 하든 앱이 판단한다
      const fallback = join(ROOT, 'index.html');
      const body = await readFile(fallback);
      res.writeHead(200, {
        'Content-Type': MIME['.html'],
        'Cache-Control': 'no-cache',
      });
      res.end(body);
      return;
    }

    if (info.isDirectory()) {
      res.writeHead(302, { Location: pathname.replace(/\/?$/, '/') }).end();
      return;
    }

    const ext = extname(target).toLowerCase();
    const body = await readFile(target);
    const headers = {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': cacheControl(pathname, ext),
    };
    // 서비스워커가 최상위 스코프를 잡을 수 있게 한다
    if (target.endsWith(`${sep}sw.js`)) headers['Service-Worker-Allowed'] = '/';

    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (e) {
    res.writeHead(500).end(String(e));
  }
});

server.listen(PORT, () => {
  console.log(`정적 서버: http://localhost:${PORT}  ←  ${ROOT}`);
});
