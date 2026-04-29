/* =====================================================================
   SPARK · Calendar app
   - Loads events.json (placeholder; will be replaced by Smartsheet feed)
   - Renders pages dynamically
   - Initializes StPageFlip (book animation)
   - Switches between two-page (desktop) and single-page (mobile)
   ===================================================================== */

const BREAKPOINT = 900;
const TODAY = new Date();

let pageFlip = null;
let weeksData = [];
let pageMap = []; // pageFlip page index → weeksData index

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

/* ---------- Render: Pages ---------- */

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

function pageFooterHTML(left, right) {
  return `
    <div class="page__footer">
      <span>${left}</span>
      <span>${right}</span>
    </div>
  `;
}

function buildPagesDesktop() {
  const pages = [];
  pageMap = [];
  const total = weeksData.length;

  weeksData.forEach((week, i) => {
    const dept  = getBlock(week, "department");
    const div   = getBlock(week, "division");
    const joint = getJointBlock(week);

    // LEFT PAGE — Department (+ joint if present)
    const leftBody = joint && !dept
      ? buildBlockHTML(joint)
      : `${joint ? buildBlockHTML(joint) : ""}${dept ? buildBlockHTML(dept) : `<div class="events--empty">No Department session</div>`}`;

    pages.push(`
      <div class="page page--left">
        ${pageHeaderHTML(week)}
        <div class="page__content">${leftBody}</div>
        ${pageFooterHTML("SPARK · CCHMC Radiology", "")}
      </div>
    `);
    pageMap.push(i);

    // RIGHT PAGE — Division (+ joint if present)
    const rightBody = joint && !div
      ? buildBlockHTML(joint)
      : `${joint ? buildBlockHTML(joint) : ""}${div ? buildBlockHTML(div) : `<div class="events--empty">No Division session</div>`}`;

    pages.push(`
      <div class="page page--right">
        ${pageHeaderHTML(week)}
        <div class="page__content">${rightBody}</div>
        ${pageFooterHTML("", "Wednesday Programming")}
      </div>
    `);
    pageMap.push(i);
  });

  return pages;
}

function buildPagesMobile() {
  const pages = [];
  pageMap = [];

  weeksData.forEach((week, i) => {
    const dept  = getBlock(week, "department");
    const div   = getBlock(week, "division");
    const joint = getJointBlock(week);

    let bodyHTML;
    if (dept && div) {
      // Two-block week: tabbed view (joint banner above tabs if present)
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
      // Single-block week (joint-only, or only one of dept/div): show full
      const blocks = [joint, dept, div].filter(Boolean);
      bodyHTML = blocks.length
        ? blocks.map(buildBlockHTML).join("")
        : `<div class="events--empty">No events scheduled</div>`;
    }

    pages.push(`
      <div class="page page--single">
        ${pageHeaderHTML(week)}
        <div class="page__content">${bodyHTML}</div>
        ${pageFooterHTML("SPARK · CCHMC Radiology", "")}
      </div>
    `);
    pageMap.push(i);
  });

  return pages;
}

/* ---------- Navigation ---------- */

function nearestUpcomingWeekIndex() {
  const todayStr = TODAY.toISOString().slice(0, 10);
  for (let i = 0; i < weeksData.length; i++) {
    if (weeksData[i].date >= todayStr) return i;
  }
  return Math.max(0, weeksData.length - 1);
}

function pageIndexForWeek(weekIndex) {
  return isDesktop() ? weekIndex * 2 : weekIndex;
}

/* ---------- Book initialization ---------- */

function pageDimensions() {
  const desktop = isDesktop();
  if (desktop) {
    // Two-page spread — each page is portrait-ish 3:4
    return { width: 460, height: 620 };
  }
  return { width: 360, height: 600 };
}

function initBook() {
  const desktop = isDesktop();
  const pages = desktop ? buildPagesDesktop() : buildPagesMobile();

  // Tear down previous instance, then recreate the container fresh.
  // (destroy() can leave the DOM in an inconsistent state if we've also
  // mutated container.innerHTML, so we always rebuild from scratch.)
  if (pageFlip) {
    try { pageFlip.destroy(); } catch (e) { /* noop */ }
    pageFlip = null;
  }

  const wrap = document.querySelector(".book-wrap");
  wrap.innerHTML = '<div id="book"></div>';
  const container = wrap.querySelector("#book");
  container.innerHTML = pages.join("");

  const dims = pageDimensions();

  pageFlip = new St.PageFlip(container, {
    width: dims.width,
    height: dims.height,
    size: "stretch",
    minWidth: 280,
    maxWidth: 540,
    minHeight: 460,
    maxHeight: 720,
    showCover: false,
    flippingTime: 700,
    usePortrait: !desktop,
    autoSize: true,
    maxShadowOpacity: 0.4,
    drawShadow: true,
    mobileScrollSupport: false,
    swipeDistance: 30,
  });

  pageFlip.loadFromHTML(container.querySelectorAll(".page"));

  const startWeek = nearestUpcomingWeekIndex();
  const startPage = pageIndexForWeek(startWeek);

  // Snap immediately (no animation) to the upcoming week
  pageFlip.turnToPage(startPage);

  pageFlip.on("flip", e => updatePageInfo(e.data));
  updatePageInfo(startPage);
}

function updatePageInfo(pageIndex) {
  const weekIndex = pageMap[pageIndex] ?? 0;
  const week = weeksData[weekIndex];
  if (!week) return;
  const todayStr = TODAY.toISOString().slice(0, 10);
  const tag = week.date < todayStr ? "Past" : (week.date === todayStr ? "Today" : "Upcoming");
  document.getElementById("pageInfo").textContent =
    `${fmtDateShort(week.date)} · ${tag}`;
}

/* ---------- UI Wiring ---------- */

function setupNav() {
  document.getElementById("prevBtn").addEventListener("click", () => {
    pageFlip?.flipPrev();
  });
  document.getElementById("nextBtn").addEventListener("click", () => {
    pageFlip?.flipNext();
  });
  document.getElementById("todayBtn").addEventListener("click", () => {
    if (!pageFlip) return;
    pageFlip.flip(pageIndexForWeek(nearestUpcomingWeekIndex()));
  });

  const dialog = document.getElementById("jumperDialog");
  document.getElementById("jumpBtn").addEventListener("click", () => {
    populateJumper();
    dialog.showModal();
  });

  // Theme toggle (paper ↔ ink)
  const themeBtn = document.getElementById("themeBtn");
  themeBtn.addEventListener("click", () => {
    const curr = document.documentElement.getAttribute("data-theme");
    document.documentElement.setAttribute("data-theme", curr === "ink" ? "paper" : "ink");
  });

  // Keyboard nav
  document.addEventListener("keydown", e => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
    if (e.key === "ArrowLeft")  pageFlip?.flipPrev();
    if (e.key === "ArrowRight") pageFlip?.flipNext();
  });

  // Tab switching (mobile blocks): delegated since pages live inside the
  // pageFlip-managed DOM and re-render on viewport changes.
  document.addEventListener("click", e => {
    const tab = e.target.closest(".tab");
    if (!tab || !tab.dataset.tabTarget) return;
    e.preventDefault();
    e.stopPropagation();
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
  const todayStr = TODAY.toISOString().slice(0, 10);
  const upcomingIdx = nearestUpcomingWeekIndex();

  list.innerHTML = weeksData.map((w, i) => {
    const past = w.date < todayStr;
    const isCurrent = i === upcomingIdx;
    return `
      <li>
        <button data-week="${i}" class="${isCurrent ? "is-current" : ""}">
          <span>${fmtDateShort(w.date)}</span>
          <span class="week-meta">${past ? "Past" : (isCurrent ? "Upcoming" : "Future")}</span>
        </button>
      </li>
    `;
  }).join("");

  list.querySelectorAll("button").forEach(btn => {
    btn.addEventListener("click", () => {
      const w = Number(btn.dataset.week);
      pageFlip?.flip(pageIndexForWeek(w));
      document.getElementById("jumperDialog").close();
    });
  });
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
      initBook();
    }
  }, 180);
});

/* ---------- Boot ---------- */

async function boot() {
  try {
    const res = await fetch("events.json", { cache: "no-cache" });
    const data = await res.json();
    weeksData = data.weeks || [];
  } catch (err) {
    console.warn("Could not fetch events.json — using inline fallback.", err);
    weeksData = window.__SPARK_FALLBACK__?.weeks || [];
  }

  weeksData.sort((a, b) => a.date.localeCompare(b.date));

  if (!weeksData.length) {
    document.getElementById("book").innerHTML =
      `<div style="padding:2rem;text-align:center;font-family:var(--body);font-style:italic">No events loaded.</div>`;
    return;
  }

  setupNav();
  initBook();
}

boot();
