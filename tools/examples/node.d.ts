// The little of Node the example script uses (the project has no @types/node), so `tsc` can check the script.
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function writeFileSync(path: string, data: string): void;
  export function existsSync(path: string): boolean;
}
declare const process: { cwd(): string };
