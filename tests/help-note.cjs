// Synthetic rendering only: help cannot submit forms or change a billing record.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server')
const source=fs.readFileSync('src/components/HelpNote.tsx','utf8'),m={exports:{}}
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports:m.exports,require})
const html=renderToStaticMarkup(React.createElement(m.exports.HelpNote,{title:'変わらない情報は？'},React.createElement('p',null,'過去の記録は変わりません。')))
assert(html.startsWith('<span class="help-note"><button'),'Compact icon without a visible heading row')
assert(html.includes('type="button"')&&html.includes('role="tooltip"')&&html.includes(' hidden=""'),'No form submission; note hidden until hovered/focused/tapped')
assert(html.includes('変わらない情報は？')&&html.includes('過去の記録は変わりません。'))
// Run the actual hover/focus callbacks with a lower-right anchor at desktop zoom.
let pos=null;const hooks={useId:()=> 'test-note',useRef:()=>({current:{offsetWidth:24,getBoundingClientRect:()=>({width:32.4,left:1240,top:650,bottom:682.4})}}),useState:()=>[pos,v=>pos=v],useEffect:()=>{}}
const hm={exports:{}};vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports:hm.exports,require:n=>n==='react'?hooks:require(n),window:{innerWidth:1280,innerHeight:720}})
let tree=hm.exports.HelpNote({title:'説明',children:'本文'}),trigger=tree.props.children[0]
trigger.props.onMouseEnter();assert(pos,'Hover opens without a click');assert.equal(Math.round(pos.width*1.35),320);assert(pos.left*1.35+320<=1268);assert(pos.bottom>0,'Use space above the lower edge')
tree.props.onMouseLeave();assert.equal(pos,null);trigger.props.onFocus();assert(pos,'Keyboard focus also opens')
tree=hm.exports.HelpNote({title:'説明',children:'本文'});assert.equal(tree.props.children[0].props['aria-describedby'],'test-note')
const css=fs.readFileSync('src/components/HelpNote.css','utf8');assert(css.includes('position:fixed')&&css.includes(':focus-visible'));assert(source.includes('onMouseEnter={show}')&&source.includes('onFocus={show}')&&source.includes("e.key==='Escape'"))
assert(css.includes('width:16px; height:16px')&&css.includes('inset:-8px'),'Small visible icon with a separate invisible touch target')
assert(fs.readFileSync('src/styles.css','utf8').includes('button:not(.btn):not(.help-note-mark)'),'Generic editor buttons must not enlarge the help icon')
const review=fs.readFileSync('src/components/BillingScheduleChangeReview.tsx','utf8');assert(!review.includes('個別確認'));assert(review.includes('請求詳細の予定日も変更しますか？'))
console.log('PASS: compact hover help, focus/touch support, dismissible fixed note, non-submit trigger and unchanged schedule wording')
