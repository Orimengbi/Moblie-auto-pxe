import * as XLSX from "xlsx";

/**
 * 给生成的 xlsx 第一张表的某些列加下拉选择（Excel 的数据验证 - 序列）。
 * SheetJS 社区版写不了数据验证，这里先照常生成，再改 zip 里 sheet1.xml，插一段 <dataValidations>。
 * 选项放在一张隐藏的「选项」表里，下拉引用那张表的区域，选项多、有逗号也不受 255 字符的限制。
 * 导入只读第一张表，隐藏表不影响导回来。
 */

export interface Dropdown {
  /** 第一行里的列名。 */
  header: string;
  values: string[];
  /** stop：只能选列表里的；warning：可以填别的，Excel 提醒一下（比如机房也能填名称）。 */
  strict: boolean;
}

const OPTIONS_SHEET = "选项";

/** xlsx 是 CommonJS 包：打包后 CFB 是具名导出，Node 直接跑（测试）时只在 default 上。 */
const CFB = (XLSX as unknown as { CFB?: typeof XLSX.CFB }).CFB ?? (XLSX as unknown as { default: { CFB: typeof XLSX.CFB } }).default.CFB;

function columnName(index: number): string {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

function xml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** 生成带下拉的 xlsx。下拉覆盖到第 lastRow 行（含表头），留出往下填的空行。 */
export function xlsxWithDropdowns(rows: unknown[][], sheetName: string, dropdowns: Dropdown[], lastRow = Math.max(1000, rows.length + 500)): Buffer {
  const header = (rows[0] || []).map((cell) => String(cell ?? ""));
  const used = dropdowns.map((item) => ({ ...item, column: header.indexOf(item.header) })).filter((item) => item.column >= 0 && item.values.length);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), sheetName);
  if (!used.length) return XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;

  // 选项表：每个下拉一列，第一行是列名。
  const height = Math.max(...used.map((item) => item.values.length));
  const options = [used.map((item) => item.header), ...Array.from({ length: height }, (_, row) => used.map((item) => item.values[row] ?? ""))];
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(options), OPTIONS_SHEET);
  book.Workbook = { ...(book.Workbook || {}), Sheets: [{ Hidden: 0 }, { Hidden: 1 }] };
  const written = XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;

  const validations = used.map((item, index) => {
    const target = `${columnName(item.column)}2:${columnName(item.column)}${lastRow}`;
    const source = `'${OPTIONS_SHEET}'!$${columnName(index)}$2:$${columnName(index)}$${item.values.length + 1}`;
    const message = item.strict ? `请从下拉列表里选${item.header}` : `${item.header}不在列表里，导入时会按代码或名称再找一次`;
    return `<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" errorStyle="${item.strict ? "stop" : "warning"}" errorTitle="${xml(item.header)}" error="${xml(message)}" sqref="${target}"><formula1>${xml(source)}</formula1></dataValidation>`;
  });
  const block = `<dataValidations count="${validations.length}">${validations.join("")}</dataValidations>`;

  const zip = CFB.read(written, { type: "buffer" });
  const entry = CFB.find(zip, "/xl/worksheets/sheet1.xml");
  if (!entry?.content) throw new Error("生成表格失败：找不到第一张表");
  const sheet = Buffer.from(entry.content as Uint8Array).toString("utf8");
  // OOXML 规定 dataValidations 要在 sheetData（和 mergeCells）之后、pageMargins 等之前。
  const anchor = sheet.includes("</mergeCells>") ? "</mergeCells>" : "</sheetData>";
  if (!sheet.includes(anchor)) throw new Error("生成表格失败：表格结构不认识");
  entry.content = Buffer.from(sheet.replace(anchor, `${anchor}${block}`), "utf8");
  return Buffer.from(CFB.write(zip, { fileType: "zip", type: "buffer" }) as Uint8Array);
}
