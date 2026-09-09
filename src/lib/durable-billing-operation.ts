import {canonicalJson,copyJson} from './billing-json'

export type PendingBillingOperation={version:1;id:string;scope:string;request:Record<string,unknown>;signature:string}
type Storage=Pick<globalThis.Storage,'getItem'|'setItem'|'removeItem'>
/** Stored before sending. Successful RPC + successful reload are both required to clear it. */
export function durableBillingOperation<T>({storage,scope,operationId,write,reload,definitelyRejected}:{
  storage:Storage;scope:string;operationId:()=>string;write:(id:string,request:Record<string,unknown>)=>Promise<unknown>;
  reload:()=>Promise<T>;definitelyRejected?:(error:unknown)=>boolean
}){
  const key=`ageful.billing.pending.v1:${scope}`
  let busy=false
  function pending():PendingBillingOperation|null {
    const raw=storage.getItem(key);if(raw===null)return null
    try{const item=JSON.parse(raw) as PendingBillingOperation
      if(item.version!==1||item.scope!==scope||typeof item.id!=='string'||!item.request||Array.isArray(item.request)
        ||typeof item.request!=='object'||canonicalJson(item.request)!==item.signature)throw Error('invalid')
      return item
    }catch{throw Error('保存中の記録を読み取れません。新しい保存は停止しています。記録を削除せず復旧を依頼してください')}
  }
  async function run(input?:Record<string,unknown>):Promise<T>{
    if(busy)throw Error('保存中です');busy=true
    try{
      let item=pending()
      if(!input&&!item)throw Error('再確認する保存はありません')
      const request=input?copyJson(input):item!.request,signature=canonicalJson(request)
      if(item&&item.signature!==signature)throw Error('前回の保存結果が未確認です。先に「保存結果を再確認」を実行してください')
      item??={version:1,id:operationId(),scope,request,signature}
      // Quota/disabled storage must fail before a DB request is sent.
      storage.setItem(key,JSON.stringify(item))
      try{await write(item.id,copyJson(item.request))}catch(e){if(definitelyRejected?.(e))storage.removeItem(key);throw e}
      const result=await reload()
      storage.removeItem(key)
      return result
    }finally{busy=false}
  }
  return {pending,save:(input:Record<string,unknown>)=>run(input),recover:()=>run()}
}
