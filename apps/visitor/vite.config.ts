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

export default defineConfig({
  plugins: [sampleMaps()],
  server: { port: 5173 },
  build: {
    target: 'es2020',
    // The preload polyfill costs bytes we don't need on modern phones.
    modulePreload: { polyfill: false },
  },
});
