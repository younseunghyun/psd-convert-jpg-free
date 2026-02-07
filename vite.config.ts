import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(() => {
  // GitHub Pages: set BASE_PATH to "/<repo-name>/" in CI.
  const base = process.env.BASE_PATH || '/'

  return {
    base,
    plugins: [react()],
  }
})
