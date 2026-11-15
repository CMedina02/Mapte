import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Mapte',
        short_name: 'Mapte',
        start_url: '/visor',
        display: 'standalone',
        background_color: '#131314',
        theme_color: '#131314',
        icons: [{ src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml' }],
      },
      workbox: {
        // Assets de misión (imágenes, heightmap .f32): se sirven desde caché sin red
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/assets/'),
            handler: 'CacheFirst',
            options: { cacheName: 'mission-assets' },
          },
          {
            // Tipografías de Google: el visor las conserva sin red
            urlPattern: ({ url }) => /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname),
            handler: 'CacheFirst',
            options: { cacheName: 'google-fonts', expiration: { maxEntries: 20 } },
          },
        ],
      },
    }),
  ],
  server: {
    fs: { allow: ['..'] },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
});
