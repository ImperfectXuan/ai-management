export interface DemoWorkspace {
  base: string;
  repo: string;
  home: string;
  profile: string;
  sourceA: string;
  sourceB: string;
}
export const projectRoot: string;
export function prepareDemo(): Promise<DemoWorkspace>;
