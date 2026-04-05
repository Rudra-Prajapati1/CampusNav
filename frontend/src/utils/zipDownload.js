function makeCrcTable() {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
}

const CRC_TABLE = makeCrcTable();
const encoder = new TextEncoder();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dataUrlToBytes(dataUrl) {
  const [, payload = ""] = String(dataUrl || "").split(",");
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function pushUint16(buffer, value) {
  buffer.push(value & 0xff, (value >>> 8) & 0xff);
}

function pushUint32(buffer, value) {
  buffer.push(
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  );
}

export function sanitizeFilename(value, fallback = "file") {
  return (
    String(value || "")
      .trim()
      .replace(/[<>:"/\\|?*\x00-\x1f]+/g, "-")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || fallback
  );
}

export function downloadDataUrl(dataUrl, filename) {
  const anchor = document.createElement("a");
  anchor.href = dataUrl;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.click();
}

export function createStoredZip(files = []) {
  const localChunks = [];
  const centralChunks = [];
  let offset = 0;

  files.forEach((file) => {
    const nameBytes = encoder.encode(file.name);
    const dataBytes = file.bytes;
    const checksum = crc32(dataBytes);
    const local = [];

    pushUint32(local, 0x04034b50);
    pushUint16(local, 20);
    pushUint16(local, 0);
    pushUint16(local, 0);
    pushUint16(local, 0);
    pushUint16(local, 0);
    pushUint32(local, checksum);
    pushUint32(local, dataBytes.length);
    pushUint32(local, dataBytes.length);
    pushUint16(local, nameBytes.length);
    pushUint16(local, 0);
    local.push(...nameBytes, ...dataBytes);
    localChunks.push(...local);

    const central = [];
    pushUint32(central, 0x02014b50);
    pushUint16(central, 20);
    pushUint16(central, 20);
    pushUint16(central, 0);
    pushUint16(central, 0);
    pushUint16(central, 0);
    pushUint16(central, 0);
    pushUint32(central, checksum);
    pushUint32(central, dataBytes.length);
    pushUint32(central, dataBytes.length);
    pushUint16(central, nameBytes.length);
    pushUint16(central, 0);
    pushUint16(central, 0);
    pushUint16(central, 0);
    pushUint16(central, 0);
    pushUint32(central, 0);
    pushUint32(central, offset);
    central.push(...nameBytes);
    centralChunks.push(...central);

    offset += local.length;
  });

  const end = [];
  pushUint32(end, 0x06054b50);
  pushUint16(end, 0);
  pushUint16(end, 0);
  pushUint16(end, files.length);
  pushUint16(end, files.length);
  pushUint32(end, centralChunks.length);
  pushUint32(end, localChunks.length);
  pushUint16(end, 0);

  return new Blob(
    [
      new Uint8Array(localChunks),
      new Uint8Array(centralChunks),
      new Uint8Array(end),
    ],
    { type: "application/zip" },
  );
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadQrBatchZip(entries, filename = "campusnav-room-qr.zip") {
  const files = (entries || []).map((entry, index) => ({
    name: `${String(index + 1).padStart(2, "0")}-${sanitizeFilename(entry.room_name || "room")}.png`,
    bytes: dataUrlToBytes(entry.qr),
  }));

  const zip = createStoredZip(files);
  downloadBlob(zip, filename);
}
