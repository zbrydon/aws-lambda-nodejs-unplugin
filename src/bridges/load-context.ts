import { getArgs } from './get-args.ts';

export const loadBridgeContext = async () => {
  const { configPath, entry, outputDir } = getArgs();

  const { default: userConfig } = await import(configPath);

  if (!userConfig || typeof userConfig !== 'object') {
    throw new Error(`Config file must export a default config object: ${configPath}`);
  }

  return { configPath, entry, outputDir, userConfig };
};
