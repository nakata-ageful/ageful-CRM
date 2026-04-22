export type TaskDef = {
  name: string
  subTasks: string[]
}

// ── ジャックス 申込 ──────────────────────────────────────
const JACCS_APPLY: TaskDef[] = [
  { name: 'ローン申込書',              subTasks: ['金利変動確認欄'] },
  { name: '確認書（保険）',            subTasks: [] },
  { name: '本人確認書類（運転免許証）', subTasks: [] },
  { name: '源泉徴収票',                subTasks: [] },
  { name: '確定申告書',                subTasks: [] },
  { name: '収支内訳書',                subTasks: [] },
  { name: '土地全部事項証明書',        subTasks: [] },
  { name: 'Google座標',                subTasks: [] },
  { name: '経済産業省 設備認定書',     subTasks: [] },
  { name: '電力受給契約書',            subTasks: [] },
  { name: '設備概要',                  subTasks: ['パネル', 'パワコン'] },
  { name: '売電実績',                  subTasks: [] },
  { name: '発電シミュレーション',      subTasks: [] },
  { name: '見積書・収支シミュレーション', subTasks: [] },
  { name: '申込書類郵送',              subTasks: [] },
]

// ── アプラス 申込 ────────────────────────────────────────
const APLUS_APPLY: TaskDef[] = [
  { name: 'ローン申込書',              subTasks: ['金利変動確認欄'] },
  { name: '確認書（アンケート）',      subTasks: [] },
  { name: '確認票（保険）',            subTasks: [] },
  { name: '引渡確認書',                subTasks: [] },
  { name: '本人確認書類（運転免許証）', subTasks: [] },
  { name: '源泉徴収票',                subTasks: [] },
  { name: '確定申告書',                subTasks: [] },
  { name: '収支内訳書',                subTasks: [] },
  { name: '所得証明書',                subTasks: [] },
  { name: '住民税課税証明書',          subTasks: [] },
  { name: '納税証明書（その１・その２）', subTasks: [] },
  { name: '土地全部事項証明書',        subTasks: [] },
  { name: 'Google座標',                subTasks: [] },
  { name: '経済産業省 設備認定書',     subTasks: [] },
  { name: '電力受給契約書',            subTasks: [] },
  { name: '設備概要',                  subTasks: ['パネル', 'パワコン'] },
  { name: '売電実績',                  subTasks: [] },
  { name: '発電シミュレーション',      subTasks: [] },
  { name: '見積書・収支シミュレーション', subTasks: [] },
  { name: '申込書類郵送',              subTasks: [] },
]

// ── ジャックス 契約 ──────────────────────────────────────
const JACCS_CONTRACT: TaskDef[] = [
  { name: '売買契約書',        subTasks: ['顧客へ郵送', '代理店へ郵送'] },
  { name: '土地契約書',        subTasks: ['顧客へ郵送', '代理店へ郵送'] },
  { name: '住民票',            subTasks: [] },
  { name: '印鑑証明書',        subTasks: [] },
  { name: '金消契約関連書類',  subTasks: [] },
  { name: '契約チェック',      subTasks: [] },
]

// ── アプラス 契約 ────────────────────────────────────────
const APLUS_CONTRACT: TaskDef[] = [
  { name: '売買契約書',        subTasks: ['顧客へ郵送', '代理店へ郵送'] },
  { name: '土地契約書',        subTasks: ['顧客へ郵送', '代理店へ郵送'] },
  { name: '住民票',            subTasks: [] },
  { name: '印鑑証明書',        subTasks: [] },
  { name: '契約チェック',      subTasks: [] },
]

const TASK_MAP: Record<string, { apply: TaskDef[]; contract: TaskDef[] }> = {
  'ジャックス': { apply: JACCS_APPLY, contract: JACCS_CONTRACT },
  'アプラス':   { apply: APLUS_APPLY, contract: APLUS_CONTRACT },
}

export function tasksForCompany(mode: 'apply' | 'contract', company: string): TaskDef[] {
  return TASK_MAP[company]?.[mode] ?? []
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
