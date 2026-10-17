import {createRoot} from 'react-dom/client'
import {seedFullDemo,seedManagementDemo} from './full-demo-runtime'
import App from '../App'
import '../styles.css'
if(import.meta.env.DEV&&import.meta.env.MODE==='operator-demo'){
  seedFullDemo()
  if(new URLSearchParams(location.search).get('practice')==='management'){
    seedManagementDemo()
    document.title='管理設定の練習（本番保存なし・再読み込みでリセット）'
  }
  createRoot(document.getElementById('root')!).render(<App/> )
}else document.getElementById('root')!.textContent='隔離した練習環境専用です。'
