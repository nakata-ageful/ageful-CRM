import { useRef, useState } from 'react'
import type { CsvImportRow } from '../types'
import { bulkImportProjects } from '../lib/actions'

type Props = {
  onReload: () => void
}

// CSV テンプレートの列定義（順序が重要）
const CSV_COLUMNS: { key: keyof CsvImportRow; label: string; required?: boolean }[] = [
  { key: 'customer_name',           label: '顧客名',             required: true },
  { key: 'company_name',            label: '会社名' },
  { key: 'email',                   label: 'メール' },
  { key: 'phone',                   label: '電話番号' },
  { key: 'postal_code',             label: '顧客郵便番号' },
  { key: 'customer_address',        label: '顧客住所' },
  { key: 'project_name',            label: '案件名',             required: true },
  { key: 'project_number',          label: '案件番号' },
  { key: 'key_number',              label: 'カギNo' },
  { key: 'site_address',            label: '設置住所' },
  { key: 'handover_date',           label: '引渡日' },
  { key: 'abolition_date',          label: '撤廃日' },
  { key: 'grid_id',                 label: '系統ID' },
  { key: 'grid_certified_at',       label: '系統認定日' },
  { key: 'fit_period',              label: 'FIT期間_年' },
  { key: 'power_supply_start_date', label: '給電開始日' },
  { key: 'fit_end_date',            label: 'FIT満了日' },
  { key: 'generation_point_id',     label: '発電地点特定番号' },
  { key: 'customer_number',         label: 'お客さま番号' },
  { key: 'sales_company',           label: '販売会社' },
  { key: 'referrer',                label: '紹介者' },
  { key: 'sales_price',             label: '販売価格' },
  { key: 'reference_price',         label: '価格参照' },
  { key: 'land_cost',               label: '土地代' },
  { key: 'amuras_member_no',        label: 'アムラス会員番号' },
  { key: 'monitoring_system',       label: '遠隔監視システム' },
  { key: 'notes',                   label: '備考' },
  { key: 'panel_kw',                label: 'パネルkW' },
  { key: 'panel_count',             label: 'パネル枚数' },
  { key: 'panel_manufacturer',      label: 'パネルメーカー' },
  { key: 'panel_model',             label: 'パネル型番' },
  { key: 'pcs_kw',                  label: 'パワコンkW' },
  { key: 'pcs_count',               label: 'パワコン台数' },
  { key: 'pcs_manufacturer',        label: 'パワコンメーカー' },
  { key: 'pcs_model',               label: 'パワコン型番' },
  { key: 'latitude',                label: '緯度' },
  { key: 'longitude',               label: '経度' },
]

const LABEL_TO_KEY: Record<string, keyof CsvImportRow> = Object.fromEntries(
  CSV_COLUMNS.map(c => [c.label, c.key])
)

// ── レガシー形式（エイジフル既存CSV）用ユーティリティ ─────────────────────────

function isCorporateName(name: string): boolean {
  return /[㈱㈲]|株式|有限|合同|\(株\)|\(有\)|（株）|（有）/.test(name)
}

function cleanNumStr(v: string): string {
  // " 28,000,000 " → "28000000"
  return v.replace(/[,\s¥￥]/g, '').replace(/[^\d.-]/g, '')
}

function parseCoords(v: string): { lat: string; lng: string } {
  const m = v.match(/([\d.]+)\s*,\s*([\d.]+)/)
  return m ? { lat: m[1], lng: m[2] } : { lat: '', lng: '' }
}

function parsePanelCount(desc: string): string {
  // "255w・180枚" → "180"
  const m = desc.match(/(\d+)\s*枚/)
  return m ? m[1] : ''
}

function parsePcsCount(desc: string): string {
  // "10.0kw・5台" → "5"
  const m = desc.match(/(\d+)\s*台/)
  return m ? m[1] : ''
}

function parseFitNum(v: string): string {
  // "36円" → "36", "21年" → "21"
  return v.replace(/[^\d.]/g, '')
}

/** レガシー形式（2行ヘッダー）を検出する */
function detectLegacyFormat(text: string): boolean {
  const firstLine = text.split(/\r?\n/)[0].replace(/^\uFEFF/, '')
  const cols = firstLine.split(',').map(c => c.trim().replace(/^"|"$/g, ''))
  // col0="", col1="案件名" がレガシー形式の特徴
  return cols[1] === '案件名'
}

/**
 * レガシー形式CSVパーサー
 * エイジフル既存データ（2行ヘッダー）に対応
 *
 * 列マッピング:
 *   1=案件名, 2=顧客名, 3=email, 4=電話, 5=顧客郵便番号, 6=顧客住所
 *   7=発電所名(省略可), 8=発電所郵便番号(無視), 9=都道府県, 10=市区町村以降
 *   11=座標, 12=パネルkW, 13=パネル説明(枚数パース), 14=パネルメーカー, 15=パネル型番
 *   16=パワコンkW, 17=パワコン説明(台数パース), 18=パワコンメーカー, 19=パワコン型番
 *   20=経産ID, 21=経産認定日, 22=FIT, 23=需給開始日, 24=お客さま番号, 25=受電地点番号
 *   26=遠隔監視, 33=販売会社, 34=紹介者, 36=引渡日
 *   38=販売価格, 39=価格備考, 40=土地代, 46=カギNo, 47=備考, 48=アプラス会員番号
 *   末尾4列: パネルkW, パネルメーカー, パワコンkW, パワコンメーカー(col12が空の場合フォールバック)
 */
function parseLegacyCsv(text: string): { rows: CsvImportRow[]; errors: string[] } {
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== '')
  if (lines.length < 3) return { rows: [], errors: ['データが不足しています（ヘッダー2行 + データ1行以上必要）'] }

  const errors: string[] = []
  const rows: CsvImportRow[] = []

  // 先頭2行はヘッダー（スキップ）
  for (let i = 2; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i])

    const projectName = cols[1]?.trim() ?? ''
    const customerName = cols[2]?.trim() ?? ''

    // 空行スキップ
    if (!projectName && !customerName) continue
    if (!customerName) {
      errors.push(`行${i + 1}（${projectName}）: 顧客名が空のためスキップ`)
      continue
    }
    if (!projectName) {
      errors.push(`行${i + 1}（${customerName}）: 案件名が空のためスキップ`)
      continue
    }

    // 座標パース
    const { lat, lng } = parseCoords(cols[11]?.trim() ?? '')

    // パネル/パワコンデータ（col12-19優先、空の場合は末尾4列フォールバック）
    let panelKw = cols[12]?.trim() ?? ''
    const panelDesc = cols[13]?.trim() ?? ''
    let panelMfr = cols[14]?.trim() ?? ''
    let panelModel = cols[15]?.trim() ?? ''
    let pcsKw = cols[16]?.trim() ?? ''
    const pcsDesc = cols[17]?.trim() ?? ''
    let pcsMfr = cols[18]?.trim() ?? ''
    const pcsModel = cols[19]?.trim() ?? ''

    // col12が空の場合、BM〜BP列（code 64〜67）のパネルデータを使う
    if (!panelKw && cols.length >= 65) {
      panelKw = cols[64]?.trim() ?? ''
      panelMfr = panelMfr || (cols[65]?.trim() ?? '')
      pcsKw = cols[66]?.trim() ?? ''
      pcsMfr = pcsMfr || (cols[67]?.trim() ?? '')
    }

    // 設置住所 = 都道府県 + 市区町村以降
    const prefecture = cols[9]?.trim() ?? ''
    const cityStreet = cols[10]?.trim() ?? ''
    const siteAddress = [prefecture, cityStreet].filter(Boolean).join('')

    // BD〜BL列（code 55〜63）の保守管理メモを収集して notes に追加
    const legacyMemos = [55, 56, 57, 58, 59, 60, 61, 62, 63]
      .map(i => cols[i]?.trim() ?? '')
      .filter(Boolean)
    const baseNotes = cols[46]?.trim() ?? ''
    const combinedNotes = legacyMemos.length > 0
      ? [baseNotes, '【旧メモ】' + legacyMemos.join(' / ')].filter(Boolean).join('\n')
      : baseNotes

    const row: CsvImportRow = {
      customer_name: customerName,
      company_name: isCorporateName(customerName) ? customerName : '',
      email: cols[3]?.trim() ?? '',
      phone: cols[4]?.trim() ?? '',
      postal_code: cols[5]?.trim() ?? '',
      customer_address: cols[6]?.trim() ?? '',
      project_name: projectName,
      project_number: '',
      key_number: cols[45]?.trim() ?? '',
      site_address: siteAddress,
      grid_id: cols[20]?.trim() ?? '',
      grid_certified_at: cols[21]?.trim() ?? '',
      fit_period: parseFitNum(cols[22]?.trim() ?? ''),
      power_supply_start_date: cols[23]?.trim() ?? '',
      fit_end_date: '',
      generation_point_id: cols[25]?.trim() ?? '',
      customer_number: cols[24]?.trim() ?? '',
      handover_date: cols[35]?.trim() ?? '',
      abolition_date: '',
      sales_company: cols[32]?.trim() ?? '',
      referrer: cols[33]?.trim() ?? '',
      sales_price: cleanNumStr(cols[37]?.trim() ?? ''),
      reference_price: cleanNumStr(cols[38]?.trim() ?? ''),
      land_cost: cleanNumStr(cols[39]?.trim() ?? ''),
      amuras_member_no: cols[47]?.trim() ?? '',
      monitoring_system: cols[26]?.trim() ?? '',
      notes: combinedNotes,
      latitude: lat,
      longitude: lng,
      panel_kw: panelKw,
      panel_count: parsePanelCount(panelDesc),
      panel_manufacturer: panelMfr,
      panel_model: panelModel,
      pcs_kw: pcsKw,
      pcs_count: parsePcsCount(pcsDesc),
      pcs_manufacturer: pcsMfr,
      pcs_model: pcsModel,
    }

    rows.push(row)
  }

  return { rows, errors }
}

// ── テンプレート形式パーサー ───────────────────────────────────────────────────

function parseCsv(text: string): { rows: CsvImportRow[]; errors: string[] } {
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== '')
  if (lines.length < 2) return { rows: [], errors: ['データが空です（ヘッダー行 + 1行以上必要）'] }

  // BOM除去
  const headerLine = lines[0].replace(/^\uFEFF/, '')
  const headers = headerLine.split(',').map(h => h.trim().replace(/^"|"$/g, ''))

  const errors: string[] = []
  const rows: CsvImportRow[] = []

  for (let i = 1; i < lines.length; i++) {
    const values = splitCsvLine(lines[i])
    const obj: Partial<CsvImportRow> = {}

    headers.forEach((h, idx) => {
      const key = LABEL_TO_KEY[h]
      if (key) obj[key] = (values[idx] ?? '').trim()
    })

    const row = obj as CsvImportRow
    // 必須項目チェック
    if (!row.customer_name) {
      errors.push(`行${i + 1}: 顧客名が空です（スキップ）`)
      continue
    }
    if (!row.project_name) {
      errors.push(`行${i + 1}（${row.customer_name}）: 案件名が空です（スキップ）`)
      continue
    }

    rows.push(row)
  }

  return { rows, errors }
}

function splitCsvLine(line: string): string[] {
  const result: string[] = []
  let cur = ''
  let inQuote = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') { cur += '"'; i++ }
      else inQuote = !inQuote
    } else if (ch === ',' && !inQuote) {
      result.push(cur); cur = ''
    } else {
      cur += ch
    }
  }
  result.push(cur)
  return result
}

function downloadTemplate() {
  const header = CSV_COLUMNS.map(c => c.label).join(',')
  const example = CSV_COLUMNS.map(c => {
    if (c.key === 'customer_name') return '田中 太郎'
    if (c.key === 'project_name') return '○○市 太陽光案件'
    if (c.key === 'fit_period') return '20'
    if (c.key === 'handover_date') return '2024/04/01'
    if (c.key === 'fit_end_date') return '2044/04/01'
    if (c.key === 'sales_price') return '15000000'
    if (c.key === 'panel_kw') return '49.5'
    if (c.key === 'panel_count') return '132'
    if (c.key === 'pcs_kw') return '49.5'
    if (c.key === 'pcs_count') return '2'
    return ''
  }).join(',')

  // BOM付きUTF-8（Excelで文字化けしないよう）
  const bom = '\uFEFF'
  const csv = bom + header + '\n' + example + '\n'
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'ageful_import_template.csv'
  a.click()
  URL.revokeObjectURL(url)
}

type ImportState = 'idle' | 'preview' | 'importing' | 'done'

function parseAuto(text: string): { rows: CsvImportRow[]; errors: string[]; isLegacy: boolean } {
  const isLegacy = detectLegacyFormat(text)
  const result = isLegacy ? parseLegacyCsv(text) : parseCsv(text)
  return { ...result, isLegacy }
}

export function CsvImport({ onReload }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [state, setState] = useState<ImportState>('idle')
  const [rows, setRows] = useState<CsvImportRow[]>([])
  const [parseErrors, setParseErrors] = useState<string[]>([])
  const [importResult, setImportResult] = useState<{ success: number; failed: number; errors: string[] } | null>(null)
  const [isLegacyFormat, setIsLegacyFormat] = useState(false)

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const text = ev.target?.result as string
      const { rows: parsed, errors, isLegacy } = parseAuto(text)
      setRows(parsed)
      setParseErrors(errors)
      setIsLegacyFormat(isLegacy)
      setState('preview')
    }
    reader.readAsText(file, 'UTF-8')
    // reset input so same file can be re-selected
    e.target.value = ''
  }

  async function handleImport() {
    if (rows.length === 0) return
    setState('importing')
    const result = await bulkImportProjects(rows)
    setImportResult(result)
    setState('done')
    if (result.success > 0) onReload()
  }

  function reset() {
    setRows([])
    setParseErrors([])
    setImportResult(null)
    setState('idle')
  }

  return (
    <div>
      {/* テンプレートDL + ファイル選択 */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <button className="btn btn-sub" onClick={downloadTemplate}>
            📥 CSVテンプレートをダウンロード
          </button>
          <span style={{ color: '#64748b', fontSize: 13 }}>
            テンプレートに記入後、CSVファイルを選択してアップロードしてください。
          </span>
        </div>
      </div>

      {state === 'idle' && (
        <div
          className="card import-dropzone"
          onClick={() => fileRef.current?.click()}
          onDragOver={e => e.preventDefault()}
          onDrop={e => {
            e.preventDefault()
            const file = e.dataTransfer.files[0]
            if (!file) return
            const reader = new FileReader()
            reader.onload = ev => {
              const text = ev.target?.result as string
              const { rows: parsed, errors, isLegacy } = parseAuto(text)
              setRows(parsed)
              setParseErrors(errors)
              setIsLegacyFormat(isLegacy)
              setState('preview')
            }
            reader.readAsText(file, 'UTF-8')
          }}
        >
          <div style={{ fontSize: 40, marginBottom: 8 }}>📂</div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>CSVファイルを選択</div>
          <div style={{ color: '#64748b', fontSize: 13 }}>クリックまたはドラッグ＆ドロップ</div>
          <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleFile} />
        </div>
      )}

      {state === 'preview' && (
        <>
          {parseErrors.length > 0 && (
            <div className="card" style={{ background: '#fff7ed', borderLeft: '4px solid #ea580c', marginBottom: 12 }}>
              <div style={{ fontWeight: 600, color: '#ea580c', marginBottom: 4 }}>読み込み時の警告</div>
              {parseErrors.map((e, i) => <div key={i} style={{ fontSize: 13, color: '#c2410c' }}>{e}</div>)}
            </div>
          )}

          <div className="card" style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div>
                <strong>{rows.length} 件</strong>をインポートします
                {parseErrors.length > 0 && <span style={{ color: '#ea580c', marginLeft: 8 }}>（{parseErrors.length}件スキップ）</span>}
                <span style={{
                  marginLeft: 10, fontSize: 11, padding: '2px 8px', borderRadius: 4, fontWeight: 600,
                  background: isLegacyFormat ? '#fef3c7' : '#dbeafe',
                  color: isLegacyFormat ? '#92400e' : '#1e40af',
                }}>
                  {isLegacyFormat ? '既存データ形式' : 'テンプレート形式'}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-sub" onClick={reset}>やり直す</button>
                <button className="btn btn-main" onClick={handleImport} disabled={rows.length === 0}>
                  {rows.length}件をインポート
                </button>
              </div>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>顧客名</th>
                    <th>案件名</th>
                    <th>設置住所</th>
                    <th>{isLegacyFormat ? '需給開始日' : 'FIT満了日'}</th>
                    <th>販売価格</th>
                    <th>パネルkW</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={i}>
                      <td style={{ color: '#64748b', fontSize: 12 }}>{i + 1}</td>
                      <td>{row.customer_name}{row.company_name && <><br /><span style={{ fontSize: 11, color: '#64748b' }}>{row.company_name}</span></>}</td>
                      <td><strong>{row.project_name}</strong></td>
                      <td>{row.site_address || '-'}</td>
                      <td>{isLegacyFormat ? (row.power_supply_start_date || '-') : (row.fit_end_date || '-')}</td>
                      <td>{row.sales_price ? `¥${Number(row.sales_price.replace(/,/g, '')).toLocaleString()}` : '-'}</td>
                      <td>{row.panel_kw ? `${row.panel_kw} kW` : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {state === 'importing' && (
        <div className="card loading-card">インポート中...</div>
      )}

      {state === 'done' && importResult && (
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>
            {importResult.failed === 0 ? '✅' : '⚠️'}
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>
            インポート完了
          </div>
          <div style={{ marginBottom: 16 }}>
            <span style={{ color: '#16a34a', fontWeight: 600 }}>成功: {importResult.success}件</span>
            {importResult.failed > 0 && (
              <span style={{ color: '#dc2626', fontWeight: 600, marginLeft: 16 }}>失敗: {importResult.failed}件</span>
            )}
          </div>
          {importResult.errors.length > 0 && (
            <div style={{ textAlign: 'left', background: '#fef2f2', borderRadius: 8, padding: 12, marginBottom: 16 }}>
              {importResult.errors.map((e, i) => <div key={i} style={{ fontSize: 13, color: '#dc2626' }}>{e}</div>)}
            </div>
          )}
          <button className="btn btn-main" onClick={reset}>続けてインポートする</button>
        </div>
      )}

      {/* 列の説明 */}
      {state === 'idle' && (
        <div className="card" style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 14 }}>CSVの列一覧</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '4px 16px' }}>
            {CSV_COLUMNS.map(c => (
              <div key={c.key} style={{ fontSize: 13, color: c.required ? '#0f172a' : '#64748b' }}>
                {c.required && <span style={{ color: '#dc2626', marginRight: 4 }}>*</span>}
                {c.label}
              </div>
            ))}
          </div>
          <div style={{ marginTop: 8, fontSize: 12, color: '#94a3b8' }}>* 必須項目</div>
        </div>
      )}
    </div>
  )
}
