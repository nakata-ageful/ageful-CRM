export type CustomerChoice = {id:number;name:string;company_name?:string|null;name_kana?:string|null}

function normalize(value:string):string {
  return value.normalize('NFKC').toLocaleLowerCase('ja').replace(/[\u30a1-\u30f6]/g,c=>String.fromCharCode(c.charCodeAt(0)-0x60)).replace(/\s+/g,'')
}
export function customerChoiceLabel(customer:CustomerChoice):string {
  return `${customer.company_name?`${customer.company_name}（${customer.name}）`:customer.name} ／ 顧客ID ${customer.id}`
}
export function searchCustomers(customers:readonly CustomerChoice[],query:string):CustomerChoice[] {
  const tokens=query.normalize('NFKC').trim().split(/\s+/).map(normalize).filter(Boolean)
  return customers.filter(c=>tokens.every(token=>normalize([c.name,c.company_name??'',c.name_kana??''].join(' ')).includes(token)||String(c.id)===token))
}
