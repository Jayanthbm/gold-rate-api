const SOURCE_URL = "https://www.goodreturns.in/gold-rates/bangalore.html";
const PURITIES = ["24K", "22K", "18K"]; // table 1 columns 2-4
const CACHE_TTL_SECONDS = 3600;
const CACHE_KEY_URL = "https://__gold-rate-cache__/latest";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

/**
 * Equivalent of the sheet formula:
 *   VALUE(SUBSTITUTE(REGEXEXTRACT(cell, "[0-9,]+"), ",", ""))
 */
export function extractNumber(text) {
  // Decode numeric HTML entities (&#x20b9; / &#8377;) like a rendered DOM would
  const decoded = String(text ?? "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)));
  const match = /[0-9][0-9,]*/.exec(decoded);
  if (!match) return null;
  const value = Number(match[0].replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
}

/**
 * Maps a purity param ("24", "22", "18", "24k", "22K"...) to a table key
 * ("24K", "22K", "18K"), or null if it is not a supported purity.
 */
export function normalizePurity(value) {
  const match = /^(\d{2})k?$/i.exec(String(value ?? "").trim());
  if (!match) return null;
  const key = `${match[1]}K`;
  return PURITIES.includes(key) ? key : null;
}

/**
 * Extracts the text of selected cells from one row of the first HTML table,
 * mirroring IMPORTHTML(url, "table", 1) -> INDEX(table, row, col) with 1-based
 * rowIndex and colIndexes. Uses HTMLRewriter (native to Workers, zero deps).
 * Returns an object keyed by 1-based column index, e.g. { 2: "\u20b914,826..." }.
 */
export async function extractRowCells(html, rowIndex, colIndexes) {
  const targetCols = new Set(colIndexes.map((c) => c - 1)); // 0-based
  const state = { table: -1, row: -1, col: -1, capture: -1, text: "" };
  const values = {};

  const onTable = () => {
    state.table += 1;
    state.row = -1;
    state.col = -1;
  };

  const onRow = () => {
    state.row += 1;
    state.col = -1;
  };

  const onCell = (el) => {
    state.col += 1;
    const col = state.col;
    if (state.table !== 0 || state.row !== rowIndex - 1 || !targetCols.has(col)) return;
    state.capture = col;
    state.text = "";
    el.onEndTag(() => {
      values[col + 1] = state.text;
      if (state.capture === col) state.capture = -1;
    });
  };

  const onText = (chunk) => {
    if (state.capture !== -1) state.text += chunk.text;
  };

  const rewriter = new HTMLRewriter()
    .on("table", { element: onTable })
    .on("tr", { element: onRow })
    .on("td", { element: onCell, text: onText })
    .on("th", { element: onCell, text: onText });

  // Consuming the transformed body drives the parser to completion.
  await rewriter.transform(new Response(html)).text();
  return values;
}

async function fetchLatestRate() {
  const res = await fetch(SOURCE_URL, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
    cf: { cacheTtl: CACHE_TTL_SECONDS },
  });
  if (!res.ok) {
    throw new Error(`Upstream returned ${res.status}`);
  }
  const html = await res.text();
  const cells = await extractRowCells(html, 2, [2, 3, 4]);
  const rates = Object.fromEntries(PURITIES.map((p, i) => [p, extractNumber(cells[i + 2])]));
  if (PURITIES.some((p) => rates[p] === null)) {
    throw new Error("Could not parse gold rates from upstream page");
  }
  return { rates, fetchedAt: new Date().toISOString() };
}

async function getRate() {
  const cache = caches.default;
  const cacheKey = new Request(CACHE_KEY_URL);

  try {
    const hit = await cache.match(cacheKey);
    if (hit) return await hit.json();
  } catch {
    // Cache unavailable -> fall through to a live fetch
  }

  const payload = await fetchLatestRate();

  try {
    await cache.put(
      cacheKey,
      new Response(JSON.stringify(payload), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": `public, max-age=${CACHE_TTL_SECONDS}`,
        },
      }),
    );
  } catch {
    // Cache write failure is not fatal
  }

  return payload;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS_HEADERS },
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (request.method !== "GET") {
      return json({ error: "Method not allowed" }, 405);
    }

    if (url.pathname === "/") {
      return json({
        name: "gold-rate-api",
        endpoints: {
          "/api/gold": "JSON: Bangalore 24K/22K/18K gold rates per gram",
          "/api/gold?format=raw": "CSV row (24K,22K,18K); add &purity=24|22|18 for one value",
        },
        source: SOURCE_URL,
        cacheTtlSeconds: CACHE_TTL_SECONDS,
      });
    }

    if (url.pathname === "/api/gold") {
      let data;
      try {
        data = await getRate();
      } catch (err) {
        return json({ error: "Failed to fetch gold rate", detail: String(err?.message ?? err) }, 502);
      }

      const body = {
        city: "Bangalore",
        currency: "INR",
        unit: "gram",
        gold24kPerGramInr: data.rates["24K"],
        gold22kPerGramInr: data.rates["22K"],
        gold18kPerGramInr: data.rates["18K"],
        source: SOURCE_URL,
        fetchedAt: data.fetchedAt,
      };

      if (url.searchParams.get("format") === "raw") {
        const purity = url.searchParams.get("purity");
        const respond = (text) =>
          new Response(text, {
            headers: { "Content-Type": "text/plain; charset=utf-8", ...CORS_HEADERS },
          });

        if (purity !== null) {
          const key = normalizePurity(purity);
          if (key === null) {
            return json({ error: "Invalid purity", validValues: ["24", "22", "18"] }, 400);
          }
          return respond(String(data.rates[key]));
        }
        // CSV row 24K,22K,18K -> IMPORTDATA spreads it across three columns
        return respond(PURITIES.map((p) => data.rates[p]).join(","));
      }
      return json(body);
    }

    return json({ error: "Not found" }, 404);
  },
};
