import {
  basicRecordLookupFnFactory,
  combineMaybeSuspenders,
  DOLLAR_SIGN_BRACKET_REFERENCE,
  expander,
} from './expand';
import * as util from 'util';
import { empty, present, TPath } from 'recursive-reducer';
import { suspend } from './suspendable';

const dollarSignBracketExpander = expander(
  DOLLAR_SIGN_BRACKET_REFERENCE(basicRecordLookupFnFactory),
);

test('chains of dependencies in dollar sign bracket references', async () => {
  expect(
    await dollarSignBracketExpander({
      key1: '1',
      key2: '${key1}',
      key3: '---${key1}${key2}',
      key4: [
        'here is key4[1][key5]: ${key4.1.key5}',
        {
          key5: 'here is key3: ${key3}',
          key6: 'here is key4[0]: ${key4.0}',
        },
      ],
      key7: '${key8.0}',
      key8: '${key9}',
      key9: ['value9'],
    }),
  ).toStrictEqual({
    key1: '1',
    key2: '1',
    key3: '---11',
    key4: [
      'here is key4[1][key5]: here is key3: ---11',
      {
        key5: 'here is key3: ---11',
        key6: 'here is key4[0]: here is key4[1][key5]: here is key3: ---11',
      },
    ],
    key7: 'value9',
    key8: ['value9'],
    key9: ['value9'],
  });
});

test('circular dependency', () => {
  try {
    dollarSignBracketExpander({
      key1: '${key2}',
      key2: '${key1}',
    });
    fail('Expected circular dependency error');
  } catch (e) {
    expect(e.toString()).toStrictEqual(
      'Error: Circular dependency: ${key2} --> ${key1} --> ${key2}',
    );
  }
});

test('invalid expression', () => {
  try {
    const got = dollarSignBracketExpander({
      key1: '${key2.a.b}',
      key2: 'blue',
    });
    fail(
      'Expected expression error, got ' + util.inspect(got, false, null, true),
    );
  } catch (e) {
    expect(e.toString()).toStrictEqual(
      'Error: Expression ${key2.a.b} evaluated with unresolved path [b], resolved path [key2,a], and value: undefined',
    );
  }
});

test('combine maybe suspenders', () => {
  const mapper1 = (a: unknown) =>
    typeof a === 'number' ? present(a * 10) : empty();
  const mapper2 = (a: unknown) =>
    typeof a === 'string' ? present(-1) : empty();
  const mapper3 = (_a: unknown, path: TPath) =>
    path.length > 1 ? present(path[0]) : empty();
  const combined = combineMaybeSuspenders(mapper1, mapper2, mapper3);
  expect(combined(3, []).value).toBe(30);
  expect(combined('3', []).value).toBe(-1);
  expect(combined([3], []).isPresent).toBe(false);
  expect(combined([3], ['-', '']).value).toBe('-');
});

test('async suspended', async () => {
  const asyncExpander = expander((a: any, path: TPath) =>
    typeof a === 'number'
      ? present(
          suspend(
            path.join(','),
            () =>
              new Promise((resolve) => {
                setTimeout(() => resolve(a * 10), 100);
              }),
          ),
        )
      : empty(),
  );
  expect(
    await Promise.all(asyncExpander([1, 'a', 2, 'b']) as Promise<any>[]),
  ).toStrictEqual([10, 'a', 20, 'b']);
});
