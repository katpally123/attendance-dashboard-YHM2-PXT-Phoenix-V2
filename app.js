// === Branding ===
const APP_NAME = "PXT Phoenix";
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
    id:["Employee 1 ID","Employee ID","Person ID","Person Number","Badge ID","ID","Associate ID","employeeId"],
    status:["Status","Swap Status"],
    skip_date:["Date to Skip","Skip Date","Skip"],
    work_date:["Date to Work","Work Date","Work"],
    approved_statuses:["Approved","Completed","Accepted","Success"]
  }
};
let SETTINGS = null;

// ================== DOM HOOKS ==================
const dateEl   = document.getElementById("dateInput");
const shiftEl  = document.getElementById("shiftInput");
const newHireEl= document.getElementById("excludeNewHires");
const auditToggle = document.getElementById("auditToggle");

const rosterEl = document.getElementById("rosterFile");
const mytimeEl = document.getElementById("mytimeFile");
const vacEl    = document.getElementById("vacFile");
const swapOutEl= document.getElementById("swapOutFile");
const swapInEl = document.getElementById("swapInFile");
const vetEl    = document.getElementById("vetFile");

const fileStatus = document.getElementById("fileStatus");
const processBtn = document.getElementById("processBtn");

// tabs
const tabDash   = document.getElementById("tabDashboard");
const tabAudit  = document.getElementById("tabAudit");
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
const auditTable   = document.getElementById("auditTable");
const btnNoShow    = document.getElementById("dlNoShow");
const btnAuditCSV  = document.getElementById("dlAuditCSV");

// ================== INIT ==================
(async function boot(){
  try {
    const res = await fetch(SETTINGS_URL, {cache:"no-store"});
    SETTINGS = res.ok ? await res.json() : DEFAULT_SETTINGS;
  } catch { SETTINGS = DEFAULT_SETTINGS; }

  // seed today
  const t = new Date(); dateEl.value = new Date(Date.UTC(t.getFullYear(),t.getMonth(),t.getDate())).toISOString().slice(0,10);
  shiftEl.value = "Day";
  updateRibbonStatic();

  tabDash.addEventListener("click", ()=>switchTab("dash"));
  tabAudit.addEventListener("click", ()=>switchTab("audit"));
  auditToggle.addEventListener("change", ()=>switchTab(auditToggle.checked ? "audit" : "dash"));

  dateEl.addEventListener("change", updateRibbonStatic);
  shiftEl.addEventListener("change", updateRibbonStatic);

  processBtn.addEventListener("click", processAll);
})();

function switchTab(which){
  const dash = which==="dash";
  tabDash.classList.toggle("active", dash);
  tabAudit.classList.toggle("active", !dash);
  panelDash.classList.toggle("hidden", !dash);
  panelAudit.classList.toggle("hidden", dash);
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
  return noLead || t.toUpperCase();
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
function parseHhMm(h){
  if (h==null) return 0;
  const s=String(h).trim();
  if (/^\d+:\d+$/.test(s)){ const [hh,mm]=s.split(":").map(Number); return hh+(mm/60); }
  const n = parseFloat(s.replace(/[^\d.]/g,""));
  return Number.isFinite(n)?n:0;
}
function hoursFromRowFlexible(row){
  const keys=["Hours","Hours Worked","Amount","Total Hours","Daily Hours","Duration","Qty","Quantity"];
  for(const k of keys){ if(row[k]!=null && String(row[k]).trim()!=="") return parseHhMm(row[k]); }
  return 0;
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
  if (!x) return "AMZN"; // default to AMZN if blank
  if (/(temp|temporary|seasonal|agency|vendor|contract|white badge|wb|csg|adecco|randstad)/.test(x)) return "TEMP";
  return "AMZN";
}
function normLogin(x){
  if (x == null) return "";
  let s = String(x).trim().toLowerCase();
  if (s.includes("@")) s = s.split("@", 1)[0];
  return s.replace(/[^a-z0-9]/g, "");
}

// parse CSV (auto-detect header row)
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

// ================== PROCESS ==================
async function processAll(){
  fileStatus.textContent = "Parsing…";
  try{
    if (!rosterEl.files[0] || !mytimeEl.files[0]) throw new Error("Upload Roster and MyTime CSVs.");

    // read all files (skipFirstLine for MyTime + Hours Summary banner rows)
    const [rosterRaw, mytimeRaw, vacRaw, swapOutRaw, swapInRaw, vetRaw] = await Promise.all([
      parseCSVFile(rosterEl.files[0], {header:true}),
      parseCSVFile(mytimeEl.files[0], {header:true, skipFirstLine:true}),
      vacEl.files[0]     ? parseCSVFile(vacEl.files[0], {header:true, skipFirstLine:true}) : Promise.resolve([]),
      swapOutEl.files[0] ? parseCSVFile(swapOutEl.files[0], {header:true}) : Promise.resolve([]),
      swapInEl.files[0]  ? parseCSVFile(swapInEl.files[0],  {header:true}) : Promise.resolve([]),
      vetEl.files[0]     ? parseCSVFile(vetEl.files[0],     {header:true}) : Promise.resolve([]),
    ]);

    const isoDate = dateEl.value;
    const dayName = new Date(isoDate+"T00:00:00").toLocaleDateString("en-US",{weekday:"long"});
    chipDay.textContent = dayName;
    chipShift.textContent = shiftEl.value;

    // derive corners (from settings or roster)
    let cornerCodes = SETTINGS.shift_schedule?.[shiftEl.value]?.[dayName] || [];
    let cornerSource = "settings";
    if (!cornerCodes.length){
      cornerCodes = deriveCornersFromRoster(rosterRaw);
      cornerSource = "derived";
    }
    chipCorners.textContent = cornerCodes.join(" ");
    chipCornerSource.textContent = cornerSource==="derived" ? "(derived)" : "";

    // ----- MyTime presence map -----
    const m0 = mytimeRaw[0] || {};
    const M_ID = findKey(m0, ["Person ID","Employee ID","Person Number","ID"]);
    if (!M_ID) throw new Error("MyTime must include Person/Employee ID.");
    const markers = (SETTINGS.present_markers||["X","Y","YES","TRUE","1"]).map(s=>String(s).toUpperCase());
    const onPrem = new Map();
    for (const r of mytimeRaw){
      let id = normalizeId(r[M_ID]); if (!id) continue;
      // explicit flags first…
      const keys = ["On Premise","On Premises","On Premises?","Present","On site","Onsite"];
      let present = false;
      for (const k of keys){
        const v = String(r[k]??"").toUpperCase().trim();
        if (markers.includes(v)) { present = true; break; }
      }
      // fallback: hours imply presence
      if (!present && hoursFromRowFlexible(r) > 0) present = true;
      if (present) onPrem.set(id, true);
    }

    // ----- Roster enrichment -----
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

    const rosterFullRows = rosterRaw.map(r=>{
      const id = normalizeId(r[R_ID]);
      const deptId = String(r[R_DEPT]??"").trim();
      const area = String((R_AREA? r[R_AREA] : "")??"").trim();
      const typ = classifyEmpType(r[R_TYPE]);
      const sp  = String((R_SP? r[R_SP] : "")??"");
      const cornerFull = R_COR ? String(r[R_COR]??"").trim() : sp;
      const corner = first2(cornerFull);
      const met = firstAndThird(sp);
      const start = R_HIRE ? parseDateLoose(r[R_HIRE]) : null;
      const onp = onPrem.get(id)===true;
      const login = R_UID ? normLogin(r[R_UID]) : "";
      return { id, deptId, area, typ, corner, met, start, onp, login };
    });

    const fullById = new Map(rosterFullRows.map(x=>[x.id,x]));
    const loginToEid = new Map(rosterFullRows.filter(x=>x.login && x.id).map(x=>[x.login, x.id]));

    // filter roster by corners (shift/day)
    let roster = rosterFullRows.slice();
    if (cornerCodes.length) {
      roster = roster.filter(x =>
        cornerCodes.some(cc => (x.corner||"").slice(0,2).toUpperCase() === cc.slice(0,2).toUpperCase())
      );
    }

    // exclude new hires
    if (newHireEl.checked){
      const d0 = new Date(isoDate+"T00:00:00");
      roster = roster.filter(x=>{
        if (!x.start) return true;
        const days = Math.floor((d0-x.start)/(1000*60*60*24));
        return days>=3;
      });
    }
    const byId = new Map(roster.map(x=>[x.id,x]));

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
    const mkRow = () => Object.fromEntries(depts.map(d=>[d,{AMZN:0,TEMP:0,TOTAL:0}]));
    const pushCount = (ACC, row)=>{
      const b=bucketOf(row); if (!depts.includes(b)) return;
      if (row.typ==="AMZN"){ACC[b].AMZN++; ACC[b].TOTAL++;}
      else if (row.typ==="TEMP"){ACC[b].TEMP++; ACC[b].TOTAL++;}
    };
    const sumTotals = ACC => depts.reduce((s,d)=>s+ACC[d].TOTAL,0);

    // ====== Hours Summary: Vacation (>=9.5h) & Banked Holiday (>=11.9h) ======
    const vacSet = new Set(), bhSet = new Set();
    if (vacRaw.length){
      const v0   = vacRaw[0] || {};
      const V_ID = findKey(v0, ["Employee ID","Person ID","Person Number","Badge ID","ID"]);
      const V_DT = findKey(v0, ["Date","Worked Date","Shift Date","Business Date","Shift Start Date"]);

      const namedBH  = Object.keys(v0).find(k => /(banked\s*holiday|\bbh\b)/i.test(k));
      const namedVAC = Object.keys(v0).find(k => /vacation|paid\s*personal\s*time|pto/i.test(k));

      const V_PC = findKey(v0, ["Pay Code","PayCode","Earning Code"]);
      const V_AB = findKey(v0, ["Absence Name","Absence Type","Time Off Name","Time Off Type","Category"]);
      const V_HR = findKey(v0, ["Hours","Total Hours","Duration","Qty","Quantity","Scheduled Hours","Amount"]);

      for (const r of vacRaw){
        if (V_DT){
          const dISO = toISODate(r[V_DT]); if (dISO && dISO !== isoDate) continue;
        }
        const id  = normalizeId(r[V_ID]); if (!id) continue;
        const label = String(r[V_PC] ?? r[V_AB] ?? "").toLowerCase();
        const bhH = namedBH  ? parseHhMm(r[namedBH])  : 0;
        const vaH = namedVAC ? parseHhMm(r[namedVAC]) : 0;
        const hrsFromPC = V_HR ? parseHhMm(r[V_HR]) : 0;

        if (bhH >= 11.9 || (/banked|holiday|bh/.test(label) && hrsFromPC >= 11.9)) bhSet.add(id);
        if (vaH >= 9.5  || (/(vac|paid\s*personal\s*time|pto)/.test(label) && hrsFromPC >= 9.5))  vacSet.add(id);
      }
    }

    // ====== Swaps ======
    const collectSwaps=(rows,mapping)=>{
      const out=[], inn=[];
      if (!rows.length) return {out,inn};
      const s0=rows[0];

      const S_ID    = findKey(s0, mapping.id || DEFAULT_SETTINGS.swap_mapping.id);
      const S_ST    = findKey(s0, mapping.status || DEFAULT_SETTINGS.swap_mapping.status);
      const S_SKIP  = findKey(s0, mapping.skip_date || DEFAULT_SETTINGS.swap_mapping.skip_date);
      const S_WORK  = findKey(s0, mapping.work_date || DEFAULT_SETTINGS.swap_mapping.work_date);
      const APPROVED = (mapping.approved_statuses || DEFAULT_SETTINGS.swap_mapping.approved_statuses)
        .map(s=>String(s).toUpperCase());

      for (const r of rows){
        let id = normalizeId(r[S_ID]); if (!id) continue;
        const st = String(r[S_ST] ?? "Approved").toUpperCase();
        if (S_ST && !APPROVED.includes(st) && !/APPROVED|COMPLETED|ACCEPTED|SUCCESS/.test(st)) continue;

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

    // ====== PostingAcceptance: VET/VTO ======
    let vetSet = new Set(), vtoSet = new Set();
    if (vetRaw && vetRaw.length) {
      const a0 = vetRaw[0];
      const A_ID    = findKey(a0, ["employeeId","Employee ID","Person ID","Person Number","EID"]);
      const A_LOGIN = findKey(a0, ["employeeLogin","Employee Login","login","user","username"]);
      const A_TYP   = findKey(a0, ["opportunity.type","Opportunity Type","Type"]);
      const A_ACC   = findKey(a0, ["opportunity.acceptedCount","Accepted Count","acceptedCount"]);
      const A_STAT  = findKey(a0, ["status","opportunity.status"]);
      const A_S1    = findKey(a0, ["opportunity.shiftStart","shiftStart","start"]);

      for (const r of vetRaw){
        let id = A_ID ? normalizeId(r[A_ID]) : "";
        if (!id && A_LOGIN){ const eid = loginToEid.get(normLogin(r[A_LOGIN])); if (eid) id = eid; }
        if (!id) continue;

        const accepted = (Number(r[A_ACC])>0) || /ACCEPTED|APPROVED|COMPLETED/i.test(String(r[A_STAT]||""));
        if (!accepted) continue;

        const dISO = toISODate(r[A_S1]); if (dISO && dISO !== isoDate) continue;

        const typ = String(r[A_TYP]||"").toUpperCase();
        if (typ.includes("VTO")) vtoSet.add(id);
        else if (typ.includes("VET") || typ.includes("OVERTIME")) vetSet.add(id);
      }
    }

    // ====== Build cohorts ======
    // Expected = roster slice MINUS Vacation & Banked Holiday only
    const excluded = new Set();
    for (const id of vacSet) if (byId.has(id)) excluded.add(id);
    for (const id of bhSet)  if (byId.has(id)) excluded.add(id);
    const cohortExpected = roster.filter(x => !excluded.has(x.id));

    // Present (Excluding Swaps) = Expected who are on-prem AND not Swap-Out
    const cohortPresentExSwaps = cohortExpected.filter(x => x.onp && !swapOutSet.has(x.id));

    // rows for display
    const swapOutRows        = [...swapOutSet].map(id=>byId.get(id)).filter(Boolean);
    const swapInExpectedRows = [...swapInSet].map(id=>fullById.get(id)).filter(Boolean);
    const swapInPresentRows  = swapInExpectedRows.filter(x=>onPrem.get(x.id)===true);
    const vetExpectedRows    = [...vetSet].map(id=>byId.get(id)||fullById.get(id)).filter(Boolean);
    const vetPresentRows     = vetExpectedRows.filter(x=>onPrem.get(x.id)===true);

    // ---------- Dashboard table ----------
    const mkRow = () => Object.fromEntries(depts.map(d=>[d,{AMZN:0,TEMP:0,TOTAL:0}]));
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

    // ---------- Ribbon chips (current shift slice only) ----------
    const bucketOf = x => {
      const dept = String(x.deptId || "").trim();
      const area = String(x.area || "").trim();
      if (cfg.ICQA.dept_ids.includes(dept) && area === String(cfg.ICQA.management_area_id)) return "ICQA";
      if (cfg.CRETs.dept_ids.includes(dept) && area === String(cfg.CRETs.management_area_id)) return "CRETs";
      if (cfg.DA.dept_ids.includes(dept)) return "DA";
      if (cfg.Inbound.dept_ids.includes(dept)) return "Inbound";
      return "Other";
    };

    const vacRows = [...vacSet].map(id=>byId.get(id)).filter(Boolean)
      .map(x=>({ id:x.id, dept_bucket:bucketOf(x), emp_type:x.typ, corner:x.corner, date:isoDate, reason:"Vacation" }));
    const bhRows  = [...bhSet].map(id=>byId.get(id)).filter(Boolean)
      .map(x=>({ id:x.id, dept_bucket:bucketOf(x), emp_type:x.typ, corner:x.corner, date:isoDate, reason:"Banked Holiday" }));

    chipVacationCount.textContent = vacRows.length;
    chipBHCount.textContent = bhRows.length;

    const buildURL = rows => {
      const headers=["id","dept_bucket","emp_type","corner","date","reason"];
      const csv=[headers.join(",")].concat(rows.map(r=>headers.map(h=>`"${String(r[h]??"").replace(/"/g,'""')}"`).join(","))).join("\n");
      return URL.createObjectURL(new Blob([csv],{type:"text/csv"}));
    };
    chipVacation.href = buildURL(vacRows.length?vacRows:[{id:"",dept_bucket:"",emp_type:"",corner:"",date:isoDate,reason:"Vacation"}]);
    chipBH.href = buildURL(bhRows.length?bhRows:[{id:"",dept_bucket:"",emp_type:"",corner:"",date:isoDate,reason:"Banked Holiday"}]);

    // ---------- No-Show & Audit CSV ----------
    const noShows = cohortExpected.filter(x=>!x.onp)
      .map(x=>({ id:x.id, dept_bucket:bucketOf(x), emp_type:x.typ, corner:x.corner, date:isoDate, reason:"No-Show" }));
    btnNoShow.onclick = ()=> downloadCSV(`no_shows_${isoDate}.csv`, noShows.length?noShows:[{id:"",dept_bucket:"",emp_type:"",corner:"",date:isoDate,reason:"No-Show"}]);

    // Audit reason priority
    const reasonOf = new Map();
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
    const auditBodyHTML = auditReasons.map(label=>{
      const ACC = auditCounts[label];
      const cells = depts.map(d=>`<td>${ACC[d].AMZN}</td><td>${ACC[d].TEMP}</td>`).join("");
      const total = sumTotals(ACC);
      return `<tr><td>${label}</td>${cells}<td>${total}</td></tr>`;
    }).join("");
    auditTable.innerHTML = auditHeader + "<tbody>" + auditBodyHTML + "</tbody>";

    const auditRows = [];
    for (const [id, reason] of reasonOf.entries()){
      const x = byId.get(id) || fullById.get(id); if (!x) continue;
      auditRows.push({ id:x.id, dept_bucket:bucketOf(x), emp_type:x.typ, corner:x.corner, date:isoDate, reason });
    }
    btnAuditCSV.onclick = ()=> downloadCSV(`audit_${isoDate}.csv`, auditRows.length?auditRows:[{id:"",dept_bucket:"",emp_type:"",corner:"",date:isoDate,reason:""}]);

    // flip to Audit if toggle on
    if (auditToggle.checked) switchTab("audit");

    fileStatus.textContent = "Done";
  }catch(e){
    console.error(e);
    fileStatus.textContent="Error";
    alert(e.message || "Processing failed");
  }
}

// ---------- Derive corners from roster ----------
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

function downloadCSV(filename, rows){
  const headers = Object.keys(rows[0]||{id:"id",dept_bucket:"dept_bucket",emp_type:"emp_type",corner:"corner",date:"date",reason:"reason"});
  const csv=[headers.join(",")].concat(
    rows.map(r=>headers.map(h=>`"${String(r[h]??"").replace(/"/g,'""')}"`).join(","))
  ).join("\n");
  const url=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));
  const a=document.createElement("a"); a.href=url; a.download=filename; document.body.appendChild(a); a.click();
  setTimeout(()=>{URL.revokeObjectURL(url); a.remove();},0);
}
