import { MULTILINE_BLOCK_REGEX } from "./comment-parser.js";

export function stripHtmlComments(content: string): string {
  MULTILINE_BLOCK_REGEX.lastIndex = 0;
  const stripped = content.replace(MULTILINE_BLOCK_REGEX, "");
  return stripped.replace(/\n{3,}/g, "\n\n");
}
