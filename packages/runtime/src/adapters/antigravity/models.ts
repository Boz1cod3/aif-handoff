import type { RuntimeModel } from "../../types.js";

/**
 * Official models available in Google Antigravity CLI (`agy models`).
 * Verified directly against the installed agy.exe binary.
 */
export const ANTIGRAVITY_MODELS: RuntimeModel[] = [
  // Gemini 3.8 Flash (Primary fast workhorse)
  {
    id: "gemini-3.8-flash-high",
    label: "Gemini 3.8 Flash (High)",
    supportsStreaming: true,
    metadata: {
      supportsEffort: true,
      supportedEffortLevels: ["low", "medium", "high"],
      contextWindow: 1048576,
    },
  },
  {
    id: "gemini-3.8-flash-medium",
    label: "Gemini 3.8 Flash (Medium)",
    supportsStreaming: true,
    metadata: {
      supportsEffort: true,
      supportedEffortLevels: ["low", "medium", "high"],
      contextWindow: 1048576,
    },
  },
  {
    id: "gemini-3.8-flash-low",
    label: "Gemini 3.8 Flash (Low)",
    supportsStreaming: true,
    metadata: {
      supportsEffort: true,
      supportedEffortLevels: ["low", "medium", "high"],
      contextWindow: 1048576,
    },
  },

  // Gemini 3.7 Flash
  {
    id: "gemini-3.7-flash-high",
    label: "Gemini 3.7 Flash (High)",
    supportsStreaming: true,
    metadata: {
      supportsEffort: true,
      supportedEffortLevels: ["low", "medium", "high"],
      contextWindow: 1048576,
    },
  },
  {
    id: "gemini-3.7-flash-medium",
    label: "Gemini 3.7 Flash (Medium)",
    supportsStreaming: true,
    metadata: {
      supportsEffort: true,
      supportedEffortLevels: ["low", "medium", "high"],
      contextWindow: 1048576,
    },
  },
  {
    id: "gemini-3.7-flash-low",
    label: "Gemini 3.7 Flash (Low)",
    supportsStreaming: true,
    metadata: {
      supportsEffort: true,
      supportedEffortLevels: ["low", "medium", "high"],
      contextWindow: 1048576,
    },
  },

  // Gemini 3.6 Flash
  {
    id: "gemini-3.6-flash-high",
    label: "Gemini 3.6 Flash (High)",
    supportsStreaming: true,
    metadata: {
      supportsEffort: true,
      supportedEffortLevels: ["low", "medium", "high"],
      contextWindow: 1048576,
    },
  },
  {
    id: "gemini-3.6-flash-medium",
    label: "Gemini 3.6 Flash (Medium)",
    supportsStreaming: true,
    metadata: {
      supportsEffort: true,
      supportedEffortLevels: ["low", "medium", "high"],
      contextWindow: 1048576,
    },
  },
  {
    id: "gemini-3.6-flash-low",
    label: "Gemini 3.6 Flash (Low)",
    supportsStreaming: true,
    metadata: {
      supportsEffort: true,
      supportedEffortLevels: ["low", "medium", "high"],
      contextWindow: 1048576,
    },
  },

  // Gemini 3.1 Pro (Deep context & complex reasoning: High and Low only)
  {
    id: "gemini-3.1-pro-high",
    label: "Gemini 3.1 Pro (High)",
    supportsStreaming: true,
    metadata: {
      supportsEffort: true,
      supportedEffortLevels: ["low", "high"],
      contextWindow: 2097152,
    },
  },
  {
    id: "gemini-3.1-pro-low",
    label: "Gemini 3.1 Pro (Low)",
    supportsStreaming: true,
    metadata: {
      supportsEffort: true,
      supportedEffortLevels: ["low", "high"],
      contextWindow: 2097152,
    },
  },

  // Partner Models in Antigravity Gateway
  {
    id: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6 (Thinking)",
    supportsStreaming: true,
    metadata: {
      contextWindow: 200000,
    },
  },
  {
    id: "claude-opus-4-6-thinking",
    label: "Claude Opus 4.6 (Thinking)",
    supportsStreaming: true,
    metadata: {
      contextWindow: 200000,
    },
  },
  {
    id: "gpt-oss-120b-medium",
    label: "GPT-OSS 120B (Medium)",
    supportsStreaming: true,
    metadata: {
      contextWindow: 131072,
    },
  },
];

export const DEFAULT_ANTIGRAVITY_MODEL = "gemini-3.8-flash-high";
export const LIGHT_ANTIGRAVITY_MODEL = "gemini-3.8-flash-low";
