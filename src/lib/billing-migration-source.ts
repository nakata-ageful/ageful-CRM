import type { AnnualRecord } from '../types'
import type { BillingMigrationCandidate } from './billing-migration-review'
import { canonicalJson } from './billing-json'

/** 元データの対応付けだけ。金額・請求先の確定やINSERTの許可ではない。 */
export async function identifyBillingMigrationSource(
  datasetId: string, candidate: BillingMigrationCandidate, currentRecord: AnnualRecord,
) {
  // awaitの前に値をコピーし、ハッシュ待機中の呼出元による変更の影響を避ける。
  const record = JSON.parse(canonicalJson(currentRecord)) as AnnualRecord
  const c = JSON.parse(canonicalJson(candidate)) as BillingMigrationCandidate
  if (!datasetId.trim() || !Number.isSafeInteger(record.id) || record.id <= 0
    || c.recordId !== record.id || c.contractId !== record.contract_id || c.year !== record.year) {
    throw new Error('移行元レコードの識別情報が一致しません')
  }
  const signature = canonicalJson(record)
  if (c.sourceSignature !== signature) throw new Error('確認後に元データが変わっています')
  const split = !!record.payments?.length
  let storageIndex: number
  if (split) {
    if (c.paymentIndex === null || !Number.isSafeInteger(c.paymentIndex) || c.paymentIndex < 0
      || c.paymentIndex >= record.payments!.length
      || c.seq !== record.payments![c.paymentIndex].seq) {
      throw new Error('元の配列位置・回番号が一致しません')
    }
    // seqは表示上の回番号。重複・欠番があっても配列位置と混同しない。
    storageIndex = c.paymentIndex + 1
  } else {
    if (c.paymentIndex !== null || c.seq !== null) throw new Error('単回レコードの識別情報が不正です')
    storageIndex = 0
  }
  const sourceKey = `${encodeURIComponent(datasetId)}/annual/${record.id}/${split ? `payment/${c.paymentIndex}/${c.seq}` : 'single'}`
  if (c.sourceKey !== sourceKey) throw new Error('移行元データセット・回の識別子が一致しません')
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(signature))
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  return {
    columns: {
      source_annual_record_id: record.id,
      source_payment_index: storageIndex,
      source_snapshot_hash: hash,
    },
    // 完全な元記録は移行証跡側に保管する。DBの3列だけではseq等を復元できない。
    evidence: { schemaVersion: 1, datasetId, sourceKey, originalPaymentIndex: c.paymentIndex,
      originalSeq: c.seq, sourceSignature: signature, sourceRecord: record },
    readyToWrite: false as const,
  }
}
