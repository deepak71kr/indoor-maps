import { supportedFormat } from '@innermap/core';
import { render } from 'preact';

function App() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24 }}>
      <h1>🗺️ Inner Map Editor</h1>
      <p>Map format v{supportedFormat()} — drawing tools arrive in Phase 6.</p>
    </main>
  );
}

const root = document.getElementById('app');
if (root) render(<App />, root);
