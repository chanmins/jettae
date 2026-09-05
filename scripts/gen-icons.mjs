/**
 * PWA 아이콘 생성 — 의존성 없이 PNG를 직접 쓴다.
 *
 * 아이콘 하나 만들자고 sharp/canvas를 끌어오지 않는다. zlib은 Node 기본 모듈이고,
 * PNG는 그 위에 헤더 몇 개를 얹으면 끝난다.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'app', 'public', 'icons');

const BG = [0x1b, 0x5c, 0x71]; // --accent
const FG = [0xff, 0xff, 0xff];

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** RGBA 픽셀 배열 → PNG 파일 바이트 */
function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: None
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * 제때의 마크 — 원 하나와 그 안의 체크. "때가 되면 표시된다"는 뜻이다.
 * @param inset maskable 아이콘은 가장자리가 잘리므로 안쪽으로 더 들여 그린다.
 */
function drawIcon(size, { inset = 0.18, round = true } = {}) {
  const rgba = Buffer.alloc(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  const radius = size * (0.5 - (round ? 0 : 0));
  const cornerR = size * 0.22;

  const ringOuter = size * (0.5 - inset);
  const ringInner = ringOuter - size * 0.075;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const px = x + 0.5;
      const py = y + 0.5;

      // 배경 — 둥근 사각형(설치 아이콘) 또는 정사각(maskable)
      let inBg;
      if (round) {
        const dx = Math.max(cornerR - px, px - (size - cornerR), 0);
        const dy = Math.max(cornerR - py, py - (size - cornerR), 0);
        inBg = Math.hypot(dx, dy) <= cornerR;
      } else {
        inBg = true;
      }
      void radius;

      if (!inBg) {
        rgba[i + 3] = 0;
        continue;
      }
      rgba[i] = BG[0];
      rgba[i + 1] = BG[1];
      rgba[i + 2] = BG[2];
      rgba[i + 3] = 255;

      // 링 — 위쪽 12시 방향은 비워 '남은 시간'을 뜻한다
      const d = Math.hypot(px - cx, py - cy);
      const angle = Math.atan2(py - cy, px - cx); // -PI..PI, 0 = 3시
      const gap = angle > -Math.PI / 2 - 0.42 && angle < -Math.PI / 2 + 0.42;
      if (d <= ringOuter && d >= ringInner && !gap) {
        rgba[i] = FG[0];
        rgba[i + 1] = FG[1];
        rgba[i + 2] = FG[2];
      }

      // 가운데 체크
      const t = size * 0.055; // 두께
      const s = size * 0.16; // 크기
      const ax = cx - s;
      const ay = cy + s * 0.05;
      const bx = cx - s * 0.25;
      const by = cy + s * 0.62;
      const ex = cx + s;
      const ey = cy - s * 0.62;
      if (nearSegment(px, py, ax, ay, bx, by, t) || nearSegment(px, py, bx, by, ex, ey, t)) {
        rgba[i] = FG[0];
        rgba[i + 1] = FG[1];
        rgba[i + 2] = FG[2];
      }
    }
  }
  return rgba;
}

function nearSegment(px, py, x1, y1, x2, y2, thickness) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy)) <= thickness / 2;
}

mkdirSync(OUT, { recursive: true });

const targets = [
  { file: 'icon-192.png', size: 192, opts: { inset: 0.16, round: true } },
  { file: 'icon-512.png', size: 512, opts: { inset: 0.16, round: true } },
  { file: 'icon-maskable-512.png', size: 512, opts: { inset: 0.26, round: false } },
  { file: 'badge-72.png', size: 72, opts: { inset: 0.14, round: true } },
];

for (const { file, size, opts } of targets) {
  writeFileSync(join(OUT, file), encodePng(size, size, drawIcon(size, opts)));
  console.log(`  ${file}  ${size}×${size}`);
}

// 브라우저 탭용 SVG — 같은 마크를 벡터로.
writeFileSync(
  join(OUT, 'favicon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#1B5C71"/>
  <path d="M32 10a22 22 0 1 1-9 2" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"/>
  <path d="M22 33l7 7 14-15" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
`,
);
console.log('  favicon.svg');
