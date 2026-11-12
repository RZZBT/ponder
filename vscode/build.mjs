// Bundles the extension and copies the engine (built by ../engine) and the schema into media/.
import { build } from 'esbuild';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';

// Always rebuild the engine: a stale engine/dist would ship an old renderer inside the extension.
execSync('npm run build', { cwd: '../engine', stdio: 'inherit' });

mkdirSync('media', { recursive: true });
copyFileSync('../engine/dist/ponder-player.js', 'media/ponder-player.js');
copyFileSync('../engine/dist/ponder-player.css', 'media/ponder-player.css');
copyFileSync('../schema/ponder.schema.json', 'media/ponder.schema.json');

await build({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode'],
  outfile: 'dist/extension.js',
  sourcemap: true,
});
console.log('extension built -> dist/, media/');
