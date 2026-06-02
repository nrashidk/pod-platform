// Throwaway Node resolver hook (test-only): lets `node` run the app's .ts
// files, which use extensionless relative imports (the Next/bundler
// convention). Appends ".ts" when an extensionless relative specifier maps
// to a .ts file on disk. Not used by the app or build — only by smoke tests.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export async function resolve(specifier, context, next) {
  if (specifier.startsWith(".") && context.parentURL && !path.extname(specifier)) {
    const parentPath = fileURLToPath(context.parentURL);
    const resolved = path.resolve(path.dirname(parentPath), specifier);
    if (existsSync(resolved + ".ts")) {
      return next(specifier + ".ts", context);
    }
  }
  return next(specifier, context);
}
