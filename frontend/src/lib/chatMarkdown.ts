/**
 * Prepare assistant markdown for remark-math / KaTeX.
 *
 * Diligence copy is full of currency (`$1,100/kW`, `$0.054/kWh`). remark-math
 * treats single `$...$` as inline math, which mangled those amounts into broken
 * KaTeX + leaked asterisks. Escape currency-like dollars; leave real math alone.
 */
export function preprocessMath(content: string): string {
  let result = escapeCurrencyDollars(content)
    .replace(/\\\[([\s\S]*?)\\\]/g, (_: string, math: string) => `$$${math}$$`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_: string, math: string) => `$${math}$`);

  const segments = result.split(/(\$\$[\s\S]*?\$\$|\$[^$\n]*?\$)/);
  return segments
    .map((seg, i) => {
      if (i % 2 === 1) return seg; // inside delimiters — leave KaTeX alone
      return seg
        .replace(/\\text\{([^}]*)\}/g, '$1')
        .replace(/\\mathrm\{([^}]*)\}/g, '$1')
        .replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, '$1/$2')
        .replace(/\\times/g, '×')
        .replace(/\\cdot/g, '·')
        .replace(/\\,/g, '\u202f')
        .replace(/\\!/g, '')
        .replace(/\\quad/g, '  ')
        .replace(/\\:/g, ' ');
    })
    .join('');
}

/** Escape `$` that start a currency amount; preserve `$$` display math and `\$`. */
export function escapeCurrencyDollars(content: string): string {
  const parts = content.split(/(\$\$[\s\S]*?\$\$)/);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part;
      // $1,100 / $0.054 / ~$0.058 — digit immediately after $
      return part.replace(/(?<!\\)\$(?=\d)/g, '\\$');
    })
    .join('');
}
