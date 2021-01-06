export type TDependenciesOf = Record<string, string[]>;
export const checkForCycles = (dependencies: TDependenciesOf) => {
  for (let identifier of Object.keys(dependencies)) {
    checkForCyclesOnEach(dependencies, [[identifier]]);
  }
};
const checkForCyclesOnEach = (
  dependencies: TDependenciesOf,
  chains: string[][],
) => {
  const extendedChains: string[][] = [];
  for (let chain of chains) {
    // one extension for each next dependency
    const lastDependency = chain[chain.length - 1];
    if (lastDependency !== undefined) {
      const nextDependencies = dependencies[lastDependency] || [];
      for (let nextDependency of nextDependencies) {
        const extendedChain = [...chain, nextDependency];
        extendedChains.push(extendedChain);
        if (chain.includes(nextDependency)) {
          throw new Error(
            `Circular dependency: ${extendedChain.join(' --> ')}`,
          );
        }
      }
    }
  }
  if (extendedChains.length > 0) {
    checkForCyclesOnEach(dependencies, extendedChains);
  }
};