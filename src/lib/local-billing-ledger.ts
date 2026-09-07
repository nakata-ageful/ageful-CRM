import { applyInvoiceRecipientPlan, isBillingDate, issueInvoiceUnit, recipientForUnit, type BillingUnit, type RecipientPlan } from './billing-unit'
import { canonicalJson, copyJson } from './billing-json'

type JsonValue = null | string | number | boolean | JsonValue[] | { [key: string]: JsonValue }
export type LocalBillingSnapshot = {
  projectId: number
  ownerId: number
  revision: number
  customerIds: number[]
  /** 呼出元が渡した契約の全JSON。分類未決のため条件変更は受け付けない。 */
  contract: { [key: string]: JsonValue }
  plan: RecipientPlan
  units: BillingUnit[]
  plannedAmount: number
}

type BaseCommand = { requestId: string; expectedRevision: number }
export type LocalBillingCommand = BaseCommand & (
  | { kind: 'transfer'; newOwnerId: number; transferDate: string; plan: RecipientPlan; expectedUnits: Record<string, number> }
  | { kind: 'issue'; unitId: string; expectedUnitRevision: number; issuedOn: string }
  | { kind: 'add-plan'; unit: BillingUnit }
  | { kind: 'change-estimate'; amount: number }
)

export type LocalBillingEvent = {
  requestId: string
  schemaVersion: 1
  recordedAt: string
  command: LocalBillingCommand
  before: LocalBillingSnapshot
  after: LocalBillingSnapshot
}
export type LocalBillingLedger = { current: LocalBillingSnapshot; events: LocalBillingEvent[] }

/**
 * DB未接続のトランザクション試作。成功時だけ新しいstateを一括で返す。
 * 認証、DB行ロック、永続保存、プロセス間の競合制御を提供するものではない。
 */
export function executeLocalBillingCommand(
  ledger: LocalBillingLedger, command: LocalBillingCommand, recordedAt: string,
): LocalBillingLedger {
  if (!command.requestId.trim()) throw new Error('操作IDが必要です')
  const prior = ledger.events.find(event => event.requestId === command.requestId)
  if (prior) {
    if (canonicalJson(prior.command) !== canonicalJson(command)) throw new Error('同じ操作IDで違う変更は保存できません')
    return copyJson(ledger) // 再送は履歴も現在値も巻き戻さない
  }
  const current = ledger.current
  if (current.revision !== command.expectedRevision) throw new Error('情報が更新されています。確認し直してください')
  if (!Number.isFinite(Date.parse(recordedAt))) throw new Error('記録日時が不正です')
  if (current.plan.projectId !== current.projectId || current.units.some(u => u.projectId !== current.projectId)) throw new Error('発電所の対応を確認してください')
  if (new Set(current.units.map(u => u.id)).size !== current.units.length) throw new Error('請求回IDが重複しています')
  const next = copyJson(current)
  if (command.kind === 'transfer') {
    if (!current.customerIds.includes(command.newOwnerId) || command.newOwnerId === current.ownerId) throw new Error('新しい所有者を確認してください')
    if (!isBillingDate(command.transferDate)) throw new Error('所有者変更日を確認してください')
    if (command.plan.projectId !== current.projectId) throw new Error('別の発電所の請求先指定です')
    if ([command.plan.defaultRecipientId, ...Object.values(command.plan.overrides)].some(id => !current.customerIds.includes(id))) throw new Error('存在しない請求先です')
    if (current.units.some(u => u.method === '口座振替' && u.lifecycle === 'planned')) throw new Error('今後の振替の変更は固定ルール確定後に対応します')
    next.units = copyJson(applyInvoiceRecipientPlan(current.units, command.plan, command.expectedUnits))
    next.plan = copyJson(command.plan)
    next.ownerId = command.newOwnerId
    // 引継ぎでも契約全JSONをbefore/afterへ残す。監査からの請求再計算はしない。
  } else if (command.kind === 'issue') {
    const unit = current.units.find(u => u.id === command.unitId)
    if (!unit) throw new Error('対象の請求がありません')
    const issued = issueInvoiceUnit(unit, command.expectedUnitRevision, { issuedOn: command.issuedOn,
      amount: current.plannedAmount, lineItems: [{ name: '保守料（検証用）', amount: current.plannedAmount }], frozenAt: recordedAt })
    next.units = next.units.map(u => u.id === issued.id ? issued : u)
    delete next.plan.overrides[issued.id]
  } else if (command.kind === 'add-plan') {
    const unit = command.unit
    if (unit.projectId !== current.projectId || current.units.some(u => u.id === unit.id)) throw new Error('追加する請求回のID・発電所を確認してください')
    if (unit.method !== '請求書' || unit.lifecycle !== 'planned' || unit.issuedOn || unit.receivedOn || unit.frozenAt
      || unit.frozenAmount != null || unit.frozenLineItems != null || !unit.scheduledDate || !isBillingDate(unit.scheduledDate)) throw new Error('未発行の請求書予定だけ追加できます')
    next.units.push({ ...copyJson(unit), recipientId: recipientForUnit(unit, current.plan) })
  } else {
    if (!Number.isSafeInteger(command.amount) || command.amount < 0) throw new Error('予定額を確認してください')
    next.plannedAmount = command.amount
  }
  next.revision++
  const event: LocalBillingEvent = { requestId: command.requestId, schemaVersion: 1, recordedAt,
    command: copyJson(command), before: copyJson(current), after: copyJson(next) }
  // 途中で検証・コピーが失敗しても呼出元のledgerは不変。差分は保存しない。
  return { current: next, events: [...copyJson(ledger.events), event] }
}

export function localCustomerBillingHistory(ledger: LocalBillingLedger, recipientId: number): BillingUnit[] {
  return copyJson(ledger.current.units.filter(unit => unit.recipientId === recipientId
    && (unit.lifecycle !== 'planned' || unit.issuedOn || unit.receivedOn)))
}
