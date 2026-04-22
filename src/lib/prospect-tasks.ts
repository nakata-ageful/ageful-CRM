export type TaskDef = {
  name: string
  companies: string[]
  subTasks: string[]
}

const SHARED_SUBTASKS = ['顧客へ郵送', '代理店へ郵送']

export const DEFAULT_PROSPECT_TASKS: { apply: TaskDef[]; contract: TaskDef[] } = {
  apply: [
    { name: 'ローン申込書',       companies: ['アプラス', 'ジャックス'], subTasks: ['金利変動確認欄'] },
    { name: '確認書（アンケート）', companies: ['アプラス', 'ジャックス'], subTasks: [] },
    { name: '確認票（保険）',      companies: ['アプラス', 'ジャックス'], subTasks: [] },
    { name: '本人確認書',          companies: ['ジャックス'],             subTasks: [] },
    { name: '収入証明書',          companies: ['アプラス', 'ジャックス'], subTasks: [] },
    { name: '売買契約書',          companies: ['アプラス', 'ジャックス'], subTasks: SHARED_SUBTASKS },
    { name: '土地契約書',          companies: ['アプラス', 'ジャックス'], subTasks: SHARED_SUBTASKS },
  ],
  contract: [
    { name: '売買契約書',          companies: ['アプラス', 'ジャックス'], subTasks: SHARED_SUBTASKS },
    { name: '土地契約書',          companies: ['アプラス', 'ジャックス'], subTasks: SHARED_SUBTASKS },
    { name: '住民票',              companies: ['アプラス', 'ジャックス'], subTasks: [] },
    { name: '印鑑証明書',          companies: ['アプラス', 'ジャックス'], subTasks: [] },
    { name: '金消契約関連書類',    companies: ['ジャックス'],             subTasks: [] },
    { name: '契約チェック',        companies: ['アプラス', 'ジャックス'], subTasks: [] },
  ],
}

export function tasksForCompany(mode: 'apply' | 'contract', company: string): TaskDef[] {
  return DEFAULT_PROSPECT_TASKS[mode].filter(t => !company || t.companies.includes(company))
}

export function buildTaskMap(mode: 'apply' | 'contract', company: string): Record<string, boolean> {
  return Object.fromEntries(tasksForCompany(mode, company).map(t => [t.name, false]))
}

export function buildSubTaskMap(mode: 'apply' | 'contract', company: string): Record<string, Record<string, boolean>> {
  return Object.fromEntries(
    tasksForCompany(mode, company)
      .filter(t => t.subTasks.length > 0)
      .map(t => [t.name, Object.fromEntries(t.subTasks.map(s => [s, false]))])
  )
}
