import { rspack } from '@rspack/core';
import type { Configuration } from '@rspack/core';
import { runWebpackBridge } from './webpack-factory.mts';

await runWebpackBridge((config) => rspack(config as Configuration));
