// === Branding ===
const APP_NAME = "PXT Pheonix";
document.title = `${APP_NAME} — Attendance Dashboard`;

// ================= CONFIG / LOAD SETTINGS =================
const SETTINGS_URL = new URL("settings.json", document.baseURI).href + "?v=" + Date.now();
const DEFAULT_SETTINGS = {
  departments: {
    Inbound: { dept_ids: ["1211010","1211020","1299010","1299020"] },
    DA:      { dept_ids: ["1211030","1211040","1299030","1299040"] },
    ICQA:    { dept_ids: ["1299070","1211070"], management_area_id: "27" },
    CRETs:   { dept_ids: ["1299070","1211070"], management_area_id: "22" }
  },
  shift_schedule:{Day:{},Night:{}},
  present_markers:["X","Y","YES","TRUE","1"],
  swap_mapping:{
    id:["Employee 1 ID","Employee ID","Person ID","Person Number","Badge ID","ID","Associate ID"],
    status:["Status","Swap Status"],
    skip_date:["Date to Skip","Skip Date","Skip"],
    work_date:["Date to Work","Work Date","Work"],
    approved_statuses:["Approved","Completed","Accepted"]
  }
};

let SETTINGS = null;

// ================== DOM HOOKS ==================
const dateEl   = document.getElementById("dateInput");
const shiftEl  = document.getElementById("shiftInput");
const newHireEl= document.getElementById("excludeNewHires");

const rosterEl = document.getElementById("rosterFile");
const mytimeEl = document.getElementById("mytimeFile");
const vacEl    = document.getElementById("vacFile");
const swapOutEl= document.getElementById("swapOutFile");
const swapInEl = document.getElementById("swapInFile");
const vetEl    = document.getElementById("vetFile");

const fileStatus = document.getElementById("fileStatus");
const processBtn = document.getElementById("processBtn");

// tabs
const tabDash = document.getElementById("tabDashboard");
const tabAudit= document.getElementById("tabAudit");
const panelDash = document.getElementById("panelDashboard");
const panelAudit= document.getElementById("panelAudit");

// ribbon
const chipDay = document.getElementById("chipDay");
const chipShift = document.getElementById("chipShift");
const chipCorners = document.getElementById("chipCorners");
const chipCornerSource = document.getElementById("chipCornerSource");
const chipVacation = document.getElementById("chipVacation");
const chipBH = document.getElementById("chipBH");
const chipVacationCount = document.getElementById("chipVacationCount");
const chipBHCount = document.getElementById("chipBHCount");

// tables & downloads
const replicaTable = document.getElementById("replicaTable");
const auditTable = document.getElementById("auditTable");
const btnNoShow = document.getElementById("dlNoShow");
const btnAuditCSV = document.getElementById("dlAuditCSV");

// ================== INIT ==================
(async function boot(){
  try {
    const res = await fetch(SETTINGS_URL, {cache:"no-store"});
    SETTINGS = res.ok ? await res.json() : DEFAULT_SETTINGS;
  } catch { SETTINGS = DEFAULT_SETTINGS; }

  const today = new Date();
  dateEl.value = today.toISOString().slice(0,10);
  shiftEl.value = "Day";
  updateRibbonStatic();

  tabDash.addEventListener("click", ()=>switchTab("dash"));
  tabAudit.addEventListener("click", ()=>switchTab("audit"));

  dateEl.addEventListener("change", updateRibbonStatic);
  shiftEl.addEventListener("change", updateRibbonStatic);

  processBtn.addEventListener("click", processAll);
})();

function switchTab(which){
  if (which==="dash"){
    tabDash.classList.add("active"); tabAudit.classList.remove("active");
    panelDash.classList.remove("hidden"); panelAudit.classList.add("hidden");
  }else{
    tabAudit.classList.add("active"); tabDash.classList.remove("active");
    panelAudit.classList.remove("hidden"); panelDash.classList.add("hidden");
  }
}

function updateRibbonStatic(){
  chipDay.textContent = new Date(dateEl.value+"T00:00:00").toLocaleDateString("en-US",{weekday:"long"});
  chipShift.textContent = shiftEl.value;
  chipCorners.textContent = ""; chipCornerSource.textContent = "";
}

// ================== HELPERS ==================
const canon = s => String(s||"").trim().toLowerCase().replace(/\s+/g," ");
const normalizeId = v => {
  const t = String(v??"").trim(); const d=t.replace(/\D/g,""); const noLead=d.replace(/^0+/,"");
  return noLead || t;
};
const presentVal = (val, markers) => markers.includes(String(val||"").trim().toUpperCase());
const parseDateLoose = s => { const d=new Date(s); return isNaN(d)?null:d; };

function toISODate(d){
  if (!d) return null;
  const t = String(d).trim();
  const noTime = t.replace(/[T ]\d.*$/,"");
  const dt = new Date(noTime);
  if (!isNaN(dt)) return dt.toISOString().slice(0,10);
  const mdy=/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
  const ymd=/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/;
  let m;
  if ((m=mdy.exec(noTime))){
    const [,mm,dd,yyyy]=m; return new Date(`${yyyy}-${mm.padStart(2,"0")}-${dd.padStart(2,"0")}`).toISOString().slice(0,10);
  }
  if ((m=ymd.exec(noTime))){
    const [,yyyy,mm,dd]=m; return new Date(`${yyyy}-${mm.padStart(2,"0")}-${dd.padStart(2,"0")}`).toISOString().slice(0,10);
  }
  return null;
}
function hoursToNumber(h){
  if (h==null) return 0;
  const s=String(h).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (m){ const hh=+m[1], mm=+m[2]; return hh + (mm/60); }
  const cleaned = s.replace(/,/g,'.').replace(/[^\d.]/g,'');
  return parseFloat(cleaned)||0;
}
function findKey(row, candidates){
  const keys = Object.keys(row||{});
  const wanted = candidates.map(canon);
  for(const k of keys){
    const ck = canon(k);
    if (wanted.includes(ck)) return k;
    if (wanted.includes(ck.replace(/\?/g,""))) return k;
  }
  return null;
}
function classifyEmpType(v){
  const x = canon(v);
  if (!x) return "UNKNOWN";
  if (/(amzn|amazon|blue badge|bb|fte|full time|part time|pt)\b/.test(x)) return "AMZN";
  if (/(temp|temporary|seasonal|agency|vendor|contract|white badge|wb|csg|adecco|randstad)/.test(x)) return "TEMP";
  return "UNKNOWN";
}

// Day vs Night from timestamp (used for PostingAcceptance shift filtering)
function classifyShift(ts){
  if (!ts) return null;
  const m = String(ts).match(/T(\d{2}):(\d{2})/);
  if (!m) return null;
  const hh = +m[1], mm = +m[2];
  const mins = hh*60 + mm;
  if (mins >= 7*60 && mins <= 18*60+59) return "Day";
  if (mins >= 19*60 || mins <= 6*60+30) return "Night";
  return null;
}

// Normalize a Set of IDs using normalizeId
const normalizeSet = (s) => new Set([...s].map((id) => normalizeId(id)));

const normLogin = (x) => {
  if (x == null) return "";
  let s = String(x).trim().toLowerCase();
  if (s.includes("@")) s = s.split("@", 1)[0];
  return s.replace(/[^a-z0-9]/g, "");
};

function parseCSVFile(file, opts={header:true, skipFirstLine:false}){
  return new Promise((resolve,reject)=>{
    const r=new FileReader();
    r.onerror=()=>reject(new Error("Failed to read file"));
    r.onload=()=>{
      let text=r.result;
      if (opts.skipFirstLine){
        const i=text.indexOf("\n");
        text = i>=0 ? text.slice(i+1) : text;
      }
      Papa.parse(text,{header:opts.header,skipEmptyLines:true,transformHeader:h=>h.trim(),complete:res=>resolve(res.data)});
    };
    r.readAsText(file);
  });
}
function downloadCSV(filename, rows){
  const headers = Object.keys(rows[0]||{id:"id",dept_bucket:"dept_bucket",emp_type:"emp_type",corner:"corner",date:"date",reason:"reason"});
  const csv=[headers.join(",")].concat(
    rows.map(r=>headers.map(h=>`"${String(r[h]??"").replace(/"/g,'""')}"`).join(","))
  ).join("\n");
  const url=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));
  const a=document.createElement("a"); a.href=url; a.download=filename; document.body.appendChild(a); a.click();
  setTimeout(()=>{URL.revokeObjectURL(url); a.remove();},0);
}
function deriveCornersFromRoster(rows){
  if (!rows || !rows.length) return [];
  const r0 = rows[0] || {};
  const R_COR = findKey(r0, ["Corner","Corner Code"]);
  const R_SP  = findKey(r0, ["Shift Pattern","Schedule Pattern","Shift"]);
  const set = new Set();
  for (const r of rows){
    const sp = String(r[R_SP] ?? "");
    const c = R_COR ? String(r[R_COR] ?? "").trim() : (sp ? sp.slice(0,2) : "");
    if (c) set.add(c);
  }
  return [...set];
}
// Classify Day/Night from a timestamp *in local time* (handles Z and ±HH:MM)
function classifyShiftLocal(ts){
  if (!ts) return null;
  const d = new Date(String(ts).trim());
  if (isNaN(d)) return null;
  const hh = d.getHours(), mm = d.getMinutes();
  const mins = hh*60 + mm;
  if (mins >= 7*60 && mins <= 18*60+59) return "Day";
  return "Night";
}

// ================== PROCESS ==================
async function processAll(){
  fileStatus.textContent = "Parsing…";
  try{
    if (!rosterEl.files[0] || !mytimeEl.files[0]) throw new Error("Upload Roster and MyTime CSVs.");

    // read all files
    const [rosterRaw, mytimeRaw, vacRaw, swapOutRaw, swapInRaw, vetRaw] = await Promise.all([
      parseCSVFile(rosterEl.files[0], {header:true}),
      parseCSVFile(mytimeEl.files[0], {header:true, skipFirstLine:true}), // MyTime header on row 2
      // Hours Summary header on row 2 (skip banner line)
      vacEl.files[0]     ? parseCSVFile(vacEl.files[0], {header:true, skipFirstLine:true}) : Promise.resolve([]),
      swapOutEl.files[0] ? parseCSVFile(swapOutEl.files[0], {header:true}) : Promise.resolve([]),
      swapInEl.files[0]  ? parseCSVFile(swapInEl.files[0],  {header:true}) : Promise.resolve([]),
      vetEl.files[0]     ? parseCSVFile(vetEl.files[0],     {header:true}) : Promise.resolve([]),
    ]);

    const isoDate = dateEl.value;
    const dayName = new Date(isoDate+"T00:00:00").toLocaleDateString("en-US",{weekday:"long"});
    chipDay.textContent = dayName;
    chipShift.textContent = shiftEl.value;

    let cornerCodes = SETTINGS.shift_schedule?.[shiftEl.value]?.[dayName] || [];
    let cornerSource = "settings";
    if (!cornerCodes.length){
      cornerCodes = deriveCornersFromRoster(rosterRaw);
      cornerSource = "derived";
    }
    chipCorners.textContent = cornerCodes.join(" ");
    chipCornerSource.textContent = cornerSource==="derived" ? "(derived)" : "";

    // MyTime on-prem map
    const m0 = mytimeRaw[0] || {};
    const M_ID = findKey(m0, ["Person ID","Employee ID","Person Number","ID"]);
    const M_ON = findKey(m0, ["On Premises","On Premises?","OnPremises"]);
    if (!M_ID || !M_ON) throw new Error("MyTime must include Person/Employee ID and On Premises.");
    const onPrem = new Map();
    const markers = (SETTINGS.present_markers||["X"]).map(s=>String(s).toUpperCase());
    for (const r of mytimeRaw){
      const id = normalizeId(r[M_ID]); if (!id) continue;
      const val = presentVal(r[M_ON], markers) || false;
      onPrem.set(id, (onPrem.get(id)||false) || val);
    }

    // Roster enrich (build full roster first)
    const r0 = rosterRaw[0] || {};
    const R_ID   = findKey(r0, ["Employee ID","Person Number","Person ID","Badge ID","ID"]);
    const R_DEPT = findKey(r0, ["Department ID","Home Department ID","Dept ID"]);
    const R_AREA = findKey(r0, ["Management Area ID","Mgmt Area ID","Area ID","Area"]);
    const R_TYPE = findKey(r0, ["Employment Type","Associate Type","Worker Type","Badge Type","Company"]);
    const R_SP   = findKey(r0, ["Shift Pattern","Schedule Pattern","Shift"]);
    const R_COR  = findKey(r0, ["Corner","Corner Code"]);
    const R_HIRE = findKey(r0, ["Employment Start Date","Hire Date","Start Date"]);
    const R_UID  = findKey(r0, ["User ID","Login","Username","UserID","User"]);
    if (!R_ID || !R_DEPT || !(R_SP||R_COR)) throw new Error("Roster must include Employee ID, Department ID, and Shift Pattern/Corner.");

    const first2 = s=> (s||"").slice(0,2);
    const firstAndThird = s => (s?.length>=3 ? s[0]+s[2] : "");

    // full roster rows (no UI filtering)
    const rosterFullRows = rosterRaw.map(r=>{
      const id = normalizeId(r[R_ID]);
      const deptId = String(r[R_DEPT]??"").trim();
      const area = String((R_AREA? r[R_AREA] : "")??"").trim();
      const typ = classifyEmpType(r[R_TYPE]);
      const sp  = String((R_SP? r[R_SP] : "")??"");
      const cornerFull = R_COR ? String(r[R_COR]??"").trim() : sp;
      const corner = first2(cornerFull); // LEFT(Corner,2)
      const met = firstAndThird(sp);
      const start = R_HIRE ? parseDateLoose(r[R_HIRE]) : null;
      const onp = onPrem.get(id)===true;
      const login = R_UID ? normLogin(r[R_UID]) : "";
      return { id, deptId, area, typ, corner, met, start, onp, login };
    });

    const fullById = new Map(rosterFullRows.map(x=>[x.id,x]));
    const loginToEid = new Map(rosterFullRows
      .filter(x=>x.login && x.id)
      .map(x=>[x.login, x.id]));

    // Apply UI filters to get working roster slice for dashboard
    let roster = rosterFullRows.slice();
    if (cornerCodes.length) {
      roster = roster.filter(x =>
        cornerCodes.some(cc => (x.corner||"").slice(0,2).toUpperCase() === cc.slice(0,2).toUpperCase())
      );
    }

    if (newHireEl.checked){
      const d0 = new Date(isoDate+"T00:00:00");
      roster = roster.filter(x=>{
        if (!x.start) return true;
        const days = Math.floor((d0-x.start)/(1000*60*60*24));
        return days>=3;
      });
    }

    const byId = new Map(roster.map(x=>[x.id,x])); // filtered slice (current shift)

    // dept helpers
    const cfg = SETTINGS.departments;
    const depts = ["Inbound","DA","ICQA","CRETs"];
    const bucketOf = x => {
      const dept = String(x.deptId || "").trim();
      const area = String(x.area || "").trim();
      if (cfg.ICQA.dept_ids.includes(dept) && area === String(cfg.ICQA.management_area_id)) return "ICQA";
      if (cfg.CRETs.dept_ids.includes(dept) && area === String(cfg.CRETs.management_area_id)) return "CRETs";
      if (cfg.DA.dept_ids.includes(dept)) return "DA";
      if (cfg.Inbound.dept_ids.includes(dept)) return "Inbound";
      return "Other";
    };
    const mkRow = () => Object.fromEntries(depts.map(d=>[d,{AMZN:0,TEMP:0,TOTAL:0}])); // simple 2-bucket counts
    const pushCount = (ACC, row)=>{
      const b=bucketOf(row); if (!depts.includes(b)) return;
      if (row.typ==="AMZN"){ACC[b].AMZN++; ACC[b].TOTAL++;}
      else if (row.typ==="TEMP"){ACC[b].TEMP++; ACC[b].TOTAL++;}
    };
    const sumTotals = ACC => depts.reduce((s,d)=>s+ACC[d].TOTAL,0);

    // ====== Hours Summary: Vacation (>=9.5h) & Banked Holiday (>=11.9h) ======
    const vacSet = new Set();
    const bhSet  = new Set();

    if (vacRaw.length){
      const v0   = vacRaw[0] || {};
      const V_ID = findKey(v0, ["Employee ID","Person ID","Person Number","Badge ID","ID"]);
      const V_DT = findKey(v0, ["Date","Worked Date","Shift Date","Business Date","Shift Start Date"]);

      // helper: nth key fallback by Excel column letter (0-based: A=0... Q=16, S=18)
      const nthKey = (row, idx) => {
        const ks = Object.keys(row||{});
        return (idx >= 0 && idx < ks.length) ? ks[idx] : null;
      };

      // Prefer names; fallback to positions Q=16 (BH) and S=18 (Vacation)
      const V_BH  = Object.keys(v0).find(k => /(banked\s*holiday|\bbh\b)/i.test(k)) || nthKey(v0, 16);
      const V_VAC = Object.keys(v0).find(k => /vacation/i.test(k))                     || nthKey(v0, 18);

      const dateMatches = row => {
        if (!V_DT) return true;
        const dISO = toISODate(row[V_DT]);
        return dISO === isoDate;
      };

      if (V_ID && (V_BH || V_VAC)) {
        for (const r of vacRaw){
          if (!dateMatches(r)) continue;
          const id = normalizeId(r[V_ID]); if (!id) continue;

          if (V_BH && r[V_BH] != null) {
            const bhH = hoursToNumber(r[V_BH]);
            if (bhH >= 11.9) bhSet.add(id);
          }
          if (V_VAC && r[V_VAC] != null) {
            const vacH = hoursToNumber(r[V_VAC]);
            if (vacH >= 9.5) vacSet.add(id);
          }
        }
      } else {
        // Fallback: pay code style
        const V_PC = findKey(v0, ["Pay Code","PayCode","Earning Code"]);
        const V_AB = findKey(v0, ["Absence Name","Absence Type","Time Off Type","Time-Off Type","Category"]);
        const V_HR = findKey(v0, ["Hours","Total Hours","Duration","Qty","Quantity","Scheduled Hours"]);
        const getLabel = (row) => String(row[V_PC ?? V_AB] ?? row[V_AB ?? V_PC] ?? "").toLowerCase();

        for (const r of vacRaw){
          if (!dateMatches(r)) continue;
          const id  = normalizeId(V_ID ? r[V_ID] : null);
          if (!id) continue;
          const label = getLabel(r);
          const hrs   = hoursToNumber(V_HR ? r[V_HR] : null);

          if (/(banked|holiday\s*bank|banked-?holiday|\bbh\b)/.test(label) && hrs >= 11.9){
            bhSet.add(id);
          } else if (/(vac|pto|annual|paid\s*time\s*off)/.test(label) && hrs >= 9.5){
            vacSet.add(id);
          }
        }
      }
    }

    /* ====== Helper: classify shift safely by local hour ====== */
    function classifyShiftSafe(ts){
      if (!ts) return null;
      const d = new Date(String(ts).trim());
      if (isNaN(d)) return null;
      const h = d.getHours(), m = d.getMinutes();
      const mins = h * 60 + m;
      return (mins >= 7*60 && mins <= 18*60+59) ? "Day" : "Night";
    }

    /* ====== PostingAcceptance: VET/VTO (date + shift safe) ====== */
    let vetSet = new Set(), vtoSet = new Set();
    if (vetRaw && vetRaw.length) {
      const a0 = vetRaw[0];
      const A_CLASS = findKey(a0, ["_class","class"]);
      const A_ID    = findKey(a0, ["employeeId","Employee ID","Person ID","Person Number","EID"]);
      const A_LOGIN = findKey(a0, ["employeeLogin","Employee Login","login","user","username"]);
      const A_TYP   = findKey(a0, ["opportunity.type","Opportunity Type","Type"]);
      const A_ACC   = findKey(a0, ["opportunity.acceptedCount","Accepted Count","acceptedCount"]);
      const A_FLAG  = findKey(a0, ["isAccepted","employeeAccepted","isManual"]);
      const A_STAT  = findKey(a0, ["status","opportunity.status"]);
      const A_S1    = findKey(a0, ["opportunity.shiftStart","shiftStart","start"]);
      const A_T1    = findKey(a0, ["acceptanceTime","acceptedAt","createdAt"]);
      const A_OPID  = findKey(a0, ["opportunity.id","opportunityId","Opportunity Id","id"]);

      const dateFromTs = v => {
        const m = String(v||"").match(/^(\d{4}-\d{2}-\d{2})/);
        return m ? m[1] : null;
      };
      const typeClass = raw => {
        const t = String(raw||"").toLowerCase();
        if (t.includes("vto")) return "VTO";
        if (t.includes("vet") || t.includes("overtime")) return "VET";
        return null;
      };
      const wasAccepted = r => {
        const cnt  = A_ACC  ? Number(r[A_ACC]) : NaN;
        const flag = A_FLAG ? String(r[A_FLAG]).trim().toLowerCase() : "";
              const stat = A_STAT ? String(r[A_STAT]).trim().toUpperCase() : "";
        return (Number.isFinite(cnt) && cnt > 0)
            || ["true","1","yes"].includes(flag)
            || ["ACCEPTED","APPROVED","COMPLETED"].includes(stat);
      };

      const wantDate  = dateEl.value;
      const wantShift = shiftEl.value;

      const firstLevel = new Set();
      const perType = { VET: new Set(), VTO: new Set() };

      for (const r of vetRaw) {
        if (A_CLASS) {
          const cls = String(r[A_CLASS]||"");
          if (!/AcceptancePostingAcceptanceRecord/i.test(cls)) continue;
        }

        let empId = A_ID ? normalizeId(r[A_ID]) : "";
        if (!empId && A_LOGIN) {
          const lg = normLogin(r[A_LOGIN]);
          empId = loginToEid.get(lg) || "";
        }
        if (!empId) continue;

        if (!wasAccepted(r)) continue;

        const dISO = dateFromTs(r[A_S1]) || dateFromTs(r[A_T1]);
        if (dISO !== wantDate) continue;

        const tClass = typeClass(r[A_TYP]);
        if (!tClass) continue;

        const sType = classifyShiftSafe(r[A_S1] || r[A_T1]);
        if (sType && sType !== wantShift) continue;

        if (!fullById.has(empId)) continue;

        const oppId = A_OPID ? (r[A_OPID] || "") : "";
        const k1 = `${empId}|${dISO}|${tClass}|${oppId}`;
        if (firstLevel.has(k1)) continue;
        firstLevel.add(k1);
        perType[tClass].add(`${empId}|${dISO}|${tClass}`);
      }

      const pairsVTO = new Set([...perType.VTO].map(k => k.split("|")[0]));
      const pairsVET = new Set([...perType.VET].map(k => k.split("|")[0]));
      const vetRawSet = new Set();
      const vtoRawSet = new Set();
      for (const id of pairsVTO) vtoRawSet.add(id);
      for (const id of pairsVET) if (!pairsVTO.has(id)) vetRawSet.add(id);

      vetSet = normalizeSet(vetRawSet);
      vtoSet = normalizeSet(vtoRawSet);
    }

    // ====== Swaps (split by Shift Type Day/Night if column available) ======
    const collectSwaps=(rows,mapping)=>{
      const out=[], inn=[];
      if (!rows.length) return {out,inn};
      const s0=rows[0];

      const S_ID    = findKey(s0, mapping.id || DEFAULT_SETTINGS.swap_mapping.id);
      const S_ST    = findKey(s0, mapping.status || DEFAULT_SETTINGS.swap_mapping.status);
      const S_SKIP  = findKey(s0, mapping.skip_date || DEFAULT_SETTINGS.swap_mapping.skip_date);
      const S_WORK  = findKey(s0, mapping.work_date || DEFAULT_SETTINGS.swap_mapping.work_date);
      const S_SHIFT = findKey(s0, ["Shift Type","Shift","Shift Name","ShiftTime"]); // optional

      const APPROVED = (mapping.approved_statuses || DEFAULT_SETTINGS.swap_mapping.approved_statuses)
        .map(s=>String(s).toUpperCase());

      const wantShift = shiftEl.value === "Night" ? /^NIGHT/i : /^DAY/i;

      for (const r of rows){
        const id = normalizeId(r[S_ID]); if (!id) continue;

        const st = String(r[S_ST] ?? "Approved").toUpperCase();
        const ok = !S_ST || APPROVED.includes(st) || /APPROVED|COMPLETED|ACCEPTED/.test(st);
        if (!ok) continue;

        const sv = S_SHIFT ? String(r[S_SHIFT]).trim() : "";
        if (S_SHIFT && sv && !wantShift.test(sv)) continue;

        const skipISO = toISODate(r[S_SKIP]);
        const workISO = toISODate(r[S_WORK]);

        if (skipISO===isoDate) out.push(id);
        if (workISO===isoDate) inn.push(id);
      }
      return {out,inn};
    };

    const mapping = SETTINGS.swap_mapping || DEFAULT_SETTINGS.swap_mapping;
    const S1 = collectSwaps(swapOutRaw, mapping);
    const S2 = collectSwaps(swapInRaw,  mapping);
    const swapOutSet = new Set([...S1.out, ...S2.out]);
    const swapInSet  = new Set([...S1.inn, ...S2.inn]);

    // ====== Build cohorts ======
    // Expected = roster slice MINUS Vacation & Banked Holiday only.
    // DO NOT exclude Swap-Out or VTO from Expected.
    const excluded = new Set();
    for (const id of vacSet) if (byId.has(id)) excluded.add(id);  // Vacation
    for (const id of bhSet)  if (byId.has(id)) excluded.add(id);  // Banked Holiday
    // (intentionally NOT excluding VTO or Swap-Out)

    const cohortExpected = roster.filter(x => !excluded.has(x.id));

    // Present (Excluding Swaps) = Expected who are on-prem AND not Swap-Out
    const cohortPresentExSwaps = cohortExpected.filter(x => x.onp && !swapOutSet.has(x.id));

    // rows for display
    const swapOutRows        = [...swapOutSet].map(id=>byId.get(id)).filter(Boolean);
    const swapInExpectedRows = [...swapInSet].map(id=>fullById.get(id)).filter(Boolean);
    const swapInPresentRows  = swapInExpectedRows.filter(x=>onPrem.get(x.id)===true);

    const vetExpectedRows = [...vetSet].map(id=>byId.get(id)||fullById.get(id)).filter(Boolean);
    const vetPresentRows  = vetExpectedRows.filter(x=>onPrem.get(x.id)===true);

    // ---------- Dashboard table ----------
    const row_RegularExpected   = mkRow(); cohortExpected.forEach(x=>pushCount(row_RegularExpected,x));
    const row_RegularPresentExS = mkRow(); cohortPresentExSwaps.forEach(x=>pushCount(row_RegularPresentExS,x));
    const row_SwapOut           = mkRow(); swapOutRows.forEach(x=>pushCount(row_SwapOut,x));
    const row_SwapInExpected    = mkRow(); swapInExpectedRows.forEach(x=>pushCount(row_SwapInExpected,x));
    const row_SwapInPresent     = mkRow(); swapInPresentRows.forEach(x=>pushCount(row_SwapInPresent,x));
    const row_VTO               = mkRow(); [...vtoSet].map(id=>byId.get(id)||fullById.get(id)).filter(Boolean).forEach(x=>pushCount(row_VTO,x));
    const row_VETExpected       = mkRow(); vetExpectedRows.forEach(x=>pushCount(row_VETExpected,x));
    const row_VETPresent        = mkRow(); vetPresentRows.forEach(x=>pushCount(row_VETPresent,x));

    const header = `
      <thead>
        <tr>
          <th>Attendance Details</th>
          ${depts.map(d=>`<th>${d} AMZN</th><th>${d} TEMP</th>`).join("")}
          <th>Total</th>
        </tr>
      </thead>`;
    const rowHTML = (label,ACC)=>{
      const cells = depts.map(d=>`<td>${ACC[d].AMZN}</td><td>${ACC[d].TEMP}</td>`).join("");
      const total = sumTotals(ACC);
      return `<tr><td>${label}</td>${cells}<td>${total}</td></tr>`;
    };
    replicaTable.innerHTML = header + "<tbody>"
      + rowHTML("Regular HC (Cohort Expected)", row_RegularExpected)
      + rowHTML("Regular HC Present (Excluding Swaps)", row_RegularPresentExS)
      + rowHTML("Shift Swap Out", row_SwapOut)
      + rowHTML("Shift Swap Expected", row_SwapInExpected)
      + rowHTML("Shift Swap Present", row_SwapInPresent)
      + rowHTML("VTO", row_VTO)
      + rowHTML("VET Expected", row_VETExpected)
      + rowHTML("VET Present", row_VETPresent)
      + "</tbody>";

    // ---------- Ribbon chips (restricted to current shift slice only) ----------
    const vacRows = [...vacSet]
      .map(id=>byId.get(id))      // no fullById fallback -> prevents opposite shift leakage
      .filter(Boolean)
      .map(x=>({ id:x.id, dept_bucket:bucketOf(x), emp_type:x.typ, corner:x.corner, date:isoDate, reason:"Vacation" }));

    const bhRows  = [...bhSet]
      .map(id=>byId.get(id))
      .filter(Boolean)
      .map(x=>({ id:x.id, dept_bucket:bucketOf(x), emp_type:x.typ, corner:x.corner, date:isoDate, reason:"Banked Holiday" }));

    chipVacationCount.textContent = vacRows.length;
    chipBHCount.textContent = bhRows.length;

    const buildURL = (rows)=> {
      const headers=["id","dept_bucket","emp_type","corner","date","reason"];
      const csv=[headers.join(",")].concat(rows.map(r=>headers.map(h=>`"${String(r[h]??"").replace(/"/g,'""')}"`).join(","))).join("\n");
      const url=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));
      return url;
    };
    chipVacation.href = buildURL(vacRows.length?vacRows:[{id:"",dept_bucket:"",emp_type:"",corner:"",date:isoDate,reason:"Vacation"}]);
    chipBH.href = buildURL(bhRows.length?bhRows:[{id:"",dept_bucket:"",emp_type:"",corner:"",date:isoDate,reason:"Banked Holiday"}]);

    // ---------- No-Show CSV ----------
    const noShows = cohortExpected.filter(x=>!x.onp).map(x=>({
      id:x.id, dept_bucket:bucketOf(x), emp_type:x.typ, corner:x.corner, date:isoDate, reason:"No-Show"
    }));
    btnNoShow.onclick = ()=> downloadCSV(`no_shows_${isoDate}.csv`, noShows.length?noShows:[{id:"",dept_bucket:"",emp_type:"",corner:"",date:isoDate,reason:"No-Show"}]);

    // ================= AUDIT TABLE =================
    // Priority: Vacation > BH > VTO > Swap-Out > VET-not-shown > No-Show
    const reasonOf = new Map(); // id -> reason
    const tag = (ids, reason)=>{ for (const id of ids){ if (byId.has(id) && !reasonOf.has(id)) reasonOf.set(id, reason); } };

    tag(vacSet, "Vacation / PTO");
    tag(bhSet,  "Banked Holiday");
    tag(vtoSet, "VTO accepted");
    tag(swapOutSet, "Swap-Out");

    for (const x of vetExpectedRows){
      if (onPrem.get(x.id)!==true && !reasonOf.has(x.id)) reasonOf.set(x.id, "VET accepted but not shown");
    }
    for (const x of cohortExpected){
      if (x.onp!==true && !reasonOf.has(x.id)) reasonOf.set(x.id, "No-Show (plain)");
    }

    const auditReasons = [
      "Vacation / PTO",
      "Banked Holiday",
      "VTO accepted",
      "Swap-Out",
      "VET accepted but not shown",
      "No-Show (plain)"
    ];
    const auditCounts = Object.fromEntries(auditReasons.map(r=>[r, mkRow()]));
    for (const [id, reason] of reasonOf.entries()){
      const row = byId.get(id) || fullById.get(id);
      if (!row) continue;
      pushCount(auditCounts[reason], row);
    }

    const auditHeader = `
      <thead>
        <tr>
          <th>Absence Reason</th>
          ${depts.map(d=>`<th>${d} AMZN</th><th>${d} TEMP</th>`).join("")}
          <th>Total</th>
        </tr>
      </thead>`;
    const auditBody = auditReasons.map(label=>{
      const ACC = auditCounts[label];
      const cells = depts.map(d=>`<td>${ACC[d].AMZN}</td><td>${ACC[d].TEMP}</td>`).join("");
      const total = sumTotals(ACC);
      return `<tr><td>${label}</td>${cells}<td>${total}</td></tr>`;
    }).join("");
    auditTable.innerHTML = auditHeader + "<tbody>" + auditBody + "</tbody>";

    const auditRows = [];
    for (const [id, reason] of reasonOf.entries()){
      const x = byId.get(id) || fullById.get(id); if (!x) continue;
      auditRows.push({ id:x.id, dept_bucket:bucketOf(x), emp_type:x.typ, corner:x.corner, date:isoDate, reason });
    }
    btnAuditCSV.onclick = ()=> downloadCSV(`audit_${isoDate}.csv`, auditRows.length?auditRows:[{id:"",dept_bucket:"",emp_type:"",corner:"",date:isoDate,reason:""}]);

    fileStatus.textContent = "Done";
  }catch(e){
    console.error(e);
    fileStatus.textContent="Error";
    alert(e.message || "Processing failed");
  }
}
