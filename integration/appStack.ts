import {
  Duration,
  Stack,
  type StackProps,
  aws_kms,
  aws_lambda,
  aws_lambda_event_sources,
  aws_sns,
  aws_sqs,
} from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import { NodejsFunction } from '../src/function.ts';
import type { SupportedBundler } from '../src/types.ts';

export interface AppStackProps extends StackProps {
  bundler: SupportedBundler;
}

/**
 * Integration test stack.
 */
export class AppStack extends Stack {
  constructor(scope: Construct, id: string, props: AppStackProps) {
    super(scope, id, props);

    const kmsKey = new aws_kms.Key(this, 'kms-key', {
      description: 'test-service',
      enableKeyRotation: true,
    });

    const deadLetterQueue = new aws_sqs.Queue(this, 'worker-queue-dead-letters', {
      encryptionMasterKey: kmsKey,
      retentionPeriod: Duration.days(14),
    });

    const queue = new aws_sqs.Queue(this, 'worker-queue', {
      deadLetterQueue: { maxReceiveCount: 3, queue: deadLetterQueue },
      encryptionMasterKey: kmsKey,
      retentionPeriod: Duration.days(14),
    });

    const destinationTopic = new aws_sns.Topic(this, 'destination-topic', {
      masterKey: aws_kms.Alias.fromAliasName(this, 'alias-aws-sns', 'alias/aws/sns'),
    });

    const worker = new NodejsFunction(this, 'worker', {
      runtime: aws_lambda.Runtime.NODEJS_24_X,
      architecture: aws_lambda.Architecture.ARM_64,
      memorySize: 512,
      environmentEncryption: kmsKey,
      entry: 'src/testing/fixtures/handler.ts',
      timeout: Duration.seconds(30),
      bundling: {
        bundler: props.bundler,
        bundlerConfig: `src/testing/fixtures/${props.bundler}.config.mjs`,
      },
      environment: {
        NODE_ENV: 'production',
        DESTINATION_SNS_TOPIC_ARN: destinationTopic.topicArn,
      },
    });

    destinationTopic.grantPublish(worker);

    worker.addEventSource(
      new aws_lambda_event_sources.SqsEventSource(queue, {
        batchSize: 10,
        reportBatchItemFailures: true,
      }),
    );
  }
}
