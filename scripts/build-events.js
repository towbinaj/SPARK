#!/usr/bin/env node
/**
 * Fetches the SPARK Events Smartsheet (publish URL), parses the HTML grid,
 * and writes events.json in the shape the calendar expects.
 *
 *   node scripts/build-events.js
 *   node scripts/build-events.js --url=https://publish.smartsheet.com/...
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_URL =
  "https://publish.smartsheet.com/0aa798e369234fa98e823ae6bb8cf3c3";

function parseArgs() {
  const out = { url: DEFAULT_URL };
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--url=")) out.url = a.slice("--url=".length);
  }
  return out;
}

// "04/08/26" -> "2026-04-08"
function dateToISO(mmddyy) {
  const m = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(mmddyy?.trim() || "");
  if (!m) return null;
  return `20${m[3]}-${m[1]}-${m[2]}`;
}

function normalizeBlock(label) {
  const l = (label || "").trim().toLowerCase();
  if (l === "department") return "department";
  if (l === "division")   return "division";
  return "joint";
}

const BLOCK_TITLE = {
  department: "Department",
  division:   "Division",
  joint:      "Joint Programming",
};

async function fetchHTML(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  return res.text();
}

function parseRows(html) {
  const $ = cheerio.load(html);
  let headers = null;
  const rows = [];

  $("tr").each((_, tr) => {
    const cells = [];
    $(tr).children("td").each((_, td) => {
      const $td = $(td);
      const $img = $td.find("img").first();
      if ($img.length && /checkbox/i.test($img.attr("src") || "")) {
        cells.push($img.attr("alt") === "true");
        return;
      }
      // Cheerio's .text() concatenates all descendant text; nested tables OK.
      const text = $td.text().replace(/\s+/g, " ").trim();
      cells.push(text);
    });

    if (!headers) {
      // Header row: contains "Date" and "Block" labels.
      // Smartsheet emits an empty leading <td> for the row-number column;
      // strip it so headers align with the data cells.
      if (cells.includes("Date") && cells.includes("Block")) {
        headers = cells[0] === "" ? cells.slice(1) : cells;
      }
      return;
    }

    // Data row: first cell is the row number, then one cell per header.
    if (cells.length >= headers.length + 1) {
      const row = {};
      headers.forEach((h, i) => { row[h] = cells[i + 1]; });
      rows.push(row);
    }
  });

  if (!headers) throw new Error("Could not find header row in published sheet");
  return { headers, rows };
}

function transformRows(rows) {
  const weeks = new Map();

  for (const r of rows) {
    const isoDate = dateToISO(r["Date"]);
    if (!isoDate) continue;

    const blockType = normalizeBlock(r["Block"]);
    if (!weeks.has(isoDate)) {
      weeks.set(isoDate, { date: isoDate, blocks: new Map() });
    }
    const week = weeks.get(isoDate);
    if (!week.blocks.has(blockType)) {
      week.blocks.set(blockType, {
        type: blockType,
        title: BLOCK_TITLE[blockType],
        events: [],
      });
    }

    const event = {
      startTime: r["Start Time"] || "",
      endTime:   r["End Time"]   || "",
      title:     r["Event"]      || "",
      audience:  r["Audience"]   || "",
      location:  r["Location"]   || "",
      virtual:   !!r["Virtual / Teams"],
    };

    // Optional Teams URL — supports a few likely column names
    const teamsUrl = r["Teams Link"] || r["Teams URL"] || r["Teams"] || "";
    if (teamsUrl && /^https?:\/\//.test(teamsUrl.trim())) {
      event.teamsUrl = teamsUrl.trim();
    }

    if (r["Comments"]) event.comments = r["Comments"];

    if (event.title && event.startTime) {
      week.blocks.get(blockType).events.push(event);
    }
  }

  return Array.from(weeks.values())
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(w => ({
      date: w.date,
      blocks: Array.from(w.blocks.values()),
    }));
}

async function main() {
  const { url } = parseArgs();
  console.log(`→ fetching ${url}`);
  const html = await fetchHTML(url);
  console.log(`  ${(html.length / 1024).toFixed(0)} KB received`);

  const { headers, rows } = parseRows(html);
  console.log(`→ parsed ${rows.length} rows; columns: ${headers.join(", ")}`);

  const weeks = transformRows(rows);
  const totalEvents = weeks.reduce(
    (sum, w) => sum + w.blocks.reduce((s, b) => s + b.events.length, 0),
    0,
  );
  console.log(`→ ${weeks.length} weeks, ${totalEvents} events`);

  const out = {
    _generatedAt: new Date().toISOString(),
    _source: url,
    weeks,
  };
  const outPath = join(__dirname, "..", "events.json");
  writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
  console.log(`→ wrote ${outPath}`);
}

main().catch(err => {
  console.error("✗", err.message);
  process.exit(1);
});
