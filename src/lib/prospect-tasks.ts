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
  { name: '確定申告書',                subTasks: ['収支内訳書'] },
  { name: '土地全部事項証明書',        subTasks: ['Google座標'] },
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
  { name: '確定申告書',                subTasks: ['収支内訳書'] },
  { name: '所得証明書',                subTasks: ['住民税課税証明書', '納税証明書（その１・その２）'] },
  { name: '土地全部事項証明書',        subTasks: ['Google座標'] },
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
  { name: '設備売買契約書',                          subTasks: [] },
  { name: '土地売買契約書',                          subTasks: [] },
  { name: '土地登記変更（所有権移転・地上権設定）',  subTasks: ['抵当権抹消', '登記申請'] },
  { name: '土地登記変更（抵当権設定）',              subTasks: ['登記申請'] },
  { name: '住民票',                                  subTasks: [] },
  { name: '印鑑証明書',                              subTasks: [] },
  { name: '現地写真（全景・看板・構内柱・電柱）',    subTasks: [] },
  { name: '電線盗難防止工事',                        subTasks: [] },
  { name: '経済産業省 変更申請画面',                 subTasks: [] },
  { name: '電力名義変更申請写し',                    subTasks: [] },
  { name: '本人確認電話',                            subTasks: [] },
  { name: '保守契約書',                              subTasks: [] },
]

// ── アプラス 契約 ────────────────────────────────────────
const APLUS_CONTRACT: TaskDef[] = [
  { name: '設備売買契約書',                          subTasks: [] },
  { name: '土地売買契約書',                          subTasks: [] },
  { name: '土地登記変更（所有権移転・地上権設定）',  subTasks: ['抵当権抹消', '登記申請'] },
  { name: '土地登記変更（抵当権設定）',              subTasks: ['登記申請'] },
  { name: '住民票',                                  subTasks: [] },
  { name: '印鑑証明書',                              subTasks: [] },
  { name: '現地写真（全景・看板・構内柱・電柱）',    subTasks: [] },
  { name: '経済産業省 変更申請画面',                 subTasks: [] },
  { name: '電力名義変更申請写し',                    subTasks: [] },
  { name: '本人確認電話',                            subTasks: [] },
  { name: '保守契約書',                              subTasks: [] },
]

// ── 無し 申込 ──────────────────────────────────────────
const NONE_APPLY: TaskDef[] = [
  { name: '本人確認書類（運転免許証）', subTasks: [] },
  { name: '土地全部事項証明書',        subTasks: ['Google座標'] },
  { name: '経済産業省 設備認定書',     subTasks: [] },
  { name: '電力受給契約書',            subTasks: [] },
  { name: '設備概要',                  subTasks: ['パネル', 'パワコン'] },
  { name: '売電実績',                  subTasks: [] },
  { name: '発電シミュレーション',      subTasks: [] },
  { name: '見積書・収支シミュレーション', subTasks: [] },
]

// ── 無し 契約 ──────────────────────────────────────────
const NONE_CONTRACT: TaskDef[] = [
  { name: '設備売買契約書',                          subTasks: [] },
  { name: '土地売買契約書',                          subTasks: [] },
  { name: '土地登記変更（所有権移転・地上権設定）',  subTasks: ['抵当権抹消', '登記申請'] },
  { name: '土地登記変更（抵当権設定）',              subTasks: ['登記申請'] },
  { name: '住民票',                                  subTasks: [] },
  { name: '印鑑証明書',                              subTasks: [] },
  { name: '現地写真（全景・看板・構内柱・電柱）',    subTasks: [] },
  { name: '経済産業省 変更申請画面',                 subTasks: [] },
  { name: '電力名義変更申請写し',                    subTasks: [] },
  { name: '保守契約書',                              subTasks: [] },
  { name: '保険申込書',                              subTasks: [] },
]

const TASK_MAP: Record<string, { apply: TaskDef[]; contract: TaskDef[] }> = {
  'ジャックス': { apply: JACCS_APPLY, contract: JACCS_CONTRACT },
  'アプラス':   { apply: APLUS_APPLY, contract: APLUS_CONTRACT },
  'なし':       { apply: NONE_APPLY,  contract: NONE_CONTRACT },
  '無し':       { apply: NONE_APPLY,  contract: NONE_CONTRACT },
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
