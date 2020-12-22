export type IMaybeSuspended<T> = ISuspended<T> | T;

export interface ISuspended<T> {
  advance: (evaluationContext: any) => Promise<IMaybeSuspended<T>>;
}

export class Suspended<T> implements ISuspended<T> {
  advance: (evaluationContext: any) => Promise<IMaybeSuspended<T>>;
  toStringValue: string;

  constructor(
    advance: (evaluationContext: any) => Promise<IMaybeSuspended<T>>,
    toStringValue: string,
  ) {
    this.advance = advance;
    this.toStringValue = toStringValue;
  }

  public toString() {
    return `Suspended(${this.toStringValue})`;
  }
}

export const isSuspended = <T>(o: any): o is ISuspended<T> =>
  o !== null && o !== undefined && typeof o.advance === 'function';

export const complete = <T>(value: T): ISuspended<T> => {
  return new Suspended(() => Promise.resolve(value), `Completed(${value})`);
};

const simplifyArr = <T>(maybeSuspendeds: IMaybeSuspended<T>[]): T[] | null => {
  const values: T[] = [];
  for (let maybeSuspended of maybeSuspendeds) {
    if (isSuspended(maybeSuspended)) {
      return null;
    } else {
      values.push(maybeSuspended);
    }
  }
  return values;
};

export const combine = <T, S>(
  maybeSuspended: IMaybeSuspended<T>[],
  valueCombiner: (ts: T[]) => S,
): IMaybeSuspended<S> => {
  const values = simplifyArr(maybeSuspended);
  if (values !== null) {
    return valueCombiner(values);
  } else {
    return new Suspended(
      async (...args) =>
        combine(
          await Promise.all(
            maybeSuspended.map(async (maybeSuspended) =>
              isSuspended(maybeSuspended)
                ? await maybeSuspended.advance(...args)
                : maybeSuspended,
            ),
          ),
          valueCombiner,
        ),
      `Combined(${maybeSuspended.join(', ')})`,
    );
  }
};
