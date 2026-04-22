export type TaskDef = {
  name: string
  companies: string[]
  subTasks: string[]
}

export const DEFAULT_PROSPECT_TASKS: { apply: TaskDef[]; contract: TaskDef[] } = {
  apply: [
    { name: 'ローン申込書',              companies: ['アプラス', 'ジャックス'], subTasks: ['金利変動確認欄'] },
    { name: '確認書（アンケート）',       companies: ['アプラス'],               subTasks: [] },
    { name: '確認票（保険）',             companies: ['アプラス', 'ジャックス'], subTasks: [] },
    { name: '引渡確認書',                 companies: ['アプラス'],               subTasks: [] },
    { name: '本人確認書類（運転免許証）', companies: ['アプラス', 'ジャックス'], subTasks: [] },
    { name: '源泉徴収票',                 companies: ['アプラス', 'ジャックス'], subTasks: [] },
    { name: '確定申告書',                 companies: ['アプラス', 'ジャックス'], subTasks: [] },
    { name: '収支内訳書',                 companies: ['アプラス', 'ジャックス'], subTasks: [] },
    { name: '所得証明書',                 companies: ['アプラス'],               subTasks: [] },
    { name: '住民税課税証明書',           companies: ['アプラス'],               subTasks: [] },
    { name: '納税証明書（その１・その２）', companies: ['アプラス'],             subTasks: [] },
    { name: '土地全部事項証明書',         companies: ['アプラス', 'ジャックス'], subTasks: [] },
    { name: 'Google座標',                 companies: ['アプラス', 'ジャックス'], subTasks: [] },
    { name: '経済産業省 設備認定書',      companies: ['アプラス', 'ジャックス'], subTasks: [] },
    { name: '電力受給契約書',             companies: ['アプラス', 'ジャックス'], subTasks: [] },
    { name: '設備概要',                   companies: ['アプラス', 'ジャックス'], subTasks: ['パネル', 'パワコン'] },
    { name: '売電実績',                   companies: ['アプラス', 'ジャックス'], subTasks: [] },
    { name: '発電シミュレーション',       companies: ['アプラス', 'ジャックス'], subTasks: [] },
    { name: '見積書・収支シミュレーション', companies: ['アプラス', 'ジャックス'], subTasks: [] },
    { name: '申込書類郵送',               companies: ['アプラス', 'ジャックス'], subTasks: [] },
  ],
  contract: [
    { name: '売買契約書',          companies: ['アプラス', 'ジャックス'], subTasks: ['顧客へ郵送', '代理店へ郵送'] },
    { name: '土地契約書',          companies: ['アプラス', 'ジャックス'], subTasks: ['顧客へ郵送', '代理店へ郵送'] },
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
