import { createRoot } from 'react-dom/client'
import { Canvas } from './Canvas'

const host = document.getElementById('root')
if (!host) throw new Error('canvas root #root missing from canvas.html')
createRoot(host).render(<Canvas />)
