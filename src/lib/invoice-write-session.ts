import { canonicalJson, copyJson } from './billing-json'

export type InvoiceWriteRequest = { unitId:number; revision:number; mode:'plan'|'issue'|'collection'|'correction'; value:object; reason:string|null }

/** One editor session. Keep the operation ID after uncertain save/reload errors. */
export function createInvoiceWriteSession<T>(dependencies:{
  operationId:()=>string
  write:(operationId:string,request:InvoiceWriteRequest)=>Promise<unknown>
  reload:()=>Promise<T>
  definitelyRejected?:(error:unknown)=>boolean
}) {
  let pending:{id:string;signature:string;request:InvoiceWriteRequest}|null=null
  let busy=false
  return {
    async save(input:InvoiceWriteRequest):Promise<T> {
      if(busy)throw new Error('保存中です。完了をお待ちください')
      const request=copyJson(input),signature=canonicalJson(request)
      if(pending&&pending.signature!==signature)throw new Error('前の保存結果が未確認です。同じ内容で再試行してください')
      if(!pending)pending={id:dependencies.operationId(),signature,request}
      busy=true
      try {
        try { await dependencies.write(pending.id,copyJson(pending.request)) }
        catch(error) {
          if(dependencies.definitelyRejected?.(error))pending=null
          throw error
        }
        const result=await dependencies.reload()
        pending=null
        return result
      } finally { busy=false }
    },
  }
}
