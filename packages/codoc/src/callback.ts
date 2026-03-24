import childProcess from "node:child_process";

export class ScriptCallback {
  private script: string;

  constructor(script: string) {
    this.script = script;
  }

  execute(filePath: string, event: string, token: string, url: string): void {
    try {
      childProcess.exec(
        this.script,
        {
          env: {
            ...process.env,
            CODOC_FILE: filePath,
            CODOC_EVENT: event,
            CODOC_TOKEN: token,
            CODOC_URL: url,
          },
        },
        (err: childProcess.ExecException | null, stdout: string, stderr: string) => {
          if (err) {
            console.error(`[codoc] callback script error: ${err.message}`);
          }
          if (stdout) {
            console.log(`[codoc] callback: ${stdout.trim()}`);
          }
          if (stderr) {
            console.error(`[codoc] callback stderr: ${stderr.trim()}`);
          }
        },
      );
    } catch (err: unknown) {
      const e = err as Error;
      console.error(`[codoc] callback execution failed: ${e.message}`);
    }
  }
}
