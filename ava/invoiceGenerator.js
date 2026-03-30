import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function generateInvoiceNumber(escrowNumber) {
  if (escrowNumber && escrowNumber !== "TBD") return escrowNumber;
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const yy = String(now.getFullYear()).slice(-2);
  const rand = Math.random().toString(36).substring(2, 4).toUpperCase();
  return `L-${mm}${dd}${yy}-${rand}`;
}

export async function generateEscrowInvoice(payload) {
  const invoiceNumber = generateInvoiceNumber(payload.escrowNumber);
  const outputPath = `/tmp/invoice-${invoiceNumber}.pdf`;
  const data = {
    type: "escrow",
    invoiceNumber,
    escrowCompany: payload.escrowCompany || "Escrow Company",
    escrowAddress: payload.escrowAddress || "",
    escrowPhone: payload.escrowPhone || "",
    assignmentFee: payload.assignmentFee || 0,
    wireInfo: {
      accountNumber: payload.accountNumber || "200001888105",
      routingNumber: payload.routingNumber || "064209588",
      bank: payload.bank || "Thread Bank",
      accountHolder: "Flipur Inc",
    },
  };
  const scriptPath = path.join(__dirname, "invoice.py");
  const { stdout } = await execFileAsync("python3", [
    scriptPath,
    JSON.stringify(data),
    outputPath,
  ]);
  const result = JSON.parse(stdout.trim());
  if (!result.success) throw new Error("Invoice generation failed");
  const pdfBuffer = fs.readFileSync(outputPath);
  fs.unlinkSync(outputPath);
  return { pdfBuffer, invoiceNumber, fileName: `Invoice-${invoiceNumber}.pdf` };
}
