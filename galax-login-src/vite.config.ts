import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Download page for Galax Login, built into ../galax-login (tranhuongk.github.io/galax-login/).
export default defineConfig({
  base: '/galax-login/',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: {
    outDir: fileURLToPath(new URL('../galax-login', import.meta.url)),
    emptyOutDir: true,
  },
})
