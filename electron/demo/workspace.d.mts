export interface DemoWorkspace {
  base: string;
  repo: string;
  target: string;
  home: string;
  profile: string;
  sourceA: string;
  sourceB: string;
}
export const projectRoot: string;
export function prepareDemo(): Promise<DemoWorkspace>;
