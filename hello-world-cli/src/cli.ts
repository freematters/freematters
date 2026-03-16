#!/usr/bin/env node
import { Command } from "commander";

const program = new Command();

program
  .name("hello")
  .description("A minimal CLI tool that prints a greeting")
  .argument("<name>", "name to greet")
  .showHelpAfterError(true)
  .action((name: string) => {
    console.log(`Hello, ${name}!`);
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
