// The little of Node the tool scripts use (the project has no @types/node), so `tsc` can check them.
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function writeFileSync(path: string, data: string): void;
  export function existsSync(path: string): boolean;
  export function readdirSync(path: string): string[];
  export function statSync(path: string): { isDirectory(): boolean };
}
declare const process: { cwd(): string; exit(code: number): never };
