import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BillingHistorySection } from '../components/BillingHistorySection'
import type { BillingUnit } from '../lib/billing-unit'
import '../styles.css'
const base: BillingUnit = { id: 'past', projectId: 1, serviceYear: 2025, roundLabel: '第1回', method: '請求書',
  scheduledDate: '2025-06-01', recipientId: 1, lifecycle: 'received', issuedOn: '2025-06-01', receivedOn: '2025-06-10',
  frozenAmount: 82500, frozenLineItems: [{ name: '保守料', amount: 82500 }], frozenAt: '2025-06-01T00:00:00Z', revision: 1 }
const units: BillingUnit[] = [base, { ...base, id: 'next', serviceYear: 2027, scheduledDate: '2027-06-01', recipientId: 2,
  lifecycle: 'planned', issuedOn: null, receivedOn: null, frozenAt: null, frozenAmount: null, frozenLineItems: null }]
function Preview() {
  const [customer, setCustomer] = useState(1)
  const data = { units, recipientName: (id: number) => `顧客${id === 1 ? 'A' : 'B'}`, projectName: () => 'サンプル発電所（現在の所有者：B）', plannedAmount: () => 82500 }
  return <main style={{ maxWidth: 1100, margin: '24px auto', padding: 20 }}>
    <h1>請求先別の履歴確認</h1><p>架空データ・保存操作なし。本番には接続していません。</p>
    <label>顧客詳細：<select value={customer} onChange={e => setCustomer(Number(e.target.value))}><option value={1}>顧客A</option><option value={2}>顧客B</option></select></label>
    <BillingHistorySection data={data} customerId={customer} />
    <h2>請求詳細（発電所単位）</h2><BillingHistorySection data={data} projectId={1} />
  </main>
}
if (import.meta.env.DEV) createRoot(document.getElementById('root')!).render(<Preview />)
