import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
export default defineConfig({
  base: './', plugins: [vue()],
  build: { target: 'es2022', cssCodeSplit: false, rollupOptions: { output: { inlineDynamicImports: true } } },
  server: { host: '127.0.0.1', port: 5173, strictPort: true }
});
