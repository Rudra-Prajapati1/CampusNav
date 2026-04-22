import path from "path";
import { randomUUID } from "crypto";

const AI_TRACE_SERVICE_URL =
  process.env.AI_TRACE_SERVICE_URL || "http://localhost:8000";

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

  const form = new FormData();
  const filename = file.filename || `floor-plan-${randomUUID()}.png`;
  const blob = new Blob([file.buffer], {
    type: file.contentType || "application/octet-stream",
  });
  form.append("file", blob, filename);
  form.append("options", JSON.stringify(options));

  const response = await fetch(`${AI_TRACE_SERVICE_URL}/trace`, {
    method: "POST",
    body: form,
  });

  ensureOk(response, "AI trace service request failed");
  const data = await response.json();

  return normalizeMvf(data);
}

export function createUploadedFilePayload(file) {
  if (!file) return null;
  return {
    buffer: file.buffer,
    contentType: file.mimetype,
    filename: file.originalname || path.basename(file.path || "floor-plan.png"),
  };
}
