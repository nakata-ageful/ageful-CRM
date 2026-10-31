export type CustomerChoice = {id:number;name:string;is_corporate?:boolean;company_name?:string|null;name_kana?:string|null;company_name_kana?:string|null}

function normalize(value:string):string {
  return value.normalize('NFKC').toLocaleLowerCase('ja').replace(/[\u30a1-\u30f6]/g,c=>String.fromCharCode(c.charCodeAt(0)-0x60)).replace(/\s+/g,'')
}
export function customerChoiceLabel(customer:CustomerChoice):string {
  return `${customer.company_name?`${customer.company_name}（${customer.name}）`:customer.name} ／ 顧客ID ${customer.id}`
}
export function searchCustomers(customers:readonly CustomerChoice[],query:string):CustomerChoice[] {
  const tokens=query.normalize('NFKC').trim().split(/\s+/).map(normalize).filter(Boolean)
  return customers.filter(c=>tokens.every(token=>normalize([c.name,c.company_name??'',c.name_kana??'',c.company_name_kana??''].join(' ')).includes(token)||String(c.id)===token))
}

type SortableCustomer=CustomerChoice&{is_corporate:boolean}
const kanaCollator=new Intl.Collator('ja',{usage:'sort',sensitivity:'base',numeric:true})
export function customerDisplayName(c:CustomerChoice):string{return (c.is_corporate?c.company_name:null)?.trim()||c.name}
export function customerSortKana(c:SortableCustomer):string{return normalize((c.is_corporate?c.company_name_kana:c.name_kana)??'')}
/** Never mutate input, merge identities or infer a company's reading from its contact. */
export function sortCustomersByKana<T extends SortableCustomer>(customers:readonly T[]):T[]{
  return [...customers].sort((a,b)=>{
    const ak=customerSortKana(a),bk=customerSortKana(b)
    return Number(!ak)-Number(!bk)||kanaCollator.compare(ak,bk)||kanaCollator.compare(normalize(customerDisplayName(a)),normalize(customerDisplayName(b)))||a.id-b.id
  })
}
