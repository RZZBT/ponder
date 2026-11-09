// ponder check <ponder.json | package folder | library.jar> ...
import { check, type Finding } from './check';

const USAGE = `usage: ponder check <ponder.json | package folder | library.jar> ...

Validates the file and confirms every symbol names a declaration in the package.
Exit code 1 when anything would stop an IDE from showing an animation.`;

const args = process.argv.slice(2);
if (args[0] !== 'check' || args.length < 2) {
  console.log(USAGE);
  process.exit(args[0] === '--help' || args[0] === '-h' ? 0 : 2);
}

const mark: Record<Finding['severity'], string> = { error: 'error', warning: 'warn ', ok: 'ok   ', note: 'note ' };
let failed = false;
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
process.exit(failed ? 1 : 0);
