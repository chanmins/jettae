import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // 어느 디렉터리에서 실행하든 app/ 이 루트가 된다.
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src/push',
      filename: 'sw.ts',
      registerType: 'prompt',
      injectRegister: null,
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest,json}'],
      },
      manifest: {
        name: '제때',
        short_name: '제때',
        description: '집 안 소모품, 바꿀 때를 대신 세어드려요',
        lang: 'ko',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#EAEEF0',
        theme_color: '#1B5C71',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      devOptions: { enabled: false, type: 'module' },
    }),
  ],
  server: { port: 5173, host: true },
  build: { target: 'es2022', sourcemap: true },
});
