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
const MONTHLY_TABLE = process.env.MONTHLY_TABLE      || "tblJ7i6J3wxf03Kxk"; // Monthly Report (snapshot)
const TOWING_TABLE  = process.env.TOWING_TABLE       || "tblLgNB8RQvy4xiW5"; // TOWED ILLEGAL PARKER (successful tow log)
const TOWING_DATE   = process.env.TOWING_DATE_FIELD  || "DATE";
const RING_TABLE    = process.env.RING_TABLE         || "tblViMnfhcqyMKBHU"; // RingCentral Conversations
const RING_DATE     = process.env.RING_DATE_FIELD    || "DATE";
const REFUND_TABLE  = process.env.REFUND_TABLE       || "tblRziRjireToOPoF"; // Refunds & Reimbursement
const MGMT_TABLE    = process.env.MGMT_TABLE         || "tblZUQYJfjuqnVG16"; // Management Expenses 2026

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

const CAT = {
  CR: "Customer Reimbursements / Rewards",
  DS: "Dues / Subscription",
  PE: "Parking Enforcement / Installation",
  SR: "Snow Removal",
};
const ym = d => (d ? String(d).slice(0, 7) : null);
const up = v => (v == null ? "" : String(v).trim().toUpperCase());

// Aggregate the live Airtable tables into monthly figures.
function computeLive(tow, ring, refund, mgmt) {
  const live = { towing: {}, customers: {}, expCats: { [CAT.CR]: {}, [CAT.DS]: {}, [CAT.PE]: {}, [CAT.SR]: {} }, expTotal: {}, expYears: [] };
  const add = (map, k, a) => { if (k && a != null && !isNaN(a)) map[k] = (map[k] || 0) + Number(a); };

  tow.forEach(r => { const k = ym(r.fields[TOWING_DATE]); if (k) live.towing[k] = (live.towing[k] || 0) + 1; });
  ring.forEach(r => { const k = ym(r.fields[RING_DATE]); if (k) live.customers[k] = (live.customers[k] || 0) + 1; });

  // Customer Reimbursements / Rewards — from Refunds & Reimbursement (CATEGORY = REWARD or REIMBURSEMENT)
  refund.forEach(r => {
    const c = up(r.fields.CATEGORY), k = ym(r.fields.DATE), a = r.fields.AMOUNT;
    if (c === "REWARD" || c === "REIMBURSEMENT") add(live.expCats[CAT.CR], k, a);
  });

  // Management Expenses categories
  const years = new Set();
  mgmt.forEach(r => {
    const c = up(r.fields.CATEGORY), k = ym(r.fields.DATE), a = r.fields[" AMOUNT "];
    if (k) years.add(+k.slice(0, 4));
    if (c === "DUES/SUBSCRIPTION") add(live.expCats[CAT.DS], k, a);
    else if (c === "PARKING ENFORCEMENT" || c === "PARKPLIANT") add(live.expCats[CAT.PE], k, a);
    else if (c === "SNOW REMOVAL") add(live.expCats[CAT.SR], k, a);
  });
  live.expYears = [...years].sort();

  // Monthly expense total (sum of the 4 categories), only for years with Management-Expense data.
  const keys = new Set();
  Object.values(live.expCats).forEach(m => Object.keys(m).forEach(k => keys.add(k)));
  keys.forEach(k => {
    if (!years.has(+k.slice(0, 4))) return;
    let s = 0; Object.values(live.expCats).forEach(m => { s += m[k] || 0; });
    live.expTotal[k] = s;
  });
  return live;
}

// Read: monthly snapshot + live-aggregated towing, customers, and expenses
app.get("/api/data", async (req, res) => {
  try {
    const monthly = await atGet(MONTHLY_TABLE, "pageSize=100");
    let tow = [], ring = [], refund = [], mgmt = [];
    const f = (...names) => names.map(n => `fields%5B%5D=${encodeURIComponent(n)}`).join("&");
    try { tow    = await atGet(TOWING_TABLE, `pageSize=100&${f(TOWING_DATE)}`); }        catch (e) { console.warn("towing:", e.message); }
    try { ring   = await atGet(RING_TABLE,   `pageSize=100&${f(RING_DATE)}`); }          catch (e) { console.warn("ring:", e.message); }
    try { refund = await atGet(REFUND_TABLE, `pageSize=100&${f("DATE","AMOUNT","CATEGORY")}`); } catch (e) { console.warn("refund:", e.message); }
    try { mgmt   = await atGet(MGMT_TABLE,    `pageSize=100&${f("DATE"," AMOUNT ","CATEGORY")}`); } catch (e) { console.warn("mgmt:", e.message); }
    const live = computeLive(tow, ring, refund, mgmt);
    res.json({ monthly, live });
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
