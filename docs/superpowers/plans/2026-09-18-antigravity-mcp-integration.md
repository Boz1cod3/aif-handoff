# Google Antigravity MCP Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable Google Antigravity runtime adapter to discover, install, and remove Model Context Protocol (MCP) server configurations so Handoff MCP tools can be invoked directly from chat and agent workflows.

**Architecture:** Implement atomic JSON manipulation for Antigravity's global configuration file (`~/.gemini/config/mcp_config.json`), mapping stdio (`command`, `args`, `env`) and HTTP transports (`serverUrl`) into Antigravity's native schema. Wire `getMcpStatus`, `installMcpServer`, and `uninstallMcpServer` into `createAntigravityRuntimeAdapter()`. API routes (`/settings/mcp`) will automatically detect and manage Antigravity without requiring intermediate proxy subagents.

**Tech Stack:** TypeScript (ES2022, ESNext), Node.js (`fs/promises`, `os`, `path`), Hono, Vitest, npm workspaces.

**Spec:** [docs/mcp-sync.md](../../mcp-sync.md), [packages/runtime/src/types.ts](../../packages/runtime/src/types.ts)

## Global Constraints

- Never combine shell commands with `&&`, `||`, or `;` — execute each command as a separate tool call.
- DB boundary: access database only through `@aif/data`.
- Keep every touched package at or above 70% test coverage (measured by `@vitest/coverage-v8`).
- Run `npm run ai:validate` after all tasks are completed.
- Map HTTP/SSE endpoints to `serverUrl` (not `url`) according to Antigravity 2.0 schema.
- Ensure directory creation is recursive and safe (`mkdir(..., { recursive: true })`).

---

### Task 1: Antigravity MCP Configuration Module with TDD

**Files:**

- Create: `packages/runtime/src/adapters/antigravity/mcp.ts`
- Create: `packages/runtime/src/__tests__/antigravityMcp.test.ts`

**Interfaces:**

- Produces: `getAntigravityMcpStatus(input: RuntimeMcpInput, configPath?: string): Promise<RuntimeMcpStatus>`
- Produces: `installAntigravityMcpServer(input: RuntimeMcpInstallInput, configPath?: string): Promise<void>`
- Produces: `uninstallAntigravityMcpServer(input: RuntimeMcpInput, configPath?: string): Promise<void>`
- Produces: `getAntigravityGlobalMcpConfigPath(): string`
- Consumes: `RuntimeMcpInput`, `RuntimeMcpInstallInput`, `RuntimeMcpStatus` from `../../types.js`

- [ ] **Step 1: Write the failing tests**

Create `packages/runtime/src/__tests__/antigravityMcp.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";

const readFileMock = vi.fn();
const writeFileMock = vi.fn();
const mkdirMock = vi.fn();
const homedirMock = vi.fn(() => "C:\\Users\\wait");

vi.mock("node:fs/promises", () => ({
  readFile: (...args: unknown[]) => readFileMock(...args),
  writeFile: (...args: unknown[]) => writeFileMock(...args),
  mkdir: (...args: unknown[]) => mkdirMock(...args),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => true),
}));

vi.mock("node:os", () => ({
  homedir: () => homedirMock(),
}));

const { getAntigravityMcpStatus, installAntigravityMcpServer, uninstallAntigravityMcpServer } =
  await import("../adapters/antigravity/mcp.js");

describe("Antigravity MCP config", () => {
  beforeEach(() => {
    readFileMock.mockReset();
    writeFileMock.mockReset();
    mkdirMock.mockReset();
    readFileMock.mockRejectedValue(new Error("missing"));
    writeFileMock.mockResolvedValue(undefined);
    mkdirMock.mockResolvedValue(undefined);
  });

  it("returns installed: false when mcp_config.json is missing", async () => {
    const status = await getAntigravityMcpStatus({ serverName: "handoff" });
    expect(status.installed).toBe(false);
    expect(status.serverName).toBe("handoff");
    expect(status.config).toBeNull();
  });

  it("writes stdio MCP server to mcp_config.json", async () => {
    await installAntigravityMcpServer({
      serverName: "handoff",
      transport: "stdio",
      command: "npx",
      args: ["tsx", "packages/mcp/src/index.ts"],
      cwd: "C:\\projects\\aif-handoff",
      env: {
        DATABASE_URL: "C:\\projects\\aif-handoff\\data\\aif.sqlite",
      },
    });

    expect(writeFileMock).toHaveBeenCalledTimes(1);
    const [, content] = writeFileMock.mock.calls[0] as [string, string];
    expect(JSON.parse(content)).toEqual({
      mcpServers: {
        handoff: {
          command: "npx",
          args: ["tsx", "packages/mcp/src/index.ts"],
          env: {
            DATABASE_URL: "C:\\projects\\aif-handoff\\data\\aif.sqlite",
          },
        },
      },
    });
  });

  it("writes HTTP MCP server using serverUrl property", async () => {
    await installAntigravityMcpServer({
      serverName: "handoff",
      transport: "streamable_http",
      url: "http://localhost:3100/mcp",
    });

    expect(writeFileMock).toHaveBeenCalledTimes(1);
    const [, content] = writeFileMock.mock.calls[0] as [string, string];
    expect(JSON.parse(content)).toEqual({
      mcpServers: {
        handoff: {
          serverUrl: "http://localhost:3100/mcp",
        },
      },
    });
  });

  it("reads installed server entry from config", async () => {
    readFileMock.mockResolvedValue(
      JSON.stringify({
        mcpServers: {
          handoff: {
            serverUrl: "http://localhost:3100/mcp",
          },
        },
      }),
    );

    const status = await getAntigravityMcpStatus({ serverName: "handoff" });
    expect(status.installed).toBe(true);
    expect(status.config).toEqual({
      serverUrl: "http://localhost:3100/mcp",
    });
  });

  it("removes server from mcp_config.json while preserving other servers", async () => {
    readFileMock.mockResolvedValue(
      JSON.stringify({
        mcpServers: {
          handoff: { serverUrl: "http://localhost:3100/mcp" },
          other: { command: "python", args: ["server.py"] },
        },
      }),
    );

    await uninstallAntigravityMcpServer({ serverName: "handoff" });

    expect(writeFileMock).toHaveBeenCalledTimes(1);
    const [, content] = writeFileMock.mock.calls[0] as [string, string];
    expect(JSON.parse(content)).toEqual({
      mcpServers: {
        other: { command: "python", args: ["server.py"] },
      },
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/runtime/src/__tests__/antigravityMcp.test.ts`
Expected: FAIL due to missing module `../adapters/antigravity/mcp.js`.

- [ ] **Step 3: Implement minimal code in `packages/runtime/src/adapters/antigravity/mcp.ts`**

Create `packages/runtime/src/adapters/antigravity/mcp.ts`:

```typescript
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
  env?: Record<string, string>;
  serverUrl?: string;
  [key: string]: unknown;
}

export interface AntigravityMcpConfig {
  mcpServers?: Record<string, AntigravityMcpServerConfig>;
  [key: string]: unknown;
}

async function readMcpConfig(configPath?: string): Promise<AntigravityMcpConfig> {
  const targetPath = configPath ?? getAntigravityGlobalMcpConfigPath();
  try {
    const raw = await readFile(targetPath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
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
  const servers = config.mcpServers ?? {};
  const installed = input.serverName in servers;
  return {
    installed,
    serverName: input.serverName,
    config: installed ? (servers[input.serverName] as Record<string, unknown>) : null,
  };
}

export async function installAntigravityMcpServer(
  input: RuntimeMcpInstallInput,
  configPath?: string,
): Promise<void> {
  const config = await readMcpConfig(configPath);
  if (!config.mcpServers || typeof config.mcpServers !== "object") {
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
  if (config.mcpServers && input.serverName in config.mcpServers) {
    delete config.mcpServers[input.serverName];
    await writeMcpConfig(config, configPath);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/runtime/src/__tests__/antigravityMcp.test.ts`
Expected: PASS with 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/adapters/antigravity/mcp.ts packages/runtime/src/__tests__/antigravityMcp.test.ts
git commit -m "feat(runtime): implement Antigravity MCP configuration helper with unit tests"
```

---

### Task 2: Wire Antigravity MCP into Runtime Adapter

**Files:**

- Modify: `packages/runtime/src/adapters/antigravity/index.ts`
- Modify: `packages/runtime/src/adapters/antigravity/__tests__/antigravity.test.ts`

**Interfaces:**

- Produces: `createAntigravityRuntimeAdapter()` exposing `getMcpStatus`, `installMcpServer`, `uninstallMcpServer`
- Consumes: `getAntigravityMcpStatus`, `installAntigravityMcpServer`, `uninstallAntigravityMcpServer` from `./mcp.js`

- [ ] **Step 1: Write failing adapter tests**

Modify `packages/runtime/src/adapters/antigravity/__tests__/antigravity.test.ts` to add checks for MCP adapter methods:

```typescript
it("exposes MCP management methods on adapter", () => {
  const adapter = createAntigravityRuntimeAdapter();
  expect(typeof adapter.getMcpStatus).toBe("function");
  expect(typeof adapter.installMcpServer).toBe("function");
  expect(typeof adapter.uninstallMcpServer).toBe("function");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/runtime/src/adapters/antigravity/__tests__/antigravity.test.ts`
Expected: FAIL because `adapter.getMcpStatus` is undefined.

- [ ] **Step 3: Modify `packages/runtime/src/adapters/antigravity/index.ts`**

Import and wire the functions:

```typescript
import {
  getAntigravityMcpStatus,
  installAntigravityMcpServer,
  uninstallAntigravityMcpServer,
} from "./mcp.js";
```

And inside `createAntigravityRuntimeAdapter()`:

```typescript
    async getMcpStatus(input) {
      return getAntigravityMcpStatus(input);
    },

    async installMcpServer(input) {
      return installAntigravityMcpServer(input);
    },

    async uninstallMcpServer(input) {
      return uninstallAntigravityMcpServer(input);
    },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/runtime/src/adapters/antigravity/__tests__/antigravity.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/adapters/antigravity/index.ts packages/runtime/src/adapters/antigravity/__tests__/antigravity.test.ts
git commit -m "feat(runtime): wire MCP management methods into Antigravity runtime adapter"
```

---

### Task 3: API Settings Integration & Route Tests

**Files:**

- Modify: `packages/api/src/__tests__/settings.test.ts`

**Interfaces:**

- Consumes: `POST /settings/mcp/install`, `GET /settings/mcp`, `DELETE /settings/mcp`

- [ ] **Step 1: Update API settings tests**

In `packages/api/src/__tests__/settings.test.ts`:

1. Add `antigravityConfigPath = join(fakeHome, ".gemini", "config", "mcp_config.json")`.
2. In `beforeEach`, ensure `.gemini` directory in `fakeHome` is cleaned up:
   `rmSync(join(fakeHome, ".gemini"), { recursive: true, force: true });`
3. In `POST /settings/mcp/install adds handoff server`, assert `antigravityConfigPath` exists and has `handoff` server entry with `command: "npx"`.
4. In `POST /settings/mcp/install adds handoff HTTP server when MCP_PORT is set`, assert `antigravityConfigPath` has `serverUrl: "http://localhost:3100/mcp"`.
5. In `DELETE /settings/mcp removes handoff server`, seed `antigravityConfigPath` and assert it is uninstalled.

- [ ] **Step 2: Run settings tests**

Run: `npx vitest run packages/api/src/__tests__/settings.test.ts`
Expected: PASS all MCP route tests.

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/__tests__/settings.test.ts
git commit -m "test(api): assert Antigravity MCP installation and removal in settings routes"
```

---

### Task 4: Documentation & Full Project Validation

**Files:**

- Modify: `docs/mcp-sync.md`

- [ ] **Step 1: Update `docs/mcp-sync.md`**

Add section detailing Google Antigravity MCP support:

- Explain global path `~/.gemini/config/mcp_config.json` and project path `.agents/mcp_config.json`.
- Note `serverUrl` field for remote/HTTP transport and stdio parameters.

- [ ] **Step 2: Run full workspace validation**

Run: `npm run ai:validate`
Expected: All packages pass build, type-check, tests, and coverage (>70%).

- [ ] **Step 3: Commit**

```bash
git add docs/mcp-sync.md
git commit -m "docs: document Google Antigravity MCP integration in mcp-sync.md"
```
