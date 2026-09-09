import { isBillingDate, type BillingUnit } from './billing-unit'

export type TransferBillingUnit = BillingUnit & { collectionState: 'pending' | 'succeeded' | 'failed' | 'not_applicable'; periodStart?:string|null; periodEnd?:string|null; planNote?:string }
export type TransferBillingChoice = {
  unitId: string
  expectedRevision: number
  recipientId: number
  method: BillingUnit['method']
  scheduledDate: string
  plannedAmount: number | null
  periodStart: string | null
  periodEnd: string | null
  note: string
}

/** Pure confirmation boundary only; not a DB write or authorization boundary.
 * Existing units must all be supplied by the authorized reader. No automatic
 * proration, new occurrence generation, or contract-based amount calculation.
 */
export function prepareOwnershipBillingPlan(input: {
  projectId: number
  oldOwnerId: number
  newOwnerId: number
  units: readonly TransferBillingUnit[]
  choices: readonly TransferBillingChoice[]
  allowedRecipientIds?:readonly number[]
}): { changes: TransferBillingChoice[]; preservedUnitIds: string[] } {
  const positive = (n: number) => Number.isSafeInteger(n) && n > 0
  if (![input.projectId,input.oldOwnerId,input.newOwnerId].every(positive)
    || (!input.allowedRecipientIds&&input.oldOwnerId === input.newOwnerId)) throw Error('発電所・変更前後の所有者を確認してください')
  if (new Set(input.units.map(u=>u.id)).size !== input.units.length
    || new Set(input.choices.map(c=>c.unitId)).size !== input.choices.length) throw Error('同じ請求回が重複しています')
  if (input.units.some(u=>u.projectId !== input.projectId)) throw Error('別の発電所の請求が含まれています')
  if (input.units.some(u=>u.lifecycle === 'review_required')) throw Error('記録要確認の請求を先に確認してください')
  const editable = input.units.filter(u=>u.lifecycle === 'planned')
  if (editable.some(u=>u.issuedOn || u.receivedOn || u.frozenAt || u.frozenAmount !== null
    || u.frozenLineItems !== null || !['pending','failed'].includes(u.collectionState))) {
    throw Error('予定と実績の状態が一致していません')
  }
  if (editable.length !== input.choices.length
    || input.choices.some(c=>!editable.some(u=>u.id === c.unitId))) {
    throw Error('未確認の予定をすべて指定してください。発行済み・入金済みは変更できません')
  }
  for (const c of input.choices) {
    const unit = editable.find(u=>u.id === c.unitId)!
    if (!Number.isSafeInteger(c.expectedRevision) || c.expectedRevision !== unit.revision) throw Error('請求予定が更新されています。確認し直してください')
    if(input.allowedRecipientIds?!input.allowedRecipientIds.includes(c.recipientId)
      :c.recipientId!==input.oldOwnerId&&c.recipientId!==input.newOwnerId&&c.recipientId!==unit.recipientId)
      throw Error('請求先は変更前・変更後の所有者、またはこの回に保存されている請求先を指定してください')
    if (!['請求書','口座振替'].includes(c.method) || !isBillingDate(c.scheduledDate)) throw Error('請求方法・予定日を確認してください')
    if (c.plannedAmount !== null && (!Number.isSafeInteger(c.plannedAmount) || c.plannedAmount < 0)) throw Error('予定額を確認してください')
    if ((c.periodStart === null) !== (c.periodEnd === null)
      || (c.periodStart !== null && (!isBillingDate(c.periodStart) || !isBillingDate(c.periodEnd!) || c.periodStart > c.periodEnd!))) {
      throw Error('対象期間は開始・終了を一緒に指定してください')
    }
    if (typeof c.note !== 'string') throw Error('備考を確認してください')
    // A failed debit remains the original payer's claim, even after transfer.
    // Do not silently reattempt a failed debit through this ownership workflow.
    if (unit.collectionState === 'failed' && (c.recipientId !== unit.recipientId || c.method !== '請求書')) {
      throw Error('振替不能の回は元の請求先の請求書として残してください')
    }
  }
  return {
    changes: input.choices.map(c=>({...c})),
    preservedUnitIds: input.units.filter(u=>u.lifecycle !== 'planned').map(u=>u.id),
  }
}
