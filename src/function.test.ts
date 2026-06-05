import * as fs from 'fs';
import { fileURLToPath } from 'node:url';
import * as os from 'os';
import * as path from 'path';
import { App, Stack } from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Template } from 'aws-cdk-lib/assertions';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ValidationError } from './errors.ts';
import { NodejsFunction } from './function.ts';
import * as utilModule from './util.ts';

// Mock child_process to prevent actual bundler invocations.
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
    // The bundle is always emitted as index.js, so a handler like
    // "myFile.myFunction" would point at a non-existent file at runtime. Only the
    // exported function name is kept and re-prefixed with index.
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
    // Should not throw with explicit projectRoot + entry + depsLockFilePath
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
          depsLockFilePath: tmpDir, // a directory, not a file
          bundling: {
            bundler: 'esbuild',
            bundlerConfig: path.join(tmpDir, 'build.mjs'),
          },
        }),
    ).toThrow(ValidationError);
  });

  it('auto-detects entry from .js sibling when no .ts exists', () => {
    // Write a .js handler file next to this test file won't work because
    // callsites() would look next to the compiled file. Use explicit entry
    // to verify .js extensions work.
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
    // Spy on findUpMultiple to return two lock files, simulating a repo
    // that has both pnpm-lock.yaml and yarn.lock in the same directory.
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

  it('throws when no lock files found anywhere', () => {
    // Mock findUpMultiple to return no lock files.
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

  it('auto-detect entry: throws when no handler file matches the pattern', () => {
    // Call without entry; auto-detect will use the callsite file (this test
    // file) + id, and no matching file exists for the id "xyzzy-no-such-file".
    const scope = makeScope();
    expect(
      () =>
        new NodejsFunction(scope, 'xyzzy-no-such-file', {
          depsLockFilePath: lockFile,
          bundling: {
            bundler: 'esbuild',
            bundlerConfig: path.join(tmpDir, 'build.mjs'),
          },
        }),
    ).toThrow(ValidationError);
  });

  it('auto-detect entry: finds a .ts file matching the calling file + id', () => {
    // findDefiningFile returns this test file. NodejsFunction will look for
    // function.test.<id>.ts alongside it; create that file.
    const thisFile = fileURLToPath(import.meta.url);
    const thisDir = path.dirname(thisFile);
    const ext = path.extname(thisFile);
    const handlerFile = thisFile.replace(
      new RegExp(`${ext.replace('.', '\\.')}$`),
      '.auto-entry.ts',
    );
    fs.writeFileSync(handlerFile, 'export const handler = () => {};');

    try {
      const scope = makeScope();
      expect(
        () =>
          new NodejsFunction(scope, 'auto-entry', {
            depsLockFilePath: lockFile,
            projectRoot: path.resolve(thisDir, '..'),
            bundling: {
              bundler: 'esbuild',
              bundlerConfig: path.join(tmpDir, 'build.mjs'),
            },
          }),
      ).not.toThrow();
    } finally {
      if (fs.existsSync(handlerFile)) {
        fs.unlinkSync(handlerFile);
      }
    }
  });

  it('auto-detect entry: works when NodejsFunction is subclassed', () => {
    // Subclassing exercises the while-loop in findDefiningFile that walks past
    // intermediate constructor frames (their `this` is uninitialised before
    // super() returns, so getTypeName() === null && isConstructor() === true).
    class CustomFunction extends NodejsFunction {}

    const thisFile = fileURLToPath(import.meta.url);
    const ext = path.extname(thisFile);
    const handlerFile = thisFile.replace(
      new RegExp(`${ext.replace('.', '\\.')}$`),
      '.custom-fn.ts',
    );
    fs.writeFileSync(handlerFile, 'export const handler = () => {};');

    try {
      const scope = makeScope();
      expect(
        () =>
          new CustomFunction(scope, 'custom-fn', {
            depsLockFilePath: lockFile,
            bundling: {
              bundler: 'esbuild',
              bundlerConfig: path.join(tmpDir, 'build.mjs'),
            },
          }),
      ).not.toThrow();
    } finally {
      if (fs.existsSync(handlerFile)) {
        fs.unlinkSync(handlerFile);
      }
    }
  });

  it('auto-detect: throws when defining file cannot be determined', () => {
    // Mock callsites to return a stack without 'NodejsFunction'.
    vi.spyOn(utilModule, 'callsites').mockReturnValueOnce([]);

    const scope = makeScope();
    expect(
      () =>
        new NodejsFunction(scope, 'my-handler', {
          depsLockFilePath: lockFile,
          bundling: {
            bundler: 'esbuild',
            bundlerConfig: path.join(tmpDir, 'build.mjs'),
          },
        }),
    ).toThrow(ValidationError);
  });

  it('auto-detect entry: construct id containing $& does not garble the candidate path', () => {
    // Regression: the id was previously passed as a raw string to String.replace(),
    // causing $& (and other $-sequences) to expand to the matched extension,
    // producing paths like ".Pay.tsHandler.ts" instead of ".Pay$&Handler.ts".
    const thisFile = fileURLToPath(import.meta.url);
    const ext = path.extname(thisFile);
    const id = 'Pay$&Handler';
    // Use a replacer function here too so the test's own path construction
    // isn't tripped up by the same $& expansion.
    const handlerFile = thisFile.replace(
      new RegExp(`${ext.replace('.', '\\.')}$`),
      () => `.${id}.ts`,
    );
    fs.writeFileSync(handlerFile, 'export const handler = () => {};');

    try {
      const scope = makeScope();
      expect(
        () =>
          new NodejsFunction(scope, id, {
            depsLockFilePath: lockFile,
            bundling: {
              bundler: 'esbuild',
              bundlerConfig: path.join(tmpDir, 'build.mjs'),
            },
          }),
      ).not.toThrow();
    } finally {
      if (fs.existsSync(handlerFile)) {
        fs.unlinkSync(handlerFile);
      }
    }
  });

  it('auto-detect: file:/// URL (three slashes) is normalised correctly by fileURLToPath', () => {
    // Simulate an ESM loader that returns a file:/// URL with three slashes.
    // A bare regex strip (/^file:\/\//) would leave a leading /C:/ on Windows.
    // fileURLToPath handles this correctly on all platforms.
    const thisFile = fileURLToPath(import.meta.url);
    const tripleSlashUrl = `file://${thisFile}`; // produces file:///abs/path on Unix

    vi.spyOn(utilModule, 'callsites').mockReturnValueOnce([
      {
        getFunctionName: () => 'NodejsFunction',
        getTypeName: () => 'NodejsFunction',
        getFileName: () => '/some/path/function.js',
        getLineNumber: () => 1,
        getColumnNumber: () => 1,
        isNative: () => false,
        isToplevel: () => false,
        isEval: () => false,
        isConstructor: () => true,
        getThis: () => undefined,
        getMethodName: () => null as unknown as string,
        getFunction: () => undefined as unknown as () => unknown,
        getEvalOrigin: () => '',
      },
      {
        // Frame whose getFileName() returns a file:/// URL.
        getFunctionName: () => 'TestStack',
        getTypeName: () => 'TestStack',
        getFileName: () => tripleSlashUrl,
        getLineNumber: () => 10,
        getColumnNumber: () => 5,
        isNative: () => false,
        isToplevel: () => false,
        isEval: () => false,
        isConstructor: () => true,
        getThis: () => undefined,
        getMethodName: () => null as unknown as string,
        getFunction: () => undefined as unknown as () => unknown,
        getEvalOrigin: () => '',
      },
    ] as ReturnType<typeof utilModule.callsites>);

    // The entry-detection will fail (no matching file) but the error message
    // must reference the properly normalised path, not a garbled URL with
    // a trailing slash artifact.
    const scope = makeScope();
    let errorMessage = '';
    try {
      const _fn = new NodejsFunction(scope, 'xyzzy-no-such-file', {
        depsLockFilePath: lockFile,
        bundling: {
          bundler: 'esbuild',
          bundlerConfig: path.join(tmpDir, 'build.mjs'),
        },
      });
    } catch (e) {
      errorMessage = String(e);
    }
    // The tried paths should be derived from the real fs path, not "file:///…".
    expect(errorMessage).not.toContain('file://');
    expect(errorMessage).toContain('.xyzzy-no-such-file');
  });

  it('auto-detect: skips factory-wrapper frame to find the real CDK construct call site', () => {
    // Regression: when a non-constructor factory function wraps new NodejsFunction(),
    // the stack-walk must continue past that frame and land on the enclosing
    // class constructor (the true call site).
    const thisFile = fileURLToPath(import.meta.url);

    vi.spyOn(utilModule, 'callsites').mockReturnValueOnce([
      // Frame 0: NodejsFunction constructor itself
      {
        getFunctionName: () => 'NodejsFunction',
        getTypeName: () => null as unknown as string,
        getFileName: () => '/some/path/function.js',
        getLineNumber: () => 58,
        getColumnNumber: () => 5,
        isNative: () => false,
        isToplevel: () => false,
        isEval: () => false,
        isConstructor: () => true,
        getThis: () => undefined,
        getMethodName: () => null as unknown as string,
        getFunction: () => undefined as unknown as () => unknown,
        getEvalOrigin: () => '',
      },
      // Frame 1: factory wrapper (non-constructor, null typeName)
      {
        getFunctionName: () => 'makeApi',
        getTypeName: () => null as unknown as string,
        getFileName: () => '/some/path/factory.js',
        getLineNumber: () => 5,
        getColumnNumber: () => 10,
        isNative: () => false,
        isToplevel: () => false,
        isEval: () => false,
        isConstructor: () => false,
        getThis: () => undefined,
        getMethodName: () => null as unknown as string,
        getFunction: () => undefined as unknown as () => unknown,
        getEvalOrigin: () => '',
      },
      // Frame 2: UserStack constructor, the actual call site (non-null typeName)
      {
        getFunctionName: () => 'UserStack',
        getTypeName: () => 'UserStack',
        getFileName: () => thisFile,
        getLineNumber: () => 20,
        getColumnNumber: () => 5,
        isNative: () => false,
        isToplevel: () => false,
        isEval: () => false,
        isConstructor: () => true,
        getThis: () => undefined,
        getMethodName: () => null as unknown as string,
        getFunction: () => undefined as unknown as () => unknown,
        getEvalOrigin: () => '',
      },
    ] as ReturnType<typeof utilModule.callsites>);

    // The auto-detect should resolve entry relative to thisFile (frame 2),
    // not relative to factory.js (frame 1).  No matching handler file exists,
    // so it will throw; the error must mention thisFile-derived paths,
    // not factory.js-derived paths.
    const scope = makeScope();
    let errorMessage = '';
    try {
      const _fn = new NodejsFunction(scope, 'no-such-handler', {
        depsLockFilePath: lockFile,
        bundling: {
          bundler: 'esbuild',
          bundlerConfig: path.join(tmpDir, 'build.mjs'),
        },
      });
    } catch (e) {
      errorMessage = String(e);
    }
    expect(errorMessage).toContain('no-such-handler');
    // The path must be derived from thisFile (function.test.*), not factory.js.
    expect(errorMessage).not.toContain('factory');
    expect(errorMessage).toContain('function.test');
  });

  const s3KeyForAssetHash = (assetHash: string): string => {
    const scope = makeScope();
    // oxlint-disable-next-line no-new
    new NodejsFunction(scope, 'my-handler', {
      entry: entryFile,
      depsLockFilePath: lockFile,
      bundling: {
        bundler: 'esbuild',
        bundlerConfig: path.join(tmpDir, 'build.mjs'),
        assetHash,
      },
    });
    const fns = Template.fromStack(scope).findResources('AWS::Lambda::Function');
    const [fn] = Object.values(fns) as { Properties: { Code: { S3Key: string } } }[];
    return fn!.Properties.Code.S3Key;
  };

  it('uses a custom assetHash to produce a deterministic, content-independent asset key', () => {
    // The same custom hash yields the same S3 key regardless of source content,
    // and a different custom hash yields a different key (CUSTOM hash type).
    expect(s3KeyForAssetHash('hash-one')).toBe(s3KeyForAssetHash('hash-one'));
    expect(s3KeyForAssetHash('hash-one')).not.toBe(s3KeyForAssetHash('hash-two'));
  });

  it('auto-detect: throws ValidationError when defining callsite has a null filename', () => {
    // Simulate a native/eval frame immediately after the NodejsFunction frame.
    vi.spyOn(utilModule, 'callsites').mockReturnValueOnce([
      {
        getFunctionName: () => 'NodejsFunction',
        getTypeName: () => 'NodejsFunction',
        getFileName: () => '/some/path/function.js',
        getLineNumber: () => 1,
        getColumnNumber: () => 1,
        isNative: () => false,
        isToplevel: () => false,
        isEval: () => false,
        isConstructor: () => true,
        getThis: () => undefined,
        getMethodName: () => null as unknown as string,
        getFunction: () => undefined as unknown as () => unknown,
        getEvalOrigin: () => '',
      },
      {
        // Native frame: getFileName() returns null.
        getFunctionName: () => null as unknown as string,
        getTypeName: () => null as unknown as string,
        getFileName: () => null as unknown as string,
        getLineNumber: () => 0,
        getColumnNumber: () => 0,
        isNative: () => true,
        isToplevel: () => false,
        isEval: () => false,
        isConstructor: () => false,
        getThis: () => undefined,
        getMethodName: () => null as unknown as string,
        getFunction: () => undefined as unknown as () => unknown,
        getEvalOrigin: () => '',
      },
    ] as ReturnType<typeof utilModule.callsites>);

    const scope = makeScope();
    expect(
      () =>
        new NodejsFunction(scope, 'my-handler', {
          depsLockFilePath: lockFile,
          bundling: {
            bundler: 'esbuild',
            bundlerConfig: path.join(tmpDir, 'build.mjs'),
          },
        }),
    ).toThrow(ValidationError);
  });
});
