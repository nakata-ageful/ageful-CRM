import {createRoot} from 'react-dom/client'
import {OwnershipBillingDbPreview} from './OwnershipBillingDbPreview'
import '../styles.css'
if(import.meta.env.DEV&&import.meta.env.MODE==='rehearsal')createRoot(document.getElementById('root')!).render(<OwnershipBillingDbPreview normalScreens/> )
else document.getElementById('root')!.textContent='隔離モード専用です。通常アプリでは起動しません。'
