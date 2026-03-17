import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getCompanyCamContext } from "./companycam.js";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function generateBidPDF(payload) {
  const outputPath = `/tmp/bid-${Date.now()}.pdf`;
  const scriptPath = path.join(__dirname, "bid.py");

  const { stdout } = await execFileAsync("python3", [
    scriptPath,
    JSON.stringify(payload),
    outputPath,
  ]);

  const result = JSON.parse(stdout.trim());
  if (!result.success) throw new Error("Bid generation failed");

  const pdfBuffer = fs.readFileSync(outputPath);
  fs.unlinkSync(outputPath);

  return {
    pdfBuffer,
    fileName: `RepairEstimate-${payload.propertyAddress.split(',')[0].replace(/\s+/g,'-')}.pdf`,
  };
}

export async function fetchCompanyCamContext(url) {
  return getCompanyCamContext(url);
}
