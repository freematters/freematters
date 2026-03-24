export function computeDiff(oldContent: string, newContent: string): string {
  if (oldContent === newContent) {
    return "";
  }

  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");

  // Remove trailing empty line from split if content ends with \n
  if (oldLines.length > 0 && oldLines[oldLines.length - 1] === "") oldLines.pop();
  if (newLines.length > 0 && newLines[newLines.length - 1] === "") newLines.pop();

  const m = oldLines.length;
  const n = newLines.length;

  // Two-row DP for LCS values (O(n) row space) + O(m×n) direction table for backtracking
  let prev = new Array<number>(n + 1).fill(0);
  let curr = new Array<number>(n + 1).fill(0);

  // Also store backtrack decisions in O(m×n) bit array (1 bit per cell)
  // direction[i][j]: true = diagonal/up, false = left
  // We need full backtrack info, so store directions compactly
  const directions: Uint8Array[] = [];
  for (let i = 0; i <= m; i++) {
    directions[i] = new Uint8Array(n + 1);
  }

  for (let i = 1; i <= m; i++) {
    curr[0] = 0;
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        curr[j] = prev[j - 1] + 1;
        directions[i][j] = 1; // diagonal match
      } else if (prev[j] >= curr[j - 1]) {
        curr[j] = prev[j];
        directions[i][j] = 2; // up
      } else {
        curr[j] = curr[j - 1];
        directions[i][j] = 3; // left
      }
    }
    [prev, curr] = [curr, prev];
    curr.fill(0);
  }

  // Backtrack to produce diff
  const stack: string[] = [];
  let i = m;
  let j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && directions[i][j] === 1) {
      i--;
      j--;
    } else if (j > 0 && (i === 0 || directions[i][j] === 3)) {
      stack.push(`+ ${newLines[j - 1]}`);
      j--;
    } else {
      stack.push(`- ${oldLines[i - 1]}`);
      i--;
    }
  }

  // Reverse since we backtracked
  const parts: string[] = [];
  for (let k = stack.length - 1; k >= 0; k--) {
    parts.push(stack[k]);
  }

  return parts.join("\n");
}
