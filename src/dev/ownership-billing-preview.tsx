import { createRoot } from 'react-dom/client'
import { OwnershipBillingDbPreview } from './OwnershipBillingDbPreview'
import '../styles.css'

if(import.meta.env.DEV)createRoot(document.getElementById('root')!).render(<OwnershipBillingDbPreview/> )
