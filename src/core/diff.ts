/**
 * Minimal unified diff for form-level changes.
 */

/**
 * Compute a unified diff between two text strings.
 * Returns a formatted diff string with -/+ prefixes.
 */
export function unifiedDiff(oldText: string, newText: string, label?: string): string {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const diff = myersDiff(oldLines, newLines);

  if (diff.every((d) => d.type === "equal")) {
    return "(no changes)";
  }

  const lines: string[] = [];
  if (label) lines.push(`--- ${label}`);

  for (const entry of diff) {
    for (const line of entry.lines) {
      switch (entry.type) {
        case "equal":
          lines.push(` ${line}`);
          break;
        case "delete":
          lines.push(`-${line}`);
          break;
        case "insert":
          lines.push(`+${line}`);
          break;
      }
    }
  }

  return lines.join("\n");
}

/**
 * Show all lines as added (for insert operations).
 */
export function showAdded(text: string): string {
  return text.split("\n").map((l) => `+${l}`).join("\n");
}

/**
 * Show all lines as removed (for delete operations).
 */
export function showRemoved(text: string): string {
  return text.split("\n").map((l) => `-${l}`).join("\n");
}

// --- Myers diff algorithm (line-level) ---

interface DiffEntry {
  type: "equal" | "delete" | "insert";
  lines: string[];
}

function myersDiff(oldLines: string[], newLines: string[]): DiffEntry[] {
  const n = oldLines.length;
  const m = newLines.length;
  const max = n + m;

  if (max === 0) return [];

  // Trace stores the V array at each step
  const trace: Map<number, number>[] = [];

  // Forward pass: find shortest edit script
  let vMap = new Map<number, number>();
  vMap.set(1, 0);

  outer:
  for (let d = 0; d <= max; d++) {
    const newV = new Map<number, number>();
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && (vMap.get(k - 1) ?? 0) < (vMap.get(k + 1) ?? 0))) {
        x = vMap.get(k + 1) ?? 0; // move down (insert)
      } else {
        x = (vMap.get(k - 1) ?? 0) + 1; // move right (delete)
      }
      let y = x - k;

      // Follow diagonal (equal lines)
      while (x < n && y < m && oldLines[x] === newLines[y]) {
        x++;
        y++;
      }

      newV.set(k, x);

      if (x >= n && y >= m) {
        trace.push(newV);
        break outer;
      }
    }
    trace.push(newV);
    vMap = newV;
  }

  // Backtrack to recover the edit script
  const edits: Array<{ type: "equal" | "delete" | "insert"; line: string }> = [];

  let x = n;
  let y = m;

  for (let d = trace.length - 1; d >= 0; d--) {
    const v = trace[d];
    const k = x - y;
    const prevV = d > 0 ? trace[d - 1] : new Map<number, number>([[0, 0]]);

    let prevK: number;
    if (k === -d || (k !== d && (prevV.get(k - 1) ?? 0) < (prevV.get(k + 1) ?? 0))) {
      prevK = k + 1; // came from insert
    } else {
      prevK = k - 1; // came from delete
    }

    let prevX = prevV.get(prevK) ?? 0;
    let prevY = prevX - prevK;

    // Diagonal (equal)
    while (x > prevX && y > prevY) {
      x--;
      y--;
      edits.push({ type: "equal", line: oldLines[x] });
    }

    if (d > 0) {
      if (x === prevX) {
        // Insert
        y--;
        edits.push({ type: "insert", line: newLines[y] });
      } else {
        // Delete
        x--;
        edits.push({ type: "delete", line: oldLines[x] });
      }
    }
  }

  edits.reverse();

  // Collapse consecutive same-type entries
  const result: DiffEntry[] = [];
  for (const edit of edits) {
    const last = result[result.length - 1];
    if (last && last.type === edit.type) {
      last.lines.push(edit.line);
    } else {
      result.push({ type: edit.type, lines: [edit.line] });
    }
  }

  return result;
}
