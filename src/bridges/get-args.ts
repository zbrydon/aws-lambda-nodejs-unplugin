import * as z from 'zod/mini';

const Args = z.tuple([z.string(), z.string(), z.string(), z.string(), z.string()]);

export const getArgs = () => {
  const [, , configPath, entry, outputDir] = z.parse(Args, process.argv);
  return { configPath, entry, outputDir };
};
