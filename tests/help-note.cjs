// Removed supplementary Q&A must stay removed; operational safeguards must remain.
const assert=require('node:assert/strict'),fs=require('node:fs')
for(const dir of ['src/components','src/views'])for(const file of fs.readdirSync(dir).filter(f=>f.endsWith('.tsx'))){const s=fs.readFileSync(`${dir}/${file}`,'utf8');assert(!s.includes('HelpNote'),`${file}: removed Q&A may not return`)}
assert(!fs.existsSync('src/components/HelpNote.tsx')&&!fs.existsSync('src/components/HelpNote.css'))
const review=fs.readFileSync('src/components/BillingScheduleChangeReview.tsx','utf8')
assert(review.includes('今後の自動予定')&&review.includes('impact?.warnings.map')&&review.includes('role="alert"'))
assert(fs.readFileSync('src/components/InvoiceUnitEditor.tsx','utf8').includes('請求書の作成・送信は行いません'))
console.log('PASS: unnecessary Q&A removed, future-date preview and operational errors/warnings preserved')
