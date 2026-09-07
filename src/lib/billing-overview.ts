import { isBillingDate, type BillingUnit } from './billing-unit'
import { copyJson } from './billing-json'
import { summarizeBillingHistory } from './billing-history'

/** Shared invoice/dashboard classification. Date is supplied in the user's local calendar. */
export function buildBillingOverview(source: readonly BillingUnit[], today: string) {
  if (!isBillingDate(today)) throw new Error('集計日が不正です')
  if (new Set(source.map(u => u.id)).size !== source.length) throw new Error('請求回IDが重複しています')
  const units = copyJson([...source])
  const year = Number(today.slice(0,4)), month = Number(today.slice(5,7))
  const months = Array.from({length:3},(_,i) => {
    const offset=month-1+i
    return `${year+Math.floor(offset/12)}-${String(offset%12+1).padStart(2,'0')}`
  })
  const planned=units.filter(u=>u.lifecycle==='planned'&&!u.issuedOn&&!u.receivedOn)
  const invoices=planned.filter(u=>u.method==='請求書')
  const active=units.filter(u=>u.serviceYear>=year-1&&u.serviceYear<=year&&u.lifecycle!=='cancelled'&&u.lifecycle!=='review_required')
  const received=active.filter(u=>u.lifecycle==='received'||!!u.receivedOn)
  const unpaid=active.filter(u=>!u.receivedOn&&u.lifecycle!=='received'&&(u.lifecycle==='issued'||u.lifecycle==='fixed'||!!u.issuedOn))
  return { months, upcoming: invoices.filter(u=>u.scheduledDate&&months.includes(u.scheduledDate.slice(0,7))),
    overduePlans:invoices.filter(u=>u.scheduledDate&&u.scheduledDate<`${months[0]}-01`),
    undatedPlans:invoices.filter(u=>!u.scheduledDate), laterPlans:invoices.filter(u=>u.scheduledDate&&u.scheduledDate.slice(0,7)>months[2]),
    debitPlans:planned.filter(u=>u.method==='口座振替'), received, unpaid,
    review:units.filter(u=>u.lifecycle==='review_required'),
    totals:summarizeBillingHistory([...received,...unpaid]) }
}
