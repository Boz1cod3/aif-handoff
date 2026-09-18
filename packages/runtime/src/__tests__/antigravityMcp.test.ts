import { beforeEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";

const readFileMock = vi.fn();
const writeFileMock = vi.fn();
const mkdirMock = vi.fn();
const existsSyncMock = vi.fn();
const homedirMock = vi.fn(() => "C:\\Users\\wait");

vi.mock("node:fs/promises", () => ({
  readFile: (...args: unknown[]) => readFileMock(...args),
  writeFile: (...args: unknown[]) => writeFileMock(...args),
  mkdir: (...args: unknown[]) => mkdirMock(...args),
}));

vi.mock("node:fs", () => ({
  existsSync: (...args: unknown[]) => existsSyncMock(...args),
}));

vi.mock("node:os", () => ({
  homedir: () => homedirMock(),
}));

const {
  getAntigravityGlobalMcpConfigPath,
  getAntigravityMcpStatus,
  installAntigravityMcpServer,
  uninstallAntigravityMcpServer,
} = await import("../adapters/antigravity/mcp.js");

describe("Antigravity MCP config", () => {
  beforeEach(() => {
    readFileMock.mockReset();
    writeFileMock.mockReset();
    mkdirMock.mockReset();
    existsSyncMock.mockReset();
    readFileMock.mockRejectedValue(new Error("missing"));
    writeFileMock.mockResolvedValue(undefined);
    mkdirMock.mockResolvedValue(undefined);
    existsSyncMock.mockReturnValue(true);
  });

  it("returns default global config path based on homedir", () => {
    const expectedPath = join("C:\\Users\\wait", ".gemini", "config", "mcp_config.json");
    expect(getAntigravityGlobalMcpConfigPath()).toBe(expectedPath);
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
          cwd: "C:\\projects\\aif-handoff",
          env: {
            DATABASE_URL: "C:\\projects\\aif-handoff\\data\\aif.sqlite",
          },
        },
      },
    });
  });

  it("writes stdio MCP server with default empty args and without env if omitted", async () => {
    await installAntigravityMcpServer({
      serverName: "minimal-stdio",
      transport: "stdio",
      command: "node",
    });

    expect(writeFileMock).toHaveBeenCalledTimes(1);
    const [, content] = writeFileMock.mock.calls[0] as [string, string];
    expect(JSON.parse(content)).toEqual({
      mcpServers: {
        "minimal-stdio": {
          command: "node",
          args: [],
        },
      },
    });
  });

  it("writes stdio MCP server preserving cwd when provided", async () => {
    await installAntigravityMcpServer({
      serverName: "custom-cwd-stdio",
      transport: "stdio",
      command: "node",
      args: ["run.js"],
      cwd: "d:\\custom\\dir",
    });

    expect(writeFileMock).toHaveBeenCalledTimes(1);
    const [, content] = writeFileMock.mock.calls[0] as [string, string];
    expect(JSON.parse(content)).toEqual({
      mcpServers: {
        "custom-cwd-stdio": {
          command: "node",
          args: ["run.js"],
          cwd: "d:\\custom\\dir",
        },
      },
    });
  });

  it("writes HTTP MCP server using serverUrl property", async () => {
    readFileMock.mockResolvedValue(
      JSON.stringify({
        mcpServers: {
          existing: { command: "python", args: ["other.py"] },
        },
      }),
    );

    await installAntigravityMcpServer({
      serverName: "handoff",
      transport: "streamable_http",
      url: "http://localhost:3100/mcp",
    });

    expect(writeFileMock).toHaveBeenCalledTimes(1);
    const [, content] = writeFileMock.mock.calls[0] as [string, string];
    expect(JSON.parse(content)).toEqual({
      mcpServers: {
        existing: { command: "python", args: ["other.py"] },
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

  it("creates parent directory recursively if directory does not exist", async () => {
    existsSyncMock.mockReturnValue(false);

    await installAntigravityMcpServer({
      serverName: "handoff",
      transport: "streamable_http",
      url: "http://localhost:3100/mcp",
    });

    const expectedDir = join("C:\\Users\\wait", ".gemini", "config");
    expect(mkdirMock).toHaveBeenCalledWith(expectedDir, { recursive: true });
    expect(writeFileMock).toHaveBeenCalledTimes(1);
  });

  it("respects custom configPath parameter when provided", async () => {
    const customConfigPath = "D:\\custom\\project\\mcp_config.json";

    await installAntigravityMcpServer(
      {
        serverName: "custom",
        transport: "streamable_http",
        url: "http://localhost:4000/mcp",
      },
      customConfigPath,
    );

    expect(writeFileMock).toHaveBeenCalledWith(customConfigPath, expect.any(String), "utf-8");

    readFileMock.mockResolvedValue(
      JSON.stringify({
        mcpServers: {
          custom: {
            serverUrl: "http://localhost:4000/mcp",
          },
        },
      }),
    );

    const status = await getAntigravityMcpStatus({ serverName: "custom" }, customConfigPath);
    expect(status.installed).toBe(true);
    expect(readFileMock).toHaveBeenCalledWith(customConfigPath, "utf-8");

    await uninstallAntigravityMcpServer({ serverName: "custom" }, customConfigPath);
    expect(writeFileMock).toHaveBeenLastCalledWith(
      customConfigPath,
      JSON.stringify({ mcpServers: {} }, null, 2) + "\n",
      "utf-8",
    );
  });

  it("handles corrupted or non-object config file gracefully", async () => {
    readFileMock.mockResolvedValue("invalid json string {}");

    const status = await getAntigravityMcpStatus({ serverName: "handoff" });
    expect(status.installed).toBe(false);
    expect(status.config).toBeNull();

    readFileMock.mockResolvedValue("42");
    const statusPrimitive = await getAntigravityMcpStatus({ serverName: "handoff" });
    expect(statusPrimitive.installed).toBe(false);
    expect(statusPrimitive.config).toBeNull();
  });

  it("does not rewrite file when uninstalling a server that is not registered", async () => {
    readFileMock.mockResolvedValue(
      JSON.stringify({
        mcpServers: {
          other: { command: "python", args: ["server.py"] },
        },
      }),
    );

    await uninstallAntigravityMcpServer({ serverName: "non-existent" });
    expect(writeFileMock).not.toHaveBeenCalled();
  });
});
