import { asRecord } from './config.ts';
import { getArgs } from './get-args.ts';

export interface BridgeContext {
  configPath: string;
  entry: string;
  outputDir: string;
  userConfig: Record<string, unknown>;
}

export const loadBridgeContext = async (): Promise<BridgeContext> => {
  const { configPath, entry, outputDir } = getArgs();

  const mod: unknown = await import(configPath);
  const userConfig = asRecord(asRecord(mod)?.default);

  if (!userConfig) {
    throw new Error(`Config file must export a default config object: ${configPath}`);
  }

  return { configPath, entry, outputDir, userConfig };
};
