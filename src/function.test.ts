import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { App, Stack } from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Template } from 'aws-cdk-lib/assertions';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ValidationError } from './errors.ts';
import { NodejsFunction } from './function.ts';
import * as utilModule from './util.ts';

vi.mock('child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('child_process')>();
  return {
    ...original,
    spawnSync: vi.fn<typeof original.spawnSync>().mockReturnValue({
      status: 0,
      error: undefined,
      pid: 1,
      output: [],
      stdout: Buffer.from(''),
      stderr: Buffer.from(''),
      signal: null,
    }),
  };
});

let tmpDir: string;
let entryFile: string;
let lockFile: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fn-test-'));
  entryFile = path.join(tmpDir, 'handler.ts');
  lockFile = path.join(tmpDir, 'pnpm-lock.yaml');
  fs.writeFileSync(entryFile, 'export const handler = () => {};');
  fs.writeFileSync(lockFile, '');
  fs.writeFileSync(path.join(tmpDir, 'build.mjs'), 'export default {};');
  fs.writeFileSync(path.join(tmpDir, 'rollup.config.mjs'), 'export default {};');
  fs.writeFileSync(
    path.join(tmpDir, 'package.json'),
    JSON.stringify({ name: 'test', dependencies: {} }),
  );
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

const makeApp = () => new App({ context: { 'aws:cdk:bundling-stacks': [] } });

const makeScope = () => new Stack(makeApp(), 'TestStack');

describe('NodejsFunction', () => {
  it('synthesises a Lambda function with correct defaults', () => {
    const scope = makeScope();
    // oxlint-disable-next-line no-new
    new NodejsFunction(scope, 'my-handler', {
      entry: entryFile,
      depsLockFilePath: lockFile,
      bundling: {
        bundler: 'esbuild',
        bundlerConfig: path.join(tmpDir, 'build.mjs'),
      },
    });

    const template = Template.fromStack(scope);
    expect(() =>
      template.hasResourceProperties('AWS::Lambda::Function', {
        Handler: 'index.handler',
        Runtime: lambda.Runtime.NODEJS_LATEST.name,
      }),
    ).not.toThrow();
  });

  it('uses provided runtime', () => {
    const scope = makeScope();
    // oxlint-disable-next-line no-new
    new NodejsFunction(scope, 'my-handler', {
      entry: entryFile,
      runtime: lambda.Runtime.NODEJS_24_X,
      depsLockFilePath: lockFile,
      bundling: {
        bundler: 'rollup',
        bundlerConfig: path.join(tmpDir, 'rollup.config.mjs'),
      },
    });

    expect(() =>
      Template.fromStack(scope).hasResourceProperties('AWS::Lambda::Function', {
        Runtime: 'nodejs24.x',
      }),
    ).not.toThrow();
  });

  it('re-anchors a dotted handler to index. since output is always index.js', () => {
    const scope = makeScope();
    // oxlint-disable-next-line no-new
    new NodejsFunction(scope, 'my-handler', {
      entry: entryFile,
      handler: 'myFile.myFunction',
      depsLockFilePath: lockFile,
      bundling: {
        bundler: 'esbuild',
        bundlerConfig: path.join(tmpDir, 'build.mjs'),
      },
    });

    expect(() =>
      Template.fromStack(scope).hasResourceProperties('AWS::Lambda::Function', {
        Handler: 'index.myFunction',
      }),
    ).not.toThrow();
  });

  it('keeps only the final segment of a multi-dot / path-prefixed handler', () => {
    const scope = makeScope();
    // oxlint-disable-next-line no-new
    new NodejsFunction(scope, 'my-handler', {
      entry: entryFile,
      handler: 'src/nested.module.run',
      depsLockFilePath: lockFile,
      bundling: {
        bundler: 'esbuild',
        bundlerConfig: path.join(tmpDir, 'build.mjs'),
      },
    });

    expect(() =>
      Template.fromStack(scope).hasResourceProperties('AWS::Lambda::Function', {
        Handler: 'index.run',
      }),
    ).not.toThrow();
  });

  it.each(['', '   ', 'handler.', 'my-fn', '2fn', 'a.b.'])(
    'throws ValidationError for malformed handler %p',
    (handler) => {
      const scope = makeScope();
      expect(
        () =>
          new NodejsFunction(scope, 'my-handler', {
            entry: entryFile,
            handler,
            depsLockFilePath: lockFile,
            bundling: {
              bundler: 'esbuild',
              bundlerConfig: path.join(tmpDir, 'build.mjs'),
            },
          }),
      ).toThrow(ValidationError);
    },
  );

  it('prefixes handler with index. when no dot present', () => {
    const scope = makeScope();
    // oxlint-disable-next-line no-new
    new NodejsFunction(scope, 'my-handler', {
      entry: entryFile,
      handler: 'myFunction',
      depsLockFilePath: lockFile,
      bundling: {
        bundler: 'esbuild',
        bundlerConfig: path.join(tmpDir, 'build.mjs'),
      },
    });

    expect(() =>
      Template.fromStack(scope).hasResourceProperties('AWS::Lambda::Function', {
        Handler: 'index.myFunction',
      }),
    ).not.toThrow();
  });

  it('throws when the bundler config does not exist', () => {
    const scope = makeScope();
    expect(
      () =>
        new NodejsFunction(scope, 'my-handler', {
          entry: entryFile,
          depsLockFilePath: lockFile,
          bundling: {
            bundler: 'esbuild',
            bundlerConfig: path.join(tmpDir, 'missing.mjs'),
          },
        }),
    ).toThrow(/Cannot find bundler config/);
  });

  it('throws when the bundler config path is a directory', () => {
    const scope = makeScope();
    const dirConfig = path.join(tmpDir, 'config-dir.mjs');
    fs.mkdirSync(dirConfig);
    expect(
      () =>
        new NodejsFunction(scope, 'my-handler', {
          entry: entryFile,
          depsLockFilePath: lockFile,
          bundling: {
            bundler: 'esbuild',
            bundlerConfig: dirConfig,
          },
        }),
    ).toThrow(/is not a file/);
  });

  it('throws ValidationError for non-NODEJS runtime', () => {
    const scope = makeScope();
    expect(
      () =>
        new NodejsFunction(scope, 'my-handler', {
          entry: entryFile,
          runtime: lambda.Runtime.PYTHON_3_12,
          depsLockFilePath: lockFile,
          bundling: {
            bundler: 'esbuild',
            bundlerConfig: path.join(tmpDir, 'build.mjs'),
          },
        }),
    ).toThrow(ValidationError);
  });

  it('uses explicit projectRoot', () => {
    const scope = makeScope();
    expect(
      () =>
        new NodejsFunction(scope, 'my-handler', {
          entry: entryFile,
          depsLockFilePath: lockFile,
          projectRoot: tmpDir,
          bundling: {
            bundler: 'esbuild',
            bundlerConfig: path.join(tmpDir, 'build.mjs'),
          },
        }),
    ).not.toThrow();
  });

  it('throws when entry file does not exist', () => {
    const scope = makeScope();
    expect(
      () =>
        new NodejsFunction(scope, 'my-handler', {
          entry: path.join(tmpDir, 'nonexistent.ts'),
          depsLockFilePath: lockFile,
          bundling: {
            bundler: 'esbuild',
            bundlerConfig: path.join(tmpDir, 'build.mjs'),
          },
        }),
    ).toThrow(ValidationError);
  });

  it('throws when entry file has unsupported extension', () => {
    const scope = makeScope();
    expect(
      () =>
        new NodejsFunction(scope, 'my-handler', {
          entry: path.join(tmpDir, 'handler.py'),
          depsLockFilePath: lockFile,
          bundling: {
            bundler: 'esbuild',
            bundlerConfig: path.join(tmpDir, 'build.mjs'),
          },
        }),
    ).toThrow(ValidationError);
  });

  it('throws when entry path is a directory rather than a file', () => {
    const dirEntry = path.join(tmpDir, 'handler-dir.ts');
    fs.mkdirSync(dirEntry);

    const scope = makeScope();
    expect(
      () =>
        new NodejsFunction(scope, 'my-handler', {
          entry: dirEntry,
          depsLockFilePath: lockFile,
          bundling: {
            bundler: 'esbuild',
            bundlerConfig: path.join(tmpDir, 'build.mjs'),
          },
        }),
    ).toThrow(ValidationError);
  });

  it('throws when explicit depsLockFilePath does not exist', () => {
    const scope = makeScope();
    expect(
      () =>
        new NodejsFunction(scope, 'my-handler', {
          entry: entryFile,
          depsLockFilePath: path.join(tmpDir, 'nonexistent-lock.yaml'),
          bundling: {
            bundler: 'esbuild',
            bundlerConfig: path.join(tmpDir, 'build.mjs'),
          },
        }),
    ).toThrow(ValidationError);
  });

  it('throws when explicit depsLockFilePath is a directory', () => {
    const scope = makeScope();
    expect(
      () =>
        new NodejsFunction(scope, 'my-handler', {
          entry: entryFile,
          depsLockFilePath: tmpDir,
          bundling: {
            bundler: 'esbuild',
            bundlerConfig: path.join(tmpDir, 'build.mjs'),
          },
        }),
    ).toThrow(ValidationError);
  });

  it('auto-detects entry from .js sibling when no .ts exists', () => {
    const jsEntry = path.join(tmpDir, 'handler.js');
    fs.writeFileSync(jsEntry, 'module.exports.handler = () => {};');

    const scope = makeScope();
    expect(
      () =>
        new NodejsFunction(scope, 'my-handler', {
          entry: jsEntry,
          depsLockFilePath: lockFile,
          bundling: {
            bundler: 'esbuild',
            bundlerConfig: path.join(tmpDir, 'build.mjs'),
          },
        }),
    ).not.toThrow();
  });

  it('throws when multiple lock files found', () => {
    vi.spyOn(utilModule, 'findUpMultiple').mockReturnValueOnce([
      path.join(tmpDir, 'pnpm-lock.yaml'),
      path.join(tmpDir, 'yarn.lock'),
    ]);

    const scope = makeScope();
    expect(
      () =>
        new NodejsFunction(scope, 'my-handler', {
          entry: entryFile,
          bundling: {
            bundler: 'esbuild',
            bundlerConfig: path.join(tmpDir, 'build.mjs'),
          },
        }),
    ).toThrow(ValidationError);
  });

  it('does not throw when same-manager lock variants coexist (bun.lock + bun.lockb)', () => {
    fs.writeFileSync(path.join(tmpDir, 'bun.lock'), '');
    fs.writeFileSync(path.join(tmpDir, 'bun.lockb'), '');
    vi.spyOn(utilModule, 'findUpMultiple').mockReturnValueOnce([
      path.join(tmpDir, 'bun.lock'),
      path.join(tmpDir, 'bun.lockb'),
    ]);

    const scope = makeScope();
    expect(
      () =>
        new NodejsFunction(scope, 'my-handler', {
          entry: entryFile,
          projectRoot: tmpDir,
          bundling: {
            bundler: 'esbuild',
            bundlerConfig: path.join(tmpDir, 'build.mjs'),
          },
        }),
    ).not.toThrow();
  });

  it('throws when no lock files found anywhere', () => {
    vi.spyOn(utilModule, 'findUpMultiple').mockReturnValueOnce([]);

    const scope = makeScope();
    expect(
      () =>
        new NodejsFunction(scope, 'my-handler', {
          entry: entryFile,
          bundling: {
            bundler: 'esbuild',
            bundlerConfig: path.join(tmpDir, 'build.mjs'),
          },
        }),
    ).toThrow(ValidationError);
  });
});
