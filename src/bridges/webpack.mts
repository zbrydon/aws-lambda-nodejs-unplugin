import webpack from 'webpack';
import type { Configuration } from 'webpack';
import { runWebpackBridge } from './webpack-factory.mts';

await runWebpackBridge((config) => webpack(config as Configuration));
