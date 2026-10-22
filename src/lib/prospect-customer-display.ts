import type {Customer,Prospect} from '../types'
import {prospectCustomerId} from './ownership-workflow'
import {customerDisplayName} from './customer-search'

/** Display only: never replace the prospect's stored contact name or identity. */
export function prospectCustomerDisplay(p:Prospect,customers:readonly Customer[]){
 const id=prospectCustomerId(p)
 const customer=id==null?undefined:customers.find(c=>c.id===id)
 const corporate=!!customer?.is_corporate
 return {customer,corporate,name:customer?customerDisplayName(customer):p.new_project_id&&id==null?'顧客未定':p.customer_name}
}
