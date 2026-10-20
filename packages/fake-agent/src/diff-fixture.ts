// A small, deterministic edit fixture shared by scenarios: keeps the first 7
// lines, drops the last 3, and appends 12 new lines, so a line-based diff
// reports exactly +12 -3 (the figure used as the worked example in both
// tui-transcript's "Completed edit" scenario and design D12).
function numberedLines(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix} ${index + 1}`);
}

export function editFixture(): { oldText: string; newText: string } {
  const oldLines = numberedLines("line", 10);
  const keptLines = oldLines.slice(0, 7);
  const addedLines = numberedLines("new line", 12);
  return {
    oldText: `${oldLines.join("\n")}\n`,
    newText: `${[...keptLines, ...addedLines].join("\n")}\n`,
  };
}
