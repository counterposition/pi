#!/usr/bin/env bash
# Builds a throwaway home for the README demo: a small project with a stand-in
# GitHub remote, and a Pi config with the permission system and auto mode on.
set -euo pipefail

home=${1:?usage: setup.sh <empty-dir>}
demo=$(cd "$(dirname "$0")" && pwd)
package=$(dirname "$demo")
modules=$package/node_modules

rm -rf "$home"
mkdir -p "$home/.pi/agent/extensions/pi-permission-system" "$home/acme-app/test" "$home/remote/acme"
home=$(cd "$home" && pwd -P)

cat >"$home/.pi/agent/settings.json" <<EOF
{
  "defaultProvider": "demo",
  "defaultModel": "scripted",
  "defaultProjectTrust": "always",
  "quietStartup": true,
  "tuiMode": "fullscreen",
  "extensions": ["$demo/model.ts", "$package", "$modules/@gotgenes/pi-permission-system"]
}
EOF

cat >"$home/.pi/agent/extensions/pi-permission-system/config.json" <<'EOF'
{
  "authorizerChain": ["auto-mode"],
  "permission": {
    "*": "ask",
    "read": "allow",
    "grep": "allow",
    "find": "allow",
    "ls": "allow",
    "write": "allow",
    "edit": "allow",
    "path": { "*": "allow" },
    "external_directory": "ask",
    "bash": { "*": "ask", "git status": "allow" }
  }
}
EOF

cd "$home/acme-app"
cat >package.json <<'EOF'
{
  "name": "acme-app",
  "version": "1.2.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test --test-reporter=spec",
    "build": "node build.js"
  }
}
EOF
cat >build.js <<'EOF'
import { mkdirSync, writeFileSync } from "node:fs";

mkdirSync("dist", { recursive: true });
writeFileSync("dist/app.js", "export {};\n");
console.log("built dist/app.js in 84ms");
EOF
for name in cart checkout pricing; do
  cat >"test/$name.test.js" <<EOF
import { test } from "node:test";

test("$name works", () => {});
EOF
done
printf 'node_modules/\ndist/\n' >.gitignore

git init -q -b main
git config user.name "Demo"
git config user.email "demo@example.com"
# Pushes to git@github.com:acme/app.git land in a local bare repo instead.
git init -q --bare "$home/remote/acme/app.git"
cat >"$home/remote/ssh" <<EOF
#!/bin/sh
eval "shift \$((\$# - 1))"
cd "$home/remote" && exec sh -c "\$1"
EOF
chmod +x "$home/remote/ssh"
git remote add origin git@github.com:acme/app.git
git config core.sshCommand "$home/remote/ssh"
git add -A
git commit -qm "Add checkout flow"
