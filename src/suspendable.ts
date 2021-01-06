export class Suspended<T> {
  constructor(
    public identifier: string,
    public advance: (evaluationContext: unknown) => IMaybeSuspended<T>,
    public dependencies: string[] = [],
  ) {}

  public toString(): string {
    return `Suspended(${this.identifier})`;
  }
}

export type IMaybeSuspended<T> = Suspended<T> | T;

export const suspend = <T>(
  identifier: string,
  advance: (evaluationContext: unknown) => IMaybeSuspended<T>,
  dependencies: string[] = [],
): Suspended<T> => new Suspended(identifier, advance, dependencies);

export const isSuspended = <T>(o: unknown): o is Suspended<T> =>
  o instanceof Suspended;

export const complete = <T>(value: T): Suspended<T> => {
  return new Suspended(`Completed(${value})`, () => value);
};

const simplifyArr = <T>(maybeSuspendeds: IMaybeSuspended<T>[]): T[] | null => {
  const values: T[] = [];
  for (const maybeSuspended of maybeSuspendeds) {
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
    for (const maybeSuspendedElement of maybeSuspended) {
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
