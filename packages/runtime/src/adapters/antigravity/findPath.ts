import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, join } from "node:path";
import { assertSafeWindowsShellExecutablePath } from "../../shellSafety.js";

const IS_WINDOWS = process.platform === "win32";

/**
 * Find the Google Antigravity CLI executable path from common install locations.
 */
export function findAntigravityPath(): string | undefined {
  if (process.env.ANTIGRAVITY_BIN_PATH && existsSync(process.env.ANTIGRAVITY_BIN_PATH)) {
    return process.env.ANTIGRAVITY_BIN_PATH;
  }

  const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? "";
  const localAppData = process.env.LOCALAPPDATA ?? "";

  const candidates = IS_WINDOWS
    ? [
        resolve(localAppData, "agy/bin/agy.exe"),
        resolve(homeDir, "AppData/Local/agy/bin/agy.exe"),
        resolve(process.env.APPDATA ?? "", "npm/agy.exe"),
        resolve(process.env.APPDATA ?? "", "npm/agy.cmd"),
        resolve(homeDir, "scoop/shims/agy.exe"),
        resolve(homeDir, ".local/bin/agy.exe"),
      ]
    : [
        "/usr/local/bin/agy",
        resolve(homeDir, ".local/bin/agy"),
        "/opt/homebrew/bin/agy",
        resolve(homeDir, "bin/agy"),
        "/usr/bin/agy",
      ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  // Fallback: check PATH
  const locator = IS_WINDOWS ? "where" : "which";
  try {
    const result = execFileSync(locator, ["agy"], {
      encoding: "utf8",
      timeout: 3_000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/^"(.*)"$/, "$1"))
      .find((line) => line.length > 0 && existsSync(line));

    if (result) return result;
  } catch {
    // locator command not found or agy not in PATH
  }

  return undefined;
}

/**
 * Probe whether the Antigravity CLI is reachable and return its version.
 */
export function probeAntigravityCli(cliPath: string): {
  ok: boolean;
  version?: string;
  error?: string;
} {
  try {
    if (IS_WINDOWS) {
      assertSafeWindowsShellExecutablePath(cliPath, "Antigravity CLI path");
    }
    const out = execFileSync(cliPath, ["--version"], {
      timeout: 5_000,
      shell: IS_WINDOWS,
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, version: out.trim() };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
