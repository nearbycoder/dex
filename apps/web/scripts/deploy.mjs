#!/usr/bin/env node
// Deploys with this deployment's settings from the gitignored .deploy.vars (see .deploy.vars.example), passed to
// Wrangler as variables, so wrangler.jsonc stays generic. Refuses to deploy without an allowlist: nobody could sign in.
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"

const vars = {}
if (existsSync(".deploy.vars")) {
  for (const line of readFileSync(".deploy.vars", "utf8").split("\n")) {
    const match = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line)
    if (match && !line.trimStart().startsWith("#")) vars[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2")
  }
}
if (!vars.ALLOWED_GITHUB_USERS) {
  console.error("Set ALLOWED_GITHUB_USERS in .deploy.vars first (copy .deploy.vars.example): without it, nobody can sign in.")
  process.exit(1)
}
const flags = Object.entries(vars)
  .filter(([, value]) => value !== "")
  .flatMap(([key, value]) => ["--var", `${key}:${value}`])
const result = spawnSync("npx", ["wrangler", "deploy", ...flags, ...process.argv.slice(2)], { stdio: "inherit" })
process.exit(result.status ?? 1)
