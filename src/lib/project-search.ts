import type { ProjectRow } from '../types'

function normalizeSearchValue(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('ja-JP')
    .replace(/[\s\u200b-\u200d\u2060\ufeff]/g, '')
}

export function projectMatchesSearch(project: ProjectRow, search: string): boolean {
  const query = normalizeSearchValue(search)
  if (!query) return true

  // Always search displayed names, even if the broader search text is stale.
  // Different kanji remain different: no 度会/渡会 substitution or aliases.
  return [
    project.plant_name,
    project.project_name,
    project.project_no,
    project.customer_name,
    project.company_name,
    project.site_address,
    project.site_prefecture,
    project.search_text,
  ].some(value => normalizeSearchValue(value).includes(query))
}
