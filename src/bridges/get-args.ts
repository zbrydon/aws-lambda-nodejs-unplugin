import * as z from 'zod/mini';

const Args = z.tuple([z.string(), z.string(), z.string()]);

export const getArgs = () => {
  // The parent spawns `node <bridge> <configPath> <entry> <outputDir>`. Drop the
  // node binary and script path, and ignore any extra trailing args so an added
  // flag or wrapper-injected argument does not break parsing.
  const [configPath, entry, outputDir] = z.parse(Args, process.argv.slice(2, 5));
  return { configPath, entry, outputDir };
};
