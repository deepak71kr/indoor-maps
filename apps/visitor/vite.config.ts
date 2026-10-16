import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { defineConfig } from 'vite';

const SAMPLES = fileURLToPath(new URL('../../samples/', import.meta.url));
/** Maps published from the editor ("Open on phone"); git-ignored. Dev server only. */
const PUBLISHED = fileURLToPath(new URL('../../.maps/', import.meta.url));
const SITE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const MAX_MAP_BYTES = 2 * 1024 * 1024;

/** Addresses a phone on the same Wi-Fi can open (it can't open "localhost"). */
function lanUrls(port: number): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => `http://${i?.address}:${port}`);
}

/**
 * Prototype stand-in for the CDN: serves maps at /maps/<site>.json in dev (editor-published
 * first, then samples/<site>/map.json) and copies the samples (minified) into the build.
 * Replaced by the publish pipeline in v0.
 */
function sampleMaps(): Plugin {
  const mapFile = (site: string) => `${SAMPLES}${site}/map.json`;
  const publishedFile = (site: string) => `${PUBLISHED}${site}.json`;
  return {
    name: 'inner-map-sample-maps',
    configureServer(server) {
      server.middlewares.use('/maps', (req, res, next) => {
        const site = /^\/([a-z0-9_-]+)\.json$/i.exec(req.url ?? '')?.[1];
        const file = site && [publishedFile(site), mapFile(site)].find((f) => existsSync(f));
        if (!file) return next();
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(readFileSync(file));
      });

      // Editor → visitor dev server: publish a map, and tell the editor our LAN address.
      server.middlewares.use('/__inner-map', (req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        const send = (status: number, body: unknown) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(body));
        };
        if (req.method === 'OPTIONS') return send(204, {});
        const port = server.config.server.port ?? 5173;
        if (req.method === 'GET' && req.url === '/lan') return send(200, { urls: lanUrls(port) });

        const site = /^\/maps\/([^/]+)$/.exec(req.url ?? '')?.[1];
        if (req.method !== 'PUT' || !site || !SITE_ID.test(site))
          return send(404, { error: 'not found' });
        let size = 0;
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size <= MAX_MAP_BYTES) chunks.push(chunk);
        });
        req.on('end', () => {
          if (size > MAX_MAP_BYTES) return send(413, { error: 'map too large' });
          try {
            const map = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { fmt?: unknown };
            if (map.fmt !== 0) return send(400, { error: 'not a format-0 map' });
            mkdirSync(PUBLISHED, { recursive: true });
            writeFileSync(publishedFile(site), JSON.stringify(map));
            send(200, { ok: true, urls: lanUrls(port) });
          } catch {
            send(400, { error: 'invalid JSON' });
          }
        });
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
  let base = '/';
  return {
    name: 'inner-map-sw-manifest',
    apply: 'build',
    // Run after Vite emits index.html, so the HTML is in the precache list too.
    enforce: 'post',
    configResolved(config) {
      base = config.base;
    },
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
      const files = names.map((name) => `${base}${name}`);
      if (!placeholder.test(sw.code)) this.error('sw.js: manifest placeholder not found');
      sw.code = sw.code.replace(placeholder, JSON.stringify(JSON.stringify({ version, files })));
    },
  };
}

export default defineConfig({
  // GitHub Pages serves the app at /<repo>/ (set by the deploy workflow); "/" everywhere else.
  base: process.env['BASE_PATH'] ?? '/',
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
