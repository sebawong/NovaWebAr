import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { resolve } from 'path';

export default defineConfig({
  root: 'demo',
  publicDir: 'public',
  plugins: [basicSsl()],
  server: {
    host: true,
    https: {},
  },
  build: {
    outDir: resolve(__dirname, 'demo-dist'),
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      'webslam': resolve(__dirname, 'src/index.ts'),
    },
  },
});
