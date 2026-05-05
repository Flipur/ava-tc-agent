import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MEMORY_FILE = path.join(__dirname, "../data/ava-memory.json");

const DEFAULT_MEMORY = {
  buyers: {},
  team: {},
  vendors: {},
  deals: {},
  markets: {},
  playbook: {},
  general: {},
};

function loadMemory() {
  try {
    if (fs.existsSync(MEMORY_FILE)) {
      const raw = fs.readFileSync(MEMORY_FILE, "utf8");
      return { ...DEFAULT_MEMORY, ...JSON.parse(raw) };
    }
  } catch (e) {
    console.error("Memory load error:", e.message);
  }
  return { ...DEFAULT_MEMORY };
}

function saveMemory(mem) {
  try {
    const dir = path.dirname(MEMORY_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(mem, null, 2));
  } catch (e) {
    console.error("Memory save error:", e.message);
  }
}

export function updateMemory(category, key, content) {
  const mem = loadMemory();
  if (!mem[category]) mem[category] = {};
  mem[category][key] = {
    content,
    updatedAt: new Date().toISOString(),
  };
  saveMemory(mem);
  console.log("Memory updated:", category, key);
}

export function deleteMemory(category, key) {
  const mem = loadMemory();
  if (mem[category] && mem[category][key]) {
    delete mem[category][key];
    saveMemory(mem);
  }
}

export function getMemoryContext() {
  const mem = loadMemory();
  const sections = [];

  for (const [category, entries] of Object.entries(mem)) {
    const keys = Object.keys(entries || {});
    if (!keys.length) continue;
    const lines = keys.map(k => `${k}: ${entries[k].content}`).join("\n");
    sections.push(`[${category.toUpperCase()}]\n${lines}`);
  }

  return sections.length ? sections.join("\n\n") : null;
}
