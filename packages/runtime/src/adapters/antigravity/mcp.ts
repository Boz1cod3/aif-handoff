import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import type { RuntimeMcpInput, RuntimeMcpInstallInput, RuntimeMcpStatus } from "../../types.js";

export function getAntigravityGlobalMcpConfigPath(): string {
  return join(homedir(), ".gemini", "config", "mcp_config.json");
}

export interface AntigravityMcpServerConfig {
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  serverUrl?: string;
  [key: string]: unknown;
}

export interface AntigravityMcpConfig {
  mcpServers?: Record<string, AntigravityMcpServerConfig>;
  [key: string]: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readMcpConfig(configPath?: string): Promise<AntigravityMcpConfig> {
  const targetPath = configPath ?? getAntigravityGlobalMcpConfigPath();
  try {
    const raw = await readFile(targetPath, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (isRecord(parsed)) {
      return parsed as AntigravityMcpConfig;
    }
    return {};
  } catch {
    return {};
  }
}

async function writeMcpConfig(config: AntigravityMcpConfig, configPath?: string): Promise<void> {
  const targetPath = configPath ?? getAntigravityGlobalMcpConfigPath();
  const dir = dirname(targetPath);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  await writeFile(targetPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

export async function getAntigravityMcpStatus(
  input: RuntimeMcpInput,
  configPath?: string,
): Promise<RuntimeMcpStatus> {
  const config = await readMcpConfig(configPath);
  const servers = isRecord(config.mcpServers) ? config.mcpServers : {};
  const serverEntry = servers[input.serverName];
  const isValidConfig = isRecord(serverEntry);
  const installed = input.serverName in servers && isValidConfig;
  return {
    installed,
    serverName: input.serverName,
    config: installed && isRecord(serverEntry) ? (serverEntry as Record<string, unknown>) : null,
  };
}

export async function installAntigravityMcpServer(
  input: RuntimeMcpInstallInput,
  configPath?: string,
): Promise<void> {
  const config = await readMcpConfig(configPath);
  if (!isRecord(config.mcpServers)) {
    config.mcpServers = {};
  }

  if (input.transport === "streamable_http") {
    config.mcpServers[input.serverName] = {
      serverUrl: input.url,
    };
  } else {
    config.mcpServers[input.serverName] = {
      command: input.command,
      args: input.args ?? [],
      ...(input.cwd ? { cwd: input.cwd } : {}),
      ...(input.env && Object.keys(input.env).length > 0 ? { env: input.env } : {}),
    };
  }

  await writeMcpConfig(config, configPath);
}

export async function uninstallAntigravityMcpServer(
  input: RuntimeMcpInput,
  configPath?: string,
): Promise<void> {
  const config = await readMcpConfig(configPath);
  if (isRecord(config.mcpServers) && input.serverName in config.mcpServers) {
    delete config.mcpServers[input.serverName];
    await writeMcpConfig(config, configPath);
  }
}
