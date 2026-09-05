/**
 * app/src/core → supabase/functions/_shared/core
 *
 * 알림 문구와 단계 판정은 클라이언트와 서버가 반드시 같아야 한다.
 * 두 번 구현하면 언젠가 갈라지고, 갈라진 것을 알아챌 방법이 없다.
 *
 * core/는 순수 TS라서 Deno에서도 그대로 돈다. 다만 Deno는 확장자를 요구하므로
 * 상대 import에 `.ts`를 붙여준다. 그것 말고는 손대지 않는다.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'app', 'src', 'core');
const DEST = join(ROOT, 'supabase', 'functions', '_shared', 'core');

const HEADER = `// 이 파일은 생성물이다. 고치지 말 것.
// 원본: app/src/core — \`node scripts/sync-core.mjs\`로 다시 만든다.
`;

rmSync(DEST, { recursive: true, force: true });
mkdirSync(DEST, { recursive: true });

const files = readdirSync(SRC).filter((f) => f.endsWith('.ts'));
for (const file of files) {
  const source = readFileSync(join(SRC, file), 'utf8');
  // Deno는 확장자 없는 상대 경로를 해석하지 않는다.
  const patched = source.replace(
    /(from\s+['"])(\.\.?\/[^'"]+?)(['"])/g,
    (_m, a, path, c) => `${a}${path.endsWith('.ts') ? path : `${path}.ts`}${c}`,
  );
  writeFileSync(join(DEST, file), HEADER + patched, 'utf8');
}

// 카탈로그는 서버도 필요하다 — 알림 문구에 권장 주기가 들어간다.
console.log(`core ${files.length}개 파일을 supabase/functions/_shared/core 로 옮겼어요`);
for (const f of files) console.log(`  ${f}`);
