import { useState } from 'react'
import type { MaintenanceResponse, PeriodicMaintenance, BillingRow } from '../types'
import { StatusBadge } from '../components/StatusBadge'
import { fmtYen } from '../lib/utils'

type Props = {
  responses: MaintenanceResponse[]
  periodic: PeriodicMaintenance[]
  billingRows: BillingRow[]
  onReload: () => void
  onViewDetail: (id: number) => void
  onViewProject: (projectId: number) => void
  onViewProjectMaintenance: (projectId: number) => void
}

/** 長い値を n 文字で切り「…」を付ける（全文はセルの title で確認できる） */
function truncate(v: string | null | undefined, n = 7): string {
  if (!v) return '-'
  return v.length > n ? v.slice(0, n) + '…' : v
}

type TopTab = '保守対応' | '定期保守' | '受託情報' | '委託情報'
type Filter = 'all' | '対応中' | '完了'

const TOP_TABS: TopTab[] = ['保守対応', '定期保守', '受託情報', '委託情報']

function readTopTabFromHash(): TopTab {
  const h = window.location.hash
  const q = h.includes('?') ? h.split('?')[1] : ''
  const t = new URLSearchParams(q).get('tab')
  return (TOP_TABS as string[]).includes(t ?? '') ? (t as TopTab) : '保守対応'
}

function writeTopTabToHash(t: TopTab) {
  const h = window.location.hash
  const [pathPart] = h.split('?')
  const newHash = t === '保守対応' ? pathPart : `${pathPart}?tab=${encodeURIComponent(t)}`
  if (window.location.hash !== newHash) {
    window.history.replaceState(null, '', newHash || '#')
  }
}

export function MaintenanceResponses({ responses, periodic, billingRows, onReload: _onReload, onViewDetail, onViewProject, onViewProjectMaintenance }: Props) {
  const [topTab, setTopTabState] = useState<TopTab>(() => readTopTabFromHash())
  const setTopTab = (t: TopTab) => {
    setTopTabState(t)
    writeTopTabToHash(t)
  }
  const [filter, setFilterState] = useState<Filter>(() => {
    const saved = sessionStorage.getItem('maintenance_responses_filter')
    return (['all', '対応中', '完了'].includes(saved ?? '') ? saved : '対応中') as Filter
  })
  const setFilter = (f: Filter) => {
    setFilterState(f)
    sessionStorage.setItem('maintenance_responses_filter', f)
  }
  const [search, setSearchState] = useState(() => sessionStorage.getItem('maintenance_responses_search') ?? '')
  const setSearch = (s: string) => {
    setSearchState(s)
    sessionStorage.setItem('maintenance_responses_search', s)
  }

  const filteredResponses = responses.filter(r => {
    if (filter !== 'all' && r.status !== filter) return false
    if (!search) return true
    const q = search.toLowerCase()
    return (
      (r.plant_name ?? '').toLowerCase().includes(q) ||
      (r.project_name ?? '').toLowerCase().includes(q) ||
      (r.customer_name ?? '').toLowerCase().includes(q) ||
      (r.target_area ?? '').toLowerCase().includes(q) ||
      (r.situation ?? '').toLowerCase().includes(q) ||
      (r.response_no ?? '').toLowerCase().includes(q)
    )
  })

  // project_id → 契約（受託会社・保守委託先の検索用）
  const contractByProjectId = new Map(billingRows.map(r => [r.project_id, r.contract]))

  const filteredPeriodic = periodic.filter(p => {
    if (!search) return true
    const q = search.toLowerCase()
    const c = contractByProjectId.get(p.project_id)
    return (
      (p.plant_name ?? '').toLowerCase().includes(q) ||
      (p.project_name ?? '').toLowerCase().includes(q) ||
      (p.customer_name ?? '').toLowerCase().includes(q) ||
      (p.work_type ?? '').toLowerCase().includes(q) ||
      (p.content ?? '').toLowerCase().includes(q) ||
      (c?.maintenance_contractor ?? '').toLowerCase().includes(q) ||
      (c?.subcontractor ?? '').toLowerCase().includes(q)
    )
  })

  const filteredContractRows = billingRows.filter(r => {
    if (!search) return true
    const q = search.toLowerCase()
    const c = r.contract
    return (
      (r.project_name ?? '').toLowerCase().includes(q) ||
      (r.customer_name ?? '').toLowerCase().includes(q) ||
      (c?.maintenance_contractor ?? '').toLowerCase().includes(q) ||
      (c?.subcontractor ?? '').toLowerCase().includes(q)
    )
  })

  const activeCount = responses.filter(r => r.status === '対応中').length
  const doneCount = responses.filter(r => r.status === '完了').length

  const placeholderByTab: Record<TopTab, string> = {
    '保守対応': '発電所名・顧客名・対象箇所・状況で検索...',
    '定期保守': '発電所名・顧客名・作業種別・内容・受託会社・保守委託先で検索...',
    '受託情報': '発電所名・顧客名・受託会社で検索...',
    '委託情報': '発電所名・顧客名・保守委託先で検索...',
  }

  return (
    <>
      {/* 大タブ */}
      <div className="tab-bar">
        <button
          className={`tab-btn ${topTab === '保守対応' ? 'active' : ''}`}
          onClick={() => setTopTab('保守対応')}
        >
          保守対応
          {activeCount > 0 && <span className="tab-badge">{activeCount}</span>}
        </button>
        <button
          className={`tab-btn ${topTab === '定期保守' ? 'active' : ''}`}
          onClick={() => setTopTab('定期保守')}
        >
          定期保守
        </button>
        <button
          className={`tab-btn ${topTab === '受託情報' ? 'active' : ''}`}
          onClick={() => setTopTab('受託情報')}
        >
          受託情報
        </button>
        <button
          className={`tab-btn ${topTab === '委託情報' ? 'active' : ''}`}
          onClick={() => setTopTab('委託情報')}
        >
          委託情報
        </button>
      </div>

      <div className="toolbar">
        <input
          className="search-input"
          type="search"
          placeholder={placeholderByTab[topTab]}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {topTab === '保守対応' && (
          <div className="filter-tabs">
            {([
              { key: '対応中' as Filter, label: `対応中 (${activeCount})` },
              { key: '完了' as Filter, label: `完了 (${doneCount})` },
              { key: 'all' as Filter, label: `すべて (${responses.length})` },
            ]).map(f => (
              <button
                key={f.key}
                className={`filter-tab ${filter === f.key ? 'active' : ''}`}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {topTab === '保守対応' && (
        <div className="card">
          <div className="table-meta">{filteredResponses.length} 件</div>
          <table style={{ whiteSpace: 'nowrap' }}>
            <thead>
              <tr>
                <th>管理番号</th><th>発電所</th><th>顧客</th><th>問合日</th>
                <th>発生日</th><th>対象箇所</th><th>状態</th>
              </tr>
            </thead>
            <tbody>
              {filteredResponses.length === 0 && (
                <tr><td colSpan={7} className="empty-cell">該当する保守対応記録がありません</td></tr>
              )}
              {filteredResponses.map(r => (
                <tr key={r.id} className="clickable-row" onClick={() => onViewDetail(r.id)}>
                  <td>{r.response_no ?? '-'}</td>
                  <td><strong>{r.plant_name || r.project_name || '-'}</strong></td>
                  <td title={r.customer_name ?? undefined}>{truncate(r.customer_name)}</td>
                  <td>{r.inquiry_date ?? '-'}</td>
                  <td>{r.occurrence_date ?? '-'}</td>
                  <td title={r.target_area ?? undefined}>{truncate(r.target_area, 10)}</td>
                  <td><StatusBadge status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {topTab === '定期保守' && (
        <div className="card">
          <div className="table-meta">{filteredPeriodic.length} 件</div>
          <table style={{ whiteSpace: 'nowrap' }}>
            <thead>
              <tr>
                <th>実施日</th><th>発電所</th><th>顧客</th><th>作業種別</th><th>内容</th>
              </tr>
            </thead>
            <tbody>
              {filteredPeriodic.length === 0 && (
                <tr><td colSpan={5} className="empty-cell">該当する定期保守記録がありません</td></tr>
              )}
              {filteredPeriodic.map(p => (
                <tr key={p.id} className="clickable-row" onClick={() => onViewProject(p.project_id)}>
                  <td>{p.record_date ?? '-'}</td>
                  <td><strong>{p.plant_name || p.project_name || '-'}</strong></td>
                  <td title={p.customer_name ?? undefined}>{truncate(p.customer_name)}</td>
                  <td>{p.work_type ?? '-'}</td>
                  <td title={p.content ?? undefined}>{truncate(p.content, 16)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {topTab === '受託情報' && (
        <div className="card">
          <div className="table-meta">{filteredContractRows.length} 件</div>
          <div style={{ overflowX: 'auto' }}>
          <table style={{ whiteSpace: 'nowrap' }}>
            <thead>
              <tr>
                <th>受託会社</th><th>発電所</th><th>顧客</th>
                <th>年次保守料金（税込）</th><th>保守開始日</th>
                <th>除草</th><th>点検</th><th>駆付</th>
              </tr>
            </thead>
            <tbody>
              {filteredContractRows.length === 0 && (
                <tr><td colSpan={8} className="empty-cell">該当する発電所がありません</td></tr>
              )}
              {filteredContractRows.map(r => {
                const c = r.contract
                return (
                  <tr key={r.project_id} className="clickable-row" onClick={() => onViewProjectMaintenance(r.project_id)}>
                    <td title={c?.maintenance_contractor ?? undefined}>{truncate(c?.maintenance_contractor)}</td>
                    <td><strong>{r.project_name || '-'}</strong></td>
                    <td title={r.customer_name ?? undefined}>{truncate(r.customer_name)}</td>
                    <td>{c?.annual_maintenance_inc != null ? fmtYen(c.annual_maintenance_inc) : '-'}</td>
                    <td>{c?.maintenance_start_date ?? '-'}</td>
                    <td>{c?.plan_weeding ?? '-'}</td>
                    <td>{c?.plan_inspection ?? '-'}</td>
                    <td>{c?.plan_emergency ?? '-'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {topTab === '委託情報' && (
        <div className="card">
          <div className="table-meta">{filteredContractRows.length} 件</div>
          <div style={{ overflowX: 'auto' }}>
          <table style={{ whiteSpace: 'nowrap' }}>
            <thead>
              <tr>
                <th>保守委託先</th><th>発電所</th><th>顧客</th>
                <th>委託料（税込）</th><th>委託開始日</th>
              </tr>
            </thead>
            <tbody>
              {filteredContractRows.length === 0 && (
                <tr><td colSpan={5} className="empty-cell">該当する発電所がありません</td></tr>
              )}
              {filteredContractRows.map(r => {
                const c = r.contract
                return (
                  <tr key={r.project_id} className="clickable-row" onClick={() => onViewProjectMaintenance(r.project_id)}>
                    <td title={c?.subcontractor ?? undefined}>{truncate(c?.subcontractor)}</td>
                    <td><strong>{r.project_name || '-'}</strong></td>
                    <td title={r.customer_name ?? undefined}>{truncate(r.customer_name)}</td>
                    <td>{c?.subcontract_fee_inc != null ? fmtYen(c.subcontract_fee_inc) : '-'}</td>
                    <td>{c?.subcontract_start_date ?? '-'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </>
  )
}
