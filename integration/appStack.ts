import { Duration, Stack, type StackProps, aws_lambda } from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import { NodejsFunction } from '../src/function.ts';
import type { SupportedBundler } from '../src/types.ts';

export interface AppStackProps extends StackProps {
  bundler: SupportedBundler;
}

export class AppStack extends Stack {
  constructor(scope: Construct, id: string, props: AppStackProps) {
    super(scope, id, props);

    // oxlint-disable-next-line no-new
    new NodejsFunction(this, 'worker', {
      runtime: aws_lambda.Runtime.NODEJS_24_X,
      architecture: aws_lambda.Architecture.ARM_64,
      memorySize: 512,
      entry: 'src/testing/fixtures/handler.ts',
      timeout: Duration.seconds(30),
      bundling: {
        bundler: props.bundler,
        bundlerConfig: `src/testing/fixtures/${props.bundler}.config.mjs`,
      },
      environment: {
        NODE_ENV: 'production',
      },
    });
  }
}
