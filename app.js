/* =====================================================================
   SPARK · Calendar app
   - Loads events.json (placeholder; will be replaced by Smartsheet feed)
   - Renders one week per slide in a horizontal carousel
   - Slides between weeks (translateX); swipe on touch, arrows / keys on desktop
   - Desktop: Department + Division shown side by side; mobile: tabbed
   ===================================================================== */

const BREAKPOINT = 900;
const TODAY = new Date();

// Today's *local* calendar date (YYYY-MM-DD). Using the viewer's local date —
// not TODAY.toISOString(), which is UTC and would roll to tomorrow in the
// evening for timezones behind UTC (e.g. after 8pm US Eastern).
const TODAY_STR = `${TODAY.getFullYear()}-${String(TODAY.getMonth() + 1).padStart(2, "0")}-${String(TODAY.getDate()).padStart(2, "0")}`;

let weeksData = [];
let currentIndex = 0;
let lastGeneratedAt = "";
let jumperShowPast = false; // jumper hides past weeks until toggled

/* ---------- Helpers ---------- */

const isDesktop = () => window.innerWidth >= BREAKPOINT;

// "0700" -> "7:00a", "0830" -> "8:30a", "1230" -> "12:30p"
function fmtTime(t) {
  if (!t && t !== 0) return "";
  const s = String(t).padStart(4, "0");
  const h = parseInt(s.slice(0, 2), 10);
  const m = s.slice(2);
  const ampm = h >= 12 ? "p" : "a";
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${m}${ampm}`;
}

function fmtDate(iso) {
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function fmtDateShort(iso) {
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Block label times: derived from min start / max end across events
function blockTimespan(block) {
  if (!block.events?.length) return "";
  const starts = block.events.map(e => parseInt(e.startTime, 10));
  const ends   = block.events.map(e => parseInt(e.endTime, 10));
  return `${fmtTime(Math.min(...starts))} – ${fmtTime(Math.max(...ends))}`;
}

function escapeHTML(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

/* ---------- Icons ---------- */

const ICON_PIN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/></svg>`;

const ICON_VIDEO = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>`;

/* ---------- Render: Event card ---------- */

function buildEventHTML(e) {
  const locationHTML = e.location
    ? `<span class="event__location">${ICON_PIN}${escapeHTML(e.location)}</span>`
    : "";

  let virtualHTML = "";
  if (e.virtual) {
    if (e.teamsUrl) {
      virtualHTML = `<a class="event__virtual" href="${escapeHTML(e.teamsUrl)}" target="_blank" rel="noopener" title="Join via Teams" aria-label="Join via Teams">${ICON_VIDEO}</a>`;
    } else {
      virtualHTML = `<span class="event__virtual event__virtual--noLink" title="Virtual / Teams" aria-label="Virtual">${ICON_VIDEO}</span>`;
    }
  }

  const rightCol = (locationHTML || virtualHTML)
    ? `<div class="event__rightCol">${locationHTML}${virtualHTML}</div>`
    : "";

  return `
    <li class="event">
      <h3 class="event__title">${escapeHTML(e.title)}</h3>
      ${rightCol}
      ${e.audience ? `<div class="event__audience">${escapeHTML(e.audience)}</div>` : ""}
      ${e.comments ? `<p class="event__comments">${escapeHTML(e.comments)}</p>` : ""}
    </li>
  `;
}

/* ---------- Render: Group events by start time ---------- */

function groupEventsByTime(events) {
  const groups = new Map();
  for (const e of events) {
    const key = `${e.startTime}-${e.endTime}`;
    if (!groups.has(key)) {
      groups.set(key, { startTime: e.startTime, endTime: e.endTime, events: [] });
    }
    groups.get(key).events.push(e);
  }
  return Array.from(groups.values()).sort(
    (a, b) => parseInt(a.startTime, 10) - parseInt(b.startTime, 10)
  );
}

function buildBlockHTML(block) {
  if (!block.events?.length) {
    return `
      <div class="block block--${block.type}">
        <h2 class="block__label">${escapeHTML(block.title)}</h2>
        <div class="block__rule"></div>
        <div class="events--empty">No events scheduled</div>
      </div>
    `;
  }

  const timeGroups = groupEventsByTime(block.events);
  const groupsHTML = timeGroups.map(tg => {
    const concurrentBadge = tg.events.length > 1
      ? `<span class="timegroup__concurrent">${tg.events.length} concurrent</span>`
      : "";

    return `
      <li class="timegroup">
        <div class="timegroup__head">
          <span class="timegroup__time">${fmtTime(tg.startTime)} – ${fmtTime(tg.endTime)}</span>
          ${concurrentBadge}
        </div>
        <ul class="events">${tg.events.map(buildEventHTML).join("")}</ul>
      </li>
    `;
  }).join("");

  return `
    <div class="block block--${block.type}">
      <h2 class="block__label">${escapeHTML(block.title)}</h2>
      <div class="block__rule"></div>
      <ul class="timegroups">${groupsHTML}</ul>
    </div>
  `;
}

/* ---------- Render: Slides ---------- */

function getBlock(week, type) {
  return week.blocks.find(b => b.type === type);
}

function getJointBlock(week) {
  return week.blocks.find(b => b.type === "joint");
}

function pageHeaderHTML(week) {
  return `
    <div class="page__date-line">
      <h1 class="page__date">${fmtDate(week.date)}</h1>
    </div>
  `;
}

// Desktop slide — Department + Division side by side, joint spanning above.
function buildSlideDesktop(week) {
  const dept  = getBlock(week, "department");
  const div   = getBlock(week, "division");
  const joint = getJointBlock(week);

  const jointHTML = joint ? `<div class="slide__joint">${buildBlockHTML(joint)}</div>` : "";
  const deptHTML  = dept ? buildBlockHTML(dept) : `<div class="events--empty">No Department session</div>`;
  const divHTML   = div  ? buildBlockHTML(div)  : `<div class="events--empty">No Division session</div>`;

  return `
    <div class="slide">
      <div class="page">
        ${pageHeaderHTML(week)}
        <div class="page__content">
          ${jointHTML}
          <div class="cols">
            <div class="col col--department">${deptHTML}</div>
            <div class="col col--division">${divHTML}</div>
          </div>
        </div>
      </div>
    </div>
  `;
}

// Mobile slide — tabbed when both blocks exist, else stacked.
function buildSlideMobile(week, i) {
  const dept  = getBlock(week, "department");
  const div   = getBlock(week, "division");
  const joint = getJointBlock(week);

  let bodyHTML;
  if (dept && div) {
    bodyHTML = `
      ${joint ? `<div class="joint-banner">${buildBlockHTML(joint)}</div>` : ""}
      <div class="tabs" role="tablist">
        <button class="tab tab--department is-active" data-tab-target="dept-${i}" type="button">Department</button>
        <button class="tab tab--division" data-tab-target="div-${i}" type="button">Division</button>
      </div>
      <div class="tab-panel" id="dept-${i}">${buildBlockHTML(dept)}</div>
      <div class="tab-panel" id="div-${i}" hidden>${buildBlockHTML(div)}</div>
    `;
  } else {
    const blocks = [joint, dept, div].filter(Boolean);
    bodyHTML = blocks.length
      ? blocks.map(buildBlockHTML).join("")
      : `<div class="events--empty">No events scheduled</div>`;
  }

  return `
    <div class="slide">
      <div class="page">
        ${pageHeaderHTML(week)}
        <div class="page__content">${bodyHTML}</div>
      </div>
    </div>
  `;
}

/* ---------- Carousel ---------- */

function nearestUpcomingWeekIndex() {
  const todayStr = TODAY_STR;
  for (let i = 0; i < weeksData.length; i++) {
    if (weeksData[i].date >= todayStr) return i;
  }
  return Math.max(0, weeksData.length - 1);
}

function renderTrack() {
  const track = document.getElementById("track");
  const build = isDesktop() ? buildSlideDesktop : buildSlideMobile;
  track.innerHTML = weeksData.map((w, i) => build(w, i)).join("");
  goTo(currentIndex, false);
}

// Move the track to `index`. `animate=false` snaps with no transition.
function goTo(index, animate = true) {
  currentIndex = Math.max(0, Math.min(index, weeksData.length - 1));
  const track = document.getElementById("track");
  if (!track) return;

  if (!animate) track.style.transition = "none";
  track.style.transform = `translateX(-${currentIndex * 100}%)`;
  if (!animate) {
    // Force a reflow so the snap applies before we restore the transition.
    void track.offsetWidth;
    track.style.transition = "";
  }
}

function next() { goTo(currentIndex + 1); }
function prev() { goTo(currentIndex - 1); }

// "Updated Jul 2, 2026, 10:27 PM" — from events.json's _generatedAt (the last
// time the schedule data changed). Shown in the footer; left blank if missing.
function setLastUpdated(iso) {
  const el = document.getElementById("lastUpdated");
  if (!el) return;
  const d = iso ? new Date(iso) : null;
  if (!d || isNaN(d)) { el.textContent = ""; return; }
  const stamp = d.toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
  el.textContent = `Updated ${stamp}`;
}

/* ---------- UI Wiring ---------- */

function setupNav() {
  document.getElementById("prevBtn").addEventListener("click", prev);
  document.getElementById("nextBtn").addEventListener("click", next);
  document.getElementById("todayBtn").addEventListener("click", () => {
    goTo(nearestUpcomingWeekIndex());
  });

  const dialog = document.getElementById("jumperDialog");
  document.getElementById("jumpBtn").addEventListener("click", () => {
    jumperShowPast = false; // always reopen focused on now + upcoming
    populateJumper();
    dialog.showModal();
  });
  document.getElementById("jumperPastToggle").addEventListener("click", () => {
    jumperShowPast = !jumperShowPast;
    populateJumper();
  });

  // Theme toggle (paper ↔ ink) — persisted so it survives reloads.
  document.getElementById("themeBtn").addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "ink" ? "paper" : "ink";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("spark-theme", next); } catch (e) { /* ignore */ }
  });

  // Keyboard nav
  document.addEventListener("keydown", e => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
    if (e.key === "ArrowLeft")  prev();
    if (e.key === "ArrowRight") next();
  });

  // Swipe (touch). Only act on a mostly-horizontal gesture so vertical
  // scrolling inside a page still works.
  const carousel = document.getElementById("carousel");
  let startX = null, startY = null;
  carousel.addEventListener("touchstart", e => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  }, { passive: true });
  carousel.addEventListener("touchend", e => {
    if (startX === null) return;
    const dx = e.changedTouches[0].clientX - startX;
    const dy = e.changedTouches[0].clientY - startY;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
      dx < 0 ? next() : prev();
    }
    startX = startY = null;
  }, { passive: true });

  // Tab switching (mobile blocks), delegated.
  document.addEventListener("click", e => {
    const tab = e.target.closest(".tab");
    if (!tab || !tab.dataset.tabTarget) return;
    e.preventDefault();
    const targetId = tab.dataset.tabTarget;
    const tablist  = tab.parentElement;
    const page     = tablist.parentElement;
    tablist.querySelectorAll(".tab").forEach(t => t.classList.remove("is-active"));
    tab.classList.add("is-active");
    page.querySelectorAll(".tab-panel").forEach(p => {
      p.hidden = p.id !== targetId;
    });
  });
}

function populateJumper() {
  const list = document.getElementById("jumperList");
  const todayStr = TODAY_STR;
  const upcomingIdx = nearestUpcomingWeekIndex();
  const pastCount = weeksData.filter(w => w.date < todayStr).length;

  // Hide past weeks by default so the list stays short and focused on
  // now + upcoming as the schedule grows week over week.
  const items = weeksData
    .map((w, i) => ({ w, i, past: w.date < todayStr }))
    .filter(it => jumperShowPast || !it.past);

  // Render, inserting a sticky month header whenever the month changes.
  let html = "";
  let lastMonth = "";
  for (const { w, i, past } of items) {
    const month = new Date(w.date + "T12:00:00")
      .toLocaleDateString("en-US", { month: "long", year: "numeric" });
    if (month !== lastMonth) {
      html += `<li class="jumper__month">${month}</li>`;
      lastMonth = month;
    }
    const isCurrent = i === upcomingIdx;
    const tag = past ? "Past" : (isCurrent ? "Upcoming" : "Future");
    html += `
      <li class="jumper__item" data-year="${w.date.slice(0, 4)}">
        <button data-week="${i}" class="${isCurrent ? "is-current" : ""}">
          <span>${fmtDateShort(w.date)}</span>
          <span class="week-meta">${tag}</span>
        </button>
      </li>`;
  }
  list.innerHTML = html || `<li class="jumper__empty">No weeks to show.</li>`;

  // Quick "jump to year" chips — only when the visible weeks span 2+ years.
  const years = [...new Set(items.map(it => it.w.date.slice(0, 4)))];
  const yearsEl = document.getElementById("jumperYears");
  yearsEl.hidden = years.length < 2;
  yearsEl.innerHTML = years.length < 2
    ? ""
    : years.map(y => `<button type="button" data-year="${y}">${y}</button>`).join("");
  yearsEl.querySelectorAll("button").forEach(btn => {
    btn.addEventListener("click", () => {
      const first = list.querySelector(`.jumper__item[data-year="${btn.dataset.year}"]`);
      if (first) first.scrollIntoView({ block: "start" });
    });
  });

  // Past toggle — labelled with the count, hidden when there's no past.
  const toggle = document.getElementById("jumperPastToggle");
  toggle.hidden = pastCount === 0;
  toggle.textContent = jumperShowPast
    ? "Hide past weeks"
    : `Show ${pastCount} past week${pastCount === 1 ? "" : "s"}`;

  list.querySelectorAll("button[data-week]").forEach(btn => {
    btn.addEventListener("click", () => {
      goTo(Number(btn.dataset.week));
      document.getElementById("jumperDialog").close();
    });
  });

  // Open focused on the upcoming week (or the first row if none upcoming).
  const cur = list.querySelector(".is-current") || list.querySelector("button[data-week]");
  if (cur) cur.scrollIntoView({ block: "nearest" });
}

/* ---------- Resize handling ---------- */

let wasDesktop = isDesktop();
let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const nowDesktop = isDesktop();
    if (nowDesktop !== wasDesktop) {
      wasDesktop = nowDesktop;
      renderTrack(); // rebuild slides for the new layout, keep the current week
    }
  }, 180);
});

/* ---------- Boot ---------- */

async function boot() {
  try {
    const res = await fetch("events.json", { cache: "no-cache" });
    const data = await res.json();
    weeksData = data.weeks || [];
    lastGeneratedAt = data._generatedAt || "";
  } catch (err) {
    console.warn("Could not fetch events.json — using inline fallback.", err);
    weeksData = window.__SPARK_FALLBACK__?.weeks || [];
  }

  weeksData.sort((a, b) => a.date.localeCompare(b.date));

  if (!weeksData.length) {
    document.getElementById("track").innerHTML =
      `<div style="padding:2rem;text-align:center;font-family:var(--body);font-style:italic">No events loaded.</div>`;
    return;
  }

  currentIndex = nearestUpcomingWeekIndex();
  setupNav();
  renderTrack();
  setLastUpdated(lastGeneratedAt);
}

boot();
