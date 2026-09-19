import { describe, expect, it, vi, beforeEach } from "vitest";
import { createAntigravityRuntimeAdapter, registerRuntimeModule } from "../index.js";
import {
  ANTIGRAVITY_MODELS,
  DEFAULT_ANTIGRAVITY_MODEL,
  LIGHT_ANTIGRAVITY_MODEL,
  discoverAntigravityModels,
  clearDiscoveredModelsCache,
} from "../models.js";
import * as findPathModule from "../findPath.js";
import * as mcpModule from "../mcp.js";
import { classifyAntigravityRuntimeError } from "../errors.js";
import { bootstrapRuntimeRegistry } from "../../../bootstrap.js";
import {
  UsageReporting,
  RuntimeTransport,
  type RuntimeMcpInput,
  type RuntimeMcpInstallInput,
} from "../../../types.js";

describe("Antigravity Runtime Adapter", () => {
  describe("Descriptor and capabilities", () => {
    const adapter = createAntigravityRuntimeAdapter();

    it("has correct descriptor properties", () => {
      expect(adapter.descriptor.id).toBe("antigravity");
      expect(adapter.descriptor.providerId).toBe("google");
      expect(adapter.descriptor.displayName).toBe("Google Antigravity");
      expect(adapter.descriptor.defaultTransport).toBe(RuntimeTransport.CLI);
      expect(adapter.descriptor.supportedTransports).toContain(RuntimeTransport.CLI);
      expect(adapter.descriptor.lightModel).toBe(LIGHT_ANTIGRAVITY_MODEL);
      expect(adapter.descriptor.defaultModelPlaceholder).toBe(DEFAULT_ANTIGRAVITY_MODEL);
    });

    it("declares expected capabilities", () => {
      const caps = adapter.descriptor.capabilities;
      expect(caps.supportsResume).toBe(true);
      expect(caps.supportsStreaming).toBe(true);
      expect(caps.supportsModelDiscovery).toBe(true);
      expect(caps.supportsNativeSubagentWorkflows).toBe(true);
      expect(caps.supportsSessionFork).toBe(false);
      expect(caps.usageReporting).toBe(UsageReporting.FULL);
    });
  });

  describe("Model discovery", () => {
    const adapter = createAntigravityRuntimeAdapter({ executablePath: undefined });

    it("lists all 14 official Antigravity models", async () => {
      const models = await adapter.listModels!({
        runtimeId: "antigravity",
      });

      expect(models.length).toBe(14);
      expect(models.map((m) => m.id)).toEqual(ANTIGRAVITY_MODELS.map((m) => m.id));

      const flashHigh = models.find((m) => m.id === "gemini-3.8-flash-high");
      expect(flashHigh).toBeDefined();
      expect(flashHigh?.metadata?.contextWindow).toBe(1048576);

      const proHigh = models.find((m) => m.id === "gemini-3.1-pro-high");
      expect(proHigh).toBeDefined();
      expect(proHigh?.metadata?.contextWindow).toBe(2097152);

      const proLow = models.find((m) => m.id === "gemini-3.1-pro-low");
      expect(proLow).toBeDefined();

      // Ensure no hallucinated medium pro model
      const proMedium = models.find((m) => m.id === "gemini-3.1-pro-medium");
      expect(proMedium).toBeUndefined();
    });
  });

  describe("Error classification", () => {
    it("classifies capacity 503 errors", () => {
      const err = classifyAntigravityRuntimeError(new Error("503 No capacity available for model"));
      expect(err.adapterCode).toBe("ANTIGRAVITY_CAPACITY_UNAVAILABLE");
      expect(err.category).toBe("rate_limit");
    });

    it("classifies quota exceeded errors", () => {
      const err = classifyAntigravityRuntimeError(
        new Error("ResourceExhausted: Quota exceeded for project"),
      );
      expect(err.adapterCode).toBe("ANTIGRAVITY_RATE_LIMIT");
      expect(err.category).toBe("rate_limit");
    });

    it("classifies authentication errors", () => {
      const err = classifyAntigravityRuntimeError(
        new Error("User is not logged in to Antigravity"),
      );
      expect(err.adapterCode).toBe("ANTIGRAVITY_AUTH_ERROR");
      expect(err.category).toBe("auth");
    });

    it("classifies CLI not found errors", () => {
      const err = classifyAntigravityRuntimeError(new Error("spawn agy.exe ENOENT"));
      expect(err.adapterCode).toBe("ANTIGRAVITY_CLI_NOT_FOUND");
      expect(err.category).toBe("transport");
    });

    it("classifies timeout errors", () => {
      const err = classifyAntigravityRuntimeError(new Error("Execution timed out after 30000ms"));
      expect(err.adapterCode).toBe("ANTIGRAVITY_TIMEOUT");
      expect(err.category).toBe("timeout");
    });

    it("classifies unknown generic errors", () => {
      const err = classifyAntigravityRuntimeError(new Error("Something completely unexpected"));
      expect(err.adapterCode).toBe("ANTIGRAVITY_RUNTIME_ERROR");
      expect(err.category).toBe("unknown");
    });

    it("classifies model not recognized errors as model_not_found instead of CLI missing", () => {
      const err = classifyAntigravityRuntimeError(
        new Error(
          'error: invalid model selection (--model "unknown-model"): model unknown-model is not recognized',
        ),
      );
      expect(err.adapterCode).toBe("ANTIGRAVITY_MODEL_NOT_FOUND");
      expect(err.category).toBe("model_not_found");
    });

    it("classifies ENOENT error object with code property as CLI not found", () => {
      const raw = Object.assign(new Error("spawn agy ENOENT"), { code: "ENOENT" });
      const err = classifyAntigravityRuntimeError(raw);
      expect(err.adapterCode).toBe("ANTIGRAVITY_CLI_NOT_FOUND");
      expect(err.category).toBe("transport");
    });

    it("diagnoses model not recognized as model error rather than CLI missing", async () => {
      const adapter = createAntigravityRuntimeAdapter();
      const diagnosis = await adapter.diagnoseError!({
        error: new Error("model foo is not recognized"),
      });
      expect(diagnosis).toContain("model is not supported or recognized");
      expect(diagnosis).not.toContain("Ensure 'agy.exe' is installed in PATH");
    });
  });

  describe("Input sanitization", () => {
    const adapter = createAntigravityRuntimeAdapter();

    it("strips internal command tags and system reminders", () => {
      const raw =
        "<system-reminder>secret</system-reminder><command-name>run</command-name>Hello world!";
      const sanitized = adapter.sanitizeInput!(raw);
      expect(sanitized).toBe("Hello world!");
    });
  });

  describe("Bootstrap and Module registration", () => {
    it("is registered as a built-in adapter in bootstrapRuntimeRegistry", async () => {
      const registry = await bootstrapRuntimeRegistry();
      const resolved = registry.resolveRuntime("antigravity");
      expect(resolved).toBeDefined();
      expect(resolved.descriptor.id).toBe("antigravity");
      expect(resolved.descriptor.providerId).toBe("google");
    });

    it("supports registerRuntimeModule for AIF_RUNTIME_MODULES external loading", () => {
      let registeredAdapter: unknown = null;
      let registeredOptions: unknown = null;

      const fakeRegistry = {
        registerRuntime(adapter: unknown, options?: unknown) {
          registeredAdapter = adapter;
          registeredOptions = options;
        },
      };

      registerRuntimeModule(fakeRegistry as any);
      expect(registeredAdapter).toBeDefined();
      expect((registeredAdapter as any).descriptor.id).toBe("antigravity");
      expect(registeredOptions).toEqual({ source: "module" });
    });
  });

  describe("Connection validation", () => {
    const adapter = createAntigravityRuntimeAdapter({
      executablePath: "/mock/bin/agy.exe",
    });

    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it("reports success when probeAntigravityCli succeeds", async () => {
      vi.spyOn(findPathModule, "probeAntigravityCli").mockReturnValueOnce({
        ok: true,
        version: "1.2.5",
      });

      const result = await adapter.validateConnection!({
        runtimeId: "antigravity",
      });

      expect(result.ok).toBe(true);
      expect(result.message).toContain("Google Antigravity CLI 1.2.5");
    });

    it("reports failure when probeAntigravityCli fails", async () => {
      vi.spyOn(findPathModule, "probeAntigravityCli").mockReturnValueOnce({
        ok: false,
        error: "CLI not found in PATH",
      });

      const result = await adapter.validateConnection!({
        runtimeId: "antigravity",
      });

      expect(result.ok).toBe(false);
      expect(result.message).toContain("Antigravity CLI is not reachable");
      expect(result.message).toContain("CLI not found in PATH");
    });

    it("rejects .cmd batch script due to shell injection protection", async () => {
      const result = await adapter.validateConnection!({
        runtimeId: "antigravity",
        options: { antigravityCliPath: "C:\\tools\\agy.cmd" },
      });

      expect(result.ok).toBe(false);
      expect(result.message).toContain("Executing Antigravity via batch script");
    });

    const hasLiveCli = Boolean(process.env.TEST_ANTIGRAVITY_INTEGRATION);
    it.runIf(hasLiveCli)(
      "validates installed agy.exe live when TEST_ANTIGRAVITY_INTEGRATION is enabled",
      async () => {
        const liveAdapter = createAntigravityRuntimeAdapter();
        const result = await liveAdapter.validateConnection!({
          runtimeId: "antigravity",
        });
        expect(result.ok).toBe(true);
        expect(result.message).toContain("Google Antigravity CLI 1.2.5");
      },
    );
  });

  describe("Dynamic model discovery and fallback", () => {
    beforeEach(() => {
      clearDiscoveredModelsCache();
    });

    it("falls back to ANTIGRAVITY_MODELS when cliPath is missing", async () => {
      const models = await discoverAntigravityModels({ cliPath: undefined });
      expect(models.length).toBe(14);
    });

    it("falls back to ANTIGRAVITY_MODELS when CLI execution fails", async () => {
      const models = await discoverAntigravityModels({
        cliPath: "/non-existent/path/to/agy.exe",
        forceRefresh: true,
      });
      expect(models.length).toBe(14);
    });
  });

  describe("MCP management", () => {
    const adapter = createAntigravityRuntimeAdapter();

    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it("exposes MCP management methods", () => {
      expect(typeof adapter.getMcpStatus).toBe("function");
      expect(typeof adapter.installMcpServer).toBe("function");
      expect(typeof adapter.uninstallMcpServer).toBe("function");
    });

    it("delegates getMcpStatus to getAntigravityMcpStatus", async () => {
      const spy = vi.spyOn(mcpModule, "getAntigravityMcpStatus").mockResolvedValueOnce({
        installed: true,
        serverName: "test-server",
        config: null,
      });

      const result = await adapter.getMcpStatus!({ serverName: "test-server" });

      expect(spy).toHaveBeenCalledWith({ serverName: "test-server" });
      expect(result).toEqual({
        installed: true,
        serverName: "test-server",
        config: null,
      });
    });

    it("delegates installMcpServer to installAntigravityMcpServer", async () => {
      const spy = vi.spyOn(mcpModule, "installAntigravityMcpServer").mockResolvedValueOnce();

      const input: RuntimeMcpInstallInput = {
        serverName: "test-server",
        command: "node",
        args: ["server.js"],
      };

      await adapter.installMcpServer!(input);

      expect(spy).toHaveBeenCalledWith(input);
    });

    it("delegates uninstallMcpServer to uninstallAntigravityMcpServer", async () => {
      const spy = vi.spyOn(mcpModule, "uninstallAntigravityMcpServer").mockResolvedValueOnce();

      const input: RuntimeMcpInput = { serverName: "test-server" };

      await adapter.uninstallMcpServer!(input);

      expect(spy).toHaveBeenCalledWith(input);
    });
  });
});
