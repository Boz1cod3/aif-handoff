import {
  RuntimeTransport,
  UsageReporting,
  type RuntimeAdapter,
  type RuntimeCapabilities,
  type RuntimeConnectionValidationInput,
  type RuntimeConnectionValidationResult,
  type RuntimeDiagnoseErrorInput,
  type RuntimeModel,
  type RuntimeModelListInput,
  type RuntimeRunInput,
  type RuntimeRunResult,
} from "../../types.js";
import { findAntigravityPath, probeAntigravityCli } from "./findPath.js";
import { runAntigravityCli, type AntigravityCliLogger } from "./cli.js";
import {
  ANTIGRAVITY_MODELS,
  DEFAULT_ANTIGRAVITY_MODEL,
  LIGHT_ANTIGRAVITY_MODEL,
} from "./models.js";

export type AntigravityRuntimeAdapterLogger = AntigravityCliLogger;

export interface CreateAntigravityRuntimeAdapterOptions {
  runtimeId?: string;
  providerId?: string;
  displayName?: string;
  logger?: AntigravityRuntimeAdapterLogger;
  executablePath?: string;
}

const ANTIGRAVITY_CAPABILITIES: RuntimeCapabilities = {
  supportsResume: true,
  supportsSessionFork: false,
  supportsSessionList: false,
  supportsAgentDefinitions: false,
  supportsStreaming: true,
  supportsModelDiscovery: true,
  supportsApprovals: false,
  supportsCustomEndpoint: false,
  supportsIsolatedSubagentWorkflows: false,
  supportsNativeSubagentWorkflows: true,
  usageReporting: UsageReporting.FULL,
  supportsInteractiveQuestions: false,
};

function createFallbackLogger(): AntigravityRuntimeAdapterLogger {
  return {
    debug(context, message) {
      console.debug("[runtime:antigravity]", message, context);
    },
    info(context, message) {
      console.info("INFO [runtime:antigravity]", message, context);
    },
    warn(context, message) {
      console.warn("WARN [runtime:antigravity]", message, context);
    },
    error(context, message) {
      console.error("ERROR [runtime:antigravity]", message, context);
    },
  };
}

export function createAntigravityRuntimeAdapter(
  options: CreateAntigravityRuntimeAdapterOptions = {},
): RuntimeAdapter {
  const runtimeId = options.runtimeId ?? "antigravity";
  const providerId = options.providerId ?? "google";
  const logger = options.logger ?? createFallbackLogger();
  const executablePath = options.executablePath ?? findAntigravityPath();

  return {
    descriptor: {
      id: runtimeId,
      providerId,
      displayName: options.displayName ?? "Google Antigravity",
      lightModel: LIGHT_ANTIGRAVITY_MODEL,
      defaultModelPlaceholder: DEFAULT_ANTIGRAVITY_MODEL,
      defaultTransport: RuntimeTransport.CLI,
      supportedTransports: [RuntimeTransport.CLI],
      capabilities: ANTIGRAVITY_CAPABILITIES,
    },

    getEffectiveCapabilities(): RuntimeCapabilities {
      return ANTIGRAVITY_CAPABILITIES;
    },

    async run(input: RuntimeRunInput): Promise<RuntimeRunResult> {
      return runAntigravityCli(input, logger, {
        pathToAntigravityExecutable: executablePath,
      });
    },

    async resume(input: RuntimeRunInput & { sessionId: string }): Promise<RuntimeRunResult> {
      return runAntigravityCli(input, logger, {
        pathToAntigravityExecutable: executablePath,
      });
    },

    async listModels(_input: RuntimeModelListInput): Promise<RuntimeModel[]> {
      return [...ANTIGRAVITY_MODELS];
    },

    async validateConnection(
      input: RuntimeConnectionValidationInput,
    ): Promise<RuntimeConnectionValidationResult> {
      const cliPath =
        typeof input.options?.antigravityCliPath === "string" &&
        input.options.antigravityCliPath.trim().length > 0
          ? input.options.antigravityCliPath.trim()
          : (executablePath ?? "agy.exe");

      const probe = probeAntigravityCli(cliPath);
      if (!probe.ok) {
        return {
          ok: false,
          message: `Antigravity CLI is not reachable (${cliPath}): ${probe.error}`,
        };
      }

      return {
        ok: true,
        message: `Google Antigravity CLI ${probe.version ?? "unknown"} (${cliPath})`,
      };
    },

    async diagnoseError(input: RuntimeDiagnoseErrorInput): Promise<string> {
      const errorMsg = input.error instanceof Error ? input.error.message : String(input.error);
      const tail = input.stderrTail ? `\nStderr tail:\n${input.stderrTail}` : "";
      return `Antigravity execution error: ${errorMsg}${tail}`;
    },

    sanitizeInput(text: string): string {
      return text
        .replace(/<command-name>[^<]*<\/command-name>/g, "")
        .replace(/<command-message>[^<]*<\/command-message>/g, "")
        .replace(/<command-args>([^<]*)<\/command-args>/g, "$1")
        .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
        .replace(/<task-notification>[\s\S]*?<\/task-notification>/g, "")
        .trim();
    },
  };
}

/**
 * External module registration entry point for AIF_RUNTIME_MODULES.
 */
export function registerRuntimeModule(registry: {
  registerRuntime: (adapter: RuntimeAdapter, options?: { source: string }) => void;
}): void {
  registry.registerRuntime(createAntigravityRuntimeAdapter(), { source: "module" });
}
