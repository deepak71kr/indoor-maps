import { supportedFormat } from '@innermap/core';

const app = document.getElementById('app');
if (app) {
  app.innerHTML = `<h1>🗺️ Inner Map</h1><p>Visitor app — map format v${supportedFormat()}</p>`;
}
