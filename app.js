// =====================================================================
// 「找位子」PWA v1.2 — app.js
// v1.2：全台縣市選擇（定位自動選）、充電品牌篩選、車位類型分列
// =====================================================================
"use strict";

const CONFIG = {
  WORKER: "https://parking.t0296684.workers.dev",
  DEFAULT_CITY: "Taoyuan",
  DEFAULT_ZOOM: 14,
  LIST_MAX: 40,
};

// 全台縣市（代碼 → 名稱與中心點，供定位反查與地圖置中）
const CITIES = {
  Keelung: ["基隆市", 25.13, 121.74], Taipei: ["臺北市", 25.04, 121.56],
  NewTaipei: ["新北市", 25.01, 121.45], Taoyuan: ["桃園市", 24.96, 121.22],
  Hsinchu: ["新竹市", 24.80, 120.97], HsinchuCounty: ["新竹縣", 24.70, 121.10],
  MiaoliCounty: ["苗栗縣", 24.56, 120.82], Taichung: ["臺中市", 24.15, 120.68],
  ChanghuaCounty: ["彰化縣", 24.05, 120.52], NantouCounty: ["南投縣", 23.90, 120.85],
  YunlinCounty: ["雲林縣", 23.70, 120.43], Chiayi: ["嘉義市", 23.48, 120.44],
  ChiayiCounty: ["嘉義縣", 23.46, 120.60], Tainan: ["臺南市", 23.00, 120.21],
  Kaohsiung: ["高雄市", 22.63, 120.30], PingtungCounty: ["屏東縣", 22.55, 120.55],
  YilanCounty: ["宜蘭縣", 24.70, 121.74], HualienCounty: ["花蓮縣", 23.90, 121.55],
  TaitungCounty: ["臺東縣", 22.90, 121.10], PenghuCounty: ["澎湖縣", 23.57, 119.58],
  KinmenCounty: ["金門縣", 24.44, 118.33], LienchiangCounty: ["連江縣", 26.16, 119.95],
};

// 車位類型代碼（交通部停車資料標準；實測若標示不符，改這裡即可）
const SPACE_TYPES = { 1: "一般", 2: "機車", 3: "大型車", 4: "身障", 5: "婦幼", 6: "充電" };

// ---------------------------------------------------------------- 純函式（可測試）
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function nearestCity(lat, lon) {
  let best = CONFIG.DEFAULT_CITY, bestD = Infinity;
  for (const [code, [, cLat, cLon]] of Object.entries(CITIES)) {
    const d = haversineKm(lat, lon, cLat, cLon);
    if (d < bestD) { bestD = d; best = code; }
  }
  return best;
}

function spaceLabel(t) { return SPACE_TYPES[t] || `類型${t}`; }

// 主要（一般車位）剩餘數：有分類時取一般，否則取總剩餘
function mainAvail(lot) {
  const g = (lot.spaces || []).find((s) => s.t === 1);
  if (g && typeof g.a === "number") return g.a;
  return typeof lot.avail === "number" ? lot.avail : null;
}

// 分類摘要字串：「一般 47｜身障 2｜婦幼 1」
function spacesSummary(spaces) {
  return (spaces || [])
    .filter((s) => typeof s.a === "number")
    .map((s) => `${spaceLabel(s.t)} ${s.a}`)
    .join("｜");
}

function availLevel(avail) {
  if (avail === null || avail === undefined) return "none";
  if (avail < 5) return "low";
  if (avail <= 20) return "mid";
  return "high";
}

function fmtDist(km) {
  if (km === null || km === undefined) return "";
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

function shortText(t, n = 46) {
  if (!t) return "";
  const clean = String(t).replace(/\s+/g, " ").trim();
  return clean.length > n ? clean.slice(0, n) + "…" : clean;
}

function firstNum() {
  for (let i = 0; i < arguments.length; i++) {
    const v = arguments[i];
    if (typeof v === "number" && !isNaN(v)) return v;
  }
  return null;
}

// 導航目標點 = 停車場入口：優先使用資料提供的入口座標，否則退回代表點
function entryPoint(item) {
  const e = (item.entrances && item.entrances[0]) || null;
  const lat = firstNum(item.entranceLat, item.gateLat, e && (e.lat != null ? e.lat : (Array.isArray(e) ? e[0] : undefined)));
  const lon = firstNum(item.entranceLon, item.gateLon, e && (e.lon != null ? e.lon : (Array.isArray(e) ? e[1] : undefined)));
  if (lat != null && lon != null) return { lat, lon, explicit: true };
  return { lat: item.lat, lon: item.lon, explicit: false };
}

function navUrl(item) {
  // 相容舊呼叫 navUrl(lat, lon)
  if (typeof item === "number") {
    return `https://www.google.com/maps/dir/?api=1&destination=${item},${arguments[1]}&travelmode=driving`;
  }
  return navLinks(item).google;
}

function navLinks(item) {
  const p = entryPoint(item);
  const q = (!p.explicit && item.name)
    ? encodeURIComponent([item.name, item.address].filter(Boolean).join(" "))
    : null;
  const coord = `${p.lat},${p.lon}`;
  return {
    google: `https://www.google.com/maps/dir/?api=1&destination=${q || coord}&travelmode=driving`,
    apple: `https://maps.apple.com/?daddr=${q || coord}&dirflg=d`,
    waze: `https://waze.com/ul?ll=${coord}&navigate=yes`,
  };
}

function openNavChooser(item) {
  const el = document.getElementById("navsheet");
  const links = navLinks(item);
  el.innerHTML = `<div class="grab"></div><div class="pullhint">⌄</div>
    <p class="navtitle">導航到「${esc(shortText(item.name || "目的地", 18))}」</p>
    <a class="navopt" href="${links.google}" target="_blank" rel="noopener"><span class="ic g">G</span>Google Maps</a>
    <a class="navopt" href="${links.apple}" target="_blank" rel="noopener"><span class="ic a">&#63743;</span>Apple 地圖</a>
    <a class="navopt" href="${links.waze}" target="_blank" rel="noopener"><span class="ic w">W</span>Waze</a>
    <button class="navcancel">取消</button>`;
  el.querySelectorAll(".navopt").forEach((a) => a.addEventListener("click", closeNavChooser));
  el.querySelector(".navcancel").addEventListener("click", closeNavChooser);
  el.classList.add("open");
  document.getElementById("scrim").classList.add("open");
}

// ---- 下拉關閉手勢（詳情面板與導航選單共用）----
function enableDragClose(el, onClose) {
  let startY = null, curY = 0, startT = 0, dragging = false;
  el.addEventListener("touchstart", (e) => {
    if (el.scrollTop > 0) return; // 內容捲動中不攔截
    startY = e.touches[0].clientY; startT = Date.now(); curY = 0; dragging = true;
    el.style.transition = "";
  }, { passive: true });
  el.addEventListener("touchmove", (e) => {
    if (!dragging || startY === null) return;
    curY = Math.max(0, e.touches[0].clientY - startY);
    el.style.transform = curY > 0 ? `translateY(${curY}px)` : "";
  }, { passive: true });
  el.addEventListener("touchend", () => {
    if (!dragging) return;
    dragging = false;
    const fast = curY > 40 && Date.now() - startT < 260;
    if (curY > Math.max(90, el.offsetHeight / 4) || fast) {
      el.style.transition = "transform .18s ease";
      el.style.transform = "translateY(110%)";
      setTimeout(() => { el.style.transform = ""; el.style.transition = ""; onClose(); }, 180);
    } else {
      el.style.transition = "transform .18s ease";
      el.style.transform = "";
      setTimeout(() => { el.style.transition = ""; }, 200);
    }
    startY = null; curY = 0;
  });
}

function closeNavChooser() {
  document.getElementById("navsheet").classList.remove("open");
  if (!document.getElementById("detail").classList.contains("open")) {
    document.getElementById("scrim").classList.remove("open");
  }
}

function badgeFor(item) {
  if (item.kind === "priv") return { cls: "priv", text: "民營·無即時" };
  if (item.kind === "ev") return { cls: "ev", text: `⚡ ${item.points || "?"} 樁` };
  const m = mainAvail(item);
  const lv = availLevel(m);
  const hasTypes = (item.spaces || []).some((s) => s.t === 1);
  const text = lv === "none" ? "無即時" : `${hasTypes ? "一般剩" : "剩"} ${m} 位`;
  return { cls: lv, text };
}

function brandList(stations) {
  const count = {};
  for (const s of stations) for (const b of s.brands || []) count[b] = (count[b] || 0) + 1;
  return Object.keys(count).sort((a, b) => {
    if (a === "Tesla") return -1;
    if (b === "Tesla") return 1;
    return count[b] - count[a];
  });
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------------------------------------------------------------- 應用狀態
const state = {
  city: CONFIG.DEFAULT_CITY,
  lots: [], stations: [], privLots: [], showPriv: true, showLm: true, pinMode: "avail", userPos: null,
  filter: "all", brand: null,
  map: null, layer: null, userMarker: null,
};

// ---------------------------------------------------------------- 資料載入
async function fetchJson(path) {
  const resp = await fetch(`${CONFIG.WORKER}${path}${path.includes("?") ? "&" : "?"}t=${Date.now()}`,
                           { cache: "no-store" });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

async function loadAll() {
  setBanner("");
  setUpdated("更新中…");
  try {
    const [p, c] = await Promise.all([
      fetchJson(`/api/parking?city=${state.city}`),
      fetchJson(`/api/charging?city=${state.city}`),
    ]);
    state.lots = (p.lots || []).filter((l) => l.lat && l.lon).map((l) => ({ ...l, kind: "lot" }));
    state.stations = (c.stations || []).map((s) => ({ ...s, kind: "ev" }));
    if (p.liveError) setBanner(`即時車位暫時無法取得（${p.liveError}），僅顯示靜態資訊`);
    else if (!state.lots.length && !state.stations.length)
      setBanner(`${CITIES[state.city][0]} 目前沒有可用的停車/充電開放資料`);
    const t = new Date(p.updatedAt);
    setUpdated(`${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")} 更新`);
    renderBrandChips();
    render();
  } catch (e) {
    setBanner(`載入失敗：${e.message}。請檢查網路後按 ↻ 重試。`);
    setUpdated("載入失敗");
  }
}

function setCity(code, { pan = true } = {}) {
  if (!CITIES[code] || code === state.city) return;
  state.city = code;
  state.brand = null;
  state.privLots = [];
  _lmKey = "";
  try { localStorage.setItem("zhaoweizi.city", code); } catch {}
  const sel = document.getElementById("citySel");
  if (sel) sel.value = code;
  if (pan && state.map) state.map.setView([CITIES[code][1], CITIES[code][2]], 13);
  loadAll();
}

// ---------------------------------------------------------------- 畫面
function setBanner(msg) {
  const el = document.getElementById("banner");
  el.textContent = msg;
  el.style.display = msg ? "block" : "none";
}
function setUpdated(msg) { document.getElementById("updated").textContent = msg; }

function visibleItems() {
  let items = [];
  if (state.filter === "ev") {
    items = state.brand
      ? state.stations.filter((s) => (s.brands || []).includes(state.brand))
      : [...state.stations];
  } else if (state.filter === "open") {
    items = state.lots.filter((l) => (mainAvail(l) ?? 0) > 0);
  } else {
    items = [...state.lots, ...state.stations,
             ...(state.showPriv ? state.privLots : [])];
  }
  if (state.userPos) {
    for (const it of items) it.dist = haversineKm(state.userPos[0], state.userPos[1], it.lat, it.lon);
    items.sort((a, b) => a.dist - b.dist);
  }
  return items;
}

// 從費率文字擷取「每小時」價格，供圖釘顯示（找不到時回傳 undefined）
function hourlyFee(text) {
  if (!text) return undefined;
  const s = String(text).replace(/\s+/g, "").toLowerCase();
  // 白名單制：整段費率明確為免費才標免費，條件式/附帶提及一律不標
  if (/^(全日|全天|24小時)?免費(停車|入場)?$/.test(s) || /^(free|no|none)$/.test(s)) return 0;
  const m = s.match(/(\d+)元?\/(?:小)?時/)              // 20元/時、30/小時
       || s.match(/每(?:小)?時(\d+)/)                   // 每小時30
       || s.match(/(?:小)?時(\d+)元/)                   // 時30元
       || s.match(/(?:nt\$?|\$)?(\d+)(?:twd|元|nt\$?)?\/(?:1)?(?:hr?|hour)/); // OSM 格式
  if (m) {
    const v = parseInt(m[1], 10);
    if (v >= 1 && v <= 300) return v; // 合理性檢查：超出範圍視為誤抓
  }
  return undefined; // 解析不出明確時費就不顯示，避免誤導
}

function pinHtml(item, mode = "avail") {
  if (item.kind === "ev") return `<div class="pin ev"><span>⚡</span></div>`;
  if (item.kind === "priv") {
    if (mode === "price") {
      const fee = hourlyFee(item.fee);
      const label = fee === 0 ? "免費" : (fee !== undefined ? `<span class="cur">$</span>${fee}` : "P");
      return `<div class="pin pill priv">${label}</div>`;
    }
    return `<div class="pin pill priv">P</div>`; // 車位模式：民營無即時，一律 P
  }
  const m = mainAvail(item);
  const lv = availLevel(m);
  if (mode === "price") {
    const fee = hourlyFee(item.fare);
    const label = fee === 0 ? "免費" : (fee !== undefined ? `<span class="cur">$</span>${fee}` : "—");
    return `<div class="pin pill ${lv}">${label}</div>`; // 顏色永遠代表車位充足度
  }
  const label = lv === "none" ? "—" : (m > 999 ? "999" : m);
  return `<div class="pin pill ${lv}">${label}</div>`;
}

function renderBrandChips() {
  const wrap = document.getElementById("brandChips");
  const brands = brandList(state.stations);
  if (!brands.length) { wrap.innerHTML = ""; return; }
  wrap.innerHTML = [`<button class="bchip ${state.brand ? "" : "on"}" data-brand="">全部品牌</button>`]
    .concat(brands.map((b) => {
      const isT = b === "Tesla";
      return `<button class="bchip ${isT ? "tesla-chip" : ""} ${state.brand === b ? "on" : ""}" data-brand="${esc(b)}">${isT ? '<span class="tmark">⚡</span>' : ""}${esc(b)}</button>`;
    }))
    .join("");
  wrap.querySelectorAll(".bchip").forEach((el) => el.addEventListener("click", () => {
    state.brand = el.dataset.brand || null;
    renderBrandChips();
    render();
  }));
}

function syncBrandRowVisibility() {
  document.getElementById("brandChips").style.display = state.filter === "ev" ? "flex" : "none";
}

function render() {
  syncBrandRowVisibility();
  const items = visibleItems();
  state.layer.clearLayers();
  for (const it of items) {
    const marker = L.marker([it.lat, it.lon], {
      icon: L.divIcon({ html: pinHtml(it, state.pinMode), className: "", iconSize: [0, 0], iconAnchor: [0, 0] }),
    });
    marker.on("click", () => openDetail(it));
    state.layer.addLayer(marker);
  }
  const list = document.getElementById("list");
  if (!items.length) {
    list.innerHTML = `<div class="empty">目前沒有符合條件的地點</div>`;
    return;
  }
  list.innerHTML = items.slice(0, CONFIG.LIST_MAX).map((it, i) => cardHtml(it, i)).join("");
  list.querySelectorAll(".card").forEach((el) => {
    el.addEventListener("click", (ev) => {
      if (ev.target.classList.contains("navbtn")) return;
      openDetail(items[parseInt(el.dataset.i, 10)]);
    });
  });
  list.querySelectorAll(".navbtn").forEach((el) => {
    el.addEventListener("click", () => {
      openNavChooser(items[parseInt(el.dataset.i, 10)]);
    });
  });
}

function cardHtml(it, i) {
  const dist = it.dist !== undefined ? `<span class="dist">${fmtDist(it.dist)}</span> · ` : "";

  if (it.kind === "priv") {
    const fee = hourlyFee(it.fee);
    const feeTxt = it.fee
      ? (fee !== undefined ? (fee === 0 ? "免費" : `$${fee}/時`) : esc(shortText(it.fee, 30)))
      : "費率請洽現場";
    const sub = `${dist}${esc(shortText(it.address, 30)) || "OpenStreetMap 社群資料"}`;
    const brand = it.brand ? `<span class="brandtag priv">${esc(it.brand)}</span>` : "";
    const cap = it.capacity ? `<span class="txt">車位約 ${it.capacity}</span>` : "";
    return `<div class="card lv-priv" data-i="${i}">
      <div class="top">
        <div class="info"><div class="name">${esc(it.name)}</div><div class="sub">${sub}</div></div>
        <div class="avail priv"><div class="n">P</div><div class="u">民營·無即時</div></div>
      </div>
      ${brand ? `<div class="brands">${brand}</div>` : ""}
      <div class="foot"><span class="note"><span class="txt">${feeTxt}</span>${cap ? "　" : ""}${cap}</span><button class="navbtn" data-i="${i}">導航</button></div>
    </div>`;
  }

  if (it.kind === "ev") {
    const brands = (it.brands || []).map((x) =>
      `<span class="brandtag ${x === "Tesla" ? "tesla" : ""}">${esc(x)}</span>`).join("");
    const rate = esc(shortText(it.chargingRate, 42)) || "費率請洽現場";
    const sub = `${dist}${esc(shortText(it.serviceTime || it.address, 28))}`;
    const note = it.spaces ? `<span class="txt">充電車位 ${it.spaces}</span>` : "";
    return `<div class="card lv-ev" data-i="${i}">
      <div class="top">
        <div class="info"><div class="name">${esc(it.name)}</div><div class="sub">${sub}</div></div>
        <div class="avail ev"><div class="n">${it.points || "?"}</div><div class="u">充電樁</div></div>
      </div>
      ${brands ? `<div class="brands">${brands}</div>` : ""}
      <div class="rateline"><span class="bolt">⚡</span><span class="txt">${rate}</span></div>
      <div class="foot"><span class="note">${note}</span><button class="navbtn" data-i="${i}">導航</button></div>
    </div>`;
  }

  const m = mainAvail(it);
  const lv = availLevel(m);
  const hasTypes = (it.spaces || []).some((s) => s.t === 1);
  const num = lv === "none" ? "—" : (m > 999 ? "999" : m);
  const unit = lv === "none" ? "無即時" : (hasTypes ? "一般剩" : "剩餘");
  const fee = hourlyFee(it.fare);
  const feeChip = fee !== undefined
    ? `<span class="feechip">${fee === 0 ? "免費" : `$${fee}/時`}</span>` : "";
  const sub = `${dist}${feeChip}${esc(shortText(it.fare, 42)) || "費率請洽現場"}`;

  const typed = (it.spaces || []).filter((s) => typeof s.a === "number");
  let types = "";
  if (typed.length > 1) {
    const clsFor = (t) => (t === 1 ? "g" : t === 4 ? "ac" : t === 5 ? "fa" : "");
    types = `<div class="types">` + typed.map((s) =>
      `<span class="tchip ${clsFor(s.t)}">${spaceLabel(s.t)} <b>${s.a}</b></span>`).join("") + `</div>`;
  }
  const evNote = it.ev
    ? `<span class="note"><span>⚡</span><span class="txt">場內有充電</span></span>`
    : `<span class="note"></span>`;

  return `<div class="card lv-${lv}" data-i="${i}">
    <div class="top">
      <div class="info"><div class="name">${esc(it.name)}</div><div class="sub">${sub}</div></div>
      <div class="avail ${lv}"><div class="n">${num}</div><div class="u">${unit}</div></div>
    </div>
    ${types}
    <div class="foot">${evNote}<button class="navbtn" data-i="${i}">導航</button></div>
  </div>`;
}

function openDetail(it) {
  const el = document.getElementById("detail");
  const sections = [];
  if (it.kind === "priv") {
    if (it.fee) sections.push(["費率", it.fee]);
    if (it.capacity) sections.push(["車位", `約 ${it.capacity} 格`]);
    if (it.address) sections.push(["地址", it.address]);
    sections.push(["資料來源", "OpenStreetMap 社群資料（民營停車場無即時車位，費率以現場為準）"]);
  } else if (it.kind === "ev") {
    if (it.chargingRate) sections.push(["充電費率", it.chargingRate]);
    if (it.parkingRate) sections.push(["停車費率", it.parkingRate]);
    if (it.desc) sections.push(["說明", it.desc]);
    const meta = [it.serviceTime, it.floors && `樓層：${it.floors}`, it.spaces && `充電車位：${it.spaces}`]
      .filter(Boolean).join("　");
    if (meta) sections.push(["資訊", meta]);
    if (it.address) sections.push(["地址", it.address]);
  } else {
    const typed = (it.spaces || []).filter((s) => typeof s.a === "number");
    if (typed.length) {
      sections.push(["即時車位", typed.map((s) =>
        `${spaceLabel(s.t)}：剩 ${s.a}${typeof s.n === "number" ? ` / 共 ${s.n}` : ""}`).join("\n")]);
    } else if (typeof it.total === "number") {
      sections.push(["車位", `總車位 ${it.total}${typeof it.avail === "number" ? `，目前剩餘 ${it.avail}` : ""}`]);
    }
    if (it.fare) sections.push(["費率", it.fare]);
    if (it.address) sections.push(["地址", it.address]);
  }
  const brandSrc = it.brands || (it.brand ? [it.brand] : []);
  const brands = brandSrc.map((x) =>
    `<span class="brandtag ${x === "Tesla" ? "tesla" : (it.kind === "priv" ? "priv" : "")}">${esc(x)}</span>`).join("");

  let badge;
  if (it.kind === "priv") {
    badge = `<div class="dbadge priv"><div class="n">P</div><div class="u">民營·無即時</div></div>`;
  } else if (it.kind === "ev") {
    badge = `<div class="dbadge ev"><div class="n">${it.points || "?"}</div><div class="u">充電樁</div></div>`;
  } else {
    const m = mainAvail(it);
    const lv = availLevel(m);
    const hasTypes = (it.spaces || []).some((s) => s.t === 1);
    badge = `<div class="dbadge ${lv}"><div class="n">${lv === "none" ? "—" : m}</div><div class="u">${lv === "none" ? "無即時" : (hasTypes ? "一般剩" : "剩餘")}</div></div>`;
  }

  el.innerHTML = `<div class="grab"></div><div class="pullhint">⌄</div>
    <button class="close" aria-label="關閉">✕</button>
    <div class="dhead">
      <h3>${esc(it.name)}</h3>
      ${badge}
    </div>
    ${brands ? `<div class="brands">${brands}</div>` : ""}
    ${sections.map(([h, p]) => `<div class="section"><h4>${esc(h)}</h4><p>${esc(p)}</p></div>`).join("")}
    <div class="actions"><button class="navbtn" id="detailNav">開始導航</button></div>`;
  el.querySelector(".close").addEventListener("click", closeDetail);
  el.querySelector("#detailNav").addEventListener("click", () => openNavChooser(it));
  el.classList.add("open");
  document.getElementById("scrim").classList.add("open");
  state.map.panTo([it.lat, it.lon]);
}

function closeDetail() {
  document.getElementById("detail").classList.remove("open");
  document.getElementById("navsheet").classList.remove("open");
  document.getElementById("scrim").classList.remove("open");
}

// ---------------------------------------------------------------- 重要地標（即時取自 OpenStreetMap）
let _lmTimer = null, _lmKey = "";

function overpassQL(b) {
  const bbox = `${b.getSouth()},${b.getWest()},${b.getNorth()},${b.getEast()}`;
  return `[out:json][timeout:20];(` +
    `node["railway"="station"]["name"](${bbox});` +
    `node["station"="subway"]["name"](${bbox});` +
    `node["aeroway"="aerodrome"]["name"](${bbox});way["aeroway"="aerodrome"]["name"](${bbox});` +
    `node["shop"="mall"]["name"](${bbox});way["shop"="mall"]["name"](${bbox});` +
    `node["amenity"="hospital"]["name"](${bbox});way["amenity"="hospital"]["name"](${bbox});` +
    `node["amenity"="university"]["name"](${bbox});way["amenity"="university"]["name"](${bbox});` +
    `node["tourism"~"attraction|theme_park|museum|zoo"]["name"](${bbox});` +
    `node["leisure"="stadium"]["name"](${bbox});way["leisure"="stadium"]["name"](${bbox});` +
    `node["amenity"="parking"](${bbox});way["amenity"="parking"](${bbox});` +
    `);out center 260;`;
}

// ---- 民營停車場（OSM）----
const PRIV_BRANDS = [
  [/嘟嘟房/, "嘟嘟房"], [/times|タイムズ/i, "Times"], [/俥亭/, "俥亭"],
  [/城市車旅/, "城市車旅"], [/utaggo|歐特儀/i, "uTagGo"], [/福客多|便利停車/, "便利停車"],
  [/詮營|citypark/i, "CityPark"], [/ok忠訓|嘉新/, ""],
];

function privBrand(name) {
  for (const [re, brand] of PRIV_BRANDS) {
    if (brand && re.test(name || "")) return brand;
  }
  return null;
}

// 從 Overpass 元素建立民營場清單：排除私人專用、去重（60m 內已有公有場站者略過）
function buildPrivLots(elements, lots) {
  const out = [];
  for (const el of elements) {
    const t = el.tags || {};
    if (t.amenity !== "parking") continue;
    if (t.access === "private" || t.access === "no") continue; // 私人專用不顯示
    const lat = el.lat != null ? el.lat : (el.center && el.center.lat);
    const lon = el.lon != null ? el.lon : (el.center && el.center.lon);
    if (lat == null || lon == null) continue;
    if (lots.some((l) => haversineKm(lat, lon, l.lat, l.lon) < 0.06)) continue; // 與公有場站去重
    const name = t.name || (t.operator ? `${t.operator}停車場` : "停車場");
    let fee = t.charge || "";
    if (!fee && t.fee === "no") fee = "免費";
    out.push({
      kind: "priv",
      id: `osm-${el.type || "n"}-${el.id}`,
      name, lat, lon,
      brand: privBrand(`${name} ${t.operator || ""}`),
      fee,
      capacity: t.capacity ? parseInt(t.capacity, 10) || null : null,
      address: t["addr:full"] || [t["addr:city"], t["addr:street"], t["addr:housenumber"]].filter(Boolean).join("") || "",
    });
  }
  return out;
}

function landmarkCat(t) {
  if (t.railway === "station" || t.station === "subway" || t.railway === "halt") return { k: "transit", pr: 1 };
  if (t.aeroway === "aerodrome") return { k: "airport", pr: 1 };
  if (t.shop === "mall") return { k: "mall", pr: 3 };
  if (t.amenity === "hospital") return { k: "hospital", pr: 2 };
  if (t.amenity === "university") return { k: "school", pr: 4 };
  if (t.leisure === "stadium") return { k: "stadium", pr: 4 };
  if (t.tourism) return { k: "sight", pr: 3 };
  return null;
}

function renderLandmarks(els) {
  if (!state.landmarkLayer) return;
  const items = [];
  for (const el of els) {
    const t = el.tags || {};
    if (!t.name) continue;
    const lat = el.lat != null ? el.lat : (el.center && el.center.lat);
    const lon = el.lon != null ? el.lon : (el.center && el.center.lon);
    if (lat == null || lon == null) continue;
    const cat = landmarkCat(t);
    if (!cat) continue;
    items.push({ name: t.name, lat, lon, k: cat.k, pr: cat.pr });
  }
  items.sort((a, b) => a.pr - b.pr);   // 交通樞紐、機場優先保留
  state.landmarkLayer.clearLayers();
  const seen = new Set();
  let n = 0;
  for (const it of items) {
    if (seen.has(it.name)) continue;
    seen.add(it.name);
    const marker = L.marker([it.lat, it.lon], {
      pane: "landmarks", interactive: false, keyboard: false,
      icon: L.divIcon({ className: "", iconSize: [0, 0], iconAnchor: [0, 0],
        html: `<div class="lm lm-${it.k}"><span class="d"></span>${esc(shortText(it.name, 11))}</div>` }),
    });
    state.landmarkLayer.addLayer(marker);
    if (++n >= 36) break;
  }
}

function scheduleLandmarks() { clearTimeout(_lmTimer); _lmTimer = setTimeout(loadLandmarks, 500); }

async function loadLandmarks() {
  if (!state.map || !state.landmarkLayer) return;
  if (state.map.getZoom() < 12) { state.landmarkLayer.clearLayers(); _lmKey = ""; return; }
  const b = state.map.getBounds();
  const key = [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()].map((n) => n.toFixed(2)).join(",");
  if (key === _lmKey) return;
  _lmKey = key;
  try {
    const resp = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST", body: "data=" + encodeURIComponent(overpassQL(b)),
    });
    if (!resp.ok) return;
    const json = await resp.json();
    const els = json.elements || [];
    renderLandmarks(state.showLm ? els.filter((e) => (e.tags || {}).amenity !== "parking") : []);
    state.privLots = buildPrivLots(els, state.lots);
    render(); // 民營場加入地圖與清單
  } catch (e) { /* 靜默降級：地標載入失敗不影響主要功能 */ }
}

// ---------------------------------------------------------------- 定位
function locate() {
  if (!navigator.geolocation) { setBanner("此裝置不支援定位"); return; }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      state.userPos = [pos.coords.latitude, pos.coords.longitude];
      if (state.userMarker) state.userMarker.remove();
      state.userMarker = L.circleMarker(state.userPos, {
        radius: 8, color: "#fff", weight: 3, fillColor: "#378ADD", fillOpacity: 1,
      }).addTo(state.map);
      state.map.setView(state.userPos, 15);
      const rc = document.getElementById("recenterBtn");
      if (rc) rc.classList.add("located");
      const near = nearestCity(state.userPos[0], state.userPos[1]);
      if (near !== state.city) setCity(near, { pan: false });
      else render();
    },
    () => setBanner("無法取得定位，請確認已允許位置權限"),
    { enableHighAccuracy: true, timeout: 8000 },
  );
}

// ---------------------------------------------------------------- 初始化
function init() {
  try {
    const saved = localStorage.getItem("zhaoweizi.city");
    if (saved && CITIES[saved]) state.city = saved;
    if (localStorage.getItem("zhaoweizi.pinmode") === "price") state.pinMode = "price";
    if (localStorage.getItem("zhaoweizi.priv") === "0") state.showPriv = false;
    if (localStorage.getItem("zhaoweizi.lm") === "0") state.showLm = false;
  } catch {}

  const c = CITIES[state.city];
  state.map = L.map("map", { zoomControl: true }).setView([c[1], c[2]], CONFIG.DEFAULT_ZOOM);
  // 多種底圖：簡潔（預設，最好判讀）／標準／衛星
  const simple = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    maxZoom: 20, subdomains: "abcd", attribution: "&copy; OpenStreetMap &copy; CARTO",
  });
  const standard = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19, attribution: "&copy; OpenStreetMap",
  });
  const satellite = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 19, attribution: "Tiles &copy; Esri",
  });
  simple.addTo(state.map);
  L.control.layers({ "簡潔": simple, "標準": standard, "衛星": satellite }, null,
    { position: "topright", collapsed: true }).addTo(state.map);
  state.layer = L.layerGroup().addTo(state.map);
  // 重要地標圖層（置於停車圖釘之下、不攔截點擊）
  state.map.createPane("landmarks");
  state.map.getPane("landmarks").style.zIndex = 590;
  state.map.getPane("landmarks").style.pointerEvents = "none";
  state.landmarkLayer = L.layerGroup([], { pane: "landmarks" }).addTo(state.map);
  state.map.on("moveend", scheduleLandmarks);
  scheduleLandmarks();

  const sel = document.getElementById("citySel");
  sel.innerHTML = Object.entries(CITIES).map(([code, [name]]) =>
    `<option value="${code}">${name}</option>`).join("");
  sel.value = state.city;
  sel.addEventListener("change", () => setCity(sel.value));

  document.querySelectorAll(".chip[data-filter]").forEach((chip) => {
    chip.addEventListener("click", () => {
      document.querySelectorAll(".chip").forEach((x) => x.classList.remove("on"));
      chip.classList.add("on");
      state.filter = chip.dataset.filter;
      render();
    });
  });
  const privChip = document.getElementById("privChip");
  privChip.classList.toggle("off", !state.showPriv);
  privChip.addEventListener("click", () => {
    state.showPriv = !state.showPriv;
    privChip.classList.toggle("off", !state.showPriv);
    try { localStorage.setItem("zhaoweizi.priv", state.showPriv ? "1" : "0"); } catch {}
    render();
  });
  const lmChip = document.getElementById("lmChip");
  lmChip.classList.toggle("off", !state.showLm);
  lmChip.addEventListener("click", () => {
    state.showLm = !state.showLm;
    lmChip.classList.toggle("off", !state.showLm);
    try { localStorage.setItem("zhaoweizi.lm", state.showLm ? "1" : "0"); } catch {}
    if (state.showLm) { _lmKey = ""; scheduleLandmarks(); }
    else renderLandmarks([]);
  });
  const seg = document.getElementById("pinModeSeg");
  const syncSeg = () => seg.querySelectorAll("button").forEach((b) =>
    b.classList.toggle("on", b.dataset.mode === state.pinMode));
  syncSeg();
  seg.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
    if (state.pinMode === b.dataset.mode) return;
    state.pinMode = b.dataset.mode;
    try { localStorage.setItem("zhaoweizi.pinmode", state.pinMode); } catch {}
    syncSeg();
    render();
  }));
  enableDragClose(document.getElementById("detail"), closeDetail);
  enableDragClose(document.getElementById("navsheet"), closeNavChooser);
  document.getElementById("refreshBtn").addEventListener("click", loadAll);
  document.getElementById("locateBtn").addEventListener("click", locate);
  document.getElementById("recenterBtn").addEventListener("click", () => {
    if (state.userPos) state.map.setView(state.userPos, 16, { animate: true });
    else locate();
  });
  document.getElementById("scrim").addEventListener("click", closeDetail);

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
  loadAll();
  locate();
}

if (typeof window !== "undefined") window.addEventListener("DOMContentLoaded", init);
if (typeof module !== "undefined") {
  module.exports = { haversineKm, availLevel, fmtDist, shortText, navUrl, navLinks, badgeFor, esc,
                     nearestCity, spaceLabel, mainAvail, spacesSummary, brandList,
                     buildPrivLots, privBrand, hourlyFee, pinHtml, CITIES, CONFIG };
}
