import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/be-vietnam-pro/400.css'
import '@fontsource/be-vietnam-pro/500.css'
import '@fontsource/be-vietnam-pro/600.css'
import '@fontsource/be-vietnam-pro/700.css'
import './index.css'
import App from './App.tsx'

// Follow the system light / dark setting.
const dark = window.matchMedia('(prefers-color-scheme: dark)')
const theme = () => document.documentElement.classList.toggle('dark', dark.matches)
theme()
dark.addEventListener('change', theme)

async function start() {
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('mock')) (await import('./lib/mock')).installMock()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
void start()
