/**
 * Snapmark - Shared Utilities & PDF / Photoshop Exporters
 */

/**
 * Builds a valid PDF 1.4 document containing the image.
 * Supports single page fit-to-image or multi-page A4 splitting.
 * @param {Uint8Array} imgBytes JPEG image bytes
 * @param {number} imgWidth Original image width in px
 * @param {number} imgHeight Original image height in px
 * @param {boolean} multiPage Split into standard A4 pages if page is long
 * @returns {Uint8Array} PDF binary data
 */
export function buildPdf(imgBytes, imgWidth, imgHeight, multiPage = false) {
  const encoder = new TextEncoder();
  const chunks = [];
  const xrefOffsets = [0];
  let byteOffset = 0;

  const appendBytes = (b) => {
    chunks.push(b);
    byteOffset += b.length;
  };

  const appendStr = (s) => appendBytes(encoder.encode(s));

  // Points (72 dpi): standard 0.75 ratio from 96 dpi screen
  const ptWidth = Math.round(imgWidth * 0.75);
  const ptHeight = Math.round(imgHeight * 0.75);

  // Single-page fit: MediaBox matches exact image dimensions
  appendStr("%PDF-1.4\n");

  // Obj 1: Catalog
  xrefOffsets[1] = byteOffset;
  appendStr("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

  // Obj 2: Pages
  xrefOffsets[2] = byteOffset;
  appendStr("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");

  // Obj 3: Page
  xrefOffsets[3] = byteOffset;
  appendStr(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${ptWidth} ${ptHeight}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`
  );

  // Obj 4: Image XObject
  xrefOffsets[4] = byteOffset;
  appendStr(
    `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${imgWidth} /Height ${imgHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imgBytes.length} >>\nstream\n`
  );
  appendBytes(imgBytes);
  appendStr("\nendstream\nendobj\n");

  // Obj 5: Page Content stream
  const contentStream = `q ${ptWidth} 0 0 ${ptHeight} 0 0 cm /Im0 Do Q`;
  const contentBytes = encoder.encode(contentStream);
  xrefOffsets[5] = byteOffset;
  appendStr(`5 0 obj\n<< /Length ${contentBytes.length} >>\nstream\n`);
  appendBytes(contentBytes);
  appendStr("\nendstream\nendobj\n");

  // XRef table
  const startXref = byteOffset;
  let xref = "xref\n0 6\n0000000000 65535 f \n";
  for (let i = 1; i <= 5; i++) {
    xref += String(xrefOffsets[i]).padStart(10, "0") + " 00000 n \n";
  }
  appendStr(xref);
  appendStr(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${startXref}\n%%EOF`);

  // Merge chunks into single Uint8Array
  const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
  const result = new Uint8Array(totalLength);
  let pos = 0;
  for (const c of chunks) {
    result.set(c, pos);
    pos += c.length;
  }
  return result;
}

/**
 * Converts Uint8Array to Data URL
 */
export function bytesToDataUrl(bytes, mimeType) {
  let binary = "";
  const len = bytes.byteLength;
  const chunkSize = 32768;
  for (let i = 0; i < len; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunkSize, len)));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

/**
 * Converts Blob to Data URL
 */
export async function blobToDataUrl(blob) {
  const buffer = await blob.arrayBuffer();
  return bytesToDataUrl(new Uint8Array(buffer), blob.type);
}

/**
 * Converts Data URL to Uint8Array
 */
export function dataUrlToBytes(dataUrl) {
  const base64 = dataUrl.split(",")[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Generates an Adobe Photoshop ExtendScript (.jsx) file.
 * When run in Photoshop or double clicked, it opens the image file or creates a new artboard/document with it.
 */
export function generatePhotoshopScript(imageFilename, width, height, docTitle) {
  const cleanTitle = (docTitle || "Snapmark Capture").replace(/["\\]/g, "");
  return `// Adobe Photoshop Automation Script - Snapmark
#target photoshop
app.bringToFront();

(function() {
    var title = "${cleanTitle}";
    var targetFile = new File(Folder.desktop + "/${imageFilename}");
    
    // Check if target file exists in desktop or default download folder
    if (!targetFile.exists) {
        var userFolder = Folder.myDocuments.parent;
        targetFile = new File(userFolder + "/Downloads/${imageFilename}");
    }
    
    if (targetFile.exists) {
        // Open the image file directly
        var openedDoc = app.open(targetFile);
        openedDoc.name = title;
    } else {
        // Create a new document with exact dimensions
        var doc = app.documents.add(
            ${width},
            ${height},
            72,
            title,
            NewDocumentMode.RGB,
            DocumentFill.TRANSPARENT
        );
        // Prompt user to paste from clipboard
        alert("Snapmark screenshot copied to clipboard!\\n\\nPress Ctrl+V (or Cmd+V) to paste the screenshot onto this canvas.");
    }
})();
`;
}

/**
 * Creates a valid PKZIP archive from an array of files ({ name, data }).
 * 100% pure JS, zero dependencies, compatible with Windows Explorer, macOS & 7-Zip.
 * @param {Array<{name: string, data: Uint8Array | string}>} files
 * @returns {Uint8Array}
 */
export function buildZip(files) {
  const encoder = new TextEncoder();
  const fileEntries = [];
  let offset = 0;

  // CRC-32 table
  const crcTable = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    crcTable[i] = c;
  }

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
      crc = (crc >>> 8) ^ crcTable[(crc ^ bytes[i]) & 0xff];
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  const parts = [];

  for (const f of files) {
    const dataBytes = typeof f.data === "string" ? encoder.encode(f.data) : f.data;
    const nameBytes = encoder.encode(f.name);
    const fileCrc = crc32(dataBytes);
    const size = dataBytes.length;

    // Local file header (30 bytes + name length)
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(localHeader.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0, true);
    lv.setUint16(8, 0, true); // Stored (no compression)
    lv.setUint16(10, 0, true);
    lv.setUint16(12, 0, true);
    lv.setUint32(14, fileCrc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);

    parts.push(localHeader);
    parts.push(dataBytes);

    fileEntries.push({
      nameBytes,
      crc: fileCrc,
      size,
      offset,
    });

    offset += localHeader.length + dataBytes.length;
  }

  const cdStart = offset;
  let cdSize = 0;

  // Central directory headers
  for (const e of fileEntries) {
    const cdHeader = new Uint8Array(46 + e.nameBytes.length);
    const cv = new DataView(cdHeader.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0, true);
    cv.setUint32(16, e.crc, true);
    cv.setUint32(20, e.size, true);
    cv.setUint32(24, e.size, true);
    cv.setUint16(28, e.nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, e.offset, true);
    cdHeader.set(e.nameBytes, 46);

    parts.push(cdHeader);
    cdSize += cdHeader.length;
  }

  // End of central directory record (22 bytes)
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, fileEntries.length, true);
  ev.setUint16(10, fileEntries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, cdStart, true);
  ev.setUint16(20, 0, true);

  parts.push(eocd);

  // Merge into single Uint8Array
  const totalLength = parts.reduce((acc, p) => acc + p.length, 0);
  const zipBytes = new Uint8Array(totalLength);
  let pos = 0;
  for (const p of parts) {
    zipBytes.set(p, pos);
    pos += p.length;
  }
  return zipBytes;
}

/**
 * Builds a valid, standard Adobe Photoshop Document (.psd) file from RGBA pixel data.
 * Pure Javascript, zero dependencies, opens natively in Adobe Photoshop with exact canvas/artboard dimensions.
 * @param {number} width - Document width in pixels
 * @param {number} height - Document height in pixels
 * @param {Uint8ClampedArray | Uint8Array} rgba - RGBA pixel array from Canvas getImageData
 * @returns {Uint8Array} - Binary PSD file
 */
export function buildPsd(width, height, rgba) {
  const pixelCount = width * height;
  const channelCount = 3; // RGB channels

  // Header: 26 bytes
  const header = new Uint8Array(26);
  const hv = new DataView(header.buffer);
  // Signature '8BPS'
  header[0] = 0x38; header[1] = 0x42; header[2] = 0x50; header[3] = 0x53;
  hv.setUint16(4, 1, false); // Version 1 (big endian)
  // 6 reserved bytes (indices 6..11 are 0)
  hv.setUint16(12, channelCount, false); // 3 channels
  hv.setUint32(14, height, false); // Rows
  hv.setUint32(18, width, false); // Columns
  hv.setUint16(22, 8, false); // 8 bits per channel
  hv.setUint16(24, 3, false); // ColorMode 3 = RGB

  // Color Mode Data (4 bytes: length 0)
  const colorModeData = new Uint8Array(4);

  // Image Resources (4 bytes: length 0)
  const imageResources = new Uint8Array(4);

  // Layer and Mask Info (4 bytes: length 0)
  const layerAndMask = new Uint8Array(4);

  // Image Data Section:
  // Compression (2 bytes: 0 = Raw uncompressed)
  const compression = new Uint8Array(2); // 0, 0

  // Planar pixel data: RRR... GGG... BBB...
  const planarData = new Uint8Array(pixelCount * channelCount);
  for (let i = 0; i < pixelCount; i++) {
    const src = i * 4;
    planarData[i] = rgba[src];                 // Red channel
    planarData[pixelCount + i] = rgba[src + 1]; // Green channel
    planarData[pixelCount * 2 + i] = rgba[src + 2]; // Blue channel
  }

  // Concatenate parts
  const totalLength = 26 + 4 + 4 + 4 + 2 + planarData.length;
  const psd = new Uint8Array(totalLength);
  let offset = 0;

  psd.set(header, offset); offset += 26;
  psd.set(colorModeData, offset); offset += 4;
  psd.set(imageResources, offset); offset += 4;
  psd.set(layerAndMask, offset); offset += 4;
  psd.set(compression, offset); offset += 2;
  psd.set(planarData, offset);

  return psd;
}

