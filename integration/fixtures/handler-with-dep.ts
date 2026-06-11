import * as constructs from 'constructs';

export const handler = async (event: unknown) => ({
  event,
  // Object.keys confirms the external module loaded correctly at runtime.
  constructsExports: Object.keys(constructs).sort(),
});
