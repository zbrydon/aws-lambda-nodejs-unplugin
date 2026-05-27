import { rollup } from 'rollup';
import type { InputOptions, OutputOptions, Plugin } from 'rollup';
import { getArgs } from './get-args.ts';

const { configPath, entry, outputDir, nodeModules } = getArgs();

const { default: userConfig } = await import(configPath);

if (!userConfig || typeof userConfig !== 'object') {
  throw new Error(`Config file must export a default config object: ${configPath}`);
}

const externalPlugin: Plugin = {
  name: 'lambda-externals',
  resolveId(id) {
    if (nodeModules.some((m) => id === m || id.startsWith(`${m}/`))) {
      return { id, external: true };
    }
    return null;
  },
};

const inputOptions: InputOptions = {
  ...userConfig,
  input: entry,
  plugins: [...(userConfig.plugins ?? []), externalPlugin],
};

const rawOutput = userConfig.output;
const baseOutput = Array.isArray(rawOutput) ? rawOutput[0] : (rawOutput ?? {});

const outputOptions: OutputOptions = {
  ...baseOutput,
  dir: outputDir,
  entryFileNames: 'index.js',
};

const bundle = await rollup(inputOptions);
await bundle.write(outputOptions);
await bundle.close();
