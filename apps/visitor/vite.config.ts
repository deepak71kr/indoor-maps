import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { defineConfig } from 'vite';

const SAMPLES = fileURLToPath(new URL('../../samples/', import.meta.url));

/**
 * Prototype stand-in for the CDN: serves samples/<site>/map.json at /maps/<site>.json in dev,
 * and copies (minified) into the build. Replaced by the publish pipeline in v0.
 */
function sampleMaps(): Plugin {
  const mapFile = (site: string) => `${SAMPLES}${site}/map.json`;
  return {
    name: 'inner-map-sample-maps',
    configureServer(server) {
      server.middlewares.use('/maps', (req, res, next) => {
        const site = /^\/([a-z0-9-]+)\.json$/.exec(req.url ?? '')?.[1];
        if (!site || !existsSync(mapFile(site))) return next();
        res.setHeader('Content-Type', 'application/json');
        res.end(readFileSync(mapFile(site)));
      });
    },
    generateBundle() {
      for (const site of readdirSync(SAMPLES)) {
        if (!existsSync(mapFile(site))) continue;
        const json = JSON.stringify(JSON.parse(readFileSync(mapFile(site), 'utf8')));
        this.emitFile({ type: 'asset', fileName: `maps/${site}.json`, source: json });
      }
    },
  };
}

/**
 * Injects the app-shell file list and a version derived from it into /sw.js, so every deploy
 * precaches exactly the files of that build (no stale or half-updated shells).
 */
function serviceWorkerManifest(): Plugin {
  const placeholder = /(["'`])__IM_MANIFEST__\1/;
  return {
    name: 'inner-map-sw-manifest',
    apply: 'build',
    // Run after Vite emits index.html, so the HTML is in the precache list too.
    enforce: 'post',
    generateBundle(_options, bundle) {
      const sw = bundle['sw.js'];
      if (!sw || sw.type !== 'chunk') return;
      const names = Object.keys(bundle)
        .filter((name) => name !== 'sw.js' && !name.startsWith('maps/'))
        .sort();
      // Version from CONTENTS (not just names): an edited index.html keeps its name.
      const hash = createHash('sha256');
      for (const name of names) {
        const item = bundle[name];
        hash.update(name).update(item?.type === 'chunk' ? item.code : (item?.source ?? ''));
      }
      const version = hash.digest('hex').slice(0, 10);
      const files = names.map((name) => `/${name}`);
      if (!placeholder.test(sw.code)) this.error('sw.js: manifest placeholder not found');
      sw.code = sw.code.replace(placeholder, JSON.stringify(JSON.stringify({ version, files })));
    },
  };
}

export default defineConfig({
  plugins: [sampleMaps(), serviceWorkerManifest()],
  server: { port: 5173 },
  build: {
    target: 'es2020',
    // The preload polyfill costs bytes we don't need on modern phones.
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: { index: 'index.html', sw: 'src/sw.ts' },
      output: {
        // The service worker must live at a fixed URL at the site root.
        entryFileNames: (chunk) => (chunk.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js'),
      },
    },
  },
});
