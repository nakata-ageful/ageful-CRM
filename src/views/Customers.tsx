import { useState } from 'react'
import type { Customer, CustomerInput } from '../types'
import { Modal } from '../components/Modal'
import { Confirm } from '../components/Confirm'
import { createCustomer, updateCustomer, deleteCustomer } from '../lib/actions'
import { useToast } from '../components/Toast'

type Props = {
  customers: Customer[]
  onReload: () => void
  onViewDetail: (customerId: number) => void
}

const emptyForm: CustomerInput = {
  name: '',
  company_name: '',
  is_corporate: false,
  email: '',
  phone: '',
  postal_code: '',
  address: '',
}

export function Customers({ customers, onReload, onViewDetail }: Props) {
  const toast = useToast()
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
      c.name.toLowerCase().includes(q) ||
      (c.company_name ?? '').toLowerCase().includes(q) ||
      (c.phone ?? '').includes(q) ||
      (c.email ?? '').toLowerCase().includes(q)
    )
  })

  function openCreate() {
    setForm(emptyForm)
    setEditTarget(null)
    setModal('create')
    setError('')
  }

  function openEdit(c: Customer) {
    setForm({
      name: c.name,
      company_name: c.company_name ?? '',
      is_corporate: c.is_corporate,
      email: c.email ?? '',
      phone: c.phone ?? '',
      postal_code: c.postal_code ?? '',
      address: c.address ?? '',
    })
    setEditTarget(c)
    setModal('edit')
    setError('')
  }

  async function handleSave() {
    if (!form.name.trim()) { setError('顧客名は必須です'); return }
    setSaving(true)
    try {
      if (modal === 'create') await createCustomer(form)
      else if (modal === 'edit' && editTarget) await updateCustomer(editTarget.id, form)
      setModal(null)
      onReload()
      toast(modal === 'create' ? '顧客を追加しました' : '顧客情報を保存しました')
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
    toast('顧客を削除しました')
  }

  return (
    <>
      <div className="toolbar">
        <input
          className="search-input"
          type="search"
          placeholder="顧客名・会社名・電話番号・メールで検索..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <button className="btn btn-main" onClick={openCreate}>＋ 新規顧客</button>
      </div>

      <div className="card">
        <div className="table-meta">{filtered.length} 件</div>
        <table>
          <thead>
            <tr>
              <th>顧客名</th><th>会社名</th><th>種別</th><th>電話番号</th>
              <th>メール</th><th>案件数</th><th>操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="empty-cell">該当する顧客がいません</td></tr>
            )}
            {filtered.map(c => (
              <tr key={c.id} className="clickable-row" onClick={() => onViewDetail(c.id)}>
                <td><strong>{c.name}</strong></td>
                <td>{c.company_name ?? '-'}</td>
                <td>{c.is_corporate ? '法人' : '個人'}</td>
                <td>{c.phone ?? '-'}</td>
                <td>{c.email ?? '-'}</td>
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
            <label className="form-label required">
              顧客名（個人名）
              <input className="form-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </label>
            <label className="form-label">
              会社名（法人の場合）
              <input
                className="form-input"
                value={form.company_name}
                onChange={e => setForm(f => ({ ...f, company_name: e.target.value, is_corporate: !!e.target.value }))}
              />
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
          message={`「${deleteTarget.name}」を削除しますか？関連する案件・保守記録もすべて削除されます。`}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </>
  )
}
