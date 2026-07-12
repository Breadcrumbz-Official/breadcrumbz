const SERVER_URL = "http://emote-galore-panther.ngrok-free.dev";

const qInput = document.getElementById("q");
const list = document.getElementById("results");
const toggle = document.getElementById("trackToggle");

chrome.storage.local.get({ tracking: true }, (data) => {
  toggle.checked = data.tracking;
});
toggle.addEventListener("change", () => {
  chrome.storage.local.set({ tracking: toggle.checked });
});

function info(msg) {
  list.innerHTML = "";
  const li = document.createElement("li");
  li.className = "info";
  li.textContent = msg;
  list.appendChild(li);
}

const BAD_CUTOFF = 0.22;
const MAX_SCORE = 0.45;

function confidenceHue(score) {
  const s = Math.max(0, Math.min(1, score));
  if (s <= BAD_CUTOFF) return 0;
  const t = Math.min(1, (s - BAD_CUTOFF) / (MAX_SCORE - BAD_CUTOFF));
  return t * 120;
}

function confidenceColor(score) {
  return `hsl(${confidenceHue(score)}, 85%, 34%)`;
}

function confidenceTint(score) {
  return `hsl(${confidenceHue(score)}, 75%, 86%)`;
}

//title conversion: "domain - page"
function shortenUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    let path = (u.pathname || "").replace(/\/+$/, "");
    const last = path.split("/").filter(Boolean).pop() || "";
    let page = decodeURIComponent(last)
      .replace(/\.(html?|php|aspx?)$/i, "")
      .replace(/[-_+]/g, " ")
      .trim();
    if (!page) return host;
    if (page.length > 42) page = page.slice(0, 40) + "\u2026";
    return `${host} \u00b7 ${page}`;
  } catch {
    return url.length > 50 ? url.slice(0, 48) + "\u2026" : url;
  }
}

function collectRows(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.results)) return data.results;
  if (Array.isArray(data.matches)) {
    return data.matches.flatMap((m) =>
      Array.isArray(m.results) ? m.results
        : Array.isArray(m.occurrences) ? m.occurrences
        : []
    );
  }
  if (Array.isArray(data.keywords)) {
    return data.keywords.flatMap((k) =>
      Array.isArray(k.results) ? k.results
        : Array.isArray(k.occurrences) ? k.occurrences
        : []
    );
  }
  return [];
}

async function findSmart(q) {
  const res = await fetch(`${SERVER_URL}/find`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: q }),
  });
  if (!res.ok) throw new Error(`find ${res.status}`);
  return collectRows(await res.json());
}

async function searchExact(q) {
  const res = await fetch(`${SERVER_URL}/search?word=${encodeURIComponent(q)}`);
  if (!res.ok) throw new Error(`search ${res.status}`);
  return collectRows(await res.json());
}

function render(rows) {
  const byUrl = new Map();
  for (const r of rows) {
    if (!r || !r.url) continue;
    const score = typeof r.score === "number" ? r.score : 0;
    const cur = byUrl.get(r.url);
    if (cur) {
      cur.hits += 1;
      if (score > cur.score) cur.score = score;
    } else {
      byUrl.set(r.url, { url: r.url, score, hits: 1 });
    }
  }

  const pages = [...byUrl.values()].sort((a, b) => b.score - a.score);
  if (!pages.length) {
    info("no results");
    return;
  }

  list.innerHTML = "";
  for (const p of pages) {
    const li = document.createElement("li");

    li.style.background = confidenceTint(p.score);
    li.style.borderLeft = `5px solid ${confidenceColor(p.score)}`;
    li.style.borderColor = confidenceColor(p.score);
    if (p.score < BAD_CUTOFF) li.style.opacity = "0.45";

    const a = document.createElement("a");
    a.href = p.url;
    a.target = "_blank";
    a.textContent = shortenUrl(p.url);
    a.title = p.url;

    const meta = document.createElement("div");
    meta.className = "meta";

    const conf = document.createElement("span");
    conf.className = "conf";
    conf.style.color = confidenceColor(p.score);
    conf.textContent = `${Math.round(p.score * 100)}%`;

    const hits = document.createElement("span");
    hits.className = "hits";
    hits.textContent = `${p.hits} match${p.hits > 1 ? "es" : ""}`;

    meta.appendChild(conf);
    meta.appendChild(hits);

    li.appendChild(a);
    li.appendChild(meta);
    list.appendChild(li);
  }
}

async function runSearch() {
  const q = qInput.value.trim();
  list.innerHTML = "";
  if (!q) return;
  info("searching\u2026");

  let rows = [];
  let findFailed = false;

  try {
    rows = await findSmart(q);
  } catch (err) {
    findFailed = true;
  }

  if (!rows.length) {
    try {
      const exact = await searchExact(q);
      rows = rows.concat(exact);
    } catch (err) {
      if (findFailed) {
        info("server unreachable");
        return;
      }
    }
  }

  render(rows);
}

qInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") runSearch();
});

// ---- blacklist page navigation ----
document.getElementById("blkBtn").addEventListener("click", () => {
  window.location.href = "blacklist.html";
});