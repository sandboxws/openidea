/** Paths of a Mojo application: its source and the binary it's built into. */

/** `foo.mojo` → `foo` (also `.🔥`). */
export function stem(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return name.replace(/\.(mojo|🔥)$/u, "");
}

/** The default binary: `.openidea/mojo/bin/<stem>` under the working directory. */
export const defaultOutput = (source: string) => `.openidea/mojo/bin/${stem(source)}`;

export function isAbsolute(path: string): boolean {
  return /^([\\/]|[A-Za-z]:)/.test(path);
}

/** `path` against `dir` (both `/`-separated), unless it's absolute. */
export function resolve(dir: string, path: string): string {
  if (isAbsolute(path)) return path;
  const parts = `${dir}/${path}`.split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "..") out.pop();
    else if (p !== "." && (p || !out.length)) out.push(p);
  }
  return out.join("/");
}

/** `path` relative to `root` when inside it. */
export function relative(path: string, root: string): string {
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
}
