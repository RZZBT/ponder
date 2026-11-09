// Bundles the engine into dist/ponder-player.js (IIFE exposing window.Ponder) + dist/ponder-player.css
import { build } from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';

mkdirSync('dist', { recursive: true });
await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  format: 'iife',
  globalName: 'Ponder',
  outfile: 'dist/ponder-player.js',
  target: 'chrome110', // JCEF ships a recent Chromium
  minify: true,
  sourcemap: false,
  legalComments: 'none',
});
copyFileSync('src/ui/styles.css', 'dist/ponder-player.css');

// command line checker for authors: node dist/ponder.cjs check path/to/ponder.json
await build({
  entryPoints: ['src/cli/main.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile: 'dist/ponder.cjs',
  banner: { js: '#!/usr/bin/env node' },
  legalComments: 'none',
});
console.log('engine built -> dist/');
