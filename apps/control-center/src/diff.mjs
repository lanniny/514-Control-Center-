function fallbackDiff(before, after) {
  return [
    ...before.map((text, index) => ({ type: "remove", oldLine: index + 1, newLine: null, text })),
    ...after.map((text, index) => ({ type: "add", oldLine: null, newLine: index + 1, text })),
  ];
}

export function diffLines(beforeText, afterText, maxCells = 2_000_000) {
  const before = beforeText.split(/\r?\n/);
  const after = afterText.split(/\r?\n/);
  let lines;

  if (before.length * after.length > maxCells) {
    lines = fallbackDiff(before, after);
  } else {
    const width = after.length + 1;
    const matrix = new Uint32Array((before.length + 1) * width);
    for (let i = before.length - 1; i >= 0; i -= 1) {
      for (let j = after.length - 1; j >= 0; j -= 1) {
        matrix[i * width + j] =
          before[i] === after[j]
            ? matrix[(i + 1) * width + j + 1] + 1
            : Math.max(matrix[(i + 1) * width + j], matrix[i * width + j + 1]);
      }
    }
    lines = [];
    let i = 0;
    let j = 0;
    while (i < before.length || j < after.length) {
      if (i < before.length && j < after.length && before[i] === after[j]) {
        lines.push({ type: "context", oldLine: i + 1, newLine: j + 1, text: before[i] });
        i += 1;
        j += 1;
      } else if (j < after.length && (i >= before.length || matrix[i * width + j + 1] >= matrix[(i + 1) * width + j])) {
        lines.push({ type: "add", oldLine: null, newLine: j + 1, text: after[j] });
        j += 1;
      } else {
        lines.push({ type: "remove", oldLine: i + 1, newLine: null, text: before[i] });
        i += 1;
      }
    }
  }

  const summary = lines.reduce(
    (acc, line) => {
      if (line.type === "add") acc.added += 1;
      if (line.type === "remove") acc.removed += 1;
      return acc;
    },
    { added: 0, removed: 0, changed: beforeText !== afterText },
  );
  return { summary, lines };
}
