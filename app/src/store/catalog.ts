import rawCatalog from '../data/catalog.json';
import { buildCatalogIndex } from '../core/catalog';
import type { CatalogItem } from '../core/types';

/** 카탈로그는 앱 번들에 들어가 있다 — 오프라인에서도 등록이 된다. */
export const CATALOG = buildCatalogIndex(rawCatalog.items as CatalogItem[]);

export function catalogOf(code: string | null): CatalogItem | null {
  return code ? (CATALOG.byCode.get(code) ?? null) : null;
}
