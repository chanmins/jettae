// 이 파일은 생성물이다. 고치지 말 것.
// 원본: app/src/core — `node scripts/sync-core.mjs`로 다시 만든다.
/**
 * core — 부수효과 없는 도메인 계층
 *
 * Date.now() · fetch · localStorage · DOM 을 쓰지 않는다.
 * 현재 시각은 언제나 인자로 들어온다.
 *
 * Phase 3의 Swift · Kotlin 이식은 이 폴더만 옮기면 되고,
 * tests/ 의 케이스가 그대로 이식 완료 판정 기준이 된다.
 */
export * from './types.ts';
export * from './date.ts';
export * from './cycle.ts';
export * from './season.ts';
export * from './selfCorrect.ts';
export * from './humanize.ts';
export * from './notify.ts';
export * from './overdue.ts';
export * from './usage.ts';
export * from './catalog.ts';
