"use strict";

const fs = require("node:fs");
const path = require("node:path");

const projectDir = path.resolve(__dirname, "..");
const envPath = path.join(projectDir, ".env");
const outputPath = path.join(projectDir, "config.local.js");

function parseEnv(contents) {
  const values = {};
  const lines = contents.replace(/^\uFEFF/, "").split(/\r?\n/);

  lines.forEach(function (rawLine, index) {
    let line = rawLine.trim();
    if (!line || line.startsWith("#")) return;
    if (line.startsWith("export ")) line = line.slice(7).trim();

    const separatorIndex = line.indexOf("=");
    if (separatorIndex < 1) {
      throw new Error("Invalid .env entry at line " + (index + 1));
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error("Invalid environment variable name at line " + (index + 1));
    }

    const quote = value.charAt(0);
    if ((quote === '"' || quote === "'") && value.charAt(value.length - 1) === quote) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  });

  return values;
}

function readFileValues() {
  if (!fs.existsSync(envPath)) return {};
  return parseEnv(fs.readFileSync(envPath, "utf8"));
}

function requireValue(name, fileValues) {
  const value = String(process.env[name] || fileValues[name] || "").trim();
  if (!value || value.includes("your-") || value.includes("<your-")) {
    throw new Error("Missing required environment variable: " + name);
  }
  return value;
}

const fileValues = readFileValues();
const supabaseUrl = requireValue("SUPABASE_URL", fileValues).replace(/\/$/, "");
const supabaseAnonKey = requireValue("SUPABASE_ANON_KEY", fileValues);

let parsedUrl;
try {
  parsedUrl = new URL(supabaseUrl);
} catch (error) {
  throw new Error("SUPABASE_URL must be a valid URL");
}
if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
  throw new Error("SUPABASE_URL must use http or https");
}

const generated = [
  '"use strict";',
  "",
  "window.WOMS_CONFIG = {",
  "  supabaseUrl: " + JSON.stringify(supabaseUrl) + ",",
  "  supabaseKey: " + JSON.stringify(supabaseAnonKey),
  "};",
  ""
].join("\n");

fs.writeFileSync(outputPath, generated, { encoding: "utf8", mode: 0o600 });
console.log("Generated config.local.js from Supabase environment variables.");
