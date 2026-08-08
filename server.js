/**
 * YourSpotRented — Monthly Reporting Tool (server)
 * The Airtable token lives only here, as an environment variable.
 * The browser never sees it — it just calls /api/data and /api/entry.
 */
const express = require("express");
const path = require("path");

const app = express();
app.use(express.json());

const TOKEN         = process.env.AIRTABLE_TOKEN;                       // required
const BASE_ID       = process.env.AIRTABLE_BASE_ID   || "app9iYUN8J3z2wjXN";
const MONTHLY_TABLE = process.env.MONTHLY_TABLE      || "tblJ7i6J3wxf03Kxk"; // Monthly Report
const TOWING_TABLE  = process.env.TOWING_TABLE       || "tblLgNB8RQvy4xiW5"; // TOWED ILLEGAL PARKER
const TOWING_DATE   = process.env.TOWING_DATE_FIELD  || "DATE";

if (!TOKEN) console.warn("WARNING: AIRTABLE_TOKEN is not set — /api routes will fail until you set it.");

// Node 18+ has global fetch.
async function atGet(table, params) {
  let out = [], offset = null;
  do {
    let url = `https://api.airtable.com/v0/${BASE_ID}/${table}?${params || ""}`;
    if (offset) url += `&offset=${encodeURIComponent(offset)}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
    if (!r.ok) { const t = await r.text(); throw new Error(`Airtable ${r.status}: ${t.slice(0, 300)}`); }
    const j = await r.json();
    out = out.concat(j.records);
    offset = j.offset;
  } while (offset);
  return out;
}

// Read: monthly snapshot + live towing log
app.get("/api/data", async (req, res) => {
  try {
    const monthly = await atGet(MONTHLY_TABLE, "pageSize=100");
    let towing = [];
    try { towing = await atGet(TOWING_TABLE, `pageSize=100&fields%5B%5D=${encodeURIComponent(TOWING_DATE)}`); }
    catch (e) { console.warn("towing overlay failed:", e.message); }
    res.json({ monthly, towing });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Write: upsert one month's row (manual entry)
app.patch("/api/entry", async (req, res) => {
  try {
    const fields = req.body && req.body.fields;
    if (!fields || !fields.Year || !fields.Month) return res.status(400).json({ error: "Year and Month are required." });
    const body = { performUpsert: { fieldsToMergeOn: ["Year", "Month"] }, records: [{ fields }] };
    const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${MONTHLY_TABLE}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await r.text();
    if (!r.ok) return res.status(r.status).json({ error: `${r.status}: ${text.slice(0, 300)}` });
    res.json(JSON.parse(text));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`YSR Monthly Reporting Tool running on :${PORT}`));
