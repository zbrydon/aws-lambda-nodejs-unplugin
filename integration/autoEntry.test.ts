import { createRequire } from 'module';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { App, Stack, aws_lambda } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import type { Construct } from 'constructs';
import { expect, it } from 'vitest';
import { NodejsFunction } from '../src/function.ts';

/**
 * Integration tests for the V8 callsite entry auto-detection path.
 *
 * NodejsFunction is constructed without an explicit `entry` so the handler
 * is located by inspecting the V8 call stack at construction time.
 *
 * This Stack is defined in this file so that the callsite detection resolves
 * the defining file to autoEntry.test.ts, and the handler fixture lives at
 * autoEntry.test.worker.ts (construct id: 'worker').
 */
class AutoEntryStack extends Stack {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    // entry is intentionally omitted — the handler is resolved via V8 callsite
    // detection. NodejsFunction will look for autoEntry.test.worker.ts next to
    // this file.
    // oxlint-disable-next-line no-new
    new NodejsFunction(this, 'worker', {
      runtime: aws_lambda.Runtime.NODEJS_24_X,
      architecture: aws_lambda.Architecture.ARM_64,
      bundling: {
        bundler: 'esbuild',
        bundlerConfig: 'integration/fixtures/esbuild/config.mjs',
      },
    });
  }
}

it('auto-detects entry via V8 callsite and synthesises a valid CloudFormation template', () => {
  // Suppress bundling — only verify that findEntry() located the handler and
  // the construct was built without throwing.
  const app = new App({ context: { 'aws:cdk:bundling-stacks': [] } });
  const stack = new AutoEntryStack(app, 'TestStack');
  const template = Template.fromStack(stack);

  expect(() =>
    template.hasResourceProperties('AWS::Lambda::Function', {
      Handler: 'index.handler',
      Runtime: 'nodejs24.x',
    }),
  ).not.toThrow();
});

it('auto-detected entry bundles to a callable handler end-to-end', async () => {
  const outdir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdk-auto-entry-'));
  try {
    const app = new App({ outdir });
    // oxlint-disable-next-line no-new
    new AutoEntryStack(app, 'TestStack');
    // synth() stages assets, which triggers local tryBundle() for the lambda code.
    app.synth();

    // CDK writes bundled assets to outdir/asset.<hash>/ directories.
    const assetDirs = fs.readdirSync(outdir).filter((d) => d.startsWith('asset.'));
    expect(assetDirs.length, 'expected at least one bundled asset directory').toBeGreaterThan(0);

    const indexPath = path.join(outdir, assetDirs[0]!, 'index.js');
    expect(fs.existsSync(indexPath), `index.js missing in asset dir ${assetDirs[0]}`).toBe(true);

    const require = createRequire(import.meta.url);
    const mod = require(indexPath) as { handler?: unknown };
    expect(typeof mod.handler, 'handler export should be a function').toBe('function');

    const event = { source: 'auto-entry-integration-test' };
    const result = await (mod.handler as (e: unknown) => Promise<unknown>)(event);
    expect(result).toEqual(event);
  } finally {
    fs.rmSync(outdir, { recursive: true, force: true });
  }
}, 60_000);
