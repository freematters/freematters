#!/usr/bin/env node
import { Command } from "commander";
import { greet } from "./greet.js";

const program = new Command();

program
  .name("hello")
  .description("A minimal CLI tool that prints a greeting")
  .argument("<name>", "name to greet")
  .option("-u, --uppercase", "convert greeting to uppercase")
  .showHelpAfterError(true)
  .action((name: string, options: { uppercase?: boolean }) => {
    console.log(greet(name, { uppercase: options.uppercase }));
  });

program.exitOverride();
program.configureOutput({
  writeErr: (str: string) => process.stderr.write(str),
  writeOut: (str: string) => process.stdout.write(str),
});

try {
  program.parse(process.argv);
} catch {
  process.exit(1);
}
