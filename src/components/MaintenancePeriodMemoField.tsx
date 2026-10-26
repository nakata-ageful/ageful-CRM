import {dateInputRange} from '../lib/utils'

export function MaintenancePeriodMemoField({value,onChange,ready}:{value:string;onChange:(value:string)=>void;ready:boolean}){
 return <label className="form-label">保守期間開始日
  <input className="form-input" type="date" {...dateInputRange()} value={value} disabled={!ready} onChange={e=>onChange(e.target.value)}/>
  <small style={{color:'#64748b'}}>{ready?'日付メモ（請求・期間の計算には使いません）':'保存先の準備後に入力できます'}</small>
 </label>
}
