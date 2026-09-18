import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import {
  detectColumns,
  detectInSheets,
  guessHeaderRow,
  readSheet,
  toCsvRows,
  parseLocaleAmount,
  routeFile,
} from "@/components/admin/reconcile/sheet";
import { adaptCsvResult } from "@/components/admin/reconcile/adaptCsvResult";

const veCsvRows = [
  ["Banco Nacional de Prueba", "", "", "", ""],
  ["Cuenta 0102-****-4521", "", "", "", ""],
  ["Fecha", "Referencia", "Descripción", "Débito", "Crédito"],
  ["01/09/2026", "000981234", "PAGO MOVIL DE ANA", "", "1.000,00"],
  ["01/09/2026", "000007777", "COMISION", "45,00", ""],
  ["02/09/2026", "005522221", "PAGO MOVIL DE LUIS", "", "3.000,00"],
];

describe("detectColumns (camino directo sin IA)", () => {
  it("CSV venezolano: salta las líneas de título y prefiere la columna Crédito", () => {
    expect(detectColumns(veCsvRows, "pago_movil")).toEqual({ headerRow: 2, refCol: 1, amountCol: 4 });
  });

  it("CSV estadounidense de Zelle: memo en Description y monto en Credit", () => {
    const rows = [
      ["Date", "Description", "Reference", "Debit", "Credit"],
      ["09/10/2026", "ZELLE FROM ANA MT-ABCDE", "ZL1", "", "$15.00"],
      ["09/11/2026", "ZELLE TO VENDOR", "ZL2", "$60.00", ""],
    ];
    expect(detectColumns(rows, "zelle")).toEqual({ headerRow: 0, refCol: 1, amountCol: 4 });
  });

  it("Zelle sin ningún MT-XXXXX en la columna → no es limpio (va al asistente)", () => {
    const rows = [
      ["Date", "Description", "Amount"],
      ["09/10/2026", "ZELLE FROM ANA", "15.00"],
    ];
    expect(detectColumns(rows, "zelle")).toBeNull();
  });

  it("dos columnas de monto genéricas → ambiguo → null", () => {
    const rows = [
      ["Referencia", "Monto Bs", "Monto USD"],
      ["00981234", "1.000,00", "10,00"],
    ];
    expect(detectColumns(rows, "pago_movil")).toBeNull();
  });

  it("columna 'referencia' sin dígitos (es otra cosa) → null", () => {
    const rows = [
      ["Referencia", "Monto"],
      ["PAGO A PROVEEDOR", "100,00"],
      ["PAGO MOVIL", "200,00"],
    ];
    expect(detectColumns(rows, "pago_movil")).toBeNull();
  });

  it("muchos montos ilegibles → null", () => {
    const rows = [["Referencia", "Monto"], ...Array.from({ length: 10 }, (_, i) => [`0000${1000 + i}`, i < 3 ? "abc" : "10,00"])];
    expect(detectColumns(rows, "pago_movil")).toBeNull();
  });

  it("el saldo nunca se toma como monto", () => {
    const rows = [
      ["Referencia", "Saldo", "Monto"],
      ["00981234", "99.999,00", "1.000,00"],
    ];
    expect(detectColumns(rows, "pago_movil")).toEqual({ headerRow: 0, refCol: 0, amountCol: 2 });
  });

  it("un mapeo guardado con nombres propios del banco tiene prioridad", () => {
    const rows = [
      ["Fecha", "Nro Operación", "Importe Abonado Bs"],
      ["01/09", "000981234", "1.000,00"],
    ];
    expect(detectColumns(rows, "pago_movil")).toBeNull();
    expect(detectColumns(rows, "pago_movil", { ref: "Nro Operación", amount: "Importe Abonado Bs" })).toEqual({
      headerRow: 0, refCol: 1, amountCol: 2,
    });
  });

  it("busca en todas las hojas del Excel", () => {
    const r = detectInSheets([{ name: "Resumen", rows: [["Total"], ["1"]] }, { name: "Movs", rows: veCsvRows }], "pago_movil");
    expect(r?.sheet).toBe(1);
  });
});

describe("toCsvRows (igual que el flujo clásico)", () => {
  it("solo montos > 0 con referencia; el resto se cuenta como ignorado", () => {
    const m = detectColumns(veCsvRows, "pago_movil")!;
    expect(toCsvRows(veCsvRows, m)).toEqual({
      rows: [
        { reference: "000981234", amount: 1000 },
        { reference: "005522221", amount: 3000 },
      ],
      ignored: 1,
    });
  });

  it("guessHeaderRow elige la fila con más celdas llenas", () => {
    expect(guessHeaderRow(veCsvRows)).toBe(2);
  });

  it("parseLocaleAmount conserva el comportamiento del clásico", () => {
    expect(parseLocaleAmount("1.000,00")).toBe(1000);
    expect(parseLocaleAmount("$1,234.56")).toBe(1234.56);
    expect(parseLocaleAmount("-45,00")).toBe(-45);
  });
});

describe("readSheet", () => {
  it("CSV en Windows-1252 conserva acentos y detecta ';'", async () => {
    const latin1 = Buffer.from("Fecha;Referencia;Descripción;Crédito\r\n01/09;000981234;PAGO DE MARÍA;1.000,00\r\n", "latin1");
    const { sheets } = await readSheet(new File([latin1], "banco.csv"));
    expect(sheets[0].rows[0]).toEqual(["Fecha", "Referencia", "Descripción", "Crédito"]);
    expect(sheets[0].rows[1][2]).toBe("PAGO DE MARÍA");
    expect(detectColumns(sheets[0].rows, "pago_movil")).toEqual({ headerRow: 0, refCol: 1, amountCol: 3 });
  });

  it("Excel: lee todas las hojas y devuelve también el texto para el asistente", async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Resumen"]]), "Resumen");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Referencia", "Crédito"], ["000981234", 1000]]), "Movs");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    const { sheets, text } = await readSheet(new File([buf], "banco.xlsx"));
    expect(sheets.map((s) => s.name)).toEqual(["Resumen", "Movs"]);
    expect(detectInSheets(sheets, "pago_movil")).toEqual({ sheet: 1, mapping: { headerRow: 0, refCol: 0, amountCol: 1 } });
    expect(text).toContain("# Movs");
  });
});

describe("adaptCsvResult (misma pantalla de revisión)", () => {
  it("agrupa exactos por fila, traduce motivos por código y cuenta pendientes", () => {
    const rows = [
      { reference: "000981234", amount: 1000 },
      { reference: "005522222", amount: 3000 },
      { reference: "000009999", amount: 50 },
    ];
    const r = adaptCsvResult(
      {
        matched: [
          { orderId: "a", orderNumber: "T-1", firstName: "Ana", lastName: "Paz", orderRef: "MT-AAAAA-1234", orderAmount: 1000, rowIndex: 0 },
          { orderId: "b1", orderNumber: "T-2", firstName: "Luis", lastName: "Mora", orderRef: "MT-BBBBB-2222", orderAmount: 1000, rowIndex: 1 },
          { orderId: "b2", orderNumber: "T-3", firstName: "Luis2", lastName: "Mora", orderRef: "MT-BBBBB-2222", orderAmount: 1000, rowIndex: 1 },
        ],
        unmatched: [{ code: "NO_MATCH", rowIndex: 2 }],
        totalPending: 7,
      },
      rows,
      4,
      "pago_movil",
    );
    expect(r.source).toBe("csv");
    expect(r.exactos.map((e) => e.orders.length)).toEqual([1, 2]);
    expect(r.exactos[1].bank).toMatchObject({ reference: "005522222", amount: 3000 });
    expect(r.sinMatch).toEqual([{ bank: expect.objectContaining({ rowIndex: 2, amount: 50 }), code: "NO_MATCH", expectedAmount: null }]);
    expect(r.pendingLeft).toBe(4);
    expect(r.counts).toEqual({ credits: 3, creditsTotal: 4050, debitsIgnored: 4 });
    expect(r.sugerencias).toEqual([]);
  });
});


describe("routeFile (enrutamiento del botón único)", () => {
  const r = (fileName: string, aiAvailable: boolean, sheetsOnly: boolean, columnsDetected: boolean) =>
    routeFile({ fileName, aiAvailable, sheetsOnly, columnsDetected }).kind;

  it("hoja con columnas reconocidas → directo al matcher, con o sin asistente", () => {
    expect(r("banco.csv", true, false, true)).toBe("csv");
    expect(r("banco.xlsx", false, false, true)).toBe("csv");
  });
  it("hoja ambigua → asistente si está disponible; si no, mapeo manual", () => {
    expect(r("banco.csv", true, false, false)).toBe("ai");
    expect(r("banco.xls", false, false, false)).toBe("map");
  });
  it("tras un fallo del asistente (solo hojas) → mapeo manual, nunca otra vez al asistente", () => {
    expect(r("banco.csv", true, true, false)).toBe("map");
  });
  it("PDF/imagen → asistente; sin asistente o en modo solo-hojas → rechazo", () => {
    expect(r("estado.pdf", true, false, false)).toBe("ai");
    expect(r("captura.PNG", true, false, false)).toBe("ai");
    expect(r("estado.pdf", false, false, false)).toBe("reject");
    expect(r("captura.jpg", true, true, false)).toBe("reject");
  });
});
