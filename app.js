/* =====================================================================
   GORAE LIVE — app.js  (Vanilla JS, 빌드 불필요)

   흐름
   1) DEMO_MODE=true  → 아래 고정된 demoData만 사용 (랜덤/가짜 실시간 생성 없음)
   2) DEMO_MODE=false → API_URL을 15초마다 fetch() 하여 바뀐 부분만 화면 갱신
      - 페이지 전체 reload 없음
      - 호출 실패 시 기존 화면 유지 + 작은 상태 표시만 변경

   공개 규칙 (API가 이미 마스킹해서 보내더라도 프론트에서 한 번 더 보호)
   - 이름은 항상 마스킹 (김은우 → 김○우, 김은 → 김○)
   - 100% PASS 기록만 표시 (score < 100 또는 result가 PASS가 아니면 버림)
   - 화면에는 time / student / course / unit 만 사용 (그 외 필드는 읽지 않음)
   - RETRY는 통계 숫자로만 사용
   ===================================================================== */

/* ---------------------------------------------------------------------
   CONFIG — 실제 연결 시 여기만 수정하세요
   --------------------------------------------------------------------- */

// Google Apps Script Web App 배포 URL (…/exec). 아직 없음 → 비워 둠.
// ⚠ 연결 시 fetch에 커스텀 헤더를 넣지 마세요. (Apps Script는 CORS preflight를 처리하지 못함)
const API_URL = "https://script.google.com/macros/s/AKfycbyCyRxBJJoajlBKckb6lpKMYbKpEvToi13ZkmLVemlNJzLG4Iop_IHuOygPlRTu81c1UQ/exec";

// true: 고정 demoData로 디자인 확인 / false: API_URL에서 실제 데이터 사용
const DEMO_MODE = false;

const REFRESH_INTERVAL_MS = 10000; // 자동 갱신 간격 (15초)
const FETCH_TIMEOUT_MS = 10000;    // 응답이 이보다 늦으면 실패로 처리
const FEED_MAX = 7;                // LIVE FEED에 표시할 최대 줄 수 (latest 포함)
const MINI_CARD_COUNT = 3;         // PC JUST PASSED 옆 작은 카드 수
const NEW_BADGE_MINUTES = 10;      // 최근 PASS가 이 시간(분) 이내면 NEW 배지 표시
const TIME_ZONE = "Asia/Seoul";

// 고래 이미지 경로 — 최종 이미지로 교체 시 파일만 바꾸거나 여기 경로(.webp 등)만 수정
// (히어로 고래 / JUST PASSED 왕관 고래는 index.html의 <img src>에서 지정)
// (벡터 variation: assets/whale-avatar-basic|star|book|crown.svg — 필요하면 목록에 추가)
const WHALE_AVATARS = [
  "assets/gorae-whale-avatar.webp",
];

// 학습앱으로 돌아가기 링크 — 아직 URL 없음. 값을 넣으면 화면 상단에 링크가 나타남.
const APP_BACK_URL = "";

/* ---------------------------------------------------------------------
   DEMO DATA — 고정값. 실제 학생 데이터가 아닌 목업용 샘플입니다.
   (API 예상 응답과 동일한 구조)
   --------------------------------------------------------------------- */
const demoData = {
  generatedAt: "2026-09-23T14:32:18+09:00",
  stats: { learners: 28, pass: 43, completed: 61, retry: 12 },
  latestPass: { time: "14:32", student: "김○은", course: "워드마스터 중등 Basic", unit: "Day 03", score: 100 },
  recentPasses: [
    { time: "14:29", student: "문○광", course: "경선식 영단어", unit: "Unit 12" },
    { time: "14:26", student: "이○인", course: "워드마스터 중등 실력", unit: "Day 07" },
    { time: "14:22", student: "박○지", course: "문법", unit: "Chapter 3" },
    { time: "14:18", student: "정○서", course: "고등 모의고사", unit: "Day 02" },
    { time: "14:15", student: "한○진", course: "워드마스터 중등 Basic", unit: "Day 01" },
    { time: "14:11", student: "임○유", course: "문법", unit: "Chapter 2" },
  ],
};

/* =====================================================================
   내부 상태
   ===================================================================== */
const state = {
  data: null,             // 마지막으로 성공한 (정규화된) 데이터
  stats: {},              // 현재 화면에 표시 중인 통계 숫자
  latestKey: null,        // 현재 JUST PASSED 카드의 식별 키
  tickerKey: "",          // ticker 내용이 바뀌었는지 확인용
  firstRender: true,
  lastSuccessAt: null,
  timer: null,
  inFlight: false,
};

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const $ = (sel) => document.querySelector(sel);

/* =====================================================================
   유틸: 이름 마스킹 / 시간 / 정규화
   ===================================================================== */

/**
 * 공개용 이름 마스킹
 *  김은우 → 김○우 / 김은 → 김○ / 남궁민수 → 남○○수
 *  이미 ○(또는 *)로 마스킹된 이름은 그대로 사용
 */
function maskName(raw) {
  const name = String(raw ?? "")
    .replace(/\(.*?\)|\[.*?\]/g, "") // "김은우(중2)" 같은 부가표기 제거
    .replace(/\s+/g, "")
    .trim();
  if (!name) return "";
  if (/[○◯*]/.test(name)) return name.replace(/[◯*]/g, "○");

  const chars = Array.from(name);
  if (chars.length === 1) return "○";
  if (chars.length === 2) return chars[0] + "○";
  return chars[0] + "○".repeat(chars.length - 2) + chars[chars.length - 1];
}

const kstTimeFmt = new Intl.DateTimeFormat("ko-KR", {
  timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});
const kstDateFmt = new Intl.DateTimeFormat("ko-KR", {
  timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short",
});

function kstParts(date, fmt) {
  const out = {};
  for (const p of fmt.formatToParts(date)) out[p.type] = p.value;
  return out;
}

/** "HH:MM:SS" (KST) */
function formatClock(date) {
  const p = kstParts(date, kstTimeFmt);
  return `${p.hour}:${p.minute}:${p.second}`;
}

/** "2026. 09. 23 (수)" (KST) */
function formatDate(date) {
  const p = kstParts(date, kstDateFmt);
  return `${p.year}. ${p.month}. ${p.day} (${p.weekday})`;
}

/** API의 time 값을 "HH:MM"으로 통일 ("14:32", "14:32:10", ISO 문자열 모두 허용) */
function formatPassTime(value) {
  const s = String(value ?? "").trim();
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if (m) return `${m[1].padStart(2, "0")}:${m[2]}`;
  const d = new Date(s);
  if (s && !Number.isNaN(d.getTime())) return formatClock(d).slice(0, 5);
  return "";
}

/** "HH:MM" → 분 단위 */
function toMinutes(hhmm) {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm || "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function toCount(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

function cleanText(v) {
  return String(v ?? "").replace(/\s+/g, " ").trim();
}

/**
 * PASS 한 건을 공개 가능한 형태로 정리.
 * 100% PASS가 아니면 null (→ 화면에 절대 나오지 않음)
 */
function sanitizePass(p) {
  if (!p || typeof p !== "object") return null;
  if (p.score != null && p.score !== "" && Number(p.score) < 100) return null;
  if (p.result != null && p.result !== "" && !/pass/i.test(String(p.result))) return null;

  const student = maskName(p.student);
  if (!student) return null;
  return {
    time: formatPassTime(p.time),
    student,
    course: cleanText(p.course),
    unit: cleanText(p.unit),
  };
}

const passKey = (p) => (p ? [p.time, p.student, p.course, p.unit].join("|") : "");

/** API 응답 → 화면용 데이터 (허용된 필드만 추출) */
function normalize(raw) {
  if (!raw || typeof raw !== "object") throw new Error("Invalid payload");
  const s = raw.stats || {};
  const latest = sanitizePass(raw.latestPass);
  const latestK = passKey(latest);

  const recent = (Array.isArray(raw.recentPasses) ? raw.recentPasses : [])
    .map(sanitizePass)
    .filter((p) => p && passKey(p) !== latestK);

  const generatedAt = new Date(raw.generatedAt);
  return {
    generatedAt: Number.isNaN(generatedAt.getTime()) ? null : generatedAt,
    stats: {
      learners: toCount(s.learners),
      pass: toCount(s.pass),
      completed: toCount(s.completed),
      retry: toCount(s.retry),
    },
    latestPass: latest,
    recentPasses: recent,
    leaders: normalizeLeaders(raw.leaders),
  };
}

/** [LEADERS] API leaders → 화면용 (허용된 필드만: 단어장명 / 단원 수 / 마스킹 이름) */
function normalizeLeaders(raw) {
  const clean = (list) => (Array.isArray(list) ? list : [])
    .map((l) => ({
      course: cleanText(l && l.course),
      unitCount: toCount(l && l.unitCount),
      students: (Array.isArray(l && l.students) ? l.students : []).map(maskName).filter(Boolean),
    }))
    .filter((l) => l.course && l.unitCount && l.students.length);
  const r = raw && typeof raw === "object" ? raw : {};
  return { today: clean(r.today), week: clean(r.week) };
}

/* =====================================================================
   렌더링
   ===================================================================== */

/* ---------- 통계 숫자: 값이 바뀐 경우에만 count-up ---------- */
function renderStats(stats) {
  for (const key of Object.keys(stats)) {
    const el = document.querySelector(`[data-stat="${key}"]`);
    if (!el) continue;
    const next = stats[key];
    const prev = state.stats[key];
    if (next === prev) continue; // 변화 없음 → 아무것도 하지 않음

    if (next == null) {
      el.textContent = "–";
    } else {
      animateCount(el, prev ?? 0, next);
    }
    state.stats[key] = next;
  }
}

function animateCount(el, from, to) {
  cancelAnimationFrame(el._raf);
  const fmt = (n) => n.toLocaleString("ko-KR");
  if (reduceMotion.matches || from === to) {
    el.textContent = fmt(to);
    return;
  }
  const duration = 900;
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
    el.textContent = fmt(Math.round(from + (to - from) * eased));
    if (t < 1) el._raf = requestAnimationFrame(step);
  };
  el._raf = requestAnimationFrame(step);
}

/* ---------- 작은 고래 아바타 ----------
   같은 기록에는 항상 같은 variation이 나오도록 기록 키로 고정 선택 (랜덤 아님) */
function avatarFor(p) {
  const key = passKey(p);
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return WHALE_AVATARS[h % WHALE_AVATARS.length];
}

function makeAvatar(p, extraClass = "") {
  const wrap = document.createElement("div");
  wrap.className = `avatar ${extraClass}`.trim();
  wrap.setAttribute("aria-hidden", "true");
  const img = document.createElement("img");
  img.src = avatarFor(p);
  img.alt = "";
  img.width = 120;
  img.height = 120;
  img.decoding = "async";
  wrap.append(img);
  return wrap;
}

/* ---------- JUST PASSED ---------- */
function renderFeatured(pass, referenceDate) {
  const card = $("#featured");
  const key = passKey(pass);

  if (!pass) {
    card.classList.add("is-empty");
    card.classList.remove("has-new");
    state.latestKey = null;
    return;
  }
  card.classList.remove("is-empty");

  const isChanged = key !== state.latestKey;
  if (isChanged) {
    card.querySelector('[data-f="time"]').textContent = pass.time;
    card.querySelector('[data-f="student"]').textContent = pass.student;
    card.querySelector('[data-f="course"]').textContent = pass.course;
    card.querySelector('[data-f="unit"]').textContent = pass.unit;
    card.setAttribute("aria-label", `방금 PASS: ${pass.time} ${pass.student} ${pass.course} ${pass.unit} 100% PASS`);
  }

  // NEW 배지: 방금(NEW_BADGE_MINUTES 이내) 통과한 기록일 때만
  card.classList.toggle("has-new", isRecent(pass.time, referenceDate));

  if (isChanged) {
    if (state.firstRender) {
      playOnce(card, ["anim-enter"], 800); // 첫 로드: 등장만
    } else {
      // 새로운 PASS 감지 → 등장 + glow + 100% PASS 강조 (1회)
      card.classList.add("has-new");
      playOnce(card, ["anim-enter", "anim-glow"], 2000);
    }
  }
  state.latestKey = key;
}

function isRecent(hhmm, referenceDate) {
  const passMin = toMinutes(hhmm);
  if (passMin == null) return false;
  const ref = referenceDate || new Date();
  const p = kstParts(ref, kstTimeFmt);
  const refMin = Number(p.hour) * 60 + Number(p.minute);
  const diff = refMin - passMin;
  return diff >= 0 && diff <= NEW_BADGE_MINUTES;
}

/** 애니메이션 클래스를 한 번만 재생하고 제거 */
function playOnce(el, classes, ms) {
  el.classList.remove(...classes);
  void el.offsetWidth; // reflow → 애니메이션 재시작
  el.classList.add(...classes);
  clearTimeout(el._animTimer);
  el._animTimer = setTimeout(() => el.classList.remove(...classes), ms);
}

/* ---------- 키 기반 리스트 업데이트 (바뀐 항목만 새로 만들기) ---------- */
function syncList(container, items, build, { animateNew }) {
  const existing = new Map();
  for (const child of container.children) existing.set(child.dataset.key, child);

  const seen = new Set();
  items.forEach((item, index) => {
    const key = passKey(item);
    if (seen.has(key)) return;
    seen.add(key);

    let node = existing.get(key);
    const isNew = !node;
    if (isNew) node = build(item);
    node.dataset.key = key;
    node.classList.toggle("is-latest", index === 0 && container.id === "feedList" && item._latest === true);

    // 순서가 다를 때만 DOM 이동
    if (container.children[index] !== node) {
      container.insertBefore(node, container.children[index] || null);
    }
    if (isNew && animateNew) playOnce(node, ["anim-in"], 700);
  });

  for (const [key, node] of existing) {
    if (!seen.has(key)) node.remove();
  }
}

function buildMiniCard(p) {
  const li = document.createElement("li");
  li.className = "mini";

  const top = document.createElement("div");
  top.className = "mini-top";
  const meta = document.createElement("div");
  const time = document.createElement("p");
  time.className = "mini-time";
  time.textContent = p.time;
  const name = document.createElement("p");
  name.className = "mini-name";
  name.textContent = p.student;
  meta.append(time, name);
  top.append(makeAvatar(p), meta);

  const course = document.createElement("p");
  course.className = "mini-course";
  course.textContent = `${p.course} ${p.unit}`.trim();

  const pass = document.createElement("p");
  pass.className = "mini-pass";
  pass.textContent = "100% PASS";

  li.append(top, course, pass);
  return li;
}

function buildFeedRow(p) {
  const li = document.createElement("li");
  li.className = "feed-row";

  const time = document.createElement("time");
  time.textContent = p.time;
  const name = document.createElement("span");
  name.className = "fr-name";
  name.textContent = p.student;
  const course = document.createElement("span");
  course.className = "fr-course";
  course.textContent = `${p.course} ${p.unit}`.trim();
  const pass = document.createElement("span");
  pass.className = "fr-pass pass-chip";
  pass.textContent = "PASS";

  li.append(makeAvatar(p), time, name, course, pass);
  return li;
}

function renderLists(data) {
  const animateNew = !state.firstRender;

  // PC: JUST PASSED 옆 작은 카드 (latest 제외 최근 3건)
  syncList($("#miniCards"), data.recentPasses.slice(0, MINI_CARD_COUNT), buildMiniCard, { animateNew });

  // FEED: PC에서는 latest 포함 / 모바일에서는 CSS로 latest 줄 숨김
  const feedItems = [];
  if (data.latestPass) feedItems.push({ ...data.latestPass, _latest: true });
  feedItems.push(...data.recentPasses);
  syncList($("#feedList"), feedItems.slice(0, FEED_MAX), buildFeedRow, { animateNew });

  $("#feedEmpty").hidden = feedItems.length > 0;
}

/* ---------- 하단 TICKER (내용이 바뀐 경우에만 다시 만듦) ---------- */
function renderTicker(data) {
  const s = data.stats;
  const items = [{ type: "live", text: "GORAE LIVE" }];
  if (s.pass != null) items.push({ text: `TODAY ${s.pass} PASS` });
  if (s.learners != null) items.push({ text: `${s.learners} LEARNERS` });
  const passes = [data.latestPass, ...data.recentPasses].filter(Boolean).slice(0, 6);
  for (const p of passes) items.push({ type: "pass", text: p.student });
  items.push({ type: "brand", text: "Small Steps, Big Changes." });
  items.push({ type: "brand", text: "From Work Hard to Think Hard" });

  const key = JSON.stringify(items);
  if (key === state.tickerKey) return; // 동일 → 애니메이션 끊지 않음
  state.tickerKey = key;

  const track = $("#tickerTrack");
  const makeGroup = (hidden) => {
    const g = document.createElement("div");
    g.className = "ticker-group";
    if (hidden) g.setAttribute("aria-hidden", "true");
    items.forEach((it, i) => {
      if (i > 0) {
        const sep = document.createElement("span");
        sep.className = "tk-sep";
        sep.textContent = "|";
        g.append(sep);
      }
      const span = document.createElement("span");
      span.className = "tk-item";
      if (it.type === "live") {
        span.classList.add("tk-live");
        span.append(document.createElement("i"), it.text);
      } else if (it.type === "pass") {
        span.classList.add("tk-pass");
        const b = document.createElement("b");
        b.textContent = "100% PASS";
        span.append(`${it.text} `, b);
      } else {
        if (it.type === "brand") span.classList.add("tk-brand");
        span.textContent = it.text;
      }
      g.append(span);
    });
    // 끝과 처음 사이 구분선
    const tail = document.createElement("span");
    tail.className = "tk-sep";
    tail.textContent = "|";
    g.append(tail);
    return g;
  };

  track.replaceChildren(makeGroup(false), makeGroup(true));

  // 폭에 맞춰 일정한 속도(약 55px/s)로 흐르도록 duration 계산
  requestAnimationFrame(() => {
    const width = track.firstElementChild.getBoundingClientRect().width;
    const seconds = Math.max(25, Math.round(width / 55));
    track.style.setProperty("--ticker-duration", `${seconds}s`);
  });
}

/* ---------- [LEADERS] GORAE LEARNING LEADERS ----------
   기존 10초 refresh 응답(data.leaders)만 사용. 추가 API 호출 없음. */
const leaderView = { period: "today", renderedKey: "" };

function renderLeaders(data) {
  if (!data) return;
  const period = leaderView.period;
  const list = (data.leaders && data.leaders[period]) || [];
  const key = period + JSON.stringify(list);
  if (key === leaderView.renderedKey) return; // 변화 없음 → DOM 그대로
  const samePeriod = leaderView.renderedKey.startsWith(period);
  leaderView.renderedKey = key;

  const container = $("#leaderList");
  const existing = new Map();
  for (const child of container.children) existing.set(child.dataset.key, child);

  list.forEach((l, index) => {
    const k = l.course.toLowerCase();
    let node = existing.get(k);
    const names = l.students.join(" · ");
    if (!node) {
      node = document.createElement("li");
      node.className = "leader";
      node.dataset.key = k;
      node.innerHTML =
        '<p class="ld-course"></p>' +
        '<p class="ld-names"><svg aria-hidden="true"><use href="#i-crown"></use></svg><span></span></p>' +
        '<p class="ld-count"><strong></strong><small></small></p>';
    }
    const prev = node.dataset.sig;
    const sig = names + "|" + l.unitCount;
    node.querySelector(".ld-course").textContent = l.course;
    node.querySelector(".ld-names span").textContent = names;
    node.querySelector(".ld-count strong").textContent = l.unitCount.toLocaleString("ko-KR");
    node.querySelector(".ld-count small").textContent = l.unitCount === 1 ? "UNIT" : "UNITS";
    node.setAttribute("aria-label", `${l.course} 리더 ${names}, ${l.unitCount} ${l.unitCount === 1 ? "UNIT" : "UNITS"}`);
    node.dataset.sig = sig;
    if (container.children[index] !== node) container.insertBefore(node, container.children[index] || null);
    // 같은 탭에서 리더가 바뀌거나 단원 수가 늘면 짧은 gold glow (첫 표시/탭 전환 시에는 없음)
    if (samePeriod && prev && prev !== sig) playOnce(node, ["ld-up"], 1700);
    existing.delete(k);
  });
  for (const node of existing.values()) node.remove();

  $("#leaderEmpty").hidden = list.length > 0;
}

function setLeaderPeriod(period) {
  if (period !== "today" && period !== "week") return;
  leaderView.period = period;
  document.querySelectorAll(".leader-tab").forEach((tab) => {
    const on = tab.dataset.period === period;
    tab.setAttribute("aria-selected", on ? "true" : "false");
    if (on) $("#leaderList").setAttribute("aria-labelledby", tab.id);
  });
  $("#leaderList").replaceChildren();
  leaderView.renderedKey = "";
  renderLeaders(state.data);
}

function initLeaders() {
  document.querySelectorAll(".leader-tab").forEach((tab) => {
    tab.addEventListener("click", () => setLeaderPeriod(tab.dataset.period));
  });
  $("#scrollCue").addEventListener("click", () => {
    $("#leaders").scrollIntoView({ behavior: reduceMotion.matches ? "auto" : "smooth", block: "start" });
  });
}

/* ---------- 연결 상태 표시 ---------- */
function setStatus(kind) {
  const el = $("#status");
  const labels = {
    demo: "DEMO",
    connecting: "연결 중",
    live: "LIVE",
    delayed: "연결 지연",
    error: "연결 실패 · 재시도 중",
    nourl: "API 미설정",
  };
  el.dataset.state = kind;
  el.querySelector(".status-label").textContent = labels[kind] || "";

  let timeText = "";
  if (kind === "demo") {
    timeText = "샘플 데이터";
  } else if (state.lastSuccessAt) {
    timeText = `마지막 업데이트 ${formatClock(state.lastSuccessAt)}`;
  }
  el.querySelector(".status-time").textContent = timeText;
}

/* ---------- 전체 적용 ---------- */
function applyData(data) {
  state.data = data;
  renderStats(data.stats);
  renderFeatured(data.latestPass, data.generatedAt);
  renderLists(data);
  renderTicker(data);
  renderLeaders(data);
  state.firstRender = false;
}

/* =====================================================================
   데이터 가져오기 + 15초 자동 갱신
   ===================================================================== */
async function fetchLiveData() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    // 커스텀 헤더 없이 단순 GET (Apps Script CORS 호환)
    const res = await fetch(API_URL, { cache: "no-store", signal: controller.signal, redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return normalize(await res.json());
  } finally {
    clearTimeout(timeout);
  }
}

async function refresh() {
  if (DEMO_MODE) {
    applyData(normalize(demoData));
    setStatus("demo");
    return;
  }
  if (!API_URL) {
    setStatus("nourl");
    return;
  }
  if (state.inFlight) return;
  state.inFlight = true;
  try {
    const data = await fetchLiveData();
    state.lastSuccessAt = new Date();
    applyData(data);
    setStatus("live");
  } catch (err) {
    // 실패해도 기존 화면은 그대로 유지. 상태 표시만 변경.
    console.warn("[GORAE LIVE] 데이터 갱신 실패:", err);
    setStatus(state.data ? "delayed" : "error");
  } finally {
    state.inFlight = false;
  }
}

function scheduleNext() {
  clearTimeout(state.timer);
  state.timer = setTimeout(async () => {
    await refresh();
    scheduleNext();
  }, REFRESH_INTERVAL_MS);
}

// 탭이 숨겨지면 호출을 멈추고, 다시 보이면 즉시 갱신 (모바일 데이터/배터리 절약)
document.addEventListener("visibilitychange", () => {
  if (DEMO_MODE) return;
  if (document.hidden) {
    clearTimeout(state.timer);
  } else {
    refresh().then(scheduleNext);
  }
});

/* ---------- 상단 시계 (실제 현재 시각, KST) ---------- */
function tickClock() {
  const now = new Date();
  $("#clock").textContent = formatClock(now);
  $("#date").textContent = formatDate(now);
}

/* =====================================================================
   START
   ===================================================================== */
function init() {
  if (APP_BACK_URL) {
    const back = $("#backLink");
    back.href = APP_BACK_URL;
    back.hidden = false;
  }
  tickClock();
  setInterval(tickClock, 1000);
  initLeaders();
  if (DEMO_MODE) {
    // DEMO: 고정 데이터 1회 표시 (데이터가 바뀌지 않으므로 반복 호출 없음)
    refresh();
    return;
  }
  setStatus("connecting");
  refresh().then(scheduleNext);
}

// 개발 확인용: 콘솔에서 GoraeLive.replayNewPass() 실행 시
// 현재 JUST PASSED 카드의 '새 PASS' 애니메이션만 다시 재생 (데이터는 바꾸지 않음)
window.GoraeLive = {
  replayNewPass() {
    const card = $("#featured");
    card.classList.add("has-new");
    playOnce(card, ["anim-enter", "anim-glow"], 2000);
  },
};

init();
