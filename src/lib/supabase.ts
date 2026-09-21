import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const billingRuntimePreview=import.meta.env.DEV&&import.meta.env.VITE_BILLING_LEDGER_PREVIEW==='true'
export const billingAuthCheck=import.meta.env.DEV&&import.meta.env.VITE_BILLING_AUTH_CHECK==='true'
export const hasSupabaseEnv = !!(url && key)&&!billingRuntimePreview
export const billingRuntimeEnabled=import.meta.env.VITE_BILLING_LEDGER_ENABLED==='true'||billingRuntimePreview||billingAuthCheck

export const supabase = hasSupabaseEnv ? createClient(url!, key!, {
  global:{headers:billingRuntimeEnabled?{'x-ageful-client':'ledger-v1'}:{}},
}) : null
