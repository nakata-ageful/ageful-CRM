import { useState } from 'react'
import type { Customer, CustomerInput } from '../types'
import { Modal } from '../components/Modal'
import { Confirm } from '../components/Confirm'
import { createCustomer, updateCustomer, deleteCustomer } from '../lib/actions'

type Props = {
  customers: Customer[]
  onReload: () => void
  onViewDetail: (customerId: number) => void
}

const emptyForm: CustomerInput = {
  type: 'individual',
  company_name: '',
  contact_name: '',
  email: '',
  phone: '',
  postal_code: '',
  address: '',
  notes: '',
}

export function Customers({ customers, onReload, onViewDetail }: Props) {
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState<'create' | 'edit' | null>(null)
  const [editTarget, setEditTarget] = useState<Customer | null>(null)
  const [form, setForm] = useState<CustomerInput>(emptyForm)
  const [deleteTarget, setDeleteTarget] = useState<Customer | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const filtered = customers.filter(c => {
    const q = search.toLowerCase()
    return (
      c.contact_name.toLowerCase().includes(q) ||
      (c.company_name ?? '').toLowerCase().includes(q) ||
      (c.phone ?? '').includes(q) ||
      (c.email ?? '').toLowerCase().includes(q)
    )
  })

  function exportCSV() {
    const header = ['担当者名', '会社名', '電話番号', 'メール', '住所', '案件数', '登録日']
    const body = filtered.map(c => [
      c.contact_name, c.company_name ?? '', c.phone ?? '',
      c.email ?? '', c.address ?? '', c.project_count ?? 0, c.created_at,
    ])
    const csv = [header, ...body].map(r => r.map(v => `"${v}"`).join(',')).join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `customers_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  function openCreate() {
    setForm(emptyForm)
    setEditTarget(null)
    setModal('create')
    setError('')
  }

  function openEdit(c: Customer) {
    setForm({
      type: c.type,
      company_name: c.company_name ?? '',
      contact_name: c.contact_name,
      email: c.email ?? '',
      phone: c.phone ?? '',
      postal_code: c.postal_code ?? '',
      address: c.address ?? '',
      notes: c.notes ?? '',
    })
    setEditTarget(c)
    setModal('edit')
    setError('')
  }

  async function handleSave() {
    if (!form.contact_name.trim()) { setError('担当者名は必須です'); return }
    setSaving(true)
    try {
      if (modal === 'create') await createCustomer(form)
      else if (modal === 'edit' && editTarget) await updateCustomer(editTarget.id, form)
      setModal(null)
      onReload()
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    await deleteCustomer(deleteTarget.id)
    setDeleteTarget(null)
    onReload()
  }

  return (
    <>
      <div className="toolbar">
        <input
          className="search-input"
          type="search"
          placeholder="顧客名・会社名・電話番号で検索..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-sub" onClick={exportCSV}>CSV出力</button>
          <button className="btn btn-main" onClick={openCreate}>＋ 新規顧客</button>
        </div>
      </div>

      <div className="card">
        <div className="table-meta">{filtered.length} 件</div>
        <table>
          <thead>
            <tr>
              <th>担当者名</th><th>会社名</th><th>電話番号</th>
              <th>メール</th><th>住所</th><th>案件数</th><th>操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="empty-cell">該当する顧客がいません</td></tr>
            )}
            {filtered.map(c => (
              <tr key={c.id} className="clickable-row" onClick={() => onViewDetail(c.id)}>
                <td><strong>{c.contact_name}</strong></td>
                <td>{c.company_name ?? '-'}</td>
                <td>{c.phone ?? '-'}</td>
                <td>{c.email ?? '-'}</td>
                <td>{c.address ?? '-'}</td>
                <td className="center">{c.project_count ?? 0}</td>
                <td onClick={e => e.stopPropagation()}>
                  <button className="btn-icon" title="編集" onClick={() => openEdit(c)}>✎</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(modal === 'create' || modal === 'edit') && (
        <Modal
          title={modal === 'create' ? '新規顧客登録' : '顧客情報を編集'}
          onClose={() => setModal(null)}
        >
          {error && <div className="form-error">{error}</div>}
          <div className="form-grid">
            <label className="form-label">
              種別
              <select className="form-select" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value as 'individual' | 'corporate' }))}>
                <option value="individual">個人</option>
                <option value="corporate">法人</option>
              </select>
            </label>
            {form.type === 'corporate' && (
              <label className="form-label">
                会社名
                <input className="form-input" value={form.company_name} onChange={e => setForm(f => ({ ...f, company_name: e.target.value }))} />
              </label>
            )}
            <label className="form-label required">
              担当者名
              <input className="form-input" value={form.contact_name} onChange={e => setForm(f => ({ ...f, contact_name: e.target.value }))} />
            </label>
            <label className="form-label">
              電話番号
              <input className="form-input" type="tel" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
            </label>
            <label className="form-label">
              メールアドレス
              <input className="form-input" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
            </label>
            <label className="form-label">
              郵便番号
              <input className="form-input" value={form.postal_code} onChange={e => setForm(f => ({ ...f, postal_code: e.target.value }))} />
            </label>
            <label className="form-label" style={{ gridColumn: '1/-1' }}>
              住所
              <input className="form-input" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
            </label>
            <label className="form-label" style={{ gridColumn: '1/-1' }}>
              備考
              <textarea className="form-textarea" rows={3} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </label>
          </div>
          <div className="modal-footer">
            {modal === 'edit' && editTarget && (
              <button
                className="btn btn-sub modal-delete-btn"
                onClick={() => { setModal(null); setDeleteTarget(editTarget) }}
              >
                削除
              </button>
            )}
            <button className="btn btn-sub" onClick={() => setModal(null)}>キャンセル</button>
            <button className="btn btn-main" onClick={handleSave} disabled={saving}>
              {saving ? '保存中...' : '保存する'}
            </button>
          </div>
        </Modal>
      )}

      {deleteTarget && (
        <Confirm
          message={`「${deleteTarget.contact_name}」を削除しますか？関連する案件・保守記録もすべて削除されます。`}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </>
  )
}
