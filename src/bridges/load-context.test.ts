import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadBridgeContext } from './load-context.ts';

describe('loadBridgeContext', () => {
  const originalArgv = process.argv;
  const tmpDirs: string[] = [];

  afterEach(() => {
    process.argv = originalArgv;
    for (const dir of tmpDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  /** Writes a temp config module whose `export default` is the given source. */
  const writeConfig = (defaultExpr: string): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'load-context-'));
    tmpDirs.push(dir);
    const configPath = path.join(dir, 'config.mjs');
    fs.writeFileSync(configPath, `export default ${defaultExpr};\n`);
    return configPath;
  };

  it('parses argv, imports the config, and returns its default export', async () => {
    const configPath = writeConfig(`{ marker: 'ok' }`);
    process.argv = ['node', 'bridge.mjs', configPath, 'src/index.ts', 'dist'];

    const ctx = await loadBridgeContext();

    expect(ctx).toEqual({
      configPath,
      entry: 'src/index.ts',
      outputDir: 'dist',
      userConfig: { marker: 'ok' },
    });
  });

  it('throws when the config default export is not an object', async () => {
    const configPath = writeConfig('42');
    process.argv = ['node', 'bridge.mjs', configPath, 'src/index.ts', 'dist'];

    await expect(loadBridgeContext()).rejects.toThrow(
      'Config file must export a default config object',
    );
  });

  it('throws when the config default export is null', async () => {
    const configPath = writeConfig('null');
    process.argv = ['node', 'bridge.mjs', configPath, 'src/index.ts', 'dist'];

    await expect(loadBridgeContext()).rejects.toThrow(
      'Config file must export a default config object',
    );
  });
});
