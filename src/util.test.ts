import * as fs from 'fs';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ValidationError } from './errors.ts';
import { extractDependencies, findUp, findUpMultiple, parseJsonFile } from './util.ts';

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

describe('parseJsonFile', () => {
  const tmpJsonPath = path.join(process.cwd(), '__test_parse__.json');

  afterEach(() => {
    if (fs.existsSync(tmpJsonPath)) {
      fs.unlinkSync(tmpJsonPath);
    }
  });

  it('returns the parsed value for valid JSON', () => {
    fs.writeFileSync(tmpJsonPath, JSON.stringify({ a: 1 }));
    expect(parseJsonFile(tmpJsonPath)).toEqual({ a: 1 });
  });

  it('throws ValidationError for malformed JSON', () => {
    fs.writeFileSync(tmpJsonPath, 'not-json{');
    expect(() => parseJsonFile(tmpJsonPath)).toThrow(ValidationError);
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

  it.each(['file:', 'file:   '])('throws on a file: specifier with an empty path (%p)', (spec) => {
    fs.writeFileSync(tmpPkgPath, JSON.stringify({ dependencies: { local: spec } }));
    expect(() => extractDependencies(tmpPkgPath, ['local'])).toThrow(
      /'file:' dependency with an empty path/,
    );
  });

  it.each(['workspace:*', 'workspace:^1.0.0', 'link:../pkg', 'catalog:', 'catalog:react'])(
    'resolves %p specifier to the concrete installed version via the require fallback',
    (spec) => {
      fs.writeFileSync(tmpPkgPath, JSON.stringify({ dependencies: { vitest: spec } }));
      const result = extractDependencies(tmpPkgPath, ['vitest']);

      expect(result.vitest).not.toBe(spec);
      expect(result.vitest).toMatch(/^\d+\.\d+\.\d+/);
    },
  );

  it('throws when a workspace: specifier cannot be resolved from installed modules', () => {
    fs.writeFileSync(
      tmpPkgPath,
      JSON.stringify({ dependencies: { __nonexistent_module__: 'workspace:*' } }),
    );
    expect(() => extractDependencies(tmpPkgPath, ['__nonexistent_module__'])).toThrow(
      ValidationError,
    );
  });

  it('falls back to require for installed transitive deps', () => {
    fs.writeFileSync(tmpPkgPath, JSON.stringify({}));
    const result = extractDependencies(tmpPkgPath, ['vitest']);
    expect(result.vitest).toMatch(/^\d+\.\d+/);
  });

  it('dependencies version takes precedence over peerDependencies when both declare the same module', () => {
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
    fs.writeFileSync(tmpPkgPath, JSON.stringify({ dependencies: { 'some-mod': '' } }));
    expect(() => extractDependencies(tmpPkgPath, ['some-mod'])).toThrow(ValidationError);
  });

  it('throws ValidationError when the package.json file is not a JSON object', () => {
    fs.writeFileSync(tmpPkgPath, JSON.stringify([]));
    expect(() => extractDependencies(tmpPkgPath, ['lodash'])).toThrow(ValidationError);
  });

  it('require fallback is anchored to the entry package directory, not process.cwd()', () => {
    fs.writeFileSync(tmpPkgPath, JSON.stringify({}));

    expect(() => extractDependencies(tmpPkgPath, ['vitest'])).not.toThrow();
    const result = extractDependencies(tmpPkgPath, ['vitest']);
    expect(result.vitest).toMatch(/^\d+\.\d+/);
  });

  it('require fallback returns undefined when the installed package.json version is not a string', () => {
    const pkgDir = path.dirname(tmpPkgPath);
    const fakeModDir = path.join(pkgDir, 'node_modules', 'fake-non-string-ver');
    fs.mkdirSync(fakeModDir, { recursive: true });
    fs.writeFileSync(path.join(fakeModDir, 'package.json'), JSON.stringify({ version: 42 }));
    fs.writeFileSync(tmpPkgPath, JSON.stringify({}));

    expect(() => extractDependencies(tmpPkgPath, ['fake-non-string-ver'])).toThrow(ValidationError);
  });
});
