import * as z from 'zod/mini';

const Args = z.tuple([z.string(), z.string(), z.string(), z.string(), z.string(), z.string()]);

export const getArgs = () => {
  const [, , configPath, entry, outputDir, nodeModulesJson] = z.parse(Args, process.argv);
  const nodeModules = z.parse(z.array(z.string()), JSON.parse(nodeModulesJson));
  return { configPath, entry, outputDir, nodeModules };
};
