const encoder = new TextEncoder();
const decoder = new TextDecoder();

type ZipEntry = { name: string; data: Uint8Array };

function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function concat(parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  parts.forEach((part) => { out.set(part, offset); offset += part.length; });
  return out;
}

function u16(value: number) {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, true);
  return bytes;
}

function u32(value: number) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}

function zipStore(entries: ZipEntry[]) {
  let offset = 0;
  const locals: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const checksum = crc32(entry.data);
    locals.push(concat([u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(checksum), u32(entry.data.length), u32(entry.data.length), u16(name.length), u16(0), name, entry.data]));
    central.push(concat([u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(checksum), u32(entry.data.length), u32(entry.data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name]));
    offset += locals[locals.length - 1].length;
  }
  const body = concat(locals);
  const directory = concat(central);
  return concat([body, directory, u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(directory.length), u32(body.length), u16(0)]);
}

function escapeXml(value: string) {
  return value.replace(/[<>&'"]/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[char] ?? char);
}

function columnName(index: number) {
  let value = index + 1;
  let name = "";
  while (value) { const rest = (value - 1) % 26; name = String.fromCharCode(65 + rest) + name; value = Math.floor((value - 1) / 26); }
  return name;
}

function worksheetXml(rows: string[][]) {
  const body = rows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((value, colIndex) => `<c r="${columnName(colIndex)}${rowIndex + 1}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`).join("")}</row>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

export function createParticipantTemplate() {
  const headers = ["name", "gender", "preference", ...Array.from({ length: 20 }, (_, index) => `expertise_${String(index + 1).padStart(2, "0")}`)];
  const sample = ["陳美儀", "Female", "P5P6", "1", "0", "0", "0", "0", "0", "1", "0", "0", "0", "0", "0", "0", "1", "0", "0", "0", "0", "0", "0"];
  const entries: ZipEntry[] = [
    { name: "[Content_Types].xml", data: encoder.encode(`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`) },
    { name: "_rels/.rels", data: encoder.encode(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`) },
    { name: "xl/workbook.xml", data: encoder.encode(`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Participants" sheetId="1" r:id="rId1"/></sheets></workbook>`) },
    { name: "xl/_rels/workbook.xml.rels", data: encoder.encode(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`) },
    { name: "xl/worksheets/sheet1.xml", data: encoder.encode(worksheetXml([headers, sample])) },
  ];
  return new Blob([zipStore(entries)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

async function inflateRaw(input: Uint8Array) {
  const raw = input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) as ArrayBuffer;
  const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readZipEntries(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const entries = new Map<string, Uint8Array>();
  let offset = 0;
  while (offset + 30 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    const method = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const name = decoder.decode(bytes.slice(offset + 30, offset + 30 + nameLength));
    const start = offset + 30 + nameLength + extraLength;
    const packed = bytes.slice(start, start + compressedSize);
    entries.set(name, method === 8 ? await inflateRaw(packed) : packed);
    offset = start + compressedSize;
  }
  return entries;
}

export async function parseParticipantWorkbook(file: File) {
  const entries = await readZipEntries(await file.arrayBuffer());
  const worksheet = entries.get("xl/worksheets/sheet1.xml");
  if (!worksheet) throw new Error("The workbook must include a first worksheet.");
  const doc = new DOMParser().parseFromString(decoder.decode(worksheet), "application/xml");
  const rows = Array.from(doc.querySelectorAll("row")).map((row) => Array.from(row.querySelectorAll("c")).map((cell) => cell.querySelector("t")?.textContent?.trim() ?? cell.querySelector("v")?.textContent?.trim() ?? ""));
  const [headers = [], ...data] = rows;
  const indexes = new Map(headers.map((header, index) => [header.trim().toLowerCase(), index]));
  if (!indexes.has("name") || !indexes.has("gender") || !indexes.has("preference")) throw new Error("Use the downloaded template so Name, Gender and Preference are present.");
  return data.filter((row) => row.some(Boolean)).map((row, index) => {
    const value = (key: string) => row[indexes.get(key) ?? -1]?.trim() ?? "";
    const gender: "Male" | "Female" = value("gender").toLowerCase() === "male" ? "Male" : "Female";
    const rawPreference = value("preference").toUpperCase();
    const preference = (["P1P2", "P3P4", "P5P6", "NONE"].includes(rawPreference) ? rawPreference : "NONE") as "P1P2" | "P3P4" | "P5P6" | "NONE";
    return {
      row: index + 2,
      name: value("name"),
      gender,
      preference,
      expertise: Array.from({ length: 20 }, (_, expertiseIndex) => Number(value(`expertise_${String(expertiseIndex + 1).padStart(2, "0")}`)) ? 1 : 0),
    };
  }).filter((participant) => participant.name);
}