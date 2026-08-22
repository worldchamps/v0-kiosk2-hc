export function buildSam4sReceiptHtml(data: any): string
export function findSam4sPrinter(
  printers: Array<{ name?: string; displayName?: string }>,
  configuredName?: string,
): { name?: string; displayName?: string } | null
export function receiptHeightMicrons(cssPixels: number): number
