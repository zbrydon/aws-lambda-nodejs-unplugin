import * as aws_lambda from 'aws-cdk-lib/aws-lambda';
import * as path from 'node:path';

export const BASE_BUNDLING_PROPS = {
  runtime: aws_lambda.Runtime.NODEJS_24_X,
  architecture: aws_lambda.Architecture.ARM_64,
  depsLockFilePath: path.resolve('pnpm-lock.yaml'),
  projectRoot: path.resolve('.'),
};
