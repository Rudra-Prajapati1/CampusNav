import path from "path";
import { randomUUID } from "crypto";
import { Agent } from "undici";

const DEFAULT_AI_SERVICE_CANDIDATES = [
  "http://127.0.0.1:8001",
  "http://127.0.0.1:8000",
  "http://localhost:8001",
  "http://localhost:8000",
];
const AI_TRACE_TIMEOUT_MS = Number.parseInt(
  process.env.AI_TRACE_TIMEOUT_MS || "900000",
  10,
);
const aiTraceDispatcher = new Agent({
  headersTimeout: AI_TRACE_TIMEOUT_MS,
  bodyTimeout: AI_TRACE_TIMEOUT_MS,
});

function emptyCollection() {
  return { type: "FeatureCollection", features: [] };
}

function emptyMvf() {
  return {
    spaces: emptyCollection(),
    obstructions: emptyCollection(),
    openings: emptyCollection(),
    nodes: emptyCollection(),
    objects: emptyCollection(),
    meta: {},
  };
}

function normalizeCollection(collection) {
  if (!collection || typeof collection !== "object") return emptyCollection();
  return {
    type: "FeatureCollection",
    features: Array.isArray(collection.features) ? collection.features : [],
  };
}

function normalizeMvf(payload) {
  if (!payload || typeof payload !== "object") return emptyMvf();

  return {
    spaces: normalizeCollection(payload.spaces),
    obstructions: normalizeCollection(payload.obstructions),
    openings: normalizeCollection(payload.openings),
    nodes: normalizeCollection(payload.nodes),
    objects: normalizeCollection(payload.objects),
    meta: payload.meta && typeof payload.meta === "object" ? payload.meta : {},
  };
}

function ensureOk(response, message) {
  if (response.ok) return response;
  throw new Error(`${message}: ${response.status} ${response.statusText}`);
}

function normalizeBaseUrl(value) {
  if (!value || typeof value !== "string") return null;
  return value.trim().replace(/\/+$/, "");
}

function aiServiceCandidates() {
  const configured = [
    process.env.AI_TRACE_SERVICE_URL,
    process.env.AI_SERVICE_URL,
  ]
    .map(normalizeBaseUrl)
    .filter(Boolean);

  const defaults =
    DEFAULT_AI_SERVICE_CANDIDATES.map(normalizeBaseUrl).filter(Boolean);

  return [...new Set([...configured, ...defaults])];
}

function isConnectivityError(error) {
  const code = error?.cause?.code;
  return [
    "ECONNREFUSED",
    "ETIMEDOUT",
    "ENOTFOUND",
    "EAI_AGAIN",
    "UND_ERR_CONNECT_TIMEOUT",
  ].includes(code);
}

function isAiTimeoutError(error) {
  return ["UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"].includes(
    error?.cause?.code,
  );
}

function buildTraceForm(file, options = {}) {
  const form = new FormData();
  const filename = file.filename || `floor-plan-${randomUUID()}.png`;
  const blob = new Blob([file.buffer], {
    type: file.contentType || "application/octet-stream",
  });

  form.append("file", blob, filename);
  form.append("options", JSON.stringify(options));
  return form;
}

export async function fetchRemoteFile(url) {
  const response = await fetch(url);
  ensureOk(response, "Unable to download the floor plan asset");
  const arrayBuffer = await response.arrayBuffer();
  const contentType =
    response.headers.get("content-type") || "application/octet-stream";
  return {
    buffer: Buffer.from(arrayBuffer),
    contentType,
  };
}

export async function callAiTraceService({ file, options = {} }) {
  if (!file?.buffer?.length) {
    throw new Error("A floor plan file is required before AI mapping can run.");
  }

  const candidates = aiServiceCandidates();
  let lastError = null;

  for (const baseUrl of candidates) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), AI_TRACE_TIMEOUT_MS);
    try {
      console.info(`[ai-trace] Sending floor plan to ${baseUrl}/trace`);
      const response = await fetch(`${baseUrl}/trace`, {
        method: "POST",
        body: buildTraceForm(file, options),
        signal: controller.signal,
        dispatcher: aiTraceDispatcher,
      });

      clearTimeout(timeoutId);
      ensureOk(response, `AI trace service request failed (${baseUrl})`);
      const data = await response.json();
      return normalizeMvf(data);
    } catch (error) {
      clearTimeout(timeoutId);
      lastError = error;
      if (error?.name === "AbortError" || isAiTimeoutError(error)) {
        throw new Error(
          `AI trace service reached ${baseUrl}, but CubiCasa tracing exceeded ${Math.round(
            AI_TRACE_TIMEOUT_MS / 1000,
          )} seconds. Try a smaller floor plan image or increase AI_TRACE_TIMEOUT_MS.`,
        );
      }

      if (!isConnectivityError(error)) {
        throw error;
      }

      const code = error?.cause?.code;
      const detail = code ? ` (${code})` : "";
      console.warn(`[ai-trace] Unable to reach ${baseUrl}${detail}`);
    }
  }

  const message = lastError?.message || "fetch failed";
  const code = lastError?.cause?.code ? ` (${lastError.cause.code})` : "";
  throw new Error(
    `Unable to reach AI trace service. Tried ${candidates.join(", ")}. Last error: ${message}${code}`,
  );
}

export function createUploadedFilePayload(file) {
  if (!file) return null;
  return {
    buffer: file.buffer,
    contentType: file.mimetype,
    filename: file.originalname || path.basename(file.path || "floor-plan.png"),
  };
}
