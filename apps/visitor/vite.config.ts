import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5173 },
  build: {
    target: 'es2020',
    // The preload polyfill costs bytes we don't need on modern phones.
    modulePreload: { polyfill: false },
  },
});
