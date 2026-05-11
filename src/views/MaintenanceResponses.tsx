import { useState } from 'react'
import type { MaintenanceResponse } from '../types'
import { StatusBadge } from '../components/StatusBadge'

type Props = {
  responses: MaintenanceResponse[]
  onReload: () => void
  onViewDetail: (id: number) => void
}

type Filter = 'all' | '対応中' | '完了'

export function MaintenanceResponses({ responses, onReload: _onReload, onViewDetail }: Props) {
  const [filter, setFilter] = useState<Filter>('対応中')
  const [search, setSearch] = useState('')

  const filtered = responses.filter(r => {
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

  const activeCount = responses.filter(r => r.status === '対応中').length
  const doneCount = responses.filter(r => r.status === '完了').length

  return (
    <>
      <div className="toolbar">
        <input
          className="search-input"
          type="search"
          placeholder="発電所名・顧客名・対象箇所・状況で検索..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
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
      </div>

      <div className="card">
        <div className="table-meta">{filtered.length} 件</div>
        <table>
          <thead>
            <tr>
              <th>管理番号</th><th>発電所</th><th>顧客</th><th>問合日</th>
              <th>発生日</th><th>対象箇所</th><th>状態</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="empty-cell">該当する保守対応記録がありません</td></tr>
            )}
            {filtered.map(r => (
              <tr key={r.id} className="clickable-row" onClick={() => onViewDetail(r.id)}>
                <td>{r.response_no ?? '-'}</td>
                <td><strong>{r.plant_name || r.project_name || '-'}</strong></td>
                <td>{r.customer_name ?? '-'}</td>
                <td>{r.inquiry_date ?? '-'}</td>
                <td>{r.occurrence_date ?? '-'}</td>
                <td>{r.target_area ?? '-'}</td>
                <td><StatusBadge status={r.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
