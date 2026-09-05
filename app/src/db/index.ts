import { nextDueOf } from '../core/cycle';
import { todayIn } from '../core/date';
import { LocalRepository } from './local';
import { SupabaseRepository, readSupabaseConfig } from './supabase';
import type { Repository } from './types';

export * from './types';
export { LocalRepository } from './local';
export { SupabaseRepository, readSupabaseConfig } from './supabase';

let cached: Repository | null = null;

/**
 * 환경변수에 Supabase가 잡혀 있으면 동기화 저장소, 아니면 로컬 저장소.
 * 앱 코드는 어느 쪽인지 신경 쓸 필요가 없다.
 */
export function getRepository(): Repository {
  if (cached) return cached;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Seoul';
  const today = todayIn(timezone, new Date());
  const local = new LocalRepository(today);
  const config = readSupabaseConfig();
  cached = config ? new SupabaseRepository(config, local, nextDueOf) : local;
  return cached;
}

export function isSupabaseRepository(repo: Repository): repo is SupabaseRepository {
  return repo.kind === 'supabase';
}

export function getLocalRepository(repo: Repository): LocalRepository | null {
  if (repo instanceof LocalRepository) return repo;
  return null;
}
