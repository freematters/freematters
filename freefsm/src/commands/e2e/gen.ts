import { handleError } from "../../output.js";

export interface GenArgs {
  source: string;
  output?: string;
  json: boolean;
}

export function gen(_args: GenArgs): void {
  try {
    // Stub — will be implemented in Step 5
    process.stderr.write("e2e gen is not yet implemented\n");
    process.exit(2);
  } catch (err: unknown) {
    handleError(err, _args.json);
  }
}
