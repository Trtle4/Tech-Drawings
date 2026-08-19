/**
 * A tiny arithmetic evaluator over named parameters.
 *
 * Style definitions are data, so their dimensions have to be data too. A panel
 * width is written `"W"`, a meeting flap `"W/2"`, a slot `"caliper"`, a tuck
 * `"H - caliper*2"`. No `eval`, no functions from the definition — just
 * arithmetic over the parameters the style declares.
 *
 * Supported: + - * / %, parentheses, unary minus, and min/max/abs/round/
 * floor/ceil/sqrt.
 */

export type Expr = number | string;

export type Scope = Readonly<Record<string, number>>;

const FUNCTIONS: Record<string, (...args: number[]) => number> = {
  min: Math.min,
  max: Math.max,
  abs: (a) => Math.abs(a),
  round: (a) => Math.round(a),
  floor: (a) => Math.floor(a),
  ceil: (a) => Math.ceil(a),
  sqrt: (a) => Math.sqrt(a),
  // Trig, in radians. Needed by any style that places geometry on a slope or
  // an arc rather than on a grid.
  sin: (a) => Math.sin(a),
  cos: (a) => Math.cos(a),
  tan: (a) => Math.tan(a),
  atan2: (a, b) => Math.atan2(a, b!),
  hypot: (...a) => Math.hypot(...a),
  rad: (a) => (a * Math.PI) / 180,
  deg: (a) => (a * 180) / Math.PI,
};

/** Constants available to every expression, under any scope. */
const CONSTANTS: Record<string, number> = { PI: Math.PI, E: Math.E };

export class ExprError extends Error {
  constructor(
    message: string,
    readonly source: string,
  ) {
    super(`${message} — in "${source}"`);
    this.name = 'ExprError';
  }
}

type Token = { kind: 'num'; value: number } | { kind: 'ident'; value: string } | { kind: 'op'; value: string };

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j]!)) j++;
      const raw = src.slice(i, j);
      const value = Number(raw);
      if (!Number.isFinite(value)) throw new ExprError(`Bad number "${raw}"`, src);
      out.push({ kind: 'num', value });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j]!)) j++;
      out.push({ kind: 'ident', value: src.slice(i, j) });
      i = j;
      continue;
    }
    if ('+-*/%(),'.includes(c)) {
      out.push({ kind: 'op', value: c });
      i++;
      continue;
    }
    throw new ExprError(`Unexpected character "${c}"`, src);
  }
  return out;
}

/**
 * Evaluate an expression against a scope. Numbers pass through untouched, so a
 * definition can mix `240` and `"W + caliper"` freely.
 */
export function evalExpr(expr: Expr, scope: Scope): number {
  if (typeof expr === 'number') {
    if (!Number.isFinite(expr)) throw new ExprError('Not a finite number', String(expr));
    return expr;
  }
  const tokens = tokenize(expr);
  let pos = 0;

  const peek = (): Token | undefined => tokens[pos];
  const eat = (value: string): boolean => {
    const t = peek();
    if (t && t.kind === 'op' && t.value === value) {
      pos++;
      return true;
    }
    return false;
  };

  function parseExpr(): number {
    let left = parseTerm();
    for (;;) {
      if (eat('+')) left += parseTerm();
      else if (eat('-')) left -= parseTerm();
      else return left;
    }
  }

  function parseTerm(): number {
    let left = parseUnary();
    for (;;) {
      if (eat('*')) left *= parseUnary();
      else if (eat('/')) {
        const d = parseUnary();
        if (Math.abs(d) < 1e-12) throw new ExprError('Division by zero', expr as string);
        left /= d;
      } else if (eat('%')) {
        const d = parseUnary();
        if (Math.abs(d) < 1e-12) throw new ExprError('Modulo by zero', expr as string);
        left %= d;
      } else return left;
    }
  }

  function parseUnary(): number {
    if (eat('-')) return -parseUnary();
    if (eat('+')) return parseUnary();
    return parsePrimary();
  }

  function parsePrimary(): number {
    const t = peek();
    if (!t) throw new ExprError('Unexpected end of expression', expr as string);
    if (t.kind === 'num') {
      pos++;
      return t.value;
    }
    if (t.kind === 'ident') {
      pos++;
      const fn = FUNCTIONS[t.value];
      if (eat('(')) {
        if (!fn) throw new ExprError(`Unknown function "${t.value}"`, expr as string);
        const args: number[] = [];
        if (!eat(')')) {
          do {
            args.push(parseExpr());
          } while (eat(','));
          if (!eat(')')) throw new ExprError('Expected ")"', expr as string);
        }
        return fn(...args);
      }
      if (t.value in CONSTANTS) return CONSTANTS[t.value]!;
      if (!(t.value in scope)) {
        const known = Object.keys(scope).sort().join(', ');
        throw new ExprError(`Unknown parameter "${t.value}" (known: ${known})`, expr as string);
      }
      return scope[t.value]!;
    }
    if (eat('(')) {
      const v = parseExpr();
      if (!eat(')')) throw new ExprError('Expected ")"', expr as string);
      return v;
    }
    throw new ExprError(`Unexpected token "${t.value}"`, expr as string);
  }

  const result = parseExpr();
  if (pos !== tokens.length) {
    throw new ExprError(`Unexpected trailing input at token ${pos}`, expr);
  }
  if (!Number.isFinite(result)) throw new ExprError('Evaluated to a non-finite value', expr);
  return result;
}

/** Every parameter name an expression reads. Used to validate a definition. */
export function dependencies(expr: Expr): string[] {
  if (typeof expr === 'number') return [];
  const out = new Set<string>();
  const tokens = tokenize(expr);
  tokens.forEach((t, i) => {
    if (t.kind !== 'ident') return;
    const next = tokens[i + 1];
    const isCall = next && next.kind === 'op' && next.value === '(';
    if (!isCall && !(t.value in CONSTANTS)) out.add(t.value);
  });
  return [...out];
}
