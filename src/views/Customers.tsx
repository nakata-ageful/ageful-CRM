import {errorDetail,formErrorText} from '../lib/form-error'
import {FormError} from '../components/FormError'
import {useState} from 'react'
import type {Customer,CustomerInput} from '../types'
import {Modal} from '../components/Modal'
import {Confirm} from '../components/Confirm'
import {CustomerFields} from '../components/CustomerFields'
import {createCustomer,updateCustomer,deleteCustomer} from '../lib/actions'
import {useToast} from '../components/Toast'
import {customerDisplayName,searchCustomers,sortCustomersByKana} from '../lib/customer-search'
import {emptyCustomerInput,validateCustomerRegistration} from '../lib/customer-registration'

type Props={customers:Customer[];onReload:()=>void;onViewDetail:(customerId:number)=>void}
export function Customers({customers,onReload,onViewDetail}:Props){
  const toast=useToast()
  const [deleteError,setDeleteError]=useState<unknown>(null),[deleting,setDeleting]=useState(false)
  const [search,setSearch]=useState(''),[modal,setModal]=useState<'create'|'edit'|null>(null)
  const [editTarget,setEditTarget]=useState<Customer|null>(null),[form,setForm]=useState<CustomerInput>(emptyCustomerInput)
  const [deleteTarget,setDeleteTarget]=useState<Customer|null>(null),[saving,setSaving]=useState(false),[error,setError]=useState('')
  const matches=new Set(searchCustomers(customers,search).map(c=>c.id))
  const filtered=sortCustomersByKana(customers.filter(c=>matches.has(c.id)||!!search.trim()&&[c.phone,c.email].some(v=>v?.normalize('NFKC').toLowerCase().includes(search.normalize('NFKC').toLowerCase().trim()))))
  function openCreate(){setForm({...emptyCustomerInput});setEditTarget(null);setModal('create');setError('')}
  function openEdit(c:Customer){
    setForm({name:c.name,name_kana:c.name_kana??'',company_name:c.company_name??'',company_name_kana:c.company_name_kana??'',is_corporate:c.is_corporate,email:c.email??'',phone:c.phone??'',postal_code:c.postal_code??'',address:c.address??'',notes:c.notes??''})
    setEditTarget(c);setModal('edit');setError('')
  }
  async function handleSave(){
    if(saving)return
    let input:CustomerInput
    try{input=validateCustomerRegistration(form,modal==='edit'&&editTarget?{email:editTarget.email}:undefined)}catch(e){setError(errorDetail(e)||formErrorText(e));return}
    setSaving(true)
    try{if(modal==='create')await createCustomer(input);else if(modal==='edit'&&editTarget)await updateCustomer(editTarget.id,input)
      setModal(null);onReload();toast(modal==='create'?'顧客を追加しました':'顧客情報を保存しました')
    }catch(e){setError(errorDetail(e)||formErrorText(e))}finally{setSaving(false)}
  }
  async function handleDelete(){if(!deleteTarget||deleting)return;setDeleting(true);setDeleteError(null);try{await deleteCustomer(deleteTarget.id);setDeleteTarget(null);onReload();toast('顧客を削除しました')}catch(e){setDeleteError(e)}finally{setDeleting(false)}}
  return <>
    <div className="toolbar"><input className="search-input" type="search" placeholder="顧客名・フリガナ・電話番号・メールで検索..." value={search} onChange={e=>setSearch(e.target.value)}/><button className="btn btn-main" onClick={openCreate}>＋ 新規顧客</button></div>
    <div className="card customer-list"><div className="table-meta">{filtered.length} 件<span>顧客名のフリガナ順（未登録は末尾）</span></div>
      <table><thead><tr><th>顧客名</th><th>担当者名</th><th className="customer-phone">電話番号</th><th>メール</th><th>案件数</th><th>操作</th></tr></thead>
        <tbody>{!filtered.length&&<tr><td colSpan={6} className="empty-cell">該当する顧客がいません</td></tr>}
          {filtered.map(c=><tr key={c.id} className="clickable-row" onClick={()=>onViewDetail(c.id)}>
            <td><button className="customer-name-link" onClick={e=>{e.stopPropagation();onViewDetail(c.id)}}>{customerDisplayName(c)}</button></td>
            <td>{c.is_corporate?c.name:'-'}</td><td className="customer-phone">{c.phone||'-'}</td><td className="customer-email">{c.email||'-'}</td><td className="center">{c.project_count??0}</td>
            <td onClick={e=>e.stopPropagation()}><button className="btn-icon" title="編集" aria-label={`${customerDisplayName(c)}の顧客情報を編集`} onClick={()=>openEdit(c)}>✎</button></td>
          </tr>)}
        </tbody>
      </table>
    </div>
    {modal&&<Modal title={modal==='create'?'新規顧客登録':'顧客情報を編集'} width={840} closeDisabled={saving} onClose={()=>setModal(null)}>
      <FormError message={error}/>
      <fieldset disabled={saving} className="customer-fields-fieldset"><CustomerFields value={form} onChange={patch=>setForm(f=>({...f,...patch}))}/></fieldset>
      <div className="modal-footer">{modal==='edit'&&editTarget&&<button className="btn btn-sub modal-delete-btn" disabled={saving} onClick={()=>{setModal(null);setDeleteError(null);setDeleteTarget(editTarget)}}>削除</button>}
        <button className="btn btn-sub" disabled={saving} onClick={()=>setModal(null)}>キャンセル</button><button className="btn btn-main" disabled={saving} onClick={()=>void handleSave()}>{saving?'保存中...':'保存する'}</button>
      </div>
    </Modal>}
    {deleteTarget&&<Confirm message={`「${customerDisplayName(deleteTarget)}」を削除しますか？関連する案件・保守記録もすべて削除されます。`} onConfirm={handleDelete} error={deleteError} busy={deleting} onCancel={()=>setDeleteTarget(null)}/>}
  </>
}
