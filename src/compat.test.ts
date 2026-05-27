/**
 * Type-level compatibility test.
 *
 * Verifies that NodejsFunction is structurally assignable to lambda.Function
 * and satisfies the IFunction interface expected by event sources, deployment
 * constructs, and Datadog wrappers.
 */
import type * as lambda from 'aws-cdk-lib/aws-lambda';
import type { aws_lambda_event_sources } from 'aws-cdk-lib';
import { describe, expectTypeOf, it } from 'vitest';
import type { NodejsFunction } from './function.ts';

describe('NodejsFunction type compatibility', () => {
  it('is assignable to lambda.Function', () => {
    expectTypeOf<NodejsFunction>().toMatchTypeOf<lambda.Function>();
  });

  it('is assignable to lambda.IFunction', () => {
    expectTypeOf<NodejsFunction>().toMatchTypeOf<lambda.IFunction>();
  });

  it('satisfies SqsEventSource addEventSource parameter', () => {
    type AddEventSourceArg = Parameters<
      InstanceType<typeof aws_lambda_event_sources.SqsEventSource>['bind']
    >[0];
    expectTypeOf<NodejsFunction>().toMatchTypeOf<AddEventSourceArg>();
  });
});
