(function () {
  if (window.__pageTextScraperRan) return;
  window.__pageTextScraperRan = true;

  const SKIP_TAGS = new Set([
    "SCRIPT", "STYLE", "NOSCRIPT", "SVG", "IFRAME", "TEMPLATE",
    "NAV", "HEADER", "FOOTER", "FORM", "BUTTON", "SELECT", "TEXTAREA",
    "INPUT", "LABEL", "CANVAS", "AUDIO", "VIDEO"
  ]);

  const SKIP_SELECTOR = [
    "[role='navigation']", "[role='banner']", "[role='contentinfo']",
    "[role='search']", "[role='menu']", "[role='toolbar']",
    "[aria-hidden='true']", "[hidden]",
    ".ad", ".ads", ".advertisement",
    "[class*='cookie']", "[id*='cookie']",
    "[class*='popup']", "[class*='modal']",
    "[class*='sidebar']", "[class*='menu']"
  ].join(",");

  const BLOCK_TAGS = new Set([
    "P", "DIV", "SECTION", "ARTICLE", "MAIN", "ASIDE",
    "H1", "H2", "H3", "H4", "H5", "H6",
    "LI", "TR", "BLOCKQUOTE", "PRE", "FIGCAPTION",
    "UL", "OL", "TABLE", "DL", "DD", "DT", "HR", "BR"
  ]);

  function isHidden(el) {
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return true;
    if (parseFloat(style.opacity) === 0) return true;

    const rect = el.getBoundingClientRect();
    if (rect.width <= 1 && rect.height <= 1) return true;
    if (rect.bottom < 0 || rect.right < 0) return true;

    const left = parseFloat(style.left);
    const top = parseFloat(style.top);
    if ((style.position === "absolute" || style.position === "fixed") && (left <= -5000 || top <= -5000)) return true;
    if (parseFloat(style.textIndent) <= -5000) return true;

    if (/rect\(0px,?\s*0px,?\s*0px,?\s*0px\)/.test(style.clip)) return true;
    if (style.clipPath && /inset\(\s*(100%|9[0-9]%)/.test(style.clipPath)) return true;

    return false;
  }

  function skippable(el) {
    return (
      SKIP_TAGS.has(el.tagName) ||
      el.matches(SKIP_SELECTOR) ||
      isHidden(el)
    );
  }

  function collect(node, out) {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        const t = child.nodeValue.replace(/\s+/g, " ");
        if (t.trim()) out.push(t);
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        if (skippable(child)) continue;

        const isBlock = BLOCK_TAGS.has(child.tagName);
        if (isBlock) out.push("\n");

        if (child.shadowRoot) collect(child.shadowRoot, out);
        collect(child, out);
        if (isBlock) out.push("\n");
      }
    }
  }

  function extractVisibleText() {
    if (!document.body) return "";

    const out = [];
    collect(document.body, out);

    let text = out
      .join("")

      .replace(/[ \t]*\n[ \t]*/g, "\n")

      .replace(/[ \t]{2,}/g, " ")

      .replace(/\n{3,}/g, "\n\n");

    //drop tiny/garbage lines
    text = text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => {
        if (!line) return true;
        if (line.length < 2) return false;
        // reject lines with a meaningful share of odd symbol characters
        const weird = line.match(/[^\x20-\x7E\u00C0-\u024F\u2018\u2019\u201C\u201D\u2013\u2014\u2026]/g) || [];
        if (weird.length / line.length > 0.15) return false;
        // require a reasonable share of plain readable characters
        const normal = line.match(/[a-zA-Z0-9\s.,!?;:'"()\-]/g) || [];
        return normal.length / line.length > 0.6;
      })
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    return text;
  }

  function scheduleScrape(attempt = 0) {
    const MAX_ATTEMPTS = 6;
    const text = extractVisibleText();

    if (text && text.length >= 200) {
      send(text);
      return;
    }
    if (attempt >= MAX_ATTEMPTS) {
      if (text && text.length >= 20) send(text); // send whatever we got
      return;
    }
    setTimeout(() => scheduleScrape(attempt + 1), 800 + attempt * 400);
  }

  function send(text) {
    if (!chrome.runtime?.id) return;
    try {
      chrome.runtime.sendMessage({
        type: "PAGE_TEXT",
        url: location.href,
        title: document.title,
        text: text
      });
    } catch (err) {
      console.warn("breadcrumbz: invalid response, refresh this tab", err);
    }
  }

  function isBlacklisted(hostname, blacklist) {
    const host = hostname.toLowerCase();
    return blacklist.some((entry) => {
      const e = entry.toLowerCase();
      if (e.includes(".")) {
        return host === e || host.endsWith("." + e);
      }
      return host.includes(e);
    });
  }

  setTimeout(() => {
    chrome.storage.local.get({ tracking: true, blacklist: [] }, (data) => {
      if (!data.tracking) return;
      if (isBlacklisted(location.hostname, data.blacklist)) {
        console.log("breadcrumbz: blacklisted site, scraping is a nono");
        return;
      }
      scheduleScrape();
    });
  }, 1000);
})();