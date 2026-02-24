/**
 * PDF text extraction using unpdf (pdfjs-dist under the hood).
 * Replaces pdfplumber + PyMuPDF from the Python backend.
 */

export interface ExtractedDocument {
  text: string; // full plain-text, pages separated by \n---PAGE---\n
  pages: number;
  tables: string[][][]; // always empty in Workers (no table extraction lib)
  needsOcr: boolean;
}

export async function extract(pdfBytes: ArrayBuffer): Promise<ExtractedDocument> {
  const { getDocumentProxy } = await import("unpdf");

  const uint8 = new Uint8Array(pdfBytes);
  const doc = await getDocumentProxy(uint8);

  const pageTexts: string[] = [];

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();

    // Reconstruct text preserving line breaks based on y-coordinate changes
    let lastY: number | null = null;
    let lineText = "";
    const lines: string[] = [];

    for (const item of content.items as any[]) {
      if (!item.str && item.str !== "") continue;
      const y = item.transform ? item.transform[5] : null;
      if (lastY !== null && y !== null && Math.abs(y - lastY) > 3) {
        lines.push(lineText);
        lineText = "";
      }
      lineText += item.str;
      lastY = y;
    }
    if (lineText) lines.push(lineText);

    pageTexts.push(lines.join("\n"));
  }

  const fullText = pageTexts.join("\n---PAGE---\n");
  const needsOcr = fullText.trim().length < 50;

  return {
    text: fullText,
    pages: doc.numPages,
    tables: [], // Table extraction not available in Workers runtime
    needsOcr,
  };
}
