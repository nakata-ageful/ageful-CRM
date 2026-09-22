import type { ProjectRow } from '../types'

function normalizeSearchValue(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('ja-JP')
    .replace(/[\s\u200b-\u200d\u2060\ufeff]/g, '')
}

function searchVariants(search: string): string[] {
  const normalized = normalizeSearchValue(search)
  if (!normalized) return []

  const variants = new Set([normalized])
  // 「度会」は「渡会」と入力されることがあるため、どちらの表記でも検索できるようにする。
  if (normalized.includes('渡会')) variants.add(normalized.replaceAll('渡会', '度会'))
  if (normalized.includes('度会')) variants.add(normalized.replaceAll('度会', '渡会'))
  return [...variants]
}

export function projectMatchesSearch(project: ProjectRow, search: string): boolean {
  const queries = searchVariants(search)
  if (queries.length === 0) return true

  // search_text が古い・欠けている場合でも、画面に表示している発電所名は必ず直接検索する。
  const searchableValues = [
    project.plant_name,
    project.project_name,
    project.project_no,
    project.customer_name,
    project.company_name,
    project.site_address,
    project.site_prefecture,
    project.search_text,
  ].map(normalizeSearchValue)

  return queries.some(query => searchableValues.some(value => value.includes(query)))
}
