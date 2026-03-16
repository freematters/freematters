export function greet(name: string, options?: { uppercase?: boolean }): string {
  const message = `Hello, ${name}!`;
  return options?.uppercase ? message.toUpperCase() : message;
}
