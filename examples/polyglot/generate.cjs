// Writes examples/polyglot: one tiny library with ponder.json and one calling file per language.
// node examples/polyglot/generate.cjs  (overwrites the folder)
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;

const anim = (title, symbol, aliases = []) => ({
  symbol, ...(aliases.length ? { aliases } : {}), title,
  autoAdvance: true,
  actors: {
    label: { type: 'text', x: 500, y: 150, text: title, fontSize: 30 },
    dot: { type: 'circle', x: 250, y: 330, radius: 24, fill: 'accent' },
  },
  slides: [
    { caption: `${title}: start.` },
    { caption: 'The value moves.', changes: { dot: { x: 750, fill: 'success' } } },
  ],
});
const ponder = (name, clamp, push, extra = {}) => JSON.stringify({
  version: 1,
  library: { name },
  animations: { clamp: anim('clamp', ...clamp[0]), push: anim('IntStack.push', ...push[0]), ...extra },
}, null, 2) + '\n';

const files = {
  // ---- TypeScript
  'typescript/ts-math/package.json': '{ "name": "ts-math", "version": "1.0.0", "types": "index.ts" }\n',
  'typescript/ts-math/index.ts': 'export function clamp(value: number, min: number, max: number): number {\n  return Math.max(min, Math.min(max, value));\n}\n\nexport class IntStack {\n  private items: number[] = [];\n  push(value: number): void {\n    this.items.push(value);\n  }\n}\n',
  'typescript/ts-math/ponder.json': ponder('ts-math', [['js:ts-math#clamp']], [['js:ts-math#IntStack.push']]),
  'typescript/app/main.ts': "import { clamp, IntStack } from '../ts-math/index';\n\nfunction localClamp(v: number, a: number, b: number): number { return v; }\n\nconst a = clamp(-4, 0, 10);\nconst s = new IntStack();\ns.push(3);\nconst b = localClamp(1, 2, 3);\nconsole.log(a, b);\n",
  'typescript/tsconfig.json': '{ "compilerOptions": { "strict": true, "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler" }, "include": ["app", "ts-math"] }\n',

  // ---- Python
  'python/pyutils/__init__.py': 'from pyutils.stack import IntStack\n\n\ndef clamp(value: int, minimum: int, maximum: int) -> int:\n    return max(minimum, min(maximum, value))\n',
  'python/pyutils/stack.py': 'class IntStack:\n    def __init__(self) -> None:\n        self.items: list[int] = []\n\n    def push(self, value: int) -> None:\n        self.items.append(value)\n',
  'python/pyutils/ponder.json': ponder('pyutils', [['py:pyutils.clamp']], [['py:pyutils.stack.IntStack.push']]),
  'python/main.py': 'from pyutils import clamp\nfrom pyutils.stack import IntStack\n\n\ndef local_clamp(v: int, a: int, b: int) -> int:\n    return v\n\n\nx = clamp(-4, 0, 10)\ns = IntStack()\ns.push(3)\ny = local_clamp(1, 2, 3)\nprint(x, y)\n',

  // ---- Rust (cargo workspace)
  'rust/Cargo.toml': '[workspace]\nmembers = ["rmath", "app"]\nresolver = "2"\n',
  'rust/rmath/Cargo.toml': '[package]\nname = "rmath"\nversion = "1.0.0"\nedition = "2021"\n',
  'rust/rmath/src/lib.rs': 'pub mod stack;\n\npub fn clamp(value: i32, min: i32, max: i32) -> i32 {\n    value.max(min).min(max)\n}\n',
  'rust/rmath/src/stack.rs': 'pub struct IntStack {\n    items: Vec<i32>,\n}\n\nimpl IntStack {\n    pub fn new() -> Self {\n        IntStack { items: Vec::new() }\n    }\n\n    pub fn push(&mut self, value: i32) {\n        self.items.push(value);\n    }\n}\n',
  'rust/rmath/ponder.json': ponder('rmath', [['rust:rmath::clamp']], [['rust:rmath::stack::IntStack::push']]),
  'rust/app/Cargo.toml': '[package]\nname = "app"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\nrmath = { path = "../rmath" }\n',
  'rust/app/src/main.rs': 'use rmath::stack::IntStack;\n\nfn local_clamp(v: i32, _a: i32, _b: i32) -> i32 {\n    v\n}\n\nfn main() {\n    let a = rmath::clamp(-4, 0, 10);\n    let mut s = IntStack::new();\n    s.push(3);\n    let b = local_clamp(1, 2, 3);\n    println!("{} {}", a, b);\n}\n',

  // ---- C++
  'cpp/cmath-lib/include/cmath_lib.hpp': '#pragma once\n#include <vector>\n\nnamespace cm {\n\ninline int clamp(int value, int min, int max) {\n    return value < min ? min : (value > max ? max : value);\n}\n\nclass IntStack {\npublic:\n    void push(int value) { items.push_back(value); }\nprivate:\n    std::vector<int> items;\n};\n\n}  // namespace cm\n',
  'cpp/cmath-lib/ponder.json': ponder('cmath-lib', [['cpp:cm::clamp']], [['cpp:cm::IntStack::push']]),
  'cpp/app/main.cpp': '#include "../cmath-lib/include/cmath_lib.hpp"\n#include <cstdio>\n\nstatic int local_clamp(int v, int, int) { return v; }\n\nint main() {\n    int a = cm::clamp(-4, 0, 10);\n    cm::IntStack s;\n    s.push(3);\n    int b = local_clamp(1, 2, 3);\n    std::printf("%d %d\\n", a, b);\n}\n',

  // ---- PHP
  'php/phpmath/composer.json': '{ "name": "acme/phpmath", "autoload": { "psr-4": { "Acme\\\\": "src/" } } }\n',
  'php/phpmath/src/Math.php': '<?php\n\nnamespace Acme;\n\nclass Math\n{\n    public static function clamp(int $value, int $min, int $max): int\n    {\n        return max($min, min($max, $value));\n    }\n}\n',
  'php/phpmath/src/IntStack.php': '<?php\n\nnamespace Acme;\n\nclass IntStack\n{\n    private array $items = [];\n\n    public function push(int $value): void\n    {\n        $this->items[] = $value;\n    }\n}\n',
  'php/phpmath/ponder.json': ponder('acme/phpmath', [['sym:src/Math.php:Math.clamp', ['sym:src/Math.php:Acme.Math.clamp']]], [['sym:src/IntStack.php:IntStack.push', ['sym:src/IntStack.php:Acme.IntStack.push']]]),
  'php/app/index.php': '<?php\n\nrequire __DIR__ . \'/../phpmath/src/Math.php\';\nrequire __DIR__ . \'/../phpmath/src/IntStack.php\';\n\nuse Acme\\Math;\nuse Acme\\IntStack;\n\nfunction local_clamp(int $v, int $a, int $b): int { return $v; }\n\n$a = Math::clamp(-4, 0, 10);\n$s = new IntStack();\n$s->push(3);\n$b = local_clamp(1, 2, 3);\necho $a, $b;\n',

  // ---- Lua
  'lua/lmath/ponder.json': ponder('lmath', [['sym:lmath.lua:M.clamp', ['sym:lmath.lua:clamp']]], [['sym:stack.lua:IntStack.push']]),
  'lua/lmath/lmath.lua': 'local M = {}\n\nfunction M.clamp(value, min, max)\n  return math.max(min, math.min(max, value))\nend\n\nreturn M\n',
  'lua/lmath/stack.lua': 'local IntStack = {}\nIntStack.__index = IntStack\n\nfunction IntStack.new()\n  return setmetatable({ items = {} }, IntStack)\nend\n\nfunction IntStack:push(value)\n  table.insert(self.items, value)\nend\n\nreturn IntStack\n',
  'lua/main.lua': 'package.path = "lmath/?.lua;" .. package.path\nlocal lmath = require("lmath")\nlocal IntStack = require("stack")\n\nlocal function local_clamp(v, a, b) return v end\n\nlocal a = lmath.clamp(-4, 0, 10)\nlocal s = IntStack.new()\ns:push(3)\nlocal b = local_clamp(1, 2, 3)\nprint(a, b)\n',
  'lua/.luarc.json': '{ "workspace.library": ["lmath"], "runtime.path": ["?.lua", "lmath/?.lua"] }\n',

  // ---- Go (no toolchain on this machine: ponder check only)
  'go/gomath/go.mod': 'module example.com/gomath\n\ngo 1.22\n',
  'go/gomath/clamp.go': 'package gomath\n\nfunc Clamp(value, min, max int) int {\n\tif value < min {\n\t\treturn min\n\t}\n\tif value > max {\n\t\treturn max\n\t}\n\treturn value\n}\n',
  'go/gomath/stack/stack.go': 'package stack\n\ntype IntStack struct{ items []int }\n\nfunc (s *IntStack) Push(v int) { s.items = append(s.items, v) }\n',
  'go/gomath/ponder.json': ponder('example.com/gomath', [['go:example.com/gomath.Clamp']], [['go:example.com/gomath/stack.IntStack.Push']]),

  // ---- Ruby (no toolchain: ponder check only)
  'ruby/rbmath/rbmath.gemspec': 'Gem::Specification.new do |s|\n  s.name = "rbmath"\n  s.version = "1.0.0"\n  s.files = ["lib/rbmath.rb", "ponder.json"]\nend\n',
  'ruby/rbmath/lib/rbmath.rb': 'module RbMath\n  def self.clamp(value, min, max)\n    [[value, min].max, max].min\n  end\n\n  class IntStack\n    def push(value)\n      (@items ||= []) << value\n    end\n  end\nend\n',
  'ruby/rbmath/ponder.json': ponder('rbmath', [['sym:lib/rbmath.rb:RbMath.clamp']], [['sym:lib/rbmath.rb:RbMath.IntStack.push']]),

  // ---- Java through the VS Code Java extension (jar on the classpath, jdt:// sources)
  'java/.vscode/settings.json': '{\n  "java.project.sourcePaths": ["src"],\n  "java.project.referencedLibraries": ["libs/**/*.jar"],\n  "java.import.gradle.enabled": false,\n  "java.import.maven.enabled": false\n}\n',
  'java/src/demo/Main.java': 'package demo;\n\nimport com.example.collections.IntStack;\nimport com.example.math.MathUtils;\n\npublic class Main {\n    static int localClamp(int v, int a, int b) { return v; }\n\n    public static void main(String[] args) {\n        int a = MathUtils.clamp(-4, 0, 10);\n        IntStack s = new IntStack(4);\n        s.push(3);\n        int b = localClamp(1, 2, 3);\n        System.out.println(a + b);\n    }\n}\n',
};

for (const d of fs.readdirSync(ROOT)) if (d !== 'generate.cjs' && d !== 'README.md') fs.rmSync(path.join(ROOT, d), { recursive: true, force: true });
for (const [rel, content] of Object.entries(files)) {
  const f = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, content);
}
fs.mkdirSync(path.join(ROOT, 'java/libs'), { recursive: true });
fs.copyFileSync(path.join(ROOT, '../consumer/libs/math-utils-1.0.0.jar'), path.join(ROOT, 'java/libs/math-utils-1.0.0.jar'));
console.log(Object.keys(files).length + 1, 'files');
