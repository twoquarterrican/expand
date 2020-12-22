export interface IContext {
  path: (string | number)[];
}
export interface IVisitResult<T> {
  isPresent: boolean;
  value?: T;
}
export type TVisitor<T> = (context: IContext, value: any) => Promise<T>;
type TVisitorRef<T> = { visit?: TVisitor<T> };

const visitObj = <T>(ref: TVisitorRef<T>): TVisitor<object> => {
  return async (context: IContext, obj: any) => {
    const copy: typeof obj = {};
    for (let key of Object.keys(obj)) {
      copy[key] = await ref.visit!(
        { ...context, path: [...context.path, key] },
        obj[key],
      );
    }
    return copy;
  };
};

const visitArr = <T>(ref: TVisitorRef<T>): TVisitor<T[]> => {
  return async (context: IContext, arr: any[]) => {
    const copy = [];
    for (let i = 0; i < arr.length; i++) {
      copy.push(
        await ref.visit!({ ...context, path: [...context.path, i] }, arr[i]),
      );
    }
    return copy;
  };
};

export const recursiveValueCopier = <T>(
  ...visitors: TVisitor<IVisitResult<T>>[]
): ((o: any) => Promise<any>) => {
  const ref: TVisitorRef<T> = {};
  const objVisitor = visitObj(ref);
  const arrVisitor = visitArr(ref);
  const visitAny = async (context: IContext, input: any): Promise<any> => {
    for (let visitor of visitors) {
      const { isPresent, value } = await visitor(context, input);
      if (isPresent) {
        return value;
      }
    }
    if (input === undefined || input === null) {
      return input;
    } else if (Array.isArray(input)) {
      return await arrVisitor(context, input);
    } else if (typeof input === 'object') {
      return await objVisitor(context, input);
    } else {
      return input;
    }
  };
  ref.visit = visitAny;
  return async (input: any): Promise<any> => {
    return await visitAny({ path: [] }, input);
  };
};
