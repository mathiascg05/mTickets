import { chromium, type Browser } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  TERMS_VERSION,
  TERMS_EFFECTIVE_DATE,
  ORGANIZER_TERMS_VERSION,
  ORGANIZER_TERMS_EFFECTIVE_DATE,
  PRIVACY_VERSION,
  PRIVACY_EFFECTIVE_DATE,
  LEGAL_CONTACT_EMAIL,
} from "../src/lib/legalVersions";

type LegalDoc = {
  slug: string;
  title: string;
  path: string;
  version: string;
  effectiveDate: string;
};

const BASE_URL = process.env.LEGAL_PDF_BASE_URL ?? "http://localhost:3000";

const DOCS: LegalDoc[] = [
  {
    slug: "terms",
    title: "Términos y Condiciones para Compradores",
    path: "/terms",
    version: TERMS_VERSION,
    effectiveDate: TERMS_EFFECTIVE_DATE,
  },
  {
    slug: "privacy",
    title: "Política de Privacidad",
    path: "/privacy",
    version: PRIVACY_VERSION,
    effectiveDate: PRIVACY_EFFECTIVE_DATE,
  },
  {
    slug: "terminos-organizador",
    title: "Términos del Organizador",
    path: "/terminos-organizador",
    version: ORGANIZER_TERMS_VERSION,
    effectiveDate: ORGANIZER_TERMS_EFFECTIVE_DATE,
  },
];

const PRINT_HIDE_CSS = `
  header.sticky, header[class*="sticky"] { display: none !important; }
  main { padding-top: 0 !important; }
  main > div:last-child { display: none !important; }
  a { color: inherit !important; text-decoration: underline; }
  body { background: #ffffff !important; }
`;

const PDF_MARGIN = {
  top: "20mm",
  bottom: "22mm",
  left: "18mm",
  right: "18mm",
};

function footerTemplate(docTitle: string, version: string): string {
  const safeTitle = docTitle.replace(/"/g, "&quot;");
  return `
    <div style="font-size:9px; color:#666; width:100%; padding:0 18mm; display:flex; justify-content:space-between; font-family: -apple-system, sans-serif;">
      <span>${safeTitle} · v${version}</span>
      <span>Página <span class="pageNumber"></span> de <span class="totalPages"></span></span>
    </div>
  `;
}

const HEADER_TEMPLATE = `<div style="display:none;"></div>`;

function coverHtml(generatedAt: string): string {
  const rows = DOCS.map(
    (d) => `
      <tr>
        <td style="padding:10px 12px; border-bottom:1px solid #e5e7eb;">${d.title}</td>
        <td style="padding:10px 12px; border-bottom:1px solid #e5e7eb; color:#6b7280;">v${d.version}</td>
        <td style="padding:10px 12px; border-bottom:1px solid #e5e7eb; color:#6b7280;">Vigente desde ${d.effectiveDate}</td>
      </tr>`
  ).join("");

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Documentos Legales — maTickets</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: #111827;
    padding: 60mm 20mm 20mm 20mm;
  }
  .brand {
    font-size: 28px;
    font-weight: 700;
    letter-spacing: 0.5px;
    margin-bottom: 8px;
  }
  .brand span { color: #9ca3af; }
  h1 {
    font-size: 36px;
    font-weight: 700;
    margin: 24px 0 12px 0;
    line-height: 1.15;
  }
  .subtitle {
    color: #6b7280;
    font-size: 14px;
    margin-bottom: 48px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 12px;
    font-size: 13px;
  }
  th {
    text-align: left;
    padding: 10px 12px;
    border-bottom: 2px solid #111827;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: #6b7280;
  }
  td { font-size: 13px; vertical-align: top; }
  .footer {
    margin-top: 64px;
    padding-top: 16px;
    border-top: 1px solid #e5e7eb;
    color: #6b7280;
    font-size: 12px;
    line-height: 1.6;
  }
  .footer strong { color: #111827; }
</style>
</head>
<body>
  <div class="brand">ma<span>Tickets</span></div>
  <h1>Documentos Legales</h1>
  <p class="subtitle">Compilación oficial · Generado el ${generatedAt}</p>

  <table>
    <thead>
      <tr>
        <th>Documento</th>
        <th>Versión</th>
        <th>Vigencia</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="footer">
    Este documento reúne los términos legales actualmente vigentes en la plataforma maTickets.
    Cada sección puede consultarse también en línea en su URL pública.<br/>
    Contacto legal: <strong>${LEGAL_CONTACT_EMAIL}</strong>
  </div>
</body>
</html>`;
}

async function renderPagePdf(
  browser: Browser,
  url: string,
  doc: LegalDoc
): Promise<Uint8Array> {
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });
  await page.emulateMedia({ media: "print" });
  await page.addStyleTag({ content: PRINT_HIDE_CSS });
  const pdf = await page.pdf({
    format: "A4",
    printBackground: true,
    margin: PDF_MARGIN,
    displayHeaderFooter: true,
    headerTemplate: HEADER_TEMPLATE,
    footerTemplate: footerTemplate(doc.title, doc.version),
  });
  await page.close();
  return pdf;
}

async function renderCoverPdf(browser: Browser, generatedAt: string): Promise<Uint8Array> {
  const page = await browser.newPage();
  await page.setContent(coverHtml(generatedAt), { waitUntil: "networkidle" });
  await page.emulateMedia({ media: "print" });
  const pdf = await page.pdf({
    format: "A4",
    printBackground: true,
    margin: { top: "0", bottom: "0", left: "0", right: "0" },
  });
  await page.close();
  return pdf;
}

async function mergePdfs(buffers: Uint8Array[]): Promise<Uint8Array> {
  const merged = await PDFDocument.create();
  for (const buf of buffers) {
    const src = await PDFDocument.load(buf);
    const pages = await merged.copyPages(src, src.getPageIndices());
    for (const p of pages) merged.addPage(p);
  }
  return merged.save();
}

async function main(): Promise<void> {
  const generatedAt = new Date().toLocaleDateString("es-VE", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  console.log(`→ Generando PDF legal desde ${BASE_URL}`);
  const browser = await chromium.launch();

  try {
    const cover = await renderCoverPdf(browser, generatedAt);
    console.log("  ✓ Portada lista");

    const docPdfs: Uint8Array[] = [];
    for (const doc of DOCS) {
      const url = `${BASE_URL}${doc.path}`;
      console.log(`  · Renderizando ${doc.path} ...`);
      const pdf = await renderPagePdf(browser, url, doc);
      docPdfs.push(pdf);
      console.log(`  ✓ ${doc.title}`);
    }

    const merged = await mergePdfs([cover, ...docPdfs]);

    const outDir = resolve(process.cwd(), "legal");
    await mkdir(outDir, { recursive: true });
    const outFile = resolve(outDir, `matickets-legal-${TERMS_VERSION}.pdf`);
    await writeFile(outFile, merged);

    console.log(`\n✅ PDF generado: ${outFile}`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("\n✗ Error generando PDF legal:", err);
  process.exit(1);
});
