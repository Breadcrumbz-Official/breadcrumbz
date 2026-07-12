const SERVER_URL = "http://emote-galore-panther.ngrok-free.dev";

function isBlacklisted(hostname, blacklist) {
  const host = (hostname || "").toLowerCase();
  return blacklist.some((entry) => {
    const e = entry.toLowerCase();
    if (e.includes(".")) {
      return host === e || host.endsWith("." + e);
    }
    return host.includes(e);
  });
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== "PAGE_TEXT") return;

  chrome.storage.local.get({ blacklist: [] }, (data) => {
    let hostname = "";
    try { hostname = new URL(msg.url).hostname; } catch {}

    if (isBlacklisted(hostname, data.blacklist)) {
      console.log("breadcrumbz: blocked blacklisted page", msg.url);
      return;
    }

    fetch(`${SERVER_URL}/index`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: msg.text, url: msg.url })
    })
      .then((res) => {
        if (!res.ok) throw new Error(`server responded ${res.status}`);
        return res.json();
      })
      .then((data) => {
        console.log("breadcrumbz: indexed", msg.url, data.keywords);
      })
      .catch((err) => {
        console.error("breadcrumbz: failed to index scrape", err);
      });
  });
});