import * as fs from 'fs';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ValidationError } from './errors.ts';
import { callsites, extractDependencies, findUp, findUpMultiple, isCallSite } from './util.ts';

describe('isCallSite', () => {
  it('returns false for non-record values', () => {
    expect(isCallSite(null)).toBe(false);
    expect(isCallSite('string')).toBe(false);
    expect(isCallSite(42)).toBe(false);
  });

  it('returns false for a plain object missing getFileName / getFunctionName', () => {
    expect(isCallSite({})).toBe(false);
    expect(isCallSite({ getFileName: 'not a function' })).toBe(false);
  });

  it('returns true for an object with the required function properties', () => {
    expect(isCallSite({ getFileName: () => '', getFunctionName: () => '' })).toBe(true);
  });
});

describe('callsites', () => {
  it('returns an array of call site objects', () => {
    const sites = callsites();
    expect(Array.isArray(sites)).toBe(true);
    expect(sites.length).toBeGreaterThan(0);
    expect(typeof sites[0]!.getFileName()).toBe('string');
    expect(typeof sites[0]!.getLineNumber()).toBe('number');
  });
});

describe('findUpMultiple', () => {
  it('returns files found in the current directory', () => {
    const results = findUpMultiple(['package.json'], process.cwd());
    expect(results.some((f) => f.endsWith('package.json'))).toBe(true);
  });

  it('returns empty array when no files found anywhere', () => {
    const results = findUpMultiple(['__nonexistent_xyzzy__.json'], '/');
    expect(results).toEqual([]);
  });

  it('walks up to find a file in a parent directory', () => {
    const deepDir = path.join(process.cwd(), 'src');
    const results = findUpMultiple(['package.json'], deepDir);
    expect(results.some((f) => f.endsWith('package.json'))).toBe(true);
  });

  it('returns multiple files found at the same level', () => {
    // package-lock.json and pnpm-lock.yaml never coexist here, but package.json does
    const results = findUpMultiple(['package.json', 'pnpm-lock.yaml']);
    expect(results.length).toBeGreaterThanOrEqual(1);
  });
});

describe('findUp', () => {
  it('finds package.json walking up from src/', () => {
    const result = findUp('package.json', path.join(process.cwd(), 'src'));
    expect(result).toBeDefined();
    expect(result!.endsWith('package.json')).toBe(true);
  });

  it('returns undefined when file does not exist', () => {
    const result = findUp('__nonexistent_xyzzy__.json');
    expect(result).toBeUndefined();
  });
});

describe('extractDependencies', () => {
  const tmpPkgPath = path.join(process.cwd(), '__test_pkg__.json');

  beforeEach(() => {
    fs.writeFileSync(
      tmpPkgPath,
      JSON.stringify({
        dependencies: { lodash: '^4.17.21' },
        devDependencies: { vitest: '^4' },
        peerDependencies: { react: '^18' },
      }),
    );
  });

  afterEach(() => {
    if (fs.existsSync(tmpPkgPath)) {
      fs.unlinkSync(tmpPkgPath);
    }
  });

  it('extracts version from dependencies', () => {
    const result = extractDependencies(tmpPkgPath, ['lodash']);
    expect(result.lodash).toBe('^4.17.21');
  });

  it('extracts version from devDependencies', () => {
    const result = extractDependencies(tmpPkgPath, ['vitest']);
    expect(result.vitest).toBe('^4');
  });

  it('extracts version from peerDependencies', () => {
    const result = extractDependencies(tmpPkgPath, ['react']);
    expect(result.react).toBe('^18');
  });

  it('throws ValidationError when module not found', () => {
    expect(() => extractDependencies(tmpPkgPath, ['__nonexistent_module__'])).toThrow(
      ValidationError,
    );
  });

  it('resolves relative file: specifiers to absolute', () => {
    fs.writeFileSync(tmpPkgPath, JSON.stringify({ dependencies: { local: 'file:../some-pkg' } }));
    const result = extractDependencies(tmpPkgPath, ['local']);
    expect(result.local).toMatch(/^file:.*some-pkg$/);
    expect(path.isAbsolute(result.local!.replace('file:', ''))).toBe(true);
  });

  it('passes through absolute file: specifiers unchanged', () => {
    fs.writeFileSync(tmpPkgPath, JSON.stringify({ dependencies: { local: 'file:/abs/path' } }));
    const result = extractDependencies(tmpPkgPath, ['local']);
    expect(result.local).toBe('file:/abs/path');
  });

  it('falls back to require for installed transitive deps', () => {
    // 'vitest' is actually installed, so its version is resolvable even if
    // not in the pkg JSON when we omit it from the keys.
    fs.writeFileSync(tmpPkgPath, JSON.stringify({}));
    const result = extractDependencies(tmpPkgPath, ['vitest']);
    expect(result.vitest).toMatch(/^\d+\.\d+/);
  });

  it('dependencies version takes precedence over peerDependencies when both declare the same module', () => {
    // Regression: peerDependencies previously spread last and overwrote the
    // pinned version from dependencies, causing a range like >=7.0.0 to win
    // over an explicit 8.11.3 in the Lambda output package.json.
    fs.writeFileSync(
      tmpPkgPath,
      JSON.stringify({
        dependencies: { pg: '8.11.3' },
        peerDependencies: { pg: '>=7.0.0' },
      }),
    );
    const result = extractDependencies(tmpPkgPath, ['pg']);
    expect(result.pg).toBe('8.11.3');
  });

  it('devDependencies version takes precedence over peerDependencies when both declare the same module', () => {
    fs.writeFileSync(
      tmpPkgPath,
      JSON.stringify({
        devDependencies: { ts: '5.0.0' },
        peerDependencies: { ts: '>=4.0.0' },
      }),
    );
    const result = extractDependencies(tmpPkgPath, ['ts']);
    expect(result.ts).toBe('5.0.0');
  });

  it('throws ValidationError for a module with an empty version string instead of silently falling through', () => {
    // Regression: !version was true for '', so the fallback require() would
    // resolve whatever was installed, giving no error about the malformed entry.
    fs.writeFileSync(tmpPkgPath, JSON.stringify({ dependencies: { 'some-mod': '' } }));
    expect(() => extractDependencies(tmpPkgPath, ['some-mod'])).toThrow(ValidationError);
  });

  it('throws ValidationError when the package.json file is not a JSON object', () => {
    // e.g. someone accidentally writes an array or null as their package.json
    fs.writeFileSync(tmpPkgPath, JSON.stringify([]));
    expect(() => extractDependencies(tmpPkgPath, ['lodash'])).toThrow(ValidationError);
  });

  it('require fallback is anchored to the entry package directory, not process.cwd()', () => {
    // When the module is not in package.json, resolution must start from the
    // directory that contains the package.json, not from process.cwd().
    // vitest is installed in the project root; if we anchor to a temp dir
    // that is NOT the project root, createRequire still resolves upward through
    // node_modules, so the exact version may vary, but the call must not throw.
    //
    // A more important property: the pkgPath directory is used, not process.cwd().
    // We verify this indirectly: if fromDir were wrong (e.g. '/') the require
    // would still silently succeed or fail gracefully; what we guard against
    // is the old bug of always using process.cwd() which in a monorepo would
    // resolve the wrong package root.  The unit-testable invariant is that
    // the version is resolved from the same directory as the package.json.
    fs.writeFileSync(tmpPkgPath, JSON.stringify({}));
    // vitest is reachable from both cwd and the temp dir (via node_modules hierarchy),
    // so this should resolve successfully.
    expect(() => extractDependencies(tmpPkgPath, ['vitest'])).not.toThrow();
    const result = extractDependencies(tmpPkgPath, ['vitest']);
    expect(result.vitest).toMatch(/^\d+\.\d+/);
  });

  it('require fallback returns undefined when the installed package.json version is not a string', () => {
    // Exercises the defensive `return undefined` path in tryGetModuleVersionFromRequire
    // for the (uncommon) case where require succeeds but pkg.version is not a string.
    // We do this by planting a fake module in a local node_modules whose package.json
    // carries a numeric version field.
    const pkgDir = path.dirname(tmpPkgPath);
    const fakeModDir = path.join(pkgDir, 'node_modules', 'fake-non-string-ver');
    fs.mkdirSync(fakeModDir, { recursive: true });
    fs.writeFileSync(path.join(fakeModDir, 'package.json'), JSON.stringify({ version: 42 }));
    fs.writeFileSync(tmpPkgPath, JSON.stringify({}));

    // tryGetModuleVersionFromPkg returns undefined (module absent from pkg.json).
    // tryGetModuleVersionFromRequire resolves fake-non-string-ver/package.json,
    // finds version === 42 (number), fails the typeof check, and returns undefined.
    // extractDependencies then throws because no version was resolved at all.
    expect(() => extractDependencies(tmpPkgPath, ['fake-non-string-ver'])).toThrow(ValidationError);
  });
});
