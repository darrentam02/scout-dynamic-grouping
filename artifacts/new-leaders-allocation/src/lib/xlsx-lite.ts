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

function xmlText(node: Element, name: string) {
  return Array.from(node.getElementsByTagNameNS("*", name))
    .map((part) => part.textContent ?? "")
    .join("");
}

function columnIndexFromName(name: string) {
  return [...name.toUpperCase()].reduce((total, character) => total * 26 + character.charCodeAt(0) - 64, 0) - 1;
}

function cellValue(cell: Element, sharedStrings: string[]) {
  const type = cell.getAttribute("t");
  const value = xmlText(cell, "v").trim();
  if (type === "s" && value && Number.isInteger(Number(value))) return sharedStrings[Number(value)] ?? "";
  if (type === "inlineStr") return xmlText(cell, "t").trim();
  if (type === "b") return value === "1" ? "TRUE" : "FALSE";
  return value || xmlText(cell, "t").trim();
}

function readWorksheetRows(worksheet: Uint8Array, sharedStrings: string[]) {
  const doc = new DOMParser().parseFromString(decoder.decode(worksheet), "application/xml");
  return Array.from(doc.getElementsByTagNameNS("*", "row")).map((row) => {
    const values: string[] = [];
    Array.from(row.children)
      .filter((cell) => cell.localName === "c")
      .forEach((cell) => {
        const reference = cell.getAttribute("r")?.match(/^[A-Z]+/i)?.[0];
        if (reference) values[columnIndexFromName(reference)] = cellValue(cell, sharedStrings);
      });
    return { rowNumber: Number(row.getAttribute("r")) || 0, values };
  });
}

function normalizedHeader(value: string) {
  return value.replace(/^\uFEFF/, "").trim().toLowerCase();
}

function findHeaderIndex(headers: string[], field: "name" | "gender" | "preference") {
  const label = field === "name" ? "(?:leader\\s+)?name" : field;
  const pattern = new RegExp(`^(?:${label}|[a-z]+\\s*\\(${field}\\))$`, "i");
  return headers.findIndex((header) => pattern.test(normalizedHeader(header)));
}

function expertiseIndexFromHeader(header: string) {
  const normalized = normalizedHeader(header);
  const numbered = normalized.match(/^(?:e|expertise)[ _-]*0?([1-9]|1[0-9]|20)\b/);
  if (numbered) return Number(numbered[1]) - 1;
  const column = normalized.match(/^([a-z]+)\s*\(/)?.[1];
  if (!column) return -1;
  const index = columnIndexFromName(column);
  return index >= 4 && index <= 23 ? index - 4 : -1;
}

function normalizePreference(value: string): "P1P2" | "P3P4" | "P5P6" | "NONE" {
  const compact = normalizedHeader(value).replace(/[–—−]/g, "-").replace(/\s+/g, "");
  if (/^p1-?2$/.test(compact) || compact === "p1p2") return "P1P2";
  if (/^p3-?4$/.test(compact) || compact === "p3p4") return "P3P4";
  if (/^p5-?6$/.test(compact) || compact === "p5p6") return "P5P6";
  return "NONE";
}

function isEnabled(value: string) {
  return /^(?:yes|y|true|1|x|on|✓|✔)$/i.test(value.trim());
}

export async function parseParticipantWorkbook(file: File) {
  const entries = await readZipEntries(await file.arrayBuffer());
  const sharedStringsFile = entries.get("xl/sharedStrings.xml");
  const sharedStrings = sharedStringsFile
    ? Array.from(new DOMParser().parseFromString(decoder.decode(sharedStringsFile), "application/xml").getElementsByTagNameNS("*", "si"))
      .map((item) => xmlText(item, "t"))
    : [];

  const worksheetEntries = [...entries.entries()]
    .filter(([name]) => /^xl\/worksheets\/[^/]+\.xml$/i.test(name))
    .sort(([left], [right]) => left.localeCompare(right));

  for (const [, worksheet] of worksheetEntries) {
    const rows = readWorksheetRows(worksheet, sharedStrings);
    const headerRow = rows.find((candidate) => {
      const headers = candidate.values.map((value) => value ?? "");
      const requiredIndexes = [
        findHeaderIndex(headers, "name"),
        findHeaderIndex(headers, "gender"),
        findHeaderIndex(headers, "preference"),
      ];
      return requiredIndexes.every((index) => index >= 0) && new Set(requiredIndexes).size === requiredIndexes.length;
    });
    if (!headerRow) continue;

    const headers = headerRow.values.map((value) => value ?? "");
    const nameIndex = findHeaderIndex(headers, "name");
    const genderIndex = findHeaderIndex(headers, "gender");
    const preferenceIndex = findHeaderIndex(headers, "preference");
    const expertiseIndexes = Array.from({ length: 20 }, () => -1);
    headers.forEach((header, index) => {
      const expertiseIndex = expertiseIndexFromHeader(header);
      if (expertiseIndex >= 0 && expertiseIndex < 20) expertiseIndexes[expertiseIndex] = index;
    });

    // If a workbook uses unlabelled expertise columns, keep compatibility with
    // the template's fixed layout: the 20 columns immediately after preference.
    if (expertiseIndexes.some((index) => index < 0) && preferenceIndex >= 0) {
      expertiseIndexes.forEach((index, expertiseIndex) => {
        if (index < 0) expertiseIndexes[expertiseIndex] = preferenceIndex + 1 + expertiseIndex;
      });
    }

    return rows
      .filter((candidate) => candidate.rowNumber > headerRow.rowNumber && candidate.values.some(Boolean))
      .map((candidate) => {
        const row = candidate.values;
        const valueAt = (index: number) => (index >= 0 ? row[index]?.trim() ?? "" : "");
        const rawGender = valueAt(genderIndex).toLowerCase();
        const gender: "Male" | "Female" = rawGender === "male" || rawGender === "m" ? "Male" : "Female";
        return {
          row: candidate.rowNumber,
          name: valueAt(nameIndex),
          gender,
          preference: normalizePreference(valueAt(preferenceIndex)),
          expertise: expertiseIndexes.map((index) => isEnabled(valueAt(index)) ? 1 : 0),
        };
      })
      .filter((participant) => participant.name);
  }

  throw new Error("No worksheet with Name, Gender and Preference columns was found. Upload the downloaded template or an Excel sheet with Name, Gender, Preference and E1–E20 columns.");
}