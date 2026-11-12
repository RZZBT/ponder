// ponder check <ponder.json | package folder | library.jar> ...
// ponder check-index <index folder>
import { check, type Finding } from './check';
import { checkIndex } from './check-index';

const USAGE = `usage:
  ponder check <ponder.json | package folder | library.jar> ...
      Validates the file and confirms every symbol names a declaration in the package.
  ponder check-index <index folder>
      Validates an online index (v1/<ecosystem>/<package>.json files) before you publish it.

Exit code 1 when anything would stop an IDE from showing an animation.`;

const args = process.argv.slice(2);
const command = args[0];
if ((command !== 'check' && command !== 'check-index') || args.length < 2) {
  console.log(USAGE);
  process.exit(command === '--help' || command === '-h' ? 0 : 2);
}

const mark: Record<string, string> = { error: 'error', warning: 'warn ', ok: 'ok   ', note: 'note ' };
let failed = false;

if (command === 'check-index') {
  for (const folder of args.slice(1)) {
    console.log(folder);
    const findings = checkIndex(folder);
    for (const f of findings) console.log(`  ${mark[f.severity]}  ${f.where}  ${f.message}`);
    const errors = findings.filter((f) => f.severity === 'error').length;
    console.log(errors ? `  ${errors} problem(s)\n` : `  index is valid\n`);
    if (errors) failed = true;
  }
} else {
  for (const target of args.slice(1)) {
    console.log(target);
    let findings: Finding[];
    try {
      findings = check(target);
    } catch (e) {
      console.log(`  error  ${(e as Error).message}`);
      failed = true;
      continue;
    }
    for (const f of findings) console.log(`  ${mark[f.severity]}  ${f.where}  ${f.message}`);
    const errors = findings.filter((f) => f.severity === 'error').length;
    const ok = findings.filter((f) => f.severity === 'ok').length;
    console.log(errors ? `  ${errors} problem(s)\n` : `  all ${ok} symbol(s) found\n`);
    if (errors) failed = true;
  }
}
process.exit(failed ? 1 : 0);
