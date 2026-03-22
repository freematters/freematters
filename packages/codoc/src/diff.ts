export function computeDiff(oldContent: string, newContent: string): string {
  if (oldContent === newContent) {
    return "";
  }

  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");

  // Remove trailing empty line from split if content ends with \n
  if (oldLines.length > 0 && oldLines[oldLines.length - 1] === "") oldLines.pop();
  if (newLines.length > 0 && newLines[newLines.length - 1] === "") newLines.pop();

  // Myers-like simple LCS diff using O(ND) edit graph approach
  // For simplicity, use a standard DP LCS to find common subsequence
  const m = oldLines.length;
  const n = newLines.length;

  // Build LCS table
  const dp: number[][] = [];
  for (let i = 0; i <= m; i++) {
    dp[i] = new Array<number>(n + 1).fill(0);
  }
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to produce diff
  const parts: string[] = [];
  let i = m;
  let j = n;
  const stack: string[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      stack.push(`+ ${newLines[j - 1]}`);
      j--;
    } else {
      stack.push(`- ${oldLines[i - 1]}`);
      i--;
    }
  }

  // Reverse since we backtracked
  for (let k = stack.length - 1; k >= 0; k--) {
    parts.push(stack[k]);
  }

  return parts.join("\n");
}
