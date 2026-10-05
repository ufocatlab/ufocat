const fs = require("node:fs");
const path = require("node:path");
const collection = require("@iconify-json/lucide/icons.json");

const iconNames = [
  "arrow-right",
  "camera",
  "cctv",
  "check",
  "circle-alert",
  "ellipsis",
  "expand",
  "folder-plus",
  "grip-vertical",
  "hard-drive",
  "maximize-2",
  "minimize-2",
  "plus",
  "radio",
  "settings",
  "video",
  "x",
];

const symbols = iconNames.map((name) => {
  const icon = collection.icons[name];
  if (!icon) throw new Error(`Missing Lucide icon: ${name}`);

  const width = icon.width || collection.width || 24;
  const height = icon.height || collection.height || 24;
  return `<symbol id="icon-${name}" viewBox="0 0 ${width} ${height}">${icon.body}</symbol>`;
});

const output = `<svg xmlns="http://www.w3.org/2000/svg"><defs>${symbols.join("")}</defs></svg>\n`;
const outputPath = path.join(__dirname, "..", "assets", "icons.svg");
fs.writeFileSync(outputPath, output);
console.log(`Generated ${iconNames.length} local SVG icons.`);
