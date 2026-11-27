import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Builds the admin page into ../proxy (served at tranhuongk.github.io/proxy/).
export default defineConfig({
  base: '/proxy/',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: {
    outDir: fileURLToPath(new URL('../proxy', import.meta.url)),
    emptyOutDir: true,
  },
})
