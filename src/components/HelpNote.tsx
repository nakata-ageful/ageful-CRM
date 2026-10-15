import type {ReactNode} from 'react'

/** Inline disclosure: works by tap, click, Enter and Space, without hover or overlays. */
export function HelpNote({title,children}:{title:string;children:ReactNode}){
  return <details className="help-note"><summary><span className="help-note-mark" aria-hidden="true">?</span><span>{title}</span></summary><div className="help-note-body">{children}</div></details>
}
