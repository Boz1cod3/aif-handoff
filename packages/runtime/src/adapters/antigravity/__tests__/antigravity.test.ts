import { describe, expect, it } from "vitest";
import { createAntigravityRuntimeAdapter, registerRuntimeModule } from "../index.js";
import {
  ANTIGRAVITY_MODELS,
  DEFAULT_ANTIGRAVITY_MODEL,
  LIGHT_ANTIGRAVITY_MODEL,
} from "../models.js";
import { classifyAntigravityRuntimeError } from "../errors.js";
import { bootstrapRuntimeRegistry } from "../../../bootstrap.js";
import { UsageReporting, RuntimeTransport } from "../../../types.js";

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
    const adapter = createAntigravityRuntimeAdapter();

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

  describe("Connection validation with installed agy binary", () => {
    const adapter = createAntigravityRuntimeAdapter();

    it("validates installed agy.exe successfully", async () => {
      const result = await adapter.validateConnection!({
        runtimeId: "antigravity",
      });

      expect(result.ok).toBe(true);
      expect(result.message).toContain("Google Antigravity CLI");
    });
  });
});
