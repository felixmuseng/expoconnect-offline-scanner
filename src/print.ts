import type { Row } from "./store";

// Mock. Real version sends TSPL/ESC-POS over WebUSB.
export async function printBadge(row: Row, id: string): Promise<string> {
  const line = `[PRINT ${new Date().toLocaleTimeString()}] id=${id} ${JSON.stringify(row)}`;
  console.log(line);
  await new Promise((r) => setTimeout(r, 300));
  return line;
}
