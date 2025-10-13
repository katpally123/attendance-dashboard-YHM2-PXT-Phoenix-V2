// ================== CONFIG ==================
const APP = {
  DEPTS: {
    Inbound: { dept_ids: ["1211010","1211020","1299010","1299020"] },
    DA:      { dept_ids: ["1211030","1211040","1299030","1299040"] }, // Outbound
    ICQA:    { dept_ids: ["1299070","1211070"], area: "27" },
    CRETs:   { dept_ids: ["1299070","1211070"], area: "22" }
  },
  PRESENT_MARKERS: ["X","Y","YES","TRUE","1"],
  VAC_HOURS: 9.5,
  BH_HOURS: 11.9
};

// ================ ELEMENTS ==================
const dateEl    = document.getElementById("date");
const buildBtn  = document.getElementById("build");
const resetBtn  = document.getElementById("reset");
const dlAbsBtn  = document.getElementById("dlAbs");
const auditToggle = document.getElementById("auditToggle");

const fRoster = document.getElementById("f_roster");
const fMyTime = document.getElementById("f_mytime");
const fHours  = document.getElementById("f_hours");
const fSwapUp = document.getElementById("f_swap_up");
const fSwapPs = document.getElementById("f_swap_past");
const fVetVto = document.getElementById("f_vetvto");

const metricsTable = document.getElementById("metricsTable");
const absTable     = document.getElementById("absTable");

// Modal elements
const auditModal = document.getElementById("auditModal");
const auditTitle = document.getElementById("auditTitle");
const auditSub   = document.getElementById("auditSub");
const auditBody  = document.getElementById("auditBody");
const auditClose = document.getElementById("auditClose");
const auditCsvBtn= document.getElementById("auditCsvBtn");

// ============== STATE (RUN) =================
let ROSTER = [], MYTIME = [], HOURS = [];
let SWAP_UP = [], SWAP_PS = [], VETVTO = [];

let onPrem   = new Map();   // id -> boolean present (from MyTime)
let byId     = new Map();   // id -> roster row (filtered by shift)
let fullById = new Map();   // id -> roster row (any shift)
let vacSet   = new Set();
let bhSet    = new Set();
let swapOutSet = new Set();
let swapInSet  = new Set();
let vtoSet     = new Set();
let vetSet     = new Set();

let cohortExpected      = [];
let cohortPresentExSwaps= [];
let swapOutRows         = [];
let swapInExpectedRows  = [];
let swapInPresentRows   = [];
let vetExpectedRows     = [];
let vetPresentRows      = [];
let vtoRows             = [];

let ABS_AUDIT = [];  // absence audit summary (reason counts)

// Per-metric decorated audit data (for modal/CSV)
const AUDIT = { 
  decorated: {}, 
  summary: {
    regularExpected:      "Scheduled cohort excluding Vacation & Banked Holiday (VTO/Swap-Out still considered scheduled).",
    regularPresentEx:     "From Regular Expected: On-Premises only, excluding Swap-Out.",
    swapOut:              "Approved Shift Swap — Skip Date = selected date.",
    swapInExpected:       "Shift Swap — Work Date = selected date (expected coverage).",
    swapInPresent:        "Swap-In who actually badged on premises.",
    vto:                  "Voluntary Time Off accepted for the shift.",
    vetExpected:          "Voluntary Extra Time accepted for the shift.",
    vetPresent:           "VET participants who badged on premises."
  }
};

// ============== HELPERS =====================
function getShift() {
  return document.querySelector('input[name="shift"]:checked')?.value || "Day";
}
function ymd(d) {
  return d.split("T")[0] || d;
}

// ================= SMART CSV PARSER =================
// Detects header row automatically and returns clean array of objects
function parseCSV(file) {
  return new Promise((res, rej) => {
    if (!file) { res([]); return; }
    Papa.parse(file, {
      skipEmptyLines: true,
      complete: result => {
        const rows = result.data || [];
        if (!rows.length) { res([]); return; }

        // find the row index that looks like headers
        let headerIdx = -1;
        const hints = ["employee","person","badge","department","on","hours","status","opportunity"];
        for (let i = 0; i < Math.min(rows.length, 15); i++) {
          const row = rows[i].map(x => String(x||"").toLowerCase());
          if (row.some(c => hints.some(h => c.includes(h)))) { headerIdx = i; break; }
        }

        if (headerIdx === -1) headerIdx = 0;
        const headers = rows[headerIdx].map(h => String(h||"").trim());
        const data = [];
        for (let i = headerIdx + 1; i < rows.length; i++) {
          const r = rows[i]; if (!r || !r.length) continue;
          const obj = {};
          headers.forEach((h,j) => obj[h] = r[j]);
          // stop if blank trailing rows
          if (Object.values(obj).every(v => v==null || v==="")) continue;
          data.push(obj);
        }
        res(data);
      },
      error: rej
    });
  });
}
// ID normalization: strip non-digits (use numeric part if available), otherwise use trimmed string in uppercase
function normId(x) {
  if (x == null) return "";
  let s = String(x).trim();
  if (!s) return "";
  const digits = s.replace(/\D+/g, "");
  return digits || s.toUpperCase();
}

// Determine department bucket by Dept ID (and Management Area for ICQA/CRETs)
function bucketOf(r) {
  const dept = String(r["Department ID"] ?? r.DepartmentID ?? r.deptId ?? "").trim();
  const area = String(r["Management Area ID"] ?? r.ManagementAreaID ?? r.area ?? "").trim();
  if (!dept) return "Other";
  const inList = ids => ids.includes(dept);
  if (inList(APP.DEPTS.Inbound.dept_ids)) return "Inbound";
  if (inList(APP.DEPTS.DA.dept_ids))      return "DA";
  if (inList(APP.DEPTS.ICQA.dept_ids) && area === APP.DEPTS.ICQA.area) return "ICQA";
  if (inList(APP.DEPTS.CRETs.dept_ids) && area === APP.DEPTS.CRETs.area) return "CRETs";
  return "Other";
}

function classifyType(r) {
  const t = (r["Employment Type"] ?? r.EmpType ?? "").toString().toLowerCase();
  if (/temp|season|contract|vendor|white/.test(t)) return "TEMP";
  if (!t) return "AMZN";  // default to AMZN if blank
  return "AMZN";
}

function presentFromMyTimeRow(row) {
  // MyTime "On Premise" markers (flexible column naming)
  const val = row["On Premise"] ?? row["On Premises"] ?? row["On_Premises"] ?? row["OnPremise"] ?? row["On site"] ?? row["Onsite"];
  const s = String(val ?? "").toUpperCase().trim();
  return APP.PRESENT_MARKERS.includes(s);
}

function hoursFromRow(row) {
  const hrs = Number(row["Hours"] ?? row["Total Hours"] ?? row["Daily Hours"] ?? row["Amount"] ?? 0);
  return isFinite(hrs) ? hrs : 0;
}

function parseDateCell(row) {
  // Finds a date string in any column (YYYY-MM-DD or MM/DD/YYYY) and returns as YYYY-MM-DD
  for (const k of Object.keys(row)) {
    const v = String(row[k] ?? "").trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
    if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(v)) {
      const [m, d, y] = v.split("/").map(Number);
      return [y, String(m).padStart(2, "0"), String(d).padStart(2, "0")].join("-");
    }
  }
  return "";
}

function getIdFromAny(row) {
  const keys = ["Employee ID", "Person ID", "Person Number", "EmployeeID", "Badge ID", "Badge Barcode ID", "Associate ID", "User ID", "employeeLogin", "employeeId", "EID", "ID"];
  for (const k of keys) {
    if (row[k] != null && String(row[k]).trim() !== "") {
      return normId(row[k]);
    }
  }
  return "";
}

function getCorner(r) {
  return String(r["Shift Pattern"] ?? r["Corner"] ?? r["Shift"] ?? "").toUpperCase();
}

// Filter roster row by Day/Night shift. If shift pattern string exists, use it; otherwise assume roster already filtered.
function rowMatchesShift(row, shift) {
  const p = getCorner(row);
  if (p) {
    if (shift === "Day")   return /DA|DB|DC|DL|DAY|D$/.test(p);
    if (shift === "Night") return /NA|NB|NC|NN|NIGHT|N$/.test(p);
  }
  return true;
}

function sumObj(obj) {
  return Object.values(obj).reduce((a, b) => a + (b || 0), 0);
}
function deptTypeCounter() {
  // Initialize a nested counter object for each department (Inbound, DA, ICQA, CRETs)
  const base = { Inbound: { AMZN: 0, TEMP: 0 }, DA: { AMZN: 0, TEMP: 0 }, ICQA: { AMZN: 0, TEMP: 0 }, CRETs: { AMZN: 0, TEMP: 0 } };
  return JSON.parse(JSON.stringify(base));
}
function incCounter(counter, row) {
  const b = bucketOf(row);
  if (b === "Other") return;  // skip if department not tracked
  const t = classifyType(row);
  counter[b][t] = (counter[b][t] || 0) + 1;
}

// ============== AUDIT BUILDERS ==============
function decorateRow(row) {
  const id = row._id;
  const present = onPrem.get(id) ? "Yes" : "No";
  const flags = {
    vacation:      vacSet.has(id) ? "Yes" : "No",
    bankedHoliday: bhSet.has(id) ? "Yes" : "No",
    vto:           vtoSet.has(id) ? "Yes" : "No",
    vet:           vetSet.has(id) ? "Yes" : "No",
    swapOut:       swapOutSet.has(id) ? "Yes" : "No",
    swapIn:        swapInSet.has(id) ? "Yes" : "No"
  };
  let reason = "";
  if (present === "No") {
    if (flags.vacation === "Yes" || flags.bankedHoliday === "Yes") {
      reason = "Vacation / Banked Holiday";
    } else if (flags.vto === "Yes") {
      reason = "VTO accepted";
    } else if (flags.swapOut === "Yes") {
      reason = "Swap-Out";
    } else if (flags.vet === "Yes") {
      reason = "VET accepted but not shown";
    } else {
      reason = "No-Show (plain)";
    }
  }
  return {
    "Employee ID": id,
    "Department": bucketOf(row),
    "Emp Type": classifyType(row),
    "Present": present,
    "Vacation": flags.vacation,
    "Banked Holiday": flags.bankedHoliday,
    "VTO": flags.vto,
    "VET": flags.vet,
    "Swap-Out": flags.swapOut,
    "Swap-In": flags.swapIn,
    "Reason": reason
  };
}

function buildAuditDecorated() {
  // Prepare detailed rows for each metric category (used for modal and CSV downloads)
  AUDIT.decorated = {
    regularExpected: cohortExpected.map(decorateRow),
    regularPresentEx: cohortPresentExSwaps.map(decorateRow),
    swapOut:         swapOutRows.map(decorateRow),
    swapInExpected:  swapInExpectedRows.map(decorateRow),
    swapInPresent:   swapInPresentRows.map(decorateRow),
    vto:             vtoRows.map(decorateRow),
    vetExpected:     vetExpectedRows.map(decorateRow),
    vetPresent:      vetPresentRows.map(decorateRow)
  };
}

// ============== RENDERING ===================
function renderMetrics() {
  // Table header with department columns
  const head = `
    <tr>
      <th class="k">Metric</th>
      <th colspan="2">Inbound</th>
      <th colspan="2">DA</th>
      <th colspan="2">ICQA</th>
      <th colspan="2">CRETs</th>
      <th>Total</th>
    </tr>
    <tr class="muted small">
      <th></th>
      <th>AMZN</th><th>TEMP</th>
      <th>AMZN</th><th>TEMP</th>
      <th>AMZN</th><th>TEMP</th>
      <th>AMZN</th><th>TEMP</th>
      <th></th>
    </tr>`;
  const tb = [];

  function rowHTML(label, key, counter) {
    const cells = `
      <td>${counter.Inbound.AMZN || 0}</td><td>${counter.Inbound.TEMP || 0}</td>
      <td>${counter.DA.AMZN || 0}</td><td>${counter.DA.TEMP || 0}</td>
      <td>${counter.ICQA.AMZN || 0}</td><td>${counter.ICQA.TEMP || 0}</td>
      <td>${counter.CRETs.AMZN || 0}</td><td>${counter.CRETs.TEMP || 0}</td>`;
    const total = 
      sumObj(counter.Inbound) + sumObj(counter.DA) + sumObj(counter.ICQA) + sumObj(counter.CRETs);
    const actions = `
      <span class="audit-actions">
        <button class="abtn" data-key="${key}" data-act="audit">🔎 Audit</button>
        <button class="abtn" data-key="${key}" data-act="csv">⬇ CSV</button>
      </span>`;
    return `<tr>
      <td class="k">${label} ${actions}</td>
      ${cells}
      <td>${total}</td>
    </tr>`;
  }

  // Build counts for each metric row
  const row_RegularExpected   = deptTypeCounter();  cohortExpected.forEach(x => incCounter(row_RegularExpected, x));
  const row_RegularPresentEx  = deptTypeCounter();  cohortPresentExSwaps.forEach(x => incCounter(row_RegularPresentEx, x));
  const row_SwapOut           = deptTypeCounter();  swapOutRows.forEach(x => incCounter(row_SwapOut, x));
  const row_SwapInExpected    = deptTypeCounter();  swapInExpectedRows.forEach(x => incCounter(row_SwapInExpected, x));
  const row_SwapInPresent     = deptTypeCounter();  swapInPresentRows.forEach(x => incCounter(row_SwapInPresent, x));
  const row_VTO               = deptTypeCounter();  vtoRows.forEach(x => incCounter(row_VTO, x));
  const row_VETExpected       = deptTypeCounter();  vetExpectedRows.forEach(x => incCounter(row_VETExpected, x));
  const row_VETPresent        = deptTypeCounter();  vetPresentRows.forEach(x => incCounter(row_VETPresent, x));

  // Populate table body
  metricsTable.querySelector("thead").innerHTML = head;
  tb.push(
    rowHTML("Regular HC (Cohort Expected)", "regularExpected", row_RegularExpected),
    rowHTML("Regular HC Present (Excluding Swaps)", "regularPresentEx", row_RegularPresentEx),
    rowHTML("Shift Swap Out", "swapOut", row_SwapOut),
    rowHTML("Shift Swap Expected", "swapInExpected", row_SwapInExpected),
    rowHTML("Shift Swap Present", "swapInPresent", row_SwapInPresent),
    rowHTML("VTO", "vto", row_VTO),
    rowHTML("VET Expected", "vetExpected", row_VETExpected),
    rowHTML("VET Present", "vetPresent", row_VETPresent)
  );
  metricsTable.querySelector("tbody").innerHTML = tb.join("");

  // Ensure audit action buttons visible based on toggle
  document.body.classList.toggle("audit-mode", auditToggle.checked);
}

function renderAbsAudit() {
  // Determine counts of each absence reason for scheduled-but-absent associates
  const absent = cohortExpected.filter(x => !onPrem.get(x._id));
  const counts = { 
    "Vacation / PTO": 0, 
    "Banked Holiday": 0, 
    "VTO accepted": 0, 
    "Swap-Out": 0, 
    "VET accepted but not shown": 0, 
    "No-Show (plain)": 0 
  };
  for (const x of absent) {
    const id = x._id;
    if (vacSet.has(id))      counts["Vacation / PTO"]++;
    else if (bhSet.has(id))  counts["Banked Holiday"]++;
    else if (vtoSet.has(id)) counts["VTO accepted"]++;
    else if (swapOutSet.has(id)) counts["Swap-Out"]++;
    else if (vetSet.has(id)) counts["VET accepted but not shown"]++;
    else                     counts["No-Show (plain)"]++;
  }
  ABS_AUDIT = Object.entries(counts).map(([reason, count]) => ({ reason, count }));
  const tb = ABS_AUDIT.map(r => `<tr><td>${r.reason}</td><td>${r.count}</td></tr>`).join("");
  absTable.querySelector("tbody").innerHTML = tb || `<tr><td class="muted">No absences</td><td>0</td></tr>`;
}

// Modal helpers
function ensureAuditTable(rows) {
  if (!rows || !rows.length) {
    return `<div class="muted">No rows for this metric.</div>`;
  }
  const heads = Object.keys(rows[0]);
  const thead = `<thead><tr>${heads.map(h => `<th>${h}</th>`).join("")}</tr></thead>`;
  const tbody = `<tbody>${rows.map(r => `<tr>${heads.map(h => `<td>${String(r[h] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody>`;
  return `<table class="audit-table">${thead}${tbody}</table>`;
}

function openAuditModal(key, rows) {
  auditTitle.textContent = `Audit — ${prettyName(key)}`;
  auditSub.textContent   = AUDIT.summary[key] || "";
  auditBody.innerHTML    = ensureAuditTable(rows);
  auditCsvBtn.onclick    = () => downloadCSV(`${key}_${dateEl.value || "date"}.csv`, rows);
  auditModal.classList.remove("hidden");
}
auditClose.onclick = () => auditModal.classList.add("hidden");
auditModal.addEventListener("click", e => {
  if (e.target === auditModal) auditModal.classList.add("hidden");
});

function prettyName(k) {
  switch (k) {
    case "regularExpected": return "Regular HC (Cohort Expected)";
    case "regularPresentEx": return "Regular HC Present (Excluding Swaps)";
    case "swapOut":         return "Shift Swap Out";
    case "swapInExpected":  return "Shift Swap Expected";
    case "swapInPresent":   return "Shift Swap Present";
    case "vto":             return "VTO";
    case "vetExpected":     return "VET Expected";
    case "vetPresent":      return "VET Present";
    default: return k;
  }
}

function downloadCSV(filename, rows) {
  const arr = Array.isArray(rows) ? rows : [];
  let csv = "";
  if (arr.length) {
    const headers = Object.keys(arr[0]);
    csv += headers.join(",") + "\n";
    for (const r of arr) {
      const line = headers.map(h => `"${String(r[h] ?? "").replaceAll('"', '""')}"`).join(",");
      csv += line + "\n";
    }
  } else {
    csv = "No data\n";
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// ============== CORE PIPELINE =================
buildBtn.onclick = async () => {
  const dateStr = dateEl.value;
  if (!dateStr) {
    alert("Pick a target date.");
    return;
  }
  const shift = getShift();

  // Parse files (any missing -> empty arrays)
  [ROSTER, MYTIME, HOURS, SWAP_UP, SWAP_PS, VETVTO] = await Promise.all([
    parseCSV(fRoster.files[0]), parseCSV(fMyTime.files[0]),
    parseCSV(fHours.files[0]), parseCSV(fSwapUp.files[0]),
    parseCSV(fSwapPs.files[0]), parseCSV(fVetVto.files[0])
  ]);
  if (!ROSTER.length || !MYTIME.length) {
    alert("Please upload both the Roster and Attendance (MyTime) CSV files.");
    return;
  }

  // 1) Normalize ROSTER (add normalized _id and type, then filter by shift and new-hire exclusion)
  fullById.clear();
  byId.clear();
  const today = new Date(dateStr);
  ROSTER = ROSTER.map(r => {
    const id = normId(getIdFromAny(r));
    return { ...r, _id: id, typ: classifyType(r) };
  }).filter(r => r._id);

  const exNew = document.getElementById("excludeNewHires").checked;
  const minStart = new Date(today);
  minStart.setDate(minStart.getDate() - 3);
  const rosterShift = ROSTER.filter(r => rowMatchesShift(r, shift))
    .filter(r => {
      if (!exNew) return true;
      const start = new Date(String(r["Employment Start Date"] || ""));
      return isFinite(start) ? (start <= minStart) : true;
    });

  rosterShift.forEach(r => byId.set(r._id, r));
  ROSTER.forEach(r => fullById.set(r._id, r));

  // 2) Build On-Prem presence map from MyTime file
  onPrem = new Map();
  MYTIME.forEach(row => {
    const id = normId(getIdFromAny(row));
    if (!id) return;
    if (!byId.has(id) && !fullById.has(id)) return;  // ignore entries not in roster
    const present = presentFromMyTimeRow(row);
    if (present) onPrem.set(id, true);
  });

  // 3) Determine Vacation / Banked Holiday from Hours file (by Time Code and hours thresholds)
  vacSet = new Set();
  bhSet  = new Set();
  HOURS.forEach(row => {
    const id = normId(getIdFromAny(row));
    if (!id) return;
    const hr = hoursFromRow(row);
    const date = parseDateCell(row);
    if (date !== dateStr) return;
    const timecode = String(row["Time Code"] ?? row["Pay Code"] ?? "").toUpperCase();
    const isVac = /VAC|VACATION|PTO/.test(timecode);
    const isBH  = /(BANKED|HOLIDAY)/.test(timecode);
    if (isVac && hr >= APP.VAC_HOURS) vacSet.add(id);
    if (isBH  && hr >= APP.BH_HOURS)  bhSet.add(id);
  });

  // 4) Gather approved Shift Swaps (Upcoming and Past files)
  swapOutSet = new Set();
  swapInSet  = new Set();
  function collectSwap(rows) {
    rows.forEach(row => {
      const id = normId(getIdFromAny(row));
      if (!id) return;
      const status = String(row["Status"] ?? row["Swap Status"] ?? row["Approval Status"] ?? "").toUpperCase();
      if (!/APPROVED|ACCEPTED|COMPLETED|SUCCESS/.test(status)) return;
      const skipDate = String(row["Date to Skip"] ?? row["Skip Date"] ?? "").slice(0, 10);
      const workDate = String(row["Date to Work"] ?? row["Work Date"] ?? "").slice(0, 10);
      if (skipDate === dateStr) swapOutSet.add(id);
      if (workDate === dateStr) swapInSet.add(id);
    });
  }
  collectSwap(SWAP_UP);
  collectSwap(SWAP_PS);

  // 5) Gather accepted VET/VTO from Posting Acceptance file
  vtoSet = new Set();
  vetSet = new Set();
  VETVTO.forEach(row => {
    const id = normId(getIdFromAny(row));
    if (!id) return;
    const accepted = Number(row["opportunity.acceptedCount"] ?? row["acceptedCount"] ?? row["Accepted"] ?? 0) > 0;
    if (!accepted) return;
    const typ = String(row["opportunity.type"] ?? row["type"] ?? "").toUpperCase();
    const when = String(row["opportunity.shiftStart"] ?? row["shiftStart"] ?? "");
    const d = ymd(when);
    if (d && d !== dateStr) return;
    if (typ.includes("VTO")) vtoSet.add(id);
    else if (typ.includes("VET")) vetSet.add(id);
  });

  // 6) Build cohorts/lists for each category
  // Expected cohort = rosterShift minus those on Vacation or BH (we still include those who took VTO or Swap-Out in expected count)
  cohortExpected = rosterShift.filter(r => !vacSet.has(r._id) && !bhSet.has(r._id));
  // Present (excluding swaps) = those expected and present onPrem, minus anyone who swapped out
  cohortPresentExSwaps = cohortExpected.filter(r => onPrem.get(r._id) && !swapOutSet.has(r._id));

  // Swap-Out list (those who skipped this date)
  swapOutRows = Array.from(swapOutSet).map(id => byId.get(id)).filter(Boolean);
  // Swap-In expected list (those picking up a shift on this date, may not be in original shift roster)
  swapInExpectedRows = Array.from(swapInSet).map(id => fullById.get(id) || byId.get(id)).filter(Boolean);
  // Swap-In present list (those swap-ins who actually showed up)
  swapInPresentRows  = swapInExpectedRows.filter(r => onPrem.get(r._id));

  // VET lists (expected and present)
  vetExpectedRows = Array.from(vetSet).map(id => fullById.get(id) || byId.get(id)).filter(Boolean);
  vetPresentRows  = vetExpectedRows.filter(r => onPrem.get(r._id));

  // VTO list (those who took voluntary time off)
  vtoRows = Array.from(vtoSet).map(id => byId.get(id) || fullById.get(id)).filter(Boolean);

  // Prepare detailed audit data for each category
  buildAuditDecorated();

  // Render the metrics table and absence audit summary
  renderMetrics();
  renderAbsAudit();
};

// Reset button: clears the tables and hides modal
resetBtn.onclick = () => {
  metricsTable.querySelector("thead").innerHTML = "";
  metricsTable.querySelector("tbody").innerHTML = `<tr><td class="muted">Upload files and click Build.</td></tr>`;
  absTable.querySelector("tbody").innerHTML = `<tr><td class="muted">Built with DD-Metrics.</td><td>—</td></tr>`;
  auditModal.classList.add("hidden");
};

auditToggle.onchange = () => {
  document.body.classList.toggle("audit-mode", auditToggle.checked);
};

dlAbsBtn.onclick = () => {
  const rows = ABS_AUDIT.map(r => ({ Reason: r.reason, Count: r.count }));
  downloadCSV(`absence_audit_${dateEl.value || "date"}.csv`, rows);
};

// Attach global metric action handlers (Audit/CSV for each metric row)
function onMetricAction(e) {
  const btn = e.target.closest(".abtn");
  if (!btn) return;
  const key = btn.dataset.key;
  const act = btn.dataset.act;
  if (act === "audit") {
    const rows = AUDIT.decorated[key] || [];
    openAuditModal(key, rows);
  } else if (act === "csv") {
    const rows = AUDIT.decorated[key] || [];
    downloadCSV(`${key}_${dateEl.value || "date"}.csv`, rows);
  }
}
metricsTable.addEventListener("click", onMetricAction);

// Default date = today (pre-select today’s date in the input)
(function seedDate() {
  const t = new Date();
  const d = new Date(Date.UTC(t.getFullYear(), t.getMonth(), t.getDate()));
  dateEl.value = d.toISOString().slice(0, 10);
})();
