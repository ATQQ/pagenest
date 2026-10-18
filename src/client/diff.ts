import { diffLines } from "diff";

export interface DiffRow {
  type: "same" | "remove" | "add" | "mixed";
  oldLine: string;
  newLine: string;
  oldNumber: number | null;
  newNumber: number | null;
}

function splitLines(value: string): string[] {
  const lines = value.replace(/\n$/, "").split("\n");
  return lines.length === 1 && lines[0] === "" ? [] : lines;
}

export function buildDiffRows(oldText: string, newText: string): DiffRow[] {
  const changes = diffLines(oldText, newText);
  const rows: DiffRow[] = [];
  let removed: string[] = [];
  let added: string[] = [];
  let oldNumber = 1;
  let newNumber = 1;

  function flush() {
    const count = Math.max(removed.length, added.length);
    for (let index = 0; index < count; index += 1) {
      const hasOld = index < removed.length;
      const hasNew = index < added.length;
      rows.push({
        type: hasOld && hasNew ? "mixed" : hasOld ? "remove" : "add",
        oldLine: removed[index] ?? "",
        newLine: added[index] ?? "",
        oldNumber: hasOld ? oldNumber++ : null,
        newNumber: hasNew ? newNumber++ : null,
      });
    }
    removed = [];
    added = [];
  }

  for (const change of changes) {
    const lines = splitLines(change.value);
    if (change.removed) {
      removed.push(...lines);
      continue;
    }
    if (change.added) {
      added.push(...lines);
      continue;
    }
    flush();
    for (const line of lines) {
      rows.push({
        type: "same",
        oldLine: line,
        newLine: line,
        oldNumber: oldNumber++,
        newNumber: newNumber++,
      });
    }
  }
  flush();
  return rows;
}
