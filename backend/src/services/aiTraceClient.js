import path from "path";
import { randomUUID } from "crypto";

const AI_TRACE_SERVICE_URL =
  process.env.AI_TRACE_SERVICE_URL || "http://localhost:8001";

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

  return {
    walls: Array.isArray(data.walls) ? data.walls : [],
    doors: Array.isArray(data.doors) ? data.doors : [],
    windows: Array.isArray(data.windows) ? data.windows : [],
    rooms: Array.isArray(data.rooms) ? data.rooms : [],
    nodes: Array.isArray(data.nodes) ? data.nodes : [],
    edges: Array.isArray(data.edges) ? data.edges : [],
    objects: Array.isArray(data.objects) ? data.objects : [],
  };
}

export function createUploadedFilePayload(file) {
  if (!file) return null;
  return {
    buffer: file.buffer,
    contentType: file.mimetype,
    filename: file.originalname || path.basename(file.path || "floor-plan.png"),
  };
}
