/**
 * data/jettae_catalog.json → Supabase 시드 마이그레이션
 *
 * 카탈로그는 손으로 관리하는 자산이므로 JSON이 원본이고 SQL은 파생물이다.
 * 카탈로그를 고치면 이 스크립트를 다시 돌린다.
 */
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'data', 'jettae_catalog.json');
const OUT_SQL = join(ROOT, 'supabase', 'migrations', '20260905000400_catalog_seed.sql');
const OUT_APP = join(ROOT, 'app', 'src', 'data', 'catalog.json');

const ZONES = ['욕실', '주방', '거실', '침실', '세탁', '미용', '건강', '전자', '안전'];

const raw = JSON.parse(readFileSync(SOURCE, 'utf8'));
const items = raw.items;

/* ─── 검증 — 시드가 깨진 채로 배포되면 알아채기 어렵다 ─────────────── */

const problems = [];
const seen = new Set();
for (const [i, item] of items.entries()) {
  const at = `items[${i}] ${item.code ?? '(code 없음)'}`;
  if (!/^[a-z][a-z0-9_]*$/.test(item.code ?? '')) problems.push(`${at}: code 형식이 이상해요`);
  if (seen.has(item.code)) problems.push(`${at}: code가 중복돼요`);
  seen.add(item.code);
  if (!item.name?.trim()) problems.push(`${at}: 이름이 비었어요`);
  if (!ZONES.includes(item.zone)) problems.push(`${at}: 모르는 구역 '${item.zone}'`);
  if (!['list', 'pao'].includes(item.input_type)) problems.push(`${at}: input_type이 이상해요`);
  if (!['time', 'usage'].includes(item.metric)) problems.push(`${at}: metric이 이상해요`);
  if (!['all', 'summer', 'winter'].includes(item.season)) problems.push(`${at}: season이 이상해요`);
  if (!Number.isInteger(item.cycle_days) || item.cycle_days < 1 || item.cycle_days > 3650) {
    problems.push(`${at}: cycle_days가 1~3650 범위를 벗어나요 (${item.cycle_days})`);
  }
  if (item.metric === 'usage' && !(item.cycle_usage > 0 && item.unit)) {
    problems.push(`${at}: 사용량 기준인데 cycle_usage/unit이 없어요`);
  }
}
if (raw.count !== items.length) {
  problems.push(`count(${raw.count})와 실제 개수(${items.length})가 달라요`);
}

if (problems.length > 0) {
  console.error('카탈로그에 문제가 있어요:\n' + problems.map((p) => `  - ${p}`).join('\n'));
  process.exit(1);
}

/* ─── SQL 생성 ────────────────────────────────────────────────────── */

const q = (v) => (v == null ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
const n = (v) => (v == null ? 'null' : String(v));
const b = (v) => (v ? 'true' : 'false');

const rows = items
  .map(
    (i) =>
      `  (${q(i.code)}, ${q(i.name)}, ${q(i.zone)}, ${q(i.input_type)}, ${q(i.metric)}, ` +
      `${n(i.cycle_days)}, ${n(i.cycle_usage)}, ${q(i.unit)}, ${q(i.season)}, ` +
      `${b(i.safety_locked)}, ${b(i.onboarding_pick)}, ${q(i.note)})`,
  )
  .join(',\n');

const sql = `-- 제때 — 프리셋 카탈로그 ${items.length}종
--
-- 이 파일은 손으로 고치지 않는다. data/jettae_catalog.json 이 원본이고,
-- \`npm run seed:sql\` (scripts/gen-catalog-sql.mjs)이 이 파일을 다시 만든다.
--
-- 등록이 2초가 되려면 "품목 → 권장 주기"가 이미 있어야 한다.
-- 이 카탈로그의 품질이 곧 제품의 품질이다.

insert into catalog
  (code, name, zone, input_type, metric, cycle_days, cycle_usage, unit, season,
   safety_locked, onboarding_pick, note)
values
${rows}
on conflict (code) do update set
  name            = excluded.name,
  zone            = excluded.zone,
  input_type      = excluded.input_type,
  metric          = excluded.metric,
  cycle_days      = excluded.cycle_days,
  cycle_usage     = excluded.cycle_usage,
  unit            = excluded.unit,
  season          = excluded.season,
  safety_locked   = excluded.safety_locked,
  onboarding_pick = excluded.onboarding_pick,
  note            = excluded.note;
`;

writeFileSync(OUT_SQL, sql, 'utf8');
copyFileSync(SOURCE, OUT_APP);

console.log(`카탈로그 ${items.length}종`);
console.log(`  → ${OUT_SQL.replace(ROOT, '.')}`);
console.log(`  → ${OUT_APP.replace(ROOT, '.')}`);
