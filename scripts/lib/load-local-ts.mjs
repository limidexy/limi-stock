import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// Execute production modules; only external data fixtures are substituted.
export function loadLocalTs(entry, overrides = {}) {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const cache = new Map();
  function load(file) {
    if (Object.hasOwn(overrides, file)) return overrides[file];
    if (cache.has(file)) return cache.get(file).exports;
    if (file.endsWith('.json'))
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    const module = { exports: {} };
    cache.set(file, module);
    const nativeRequire = createRequire(file);
    const require = (name) => {
      if (!name.startsWith('.') && !name.startsWith('@/'))
        return nativeRequire(name);
      const base = name.startsWith('@/')
        ? path.join(root, name.slice(2))
        : path.resolve(path.dirname(file), name);
      const resolved = [base, `${base}.ts`, `${base}.json`].find((p) =>
        fs.existsSync(p),
      );
      if (!resolved) throw new Error(`Cannot resolve ${name} from ${file}`);
      return load(resolved);
    };
    const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText;
    vm.runInNewContext(
      js,
      { module, exports: module.exports, require, console },
      { filename: file },
    );
    return module.exports;
  }
  return load(path.resolve(root, entry));
}
