#!/usr/bin/env node

// MCP wrapper that finds and spawns claude-hive mcp.
// Handles PATH resolution and common install locations.

import { spawn, execSync } from "child_process";
import { platform } from "os";
import { existsSync } from "fs";
import { join } from "path";

function findExecutable() {
  const isWin = platform() === "win32";
  const exeName = isWin ? "claude-hive.exe" : "claude-hive";

  try {
    const cmd = isWin ? `where ${exeName}` : `which ${exeName}`;
    const output = execSync(cmd, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .trim()
      .split(/\r?\n/)[0];
    if (output && existsSync(output)) {
      return output;
    }
  } catch {}

  if (isWin) {
    const candidates = [
      "C:\\Program Files\\Claude Hive\\claude-hive.exe",
      "C:\\Program Files (x86)\\Claude Hive\\claude-hive.exe",
      join(process.env.LOCALAPPDATA || "", "Programs", "Claude Hive", "claude-hive.exe"),
      join(process.env.USERPROFILE || "", ".local", "bin", "claude-hive.exe"),
    ];
    for (const p of candidates) {
      if (existsSync(p)) return p;
    }
  }

  return null;
}

const exePath = findExecutable();

if (!exePath) {
  console.error(
    "[mcp-wrapper] Could not locate claude-hive executable. " +
    "Install the Claude Hive desktop app from https://github.com/Taity180/claude-hive/releases"
  );
  process.exit(1);
}

const child = spawn(exePath, ["mcp"], {
  stdio: ["pipe", "pipe", "inherit"],
});

process.stdin.pipe(child.stdin);
child.stdout.pipe(process.stdout);

child.on("exit", (code) => process.exit(code ?? 0));
child.on("error", (err) => {
  console.error("[mcp-wrapper] Failed to spawn claude-hive:", err.message);
  process.exit(1);
});
process.on("SIGTERM", () => child.kill());
process.on("SIGINT", () => child.kill());
