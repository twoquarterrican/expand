import util from 'util';
import {
  combine,
  complete,
  IMaybeSuspended,
  isSuspended,
  suspend,
} from './suspendable';
import {
  empty,
  IRecordLookupResult,
  Optional,
  present,
  recordLookup,
  recursiveMapper,
  recursiveMapperReducer,
  TPath,
  TPathFn,
} from 'recursive-reducer';
import { checkForCycles, TDependenciesOf } from './dependencies';

const debuglog = util.debuglog('expand');
const error = console.error;

export const regexStringVisitor = <T>(
  regex: RegExp,
  onMatch: (match: RegExpExecArray, path: TPath) => IMaybeSuspended<T>,
): TPathFn<unknown, Optional<IMaybeSuspended<string | T>>> => (
  s: unknown,
  path: TPath,
) => {
  if (typeof s !== 'string') {
    return empty();
  }

  let previousLastIndex = 0;
  const pieces: IMaybeSuspended<string | T>[] = [];
  regex.lastIndex = 0;
  while (true) {
    const match = regex.exec(s);
    if (!match) {
      // if pieces.length === 0, this is the first test, meaning
      // no match at all, so we have to return a result isPresent:false (below)
      // if pieces.length > 0, then we need to add in the tail piece so the
      // whole string assembles together at the end
      if (pieces.length > 0) {
        const tail = s.substr(previousLastIndex);
        if (tail) pieces.push(complete(tail));
      }
      break;
    }
    const sub = s.substr(previousLastIndex, match.index - previousLastIndex);
    if (sub) pieces.push(complete(sub));
    pieces.push(onMatch(match, path));
    previousLastIndex = regex.lastIndex;
  }
  if (pieces.length === 0) {
    return empty();
  } else if (pieces.length === 1) {
    // only one piece: string in config may be replaced with obj or other type
    return present(pieces[0]);
  } else {
    // multiple pieces: string in config must be replaced
    // with string after all suspendable functions are done
    return present(combine(pieces, (values) => values.join('')));
  }
};

const advance = (config: unknown) =>
  recursiveMapper(() => (value: unknown) => {
    if (!isSuspended(value)) {
      return { isPresent: false };
    } else {
      const advanced = value.advance(config);
      if (!isSuspended(advanced)) {
        debuglog(
          'resolved',
          value.toString(),
          'to',
          util.inspect(advanced, false, 10, true),
        );
      }
      return { isPresent: true, value: advanced };
    }
  })(config);

const dependenciesOf: (
  config: unknown,
) => TDependenciesOf = recursiveMapperReducer(
  () => ({}), // only invoked on non-suspended values
  (prev: TDependenciesOf, current: TDependenciesOf) => {
    for (const identifier of Object.keys({ ...prev, ...current })) {
      const dependenciesArr: string[] = prev[identifier] || [];
      dependenciesArr.push(...(current[identifier] || []));
      prev[identifier] = dependenciesArr;
    }
    return prev;
  },
  () => ({}),
  (value: unknown) =>
    isSuspended(value)
      ? present({ [value.identifier]: value.dependencies })
      : empty(),
);

const advanceRepeatedly = (start: unknown): unknown => {
  let next = start;
  for (let i = 0; i < 100; i++) {
    const dependencies = dependenciesOf(next);
    if (Object.keys(dependencies).length === 0) {
      return next;
    } else {
      checkForCycles(dependencies);
      next = advance(next);
    }
  }
  error('[ERROR] expanded:', util.inspect(next, false, null, true));
  throw new Error(
    `After 100 iterations, there are still suspended functions in the config`,
  );
};

export interface IRecordLookupFn {
  expression: string;
  lookup: (a: unknown) => IRecordLookupResult;
}

export const basicRecordLookupFnFactory = (
  match: RegExpExecArray,
  valueKeyFn: (value: unknown, key: number | string) => unknown = (
    value,
    key,
  ) => (value as any)[key],
): IRecordLookupFn => {
  if (match[1] === undefined || match[0] === undefined) {
    throw new Error('Regex must have a value at group 1. Result is ' + match);
  }
  return {
    expression: match[0],
    lookup: recordLookup(match[1].split('.'), valueKeyFn),
  };
};

export const DOLLAR_SIGN_BRACKET_REFERENCE = (
  recordLookupFnFactory: (match: RegExpExecArray) => IRecordLookupFn,
): TPathFn<unknown, Optional<IMaybeSuspended<unknown>>> =>
  regexStringVisitor(/\${([^}]+)}/g, (match: RegExpExecArray) =>
    suspendedRecordLookupFn(recordLookupFnFactory(match), []),
  );

export const suspendedRecordLookupFn = (
  recordLookupFn: IRecordLookupFn,
  dependencies: string[],
): IMaybeSuspended<unknown> => {
  const { expression, lookup } = recordLookupFn;
  return suspend(
    expression,
    (evaluationContext) => {
      const { resolvedPath, unresolvedPath, value, values } = lookup(
        evaluationContext,
      );

      const dependedOn = [...values, value].find((val: unknown): boolean =>
        isSuspended(val),
      );
      if (dependedOn !== undefined) {
        return suspendedRecordLookupFn(recordLookupFn, [
          ...dependencies,
          dependedOn.identifier,
        ]);
      } else if (unresolvedPath.length === 0) {
        return value;
      } else
        throw new Error(
          `Expression ${expression} evaluated with unresolved path [${unresolvedPath}], resolved path [${resolvedPath}], and value: ${value}`,
        );
    },
    dependencies,
  );
};

export const expander = <T>(
  mapper: (a: unknown, path: TPath) => Optional<IMaybeSuspended<T>>,
): ((baseConfig: unknown) => unknown) => {
  const initialExpander = recursiveMapper(() => mapper);
  return (baseConfig: unknown) => {
    const expanded = initialExpander(baseConfig);
    return advanceRepeatedly(expanded);
  };
};
