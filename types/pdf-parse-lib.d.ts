// 为 pdf-parse 的 lib 入口补充类型声明。
// 必须直接引 lib/pdf-parse.js：包的 index.js 在 module.parent 为空时会执行测试代码
// 并 readFileSync('./test/data/05-versions-space.pdf')，在 Vercel 上直接抛 ENOENT。

declare module "pdf-parse/lib/pdf-parse.js" {
  /** pdf.js 的 TextItem 子集，仅声明本仓库用到的字段 */
  export interface PdfTextItem {
    str: string;
    transform: number[];
  }

  export interface PdfTextContent {
    items: PdfTextItem[];
  }

  /** pdf.js 的 PDFPageProxy 子集 */
  export interface PdfPageProxyLike {
    getTextContent: (options?: {
      normalizeWhitespace?: boolean;
      disableCombineTextItems?: boolean;
    }) => Promise<PdfTextContent>;
  }

  export interface PdfParseOptions {
    /** 自定义单页文本提取；返回值会拼进 data.text，逐页调用顺序即页序 */
    pagerender?: (pageData: PdfPageProxyLike) => string | Promise<string>;
    /** 最多解析页数，<=0 表示全部 */
    max?: number;
    /** pdf.js 版本目录，默认 1.10.100 */
    version?: string;
  }

  export interface PdfParseResult {
    numpages: number;
    numrender: number;
    info: unknown;
    metadata: unknown;
    text: string;
    version: string;
  }

  export default function pdfParse(
    dataBuffer: Buffer,
    options?: PdfParseOptions,
  ): Promise<PdfParseResult>;
}
