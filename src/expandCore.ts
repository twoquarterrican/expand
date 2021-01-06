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

export const regexStringVisitor = <T extends any>(
  regex: RegExp,
  onMatch: (match: RegExpExecArray) => IMaybeSuspended<T>,
): TPathFn<any, Optional<IMaybeSuspended<string | T>>> => (s: any) => {
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
    pieces.push(onMatch(match));
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

const advance = (config: any) =>
  recursiveMapper(() => (value: any) => {
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

const dependenciesOf: (config: any) => TDependenciesOf = recursiveMapperReducer(
  () => ({}), // only invoked on non-suspended values
  (prev: TDependenciesOf, current: TDependenciesOf) => {
    for (let identifier of Object.keys({ ...prev, ...current })) {
      const dependenciesArr: string[] = prev[identifier] || [];
      dependenciesArr.push(...(current[identifier] || []));
      prev[identifier] = dependenciesArr;
    }
    return prev;
  },
  () => ({}),
  (value: any) =>
    isSuspended(value)
      ? present({ [value.identifier]: value.dependencies })
      : empty(),
);

const advanceRepeatedly = (start: any): any => {
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

export const DOLLAR_SIGN_BRACKET_REFERENCE = regexStringVisitor(
  /\${([^}]+)}/g,
  (match: RegExpExecArray) => {
    if (match[1] === undefined || match[0] === undefined) {
      throw new Error('Regex must have a value at group 1. Result is ' + match);
    }
    const recordLookupFn = recordLookup(match[1].split('.'));
    return suspendedRecordLookupFn(recordLookupFn, match[0], []);
  },
);

const suspendedRecordLookupFn = (
  recordLookupFn: (a: any) => IRecordLookupResult,
  suspendedFnStringValue: string,
  dependencies: string[],
): IMaybeSuspended<any> =>
  suspend(
    suspendedFnStringValue,
    (evaluationContext) => {
      const { resolvedPath, unresolvedPath, value, values } = recordLookupFn(
        evaluationContext,
      );

      const dependedOn = [...values, value].find((val: any): boolean =>
        isSuspended(val),
      );
      if (dependedOn !== undefined) {
        return suspendedRecordLookupFn(recordLookupFn, suspendedFnStringValue, [
          ...dependencies,
          dependedOn.identifier,
        ]);
      } else if (unresolvedPath.length === 0) {
        return value;
      } else
        throw new Error(
          `Expression ${suspendedFnStringValue} evaluated with unresolved path [${unresolvedPath}], resolved path [${resolvedPath}], and value: ${value}`,
        );
    },
    dependencies,
  );

export const expander = <T>(
  mapper: (a: any, path: TPath) => Optional<IMaybeSuspended<T>>,
) => {
  const initialExpander = recursiveMapper(() => mapper);
  return (baseConfig: any) => {
    let expanded = initialExpander(baseConfig);
    return advanceRepeatedly(expanded);
  };
};
