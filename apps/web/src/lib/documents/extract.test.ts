import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DocumentError, docxText, pdfText, tidy } from "./extract";
import { documentKind } from "./kind";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

describe("documentKind", () => {
  it("knows PDFs and .docx by type or name, and nothing else", () => {
    expect(documentKind("quote.pdf", "")).toBe("pdf");
    expect(documentKind("scan", "application/pdf")).toBe("pdf");
    expect(documentKind("Spec.DOCX", "")).toBe("docx");
    expect(documentKind("old.doc", "application/msword")).toBeNull();
    expect(documentKind("notes.md", "text/markdown")).toBeNull();
  });
});

describe("pdfText", () => {
  it("reads every page, marked, from a PDF made by LibreOffice", async () => {
    const { text, pages } = await pdfText(fixture("quote.pdf"));
    expect(pages).toBe(2);
    expect(text).toMatch(/^\[Page 1\]\n/);
    // A table cell that wrapped in the layout comes out a line at a time, as pdf.js reads it.
    expect(text.replace(/\s+/g, " ")).toContain("Seagate IronWolf Pro 16TB ST16000NT001 $289.00");
    expect(text).toMatch(/\[Page 2\]\n[\s\S]*Sales tax 6\.25% not included/);
  });

  it("says a PDF with no text may be a scan", async () => {
    await expect(pdfText(fixture("scan.pdf"))).rejects.toThrow("may be a scan");
  });

  it("refuses what isn't a PDF, and a broken one", async () => {
    await expect(pdfText(new TextEncoder().encode("hello"))).rejects.toThrow(DocumentError);
    const broken = fixture("quote.pdf").slice(0, 400);
    await expect(pdfText(broken)).rejects.toThrow(DocumentError);
  });
});

describe("docxText", () => {
  it("reads a Word file's text, tables included", async () => {
    const { text, pages } = await docxText(fixture("quote.docx"));
    expect(pages).toBeUndefined();
    expect(text).toContain("Northside Computer Supply");
    expect(text).toContain("WD Red Pro 24TB WD240KFGX");
    expect(text).toContain("buy either drive line, not both");
  });

  it("refuses what isn't a .docx", async () => {
    await expect(docxText(fixture("quote.pdf"))).rejects.toThrow("isn't a Word (.docx) file");
    await expect(docxText(new TextEncoder().encode("PK not a zip"))).rejects.toThrow(DocumentError);
  });
});

describe("tidy", () => {
  it("drops NULs and invisible characters, and squeezes blank lines", () => {
    const [nul, zwsp, bom] = [0, 0x200b, 0xfeff].map((c) => String.fromCharCode(c));
    expect(tidy(`a${nul}b${zwsp} c  \n\n\n\nd${bom}`)).toBe("ab c\n\nd");
  });
});
