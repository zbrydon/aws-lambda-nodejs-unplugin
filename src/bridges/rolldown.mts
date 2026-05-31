import { rolldown } from 'rolldown';
import type { InputOptions, OutputOptions } from 'rollup';
import { runRollBridge } from './roll-factory.mts';

// rolldown's InputOptions/OutputOptions are structurally identical to rollup's but
// come from a different package, so TypeScript treats them as distinct types.
// This adapter bridges the gap without casting the entire rolldown function.
const adapter = async (options: InputOptions) => {
  const bundle = await rolldown(options as Parameters<typeof rolldown>[0]);
  return {
    write: (out: OutputOptions) => bundle.write(out as Parameters<typeof bundle.write>[0]),
    close: () => bundle.close(),
  };
};

await runRollBridge(adapter);
