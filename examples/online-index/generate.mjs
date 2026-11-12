// Rebuilds the sample online index in this folder from the example libraries' own ponder.json files.
//   node examples/online-index/generate.mjs
// The output (v1/...) is what you would publish to GitHub Pages. Check it with:
//   node engine/dist/ponder.cjs check-index examples/online-index
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const examples = join(here, '..');

const packages = [
  { ecosystem: 'npm', name: 'math-utils', path: 'v1/npm/math-utils.json', source: 'js-math-utils/ponder.json', versions: '>=1.0 <2' },
  { ecosystem: 'pypi', name: 'mathutils', path: 'v1/pypi/mathutils.json', source: 'python/mathutils/ponder.json', versions: '>=1.0 <2' },
  { ecosystem: 'maven', name: 'com.example:math-utils', path: 'v1/maven/com.example/math-utils.json', source: 'math-utils/src/main/resources/META-INF/ponder/ponder.json' },
];

for (const p of packages) {
  const ponder = JSON.parse(readFileSync(join(examples, p.source), 'utf8'));
  delete ponder.$schema; // the relative schema path means nothing on a web server
  const entry = p.versions ? { versions: p.versions, ponder } : { ponder };
  const file = { ponderIndex: 1, ecosystem: p.ecosystem, name: p.name, documents: [entry] };
  const out = join(here, p.path);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(file, null, 2) + '\n');
  console.log(`wrote ${p.path}`);
}
