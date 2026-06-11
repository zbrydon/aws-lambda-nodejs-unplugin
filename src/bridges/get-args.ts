export const getArgs = () => {
  const [configPath, entry, outputDir] = process.argv.slice(2, 5);

  if (!configPath || !entry || !outputDir) {
    throw new Error('Expected arguments: <configPath> <entry> <outputDir>');
  }

  return { configPath, entry, outputDir };
};
