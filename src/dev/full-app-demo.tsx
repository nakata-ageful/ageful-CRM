import {createRoot} from 'react-dom/client'
import {seedFullDemo} from './full-demo-runtime'
import App from '../App'
import '../styles.css'
if(import.meta.env.DEV&&import.meta.env.MODE==='operator-demo'){
  seedFullDemo()
  createRoot(document.getElementById('root')!).render(<App/> )
}else document.getElementById('root')!.textContent='隔離した練習環境専用です。'
