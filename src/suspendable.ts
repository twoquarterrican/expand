export type IMaybeSuspended<T> = ISuspended<T> | T;

export interface ISuspended<T> {
  advance: (evaluationContext: any) => IMaybeSuspended<T>;
  identifier: string;
  dependencies: string[];
}

class Suspended<T> implements ISuspended<T> {
  constructor(
    public identifier: string,
    public advance: (evaluationContext: any) => IMaybeSuspended<T>,
    public dependencies: string[] = [],
  ) {}

  public toString() {
    return `Suspended(${this.identifier})`;
  }
}

export const suspend = <T>(
  identifier: string,
  advance: (evaluationContext: any) => IMaybeSuspended<T>,
  dependencies: string[] = [],
) => new Suspended(identifier, advance, dependencies);

export const isSuspended = <T>(o: any): o is ISuspended<T> =>
  o !== null &&
  o !== undefined &&
  typeof o.advance === 'function' &&
  typeof o.identifier === 'string' &&
  Array.isArray(o.dependencies);

export const complete = <T>(value: T): ISuspended<T> => {
  return new Suspended(`Completed(${value})`, () => value);
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
    const allDependencies = [];
    for (let maybeSuspendedElement of maybeSuspended) {
      if (isSuspended(maybeSuspendedElement)) {
        allDependencies.push(...maybeSuspendedElement.dependencies);
      }
    }
    return suspend(
      `Combined(${maybeSuspended.join(', ')})`,
      (...args) =>
        combine(
          maybeSuspended.map((maybeSuspended) =>
            isSuspended(maybeSuspended)
              ? maybeSuspended.advance(...args)
              : maybeSuspended,
          ),
          valueCombiner,
        ),
      allDependencies,
    );
  }
};
