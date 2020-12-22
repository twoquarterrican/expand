import util from 'util';
import {
  recursiveValueCopier,
  IContext,
  IVisitResult,
  TVisitor,
} from './visitors';
import { combine, complete, IMaybeSuspended, isSuspended } from './suspendable';

const debuglog = util.debuglog('expand');
const error = console.error;

export const regexStringVisitor = <T extends any>(
  regex: RegExp,
  onMatchAsyncFn: (
    context: IContext,
    match: RegExpExecArray,
  ) => Promise<IMaybeSuspended<T>>,
) => async (
  context: IContext,
  s: string,
): Promise<IVisitResult<IMaybeSuspended<string | T>>> => {
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
    pieces.push(await onMatchAsyncFn(context, match));
    previousLastIndex = regex.lastIndex;
  }
  if (pieces.length === 0) {
    return { isPresent: false };
  }
  if (pieces.length === 1) {
    // only one piece: string in config may be replaced with obj or other type
    return { isPresent: true, value: pieces[0] };
  } else {
    // multiple pieces: string in config must be replaced
    // with string after all suspendable functions are done
    return {
      isPresent: true,
      value: combine(pieces, (values) => values.join('')),
    };
  }
};

const advance = async (config: any) => {
  await recursiveValueCopier(async (_context: IContext, value: any) => {
    if (!isSuspended(value)) {
      return { isPresent: false };
    } else {
      const advanced = await value.advance(config);
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
};

const anySuspended = async (config: any) => {
  let anySuspended = false;
  await recursiveValueCopier(async (_context: IContext, value: any) => {
    if (isSuspended(value)) {
      anySuspended = true;
      return { isPresent: true, value: value };
    } else {
      return { isPresent: false };
    }
  })(config);
  return anySuspended;
};

const advanceRepeatedly = async (start: any): Promise<any> => {
  let next = start;
  for (let i = 0; i < 100; i++) {
    if (await anySuspended(next)) {
      next = await advance(next);
    } else {
      return next;
    }
  }
  error('[ERROR] expanded:', util.inspect(next, false, null, true));
  throw new Error(
    `After 100 iterations, there are still suspended functions in the config`,
  );
};

export const expander = async <T>(visitors: TVisitor<IVisitResult<T>>) => {
  const initialExpander = recursiveValueCopier(visitors);
  return async (baseConfig: any) => {
    let expanded = await initialExpander(baseConfig);
    return await advanceRepeatedly(expanded);
  };
};
