import {useEffect,useId,useRef,useState,type CSSProperties,type ReactNode} from 'react'

/** Compact hover note, also available by keyboard focus and touch. No form action. */
export function HelpNote({title,children}:{title:string;children:ReactNode}){
  const id=useId(),button=useRef<HTMLButtonElement>(null)
  const [position,setPosition]=useState<CSSProperties|null>(null)
  function show(){
    const rect=button.current?.getBoundingClientRect();if(!rect)return
    // The desktop app uses CSS zoom. Fixed CSS coordinates must undo that scale.
    const scale=rect.width/(button.current?.offsetWidth||rect.width)
    const width=Math.min(320,window.innerWidth-24),below=window.innerHeight-rect.bottom-12,above=rect.top-12
    const upward=below<220&&above>below
    setPosition({width:width/scale,left:Math.max(12,Math.min(rect.left,window.innerWidth-width-12))/scale,maxHeight:Math.min(320,Math.max(48,upward?above:below))/scale,...(upward?{bottom:(window.innerHeight-rect.top-1)/scale}:{top:(rect.bottom-1)/scale})})
  }
  useEffect(()=>{
    if(!position)return
    const close=()=>setPosition(null)
    const scroll=(e:Event)=>{if(e.target instanceof Element&&e.target.closest('.help-note-body'))return;close()}
    const outside=(e:PointerEvent)=>{if(!button.current?.parentElement?.contains(e.target as Node))close()}
    const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close()}}
    // A scrolled/resized anchor must not leave a floating note at a stale position.
    window.addEventListener('scroll',scroll,true);window.addEventListener('resize',close);window.addEventListener('keydown',escape,true);window.addEventListener('pointerdown',outside,true)
    return()=>{window.removeEventListener('scroll',scroll,true);window.removeEventListener('resize',close);window.removeEventListener('keydown',escape,true);window.removeEventListener('pointerdown',outside,true)}
  },[position])
  return <span className="help-note" onMouseLeave={()=>setPosition(null)} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))setPosition(null)}}>
    <button ref={button} type="button" className="help-note-mark" aria-label={title} aria-describedby={position?id:undefined} onMouseEnter={show} onFocus={show} onClick={e=>{e.stopPropagation();show()}}>?</button>
    <span id={id} role="tooltip" className="help-note-body" hidden={!position} style={position??undefined}><strong>{title}</strong>{children}</span>
  </span>
}
