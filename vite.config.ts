import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import {retainPreviousAssets} from './scripts/retain-previous-assets';

export default defineConfig({
  plugins: [react(),retainPreviousAssets()],
  build: { outDir: 'dist/client', emptyOutDir: true, rollupOptions:{output:{manualChunks:{'react-vendor':['react','react-dom','react-router-dom']}}} },
  server: { allowedHosts: true },
});
