import {useEffect,useRef} from 'react'
import {errorDetail,formErrorText} from '../lib/form-error'

/** Bring a newly reported error into view without clearing any input or retrying a save. */
export function FormError({message}:{message:unknown}){
  const ref=useRef<HTMLDivElement>(null),detail=errorDetail(message)
  const text=formErrorText(message)
  useEffect(()=>{
    if(!message)return
    ref.current?.focus({preventScroll:true})
    ref.current?.scrollIntoView({block:'nearest'})
  },[message])
  if(!message)return null
  return <div ref={ref} className="form-error" role="alert" tabIndex={-1}>
    <strong>確認してください</strong><p>{text}</p>
    {detail&&detail!==text&&<details><summary>詳しいエラー内容</summary><p>{detail}</p></details>}
  </div>
}
