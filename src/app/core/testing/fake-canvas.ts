export interface Call {
  name: string;
  args: unknown[];
}

export interface FakeContext {
  g: CanvasRenderingContext2D;
  calls: Call[];
  /** All strings passed to fillText / strokeText. */
  texts(): string[];
  count(name: string): number;
}

/** A recording stand-in for CanvasRenderingContext2D: every method is a no-op that remembers its arguments. */
export function fakeContext(): FakeContext {
  const calls: Call[] = [];
  const props: Record<string, unknown> = {};
  const target: Record<string, unknown> = {};
  const g = new Proxy(target, {
    get(_t, key: string) {
      if (key in props) return props[key];
      return (...args: unknown[]) => {
        calls.push({ name: key, args });
        return undefined;
      };
    },
    set(_t, key: string, value: unknown) {
      props[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return {
    g,
    calls,
    texts: () => calls.filter((c) => c.name === 'fillText' || c.name === 'strokeText').map((c) => String(c.args[0])),
    count: (name) => calls.filter((c) => c.name === name).length,
  };
}
