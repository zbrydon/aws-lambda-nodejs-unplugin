import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { afterEach, expect, it, vi } from 'vitest';
import { SUPPORTED_BUNDLERS } from '../src/types.ts';
import { AppStack } from './appStack.ts';

afterEach(() => {
  vi.resetModules();
});

it.each(SUPPORTED_BUNDLERS)(
  'synthesises expected CloudFormation template for bundler: %s',
  (bundler) => {
    const app = new App({ context: { 'aws:cdk:bundling-stacks': [] } });
    const stack = new AppStack(app, 'TestStack', { bundler });
    const template = Template.fromStack(stack);

    const json = JSON.stringify(template.toJSON())
      .replace(
        /"S3Key":"([0-9a-f]+)\.zip"/g,
        (_, hash) => `"S3Key":"${'x'.repeat(hash.length)}.zip"`,
      )
      .replace(
        /CurrentVersion([0-9a-zA-Z]+)"/g,
        (_, hash) => `CurrentVersion${'x'.repeat(hash.length)}"`,
      );

    expect(JSON.parse(json)).toMatchSnapshot();
  },
);
