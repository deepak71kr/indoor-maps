import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages serves the editor at /<repo>/editor/ (set by the deploy workflow).
  base: process.env['BASE_PATH'] ?? '/',
  plugins: [preact()],
  server: { port: 5174 },
});
