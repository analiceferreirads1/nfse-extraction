import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const input = JSON.parse(readFileSync(0, "utf8"));

if (input.stop_hook_active) process.exit(0);

const options = { cwd: process.env.CLAUDE_PROJECT_DIR, stdio: "pipe" };

try {
  execSync("npm test --silent", options);
  execSync("npm run typecheck --silent", options);
} catch (error) {
  const output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
  process.stderr.write(
    `Testes ou typecheck falharam. Corrija antes de encerrar.\n${output.slice(-3000)}`,
  );
  process.exit(2);
}