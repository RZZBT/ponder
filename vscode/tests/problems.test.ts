import { describe, expect, it } from 'vitest';
import { languageSupport, longText, notificationText, problems, unresolvedImport, type Problem } from '../src/problems';
import { ALLOWED_COMMANDS, commandUri, helpHtml } from '../src/helpPage';

// one of each problem, with awkward inputs
const all: Problem[] = [
  problems.noName(),
  problems.restrictedMode(),
  problems.noLanguageExtension('rust', languageSupport('rust')!),
  problems.languageSupportOff('typescript'),
  problems.notInProject('rust'),
  problems.notInProject('go'),
  problems.libraryNotInstalled('python', 'numpy'),
  problems.libraryNotInstalled('rust', 'serde_json'),
  problems.libraryNotInstalled('cobol', 'x'),
  problems.noDefinition('python', 'clip'),
  problems.unsupportedDeclaration('the declaration is in "git:" content, which Ponder cannot read'),
  problems.ambiguous('f'),
  problems.ownCode('helper'),
  problems.unknownLibrary('f', 'mylib'),
  problems.noAnimationYet('sorted', 'the Python standard library'),
  problems.onlineOff('clip', '"numpy"'),
  problems.onlineSkipped('clip'),
  problems.indexUnreachable('clip', 'you seem to be offline'),
  problems.brokenLibraryFile('mathutils', '$.animations.a.slides[0]: Unknown property "captoin".'),
  problems.needsUpdate('This file needs a newer Ponder: it uses "tables", which this version does not have. Update Ponder to see this animation.'),
  problems.unexpected(),
];

describe('problem catalogue', () => {
  it('every problem says what happened and what to try', () => {
    for (const p of all) {
      expect(p.title.length, p.id).toBeGreaterThan(5);
      expect(p.title.endsWith('.'), `${p.id}: titles have no final period`).toBe(false);
      expect(p.detail.length, p.id).toBeGreaterThan(20);
      expect(p.tries.length, p.id).toBeGreaterThan(0);
      for (const t of p.tries) expect(t.length, p.id).toBeGreaterThan(15);
    }
  });

  it('every button runs a command the help page is allowed to run', () => {
    for (const p of all) for (const a of p.actions) expect(ALLOWED_COMMANDS, `${p.id}: ${a.command}`).toContain(a.command);
  });

  it('setup problems are the ones the user can fix on this computer', () => {
    const setup = all.filter((p) => p.setup).map((p) => p.id);
    expect(setup).toEqual(expect.arrayContaining(['restricted-mode', 'no-language-extension', 'not-in-project', 'library-not-installed', 'index-unreachable', 'needs-update']));
    expect(setup).not.toContain('no-animation-yet');
    expect(setup).not.toContain('own-code');
  });

  it('gives the right install command per language', () => {
    expect(problems.libraryNotInstalled('python', 'numpy').tries[0]).toContain('`python -m pip install numpy`');
    expect(problems.libraryNotInstalled('typescript', 'lodash').tries[0]).toContain('`npm install lodash`');
    expect(problems.libraryNotInstalled('rust', 'serde_json').tries[0]).toContain('`cargo add serde-json`');
    expect(problems.libraryNotInstalled('go', 'github.com/samber/lo').tries[0]).toContain('`go get github.com/samber/lo`');
    expect(problems.libraryNotInstalled('python', 'numpy').actions.map((a) => a.command)).toContain('python.setInterpreter');
  });

  it('offers to install the right extension', () => {
    const p = problems.noLanguageExtension('rust', languageSupport('rust')!);
    expect(p.title).toBe("Rust support isn't installed");
    expect(p.actions[0]).toEqual({ label: 'Install rust-analyzer', command: 'workbench.extensions.installExtension', args: ['rust-lang.rust-analyzer'] });
    expect(languageSupport('python')!.acceptable).toContain('ms-python.vscode-pylance');
    expect(languageSupport('plaintext')).toBeNull();
  });

  it('the notification includes the first thing to try; the log has every step', () => {
    const p = problems.indexUnreachable('clip', 'you seem to be offline');
    expect(notificationText(p)).toContain('Try: Check your internet connection');
    expect(longText(p)).toMatch(/Try:\n {2}1\. .*\n {2}2\. .*\n {2}3\. /);
  });
});

describe('unresolved imports from diagnostics', () => {
  it.each([
    ['Import "numpy" could not be resolved', 'numpy'],
    ['Import "numpy.linalg" could not be resolved from source', 'numpy'],
    ["Cannot find module 'lodash' or its corresponding type declarations.", 'lodash'],
    ["Cannot find module 'lodash/fp' or its corresponding type declarations.", 'lodash'],
    ["Cannot find module '@scope/pkg/sub' or its corresponding type declarations.", '@scope/pkg'],
    ['unresolved import `itertools`', 'itertools'],
    ['unresolved import `itertools::Itertools`', 'itertools'],
    ['failed to resolve: use of undeclared crate or module `regex`', 'regex'],
    ['could not import github.com/samber/lo (no required module provides package "github.com/samber/lo")', 'github.com/samber/lo'],
  ])('%s', (message, module) => expect(unresolvedImport([{ message }])).toBe(module));

  it('ignores other diagnostics and relative imports', () => {
    expect(unresolvedImport([{ message: '"x" is not defined' }, { message: 'Expected expression' }])).toBeNull();
    expect(unresolvedImport([{ message: "Cannot find module './helpers' or its corresponding type declarations." }])).toBeNull();
    expect(unresolvedImport([])).toBeNull();
  });
});

describe('help page', () => {
  it('escapes everything that comes from outside', () => {
    const evil = problems.libraryNotInstalled('python', '<img src=x onerror=alert(1)>');
    const html = helpHtml(evil);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain("default-src 'none'");
  });

  it('turns backticks into code and buttons into allowed command links', () => {
    const html = helpHtml(problems.noLanguageExtension('rust', languageSupport('rust')!));
    expect(html).toContain('<ol><li>');
    expect(html).toContain(`href="${commandUri({ label: '', command: 'workbench.extensions.installExtension', args: ['rust-lang.rust-analyzer'] }).replace(/&/g, '&amp;')}"`);
    expect(html).toContain('command:ponder.showLog');
    expect(helpHtml(problems.noName())).toContain('<code>sorted</code>');
  });

  it('never links a command outside the allowed list', () => {
    const sneaky: Problem = { ...problems.noName(), actions: [{ label: 'x', command: 'workbench.action.terminal.sendSequence', args: ['rm -rf /'] }] };
    expect(helpHtml(sneaky)).not.toContain('sendSequence');
  });
});
