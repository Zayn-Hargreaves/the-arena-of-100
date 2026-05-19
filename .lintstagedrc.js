const path = require("path");

module.exports = {
  "*.{js,ts,tsx}": (filenames) => {
    const groups = {};

    filenames.forEach((file) => {
      const relativePath = path.relative(process.cwd(), file);
      const parts = relativePath.split(path.sep);

      // Group files if they are in apps/ or packages/ directories
      if (
        (parts[0] === "apps" || parts[0] === "packages") &&
        parts.length > 2
      ) {
        const pkgDir = path.join(parts[0], parts[1]);
        if (!groups[pkgDir]) {
          groups[pkgDir] = [];
        }
        const fileInPkg = path.relative(pkgDir, file);
        groups[pkgDir].push(fileInPkg);
      } else {
        if (!groups["root"]) {
          groups["root"] = [];
        }
        groups["root"].push(relativePath);
      }
    });

    const commands = [];

    Object.entries(groups).forEach(([pkgDir, files]) => {
      if (pkgDir === "root") {
        // No root eslint config, just run prettier
        commands.push(
          `prettier --write ${files.map((f) => `"${f}"`).join(" ")}`,
        );
      } else {
        if (pkgDir === "apps/web") {
          // Next.js uses '--file' for linting specific files
          const fileArgs = files.map((f) => `--file "${f}"`).join(" ");
          commands.push(
            `pnpm --dir ${pkgDir} exec next lint --fix ${fileArgs}`,
          );
        } else {
          // Others use package-local eslint config
          commands.push(
            `pnpm --dir ${pkgDir} exec eslint --fix ${files.map((f) => `"${f}"`).join(" ")}`,
          );
        }
        // Type-check the affected package
        commands.push(`pnpm --dir ${pkgDir} exec tsc --noEmit`);
        // Also run prettier from the root on all workspace files to ensure consistent formatting
        const relativeFromRoot = files
          .map((f) => `"${path.join(pkgDir, f)}"`)
          .join(" ");
        commands.push(`prettier --write ${relativeFromRoot}`);
      }
    });

    return commands;
  },
  "*.{json,md,css}": ["prettier --write"],
};
