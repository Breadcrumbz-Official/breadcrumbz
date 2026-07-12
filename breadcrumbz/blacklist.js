// genuinely just a big db of posible sensitive websites, can be expanded as needed this is just as a working demo
const SUGGESTIONS = [
  "chase.com", "bankofamerica.com", "wellsfargo.com", "capitalone.com",
  "citi.com", "usbank.com", "pnc.com", "truist.com", "ally.com",
  "discover.com", "americanexpress.com", "synchrony.com", "barclays.com",
  "fidelity.com", "vanguard.com", "schwab.com", "robinhood.com",
  "etrade.com", "wealthfront.com", "betterment.com",
  "paypal.com", "venmo.com", "cash.app", "zellepay.com", "wise.com",
  "stripe.com", "westernunion.com",
  "coinbase.com", "binance.com", "kraken.com", "crypto.com",
  "experian.com", "equifax.com", "transunion.com", "creditkarma.com",
  "annualcreditreport.com",
  "irs.gov", "ssa.gov", "healthcare.gov", "studentaid.gov", "turbotax.intuit.com",
  "mychart.com", "cvs.com", "walgreens.com", "goodrx.com",
  "mail.google.com", "outlook.live.com", "mail.yahoo.com", "proton.me",
  "1password.com", "lastpass.com", "bitwarden.com", "dashlane.com",
];

const input = document.getElementById("blkInput");
const sugBox = document.getElementById("suggestions");
const listEl = document.getElementById("blkList");
const backBtn = document.getElementById("back");

let blacklist = [];
let activeIdx = -1;

backBtn.addEventListener("click", () => {
  window.location.href = "index.html";
});

function load(cb) {
  chrome.storage.local.get({ blacklist: [] }, (data) => {
    blacklist = data.blacklist;
    cb && cb();
  });
}
function save() {
  chrome.storage.local.set({ blacklist });
}

function normalize(raw) {
  let s = raw.trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "").replace(/^www\./, "");
  s = s.split("/")[0].split("?")[0].split("#")[0];
  return s;
}

function renderList() {
  listEl.innerHTML = "";
  if (!blacklist.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "nothing blacklisted yet";
    listEl.appendChild(li);
    return;
  }
  for (const domain of [...blacklist].sort()) {
    const li = document.createElement("li");

    const span = document.createElement("span");
    span.textContent = domain;

    const rm = document.createElement("button");
    rm.className = "rm";
    rm.textContent = "\u2715";
    rm.title = "remove " + domain;
    rm.addEventListener("click", () => {
      blacklist = blacklist.filter((d) => d !== domain);
      save();
      renderList();
    });

    li.appendChild(span);
    li.appendChild(rm);
    listEl.appendChild(li);
  }
}

function addEntry(domain) {
  const d = normalize(domain);
  if (!d) return;
  if (!blacklist.includes(d)) {
    blacklist.push(d);
    save();
    renderList();
  }
  input.value = "";
  closeSuggestions();
  input.focus();
}

function closeSuggestions() {
  sugBox.classList.remove("open");
  sugBox.innerHTML = "";
  activeIdx = -1;
}

function renderSuggestions() {
  const q = input.value.trim().toLowerCase();
  sugBox.innerHTML = "";
  activeIdx = -1;
  if (!q) { closeSuggestions(); return; }

  const matches = SUGGESTIONS
    .filter((d) => d.includes(q) && !blacklist.includes(d))
    .slice(0, 8);

  for (const d of matches) {
    const li = document.createElement("li");
    // highlight the matching part
    const i = d.indexOf(q);
    li.appendChild(document.createTextNode(d.slice(0, i)));
    const mark = document.createElement("mark");
    mark.textContent = d.slice(i, i + q.length);
    li.appendChild(mark);
    li.appendChild(document.createTextNode(d.slice(i + q.length)));
    li.addEventListener("mousedown", (e) => { e.preventDefault(); addEntry(d); });
    sugBox.appendChild(li);
  }

  // explicit offer
  const norm = normalize(q);
  if (norm && !blacklist.includes(norm) && !matches.includes(norm)) {
    const li = document.createElement("li");
    li.className = "addRaw";
    li.textContent = `add "${norm}"`;
    li.addEventListener("mousedown", (e) => { e.preventDefault(); addEntry(norm); });
    sugBox.appendChild(li);
  }

  if (sugBox.children.length) sugBox.classList.add("open");
  else closeSuggestions();
}

function moveActive(delta) {
  const items = [...sugBox.children];
  if (!items.length) return;
  activeIdx = (activeIdx + delta + items.length) % items.length;
  items.forEach((el, i) => el.classList.toggle("active", i === activeIdx));
}

input.addEventListener("input", renderSuggestions);
input.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") { e.preventDefault(); moveActive(1); }
  else if (e.key === "ArrowUp") { e.preventDefault(); moveActive(-1); }
  else if (e.key === "Enter") {
    e.preventDefault();
    const items = [...sugBox.children];
    if (activeIdx >= 0 && items[activeIdx]) {
      // strip the `add "..."` wrapper if it's the raw option
      const t = items[activeIdx].textContent;
      const m = t.match(/^add "(.+)"$/);
      addEntry(m ? m[1] : t);
    } else {
      addEntry(input.value);
    }
  } else if (e.key === "Escape") {
    closeSuggestions();
  }
});
input.addEventListener("blur", () => setTimeout(closeSuggestions, 120));

// ---- init ----
load(renderList);