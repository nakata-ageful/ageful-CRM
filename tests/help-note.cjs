// Synthetic rendering only: help cannot submit forms or change a billing record.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server')
const source=fs.readFileSync('src/components/HelpNote.tsx','utf8'),m={exports:{}}
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports:m.exports,require})
const html=renderToStaticMarkup(React.createElement(m.exports.HelpNote,{title:'変わらない情報は？'},React.createElement('p',null,'過去の記録は変わりません。')))
assert(html.startsWith('<details class="help-note"><summary>'),'Native keyboard/touch disclosure, closed by default')
assert(!html.includes(' open')&&!html.includes('<button')&&!html.includes('<input'),'Help has no form action or data edits')
assert(html.includes('変わらない情報は？')&&html.includes('過去の記録は変わりません。'))
const css=fs.readFileSync('src/components/HelpNote.css','utf8');assert(css.includes('min-height:44px')&&css.includes(':focus-visible'))
const review=fs.readFileSync('src/components/BillingScheduleChangeReview.tsx','utf8');assert(!review.includes('個別確認'));assert(review.includes('請求詳細の予定日も変更しますか？'))
console.log('PASS: closed native help disclosures, named keyboard/tap target, no form side effects and action-oriented schedule wording')
