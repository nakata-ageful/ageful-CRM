import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const hasSupabaseEnv = !!(url && key)
export const billingRuntimeEnabled=import.meta.env.VITE_BILLING_LEDGER_ENABLED==='true'

export const supabase = hasSupabaseEnv ? createClient(url!, key!, {
  global:{headers:billingRuntimeEnabled?{'x-ageful-client':'ledger-v1'}:{}},
}) : null
