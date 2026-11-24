import type { Contract } from '../types'
import type { BillingHistoryData } from '../components/BillingHistorySection'
import { validateDetailPlan, type DetailPlanCandidate } from './billing-detail-plan'
import { managementActiveOn } from './management-lifecycle'
import type { RoutineInvoiceContext } from './routine-invoice'

export function automaticDebitContext(contract: Contract, candidate: DetailPlanCandidate, data: BillingHistoryData): RoutineInvoiceContext | null {
  if (candidate.method !== 'direct_debit' || contract.billing_method !== '口座振替'
    || contract.billing_schedule_days?.length !== 1
    || data.ownershipChangedProjects?.includes(contract.project_id)
    || candidate.reviewReason || !candidate.periodStart || !candidate.periodEnd
    || !data.recipients?.some(customer => customer.id === candidate.recipientId)) return null
  const projectId = contract.project_id
  const units = data.units.filter(unit => unit.projectId === projectId)
  const events = (data.managementEvents ?? []).filter(event => event.project_id === projectId)
  if (!managementActiveOn(events, projectId, 'all', candidate.date)
    || !managementActiveOn(events, projectId, 'maintenance', candidate.date)
    || units.some(unit => unit.scheduledDate === candidate.date)) return null

  const item = { ...candidate, periodStart: candidate.periodStart, periodEnd: candidate.periodEnd }
  try {
    validateDetailPlan(item, units, projectId, '振替結果を確認', contract.maintenance_start_date, data.cycleRules, contract)
  } catch {
    return null
  }

  const bareContract = { ...contract } as Contract & { annual_records?: unknown }
  delete bareContract.annual_records
  return {
    contract: bareContract, item,
    versions: Object.fromEntries(units.map(unit => [unit.id, unit.revision])),
    last: Math.max(0, ...events.map(event => event.id)),
    ...(data.cycleRulesReady ? { cycleRevision: Math.max(0, ...(data.cycleRules ?? []).filter(rule => rule.project_id === projectId).map(rule => rule.id)) } : {}),
  }
}
