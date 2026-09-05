const fs = require("fs");
const path = require("path");

const NEWSWIRE_URL = "https://www.rockstargames.com/newswire";

const ROOT_DIR = path.resolve(__dirname, "..");
const CONFIG_FILE = path.join(ROOT_DIR, "config", "config.json");
const STATE_FILE = path.join(
  ROOT_DIR,
  "data",
  "state",
  "newswire.json"
);
const NOTIFICATIONS_FILE = path.join(
  ROOT_DIR,
  "data",
  "state",
  "notifications.json"
);

function readJson(file) {
  try {
    if (!fs.existsSync(file)) {
      return null;
    }

    return JSON.parse(
      fs.readFileSync(file, "utf8")
    );
  } catch (error) {
    console.log(
      `[NEWSWIRE] Failed to read ${file}: ${error.message}`
    );

    return null;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(
    path.dirname(file),
    {
      recursive: true
    }
  );

  fs.writeFileSync(
    file,
    JSON.stringify(data, null, 2) + "\n",
    "utf8"
  );
}

function decodeHtml(value) {
  if (!value) {
    return value;
  }

  return String(value)
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#47;/gi, "/")
    .replace(/&#x27;/gi, "'")
    .replace(/&#34;/gi, '"')
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeUrl(value) {
  if (!value) {
    return null;
  }

  let url = String(value).trim();

  if (url.startsWith("/")) {
    url =
      `https://www.rockstargames.com${url}`;
  }

  try {
    const parsed = new URL(url);

    if (
      parsed.hostname !==
        "www.rockstargames.com" &&
      parsed.hostname !==
        "rockstargames.com"
    ) {
      return null;
    }

    parsed.hash = "";
    parsed.search = "";

    return parsed.toString();
  } catch {
    return null;
  }
}

function isArticleUrl(url) {
  return Boolean(
    url &&
      /rockstargames\.com\/newswire\/article\//i.test(
        url
      )
  );
}

function normalizeDate(value) {
  if (!value) {
    return null;
  }

  const text =
    String(value).trim();

  if (!text) {
    return null;
  }

  const date = new Date(text);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return null;
  }

  return date.toISOString();
}

const MONTHS = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,

  janvier: 0,
  février: 1,
  fevrier: 1,
  mars: 2,
  avril: 3,
  mai: 4,
  juin: 5,
  juillet: 6,
  août: 7,
  aout: 7,
  septembre: 8,
  octobre: 9,
  novembre: 10,
  décembre: 11,
  decembre: 11
};

function parseHumanDate(value) {
  if (!value) {
    return null;
  }

  const text =
    String(value)
      .replace(/\s+/g, " ")
      .trim();

  let match = text.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})\b/i
  );

  if (match) {
    const year =
      Number(match[3]);

    const month =
      MONTHS[
        match[1].toLowerCase()
      ];

    const day =
      Number(match[2]);

    return new Date(
      Date.UTC(
        year,
        month,
        day
      )
    ).toISOString();
  }

  match = text.match(
    /\b(\d{1,2})\s+(janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)\s+(\d{4})\b/i
  );

  if (match) {
    const day =
      Number(match[1]);

    const month =
      MONTHS[
        match[2].toLowerCase()
      ];

    const year =
      Number(match[3]);

    return new Date(
      Date.UTC(
        year,
        month,
        day
      )
    ).toISOString();
  }

  return null;
}

function findDateInText(text) {
  if (!text) {
    return null;
  }

  const iso =
    text.match(
      /\b20\d{2}-\d{2}-\d{2}(?:T[0-9:.+-]+Z?)?\b/
    );

  if (iso) {
    const parsed =
      normalizeDate(iso[0]);

    if (parsed) {
      return parsed;
    }
  }

  const english =
    text.match(
      /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+20\d{2}\b/i
    );

  if (english) {
    return parseHumanDate(
      english[0]
    );
  }

  const french =
    text.match(
      /\b\d{1,2}\s+(?:janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)\s+20\d{2}\b/i
    );

  if (french) {
    return parseHumanDate(
      french[0]
    );
  }

  return null;
}

function extractMeta(
  html,
  names
) {
  for (const name of names) {
    const escaped =
      name.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
      );

    const patterns = [
      new RegExp(
        `<meta[^>]+(?:name|property)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`,
        "i"
      ),
      new RegExp(
        `<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${escaped}["'][^>]*>`,
        "i"
      )
    ];

    for (const pattern of patterns) {
      const match =
        html.match(pattern);

      if (match) {
        return decodeHtml(
          match[1]
        );
      }
    }
  }

  return null;
}

function extractJsonLdDates(html) {
  let published = null;
  let modified = null;

  const blocks =
    html.match(
      /<script[^>]+type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi
    ) || [];

  for (const block of blocks) {
    const body =
      block
        .replace(
          /<script[^>]*>/i,
          ""
        )
        .replace(
          /<\/script>$/i,
          ""
        )
        .trim();

    try {
      const json =
        JSON.parse(body);

      const values =
        Array.isArray(json)
          ? json
          : [json];

      for (const item of values) {
        if (
          !published &&
          item &&
          item.datePublished
        ) {
          published =
            normalizeDate(
              item.datePublished
            );
        }

        if (
          !modified &&
          item &&
          item.dateModified
        ) {
          modified =
            normalizeDate(
              item.dateModified
            );
        }
      }
    } catch {
      const p =
        body.match(
          /"datePublished"\s*:\s*"([^"]+)"/i
        );

      const m =
        body.match(
          /"dateModified"\s*:\s*"([^"]+)"/i
        );

      if (!published && p) {
        published =
          normalizeDate(
            p[1]
          );
      }

      if (!modified && m) {
        modified =
          normalizeDate(
            m[1]
          );
      }
    }
  }

  return {
    published,
    modified
  };
}

async function fetchPage(url) {
  const response =
    await fetch(url, {
      headers: {
        "user-agent":
          "Mozilla/5.0 RSGOracle Newswire",
        accept:
          "text/html,application/xhtml+xml"
      }
    });

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status}`
    );
  }

  const html =
    await response.text();

  return {
    html,
    response
  };
}

async function fetchLastModified(url) {
  try {
    const response =
      await fetch(url, {
        method: "HEAD",
        redirect: "follow",
        headers: {
          "user-agent":
            "Mozilla/5.0 RSGOracle Newswire"
        }
      });

    return (
      response.headers.get(
        "last-modified"
      ) || null
    );
  } catch {
    return null;
  }
}

function extractArticleLinks(
  html,
  limit
) {
  const results = [];
  const seen = new Set();

  const pattern =
    /<a\b[^>]*href=["']([^"']*\/newswire\/article\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  let match;

  while (
    (match =
      pattern.exec(html)) &&
    results.length <
      limit + 1
  ) {
    const url =
      normalizeUrl(
        match[1]
      );

    if (
      !isArticleUrl(url) ||
      seen.has(url)
    ) {
      continue;
    }

    seen.add(url);

    const title =
      decodeHtml(
        match[2]
      );

    const start =
      Math.max(
        0,
        match.index - 1200
      );

    const end =
      Math.min(
        html.length,
        pattern.lastIndex + 1200
      );

    const context =
      decodeHtml(
        html.slice(
          start,
          end
        )
      );

    const date =
      findDateInText(
        context
      );

    results.push({
      title:
        title || null,
      url,
      date
    });
  }

  return results;
}

async function fetchNewswire(
  latestArticles
) {
  console.log(
    "[NEWSWIRE] Checking Rockstar Newswire..."
  );

  const { html } =
    await fetchPage(
      NEWSWIRE_URL
    );

  const links =
    extractArticleLinks(
      html,
      latestArticles
    );

  console.log(
    `[NEWSWIRE] Article links detected: ${links.length}`
  );

  if (!links.length) {
    return [];
  }

  /*
   * Rockstar currently places the featured
   * GTA VI article first.
   *
   * Ignore that first result and inspect
   * the next 5 real Newswire articles.
   */
  const candidates =
    links.slice(
      1,
      latestArticles + 1
    );

  console.log(
    `[NEWSWIRE] Ignoring first featured result, checking ${candidates.length} latest articles.`
  );

  const articles = [];

  for (const item of candidates) {
    try {
      const [
        page,
        lastModified
      ] = await Promise.all([
        fetchPage(
          item.url
        ),
        fetchLastModified(
          item.url
        )
      ]);

      const articleHtml =
        page.html;

      const jsonLd =
        extractJsonLdDates(
          articleHtml
        );

      const publishedMeta =
        extractMeta(
          articleHtml,
          [
            "article:published_time",
            "datePublished",
            "publication_date",
            "published_time"
          ]
        );

      const modifiedMeta =
        extractMeta(
          articleHtml,
          [
            "article:modified_time",
            "dateModified",
            "modified_time"
          ]
        );

      const titleMeta =
        extractMeta(
          articleHtml,
          [
            "og:title",
            "twitter:title"
          ]
        );

      const date =
        jsonLd.published ||
        normalizeDate(
          publishedMeta
        ) ||
        parseHumanDate(
          publishedMeta
        ) ||
        item.date ||
        findDateInText(
          decodeHtml(
            articleHtml
          )
        );

      const updatedAt =
        jsonLd.modified ||
        normalizeDate(
          modifiedMeta
        ) ||
        parseHumanDate(
          modifiedMeta
        );

      const title =
        titleMeta ||
        item.title ||
        null;

      articles.push({
        title,
        url: item.url,
        date:
          date || null,
        updatedAt:
          updatedAt || null,

        /*
         * IMPORTANT:
         * Keep EXACTLY the HTTP
         * Last-Modified header.
         *
         * If Rockstar sends:
         * Thu, 31 Aug 2045 02:39:53 GMT
         *
         * we keep that exact value.
         */
        lastModified:
          lastModified || null
      });

      console.log(
        `[NEWSWIRE] ${title || item.url}`
      );

      console.log(
        `[NEWSWIRE] Published: ${date || "unknown"}`
      );

      console.log(
        `[NEWSWIRE] Last-Modified header: ${lastModified || "unknown"}`
      );

      console.log(
        `[NEWSWIRE] Updated: ${updatedAt || "unknown"}`
      );
    } catch (error) {
      console.log(
        `[NEWSWIRE] Failed to read article ${item.url}: ${error.message}`
      );

      articles.push({
        title:
          item.title || null,
        url: item.url,
        date:
          item.date || null,
        updatedAt: null,
        lastModified: null
      });
    }
  }

  return articles;
}

function normalizeState(state) {
  if (
    !state ||
    typeof state !== "object"
  ) {
    return {
      articles: [],
      known_urls: []
    };
  }

  return {
    articles:
      Array.isArray(
        state.articles
      )
        ? state.articles
        : [],

    known_urls:
      Array.isArray(
        state.known_urls
      )
        ? state.known_urls
        : []
  };
}

function loadNotifications() {
  const data =
    readJson(
      NOTIFICATIONS_FILE
    );

  return Array.isArray(data)
    ? data
    : [];
}

function findExisting(
  state,
  url
) {
  return (
    state.articles.find(
      (article) =>
        article &&
        article.url === url
    ) || null
  );
}

function mergeArticle(
  state,
  article
) {
  const existing =
    findExisting(
      state,
      article.url
    );

  if (!existing) {
    state.articles.push({
      title:
        article.title ||
        "Newswire",

      url:
        article.url,

      date:
        article.date ||
        null,

      last_modified:
        article.lastModified ||
        null,

      updated_at:
        article.updatedAt ||
        null
    });

    return true;
  }

  let changed = false;

  if (
    article.title &&
    existing.title !==
      article.title
  ) {
    existing.title =
      article.title;

    changed = true;
  }

  if (
    article.date &&
    existing.date !==
      article.date
  ) {
    existing.date =
      article.date;

    changed = true;
  }

  if (
    article.lastModified &&
    existing.last_modified !==
      article.lastModified
  ) {
    existing.last_modified =
      article.lastModified;

    changed = true;
  }

  if (
    article.updatedAt &&
    existing.updated_at !==
      article.updatedAt
  ) {
    existing.updated_at =
      article.updatedAt;

    changed = true;
  }

  return changed;
}

async function main() {
  try {
    const config =
      readJson(
        CONFIG_FILE
      ) || {};

    const latestArticles =
      Number.isInteger(
        config?.newswire?.latest_articles
      ) &&
      config.newswire.latest_articles >
        0
        ? config.newswire.latest_articles
        : 5;

    const previousState =
      normalizeState(
        readJson(
          STATE_FILE
        )
      );

    const currentArticles =
      await fetchNewswire(
        latestArticles
      );

    if (
      !currentArticles.length
    ) {
      console.log(
        "[NEWSWIRE] No Newswire articles detected."
      );

      return;
    }

    const knownUrls =
      new Set(
        previousState.known_urls
      );

    for (
      const article of
        previousState.articles
    ) {
      if (article?.url) {
        knownUrls.add(
          article.url
        );
      }
    }

    const newArticles =
      currentArticles.filter(
        (article) =>
          !knownUrls.has(
            article.url
          )
      );

    const state = {
      articles: [
        ...previousState.articles
      ],

      known_urls: [
        ...previousState.known_urls
      ]
    };

    let stateChanged =
      false;

    /*
     * Always enrich existing articles.
     *
     * This repairs old state entries such as:
     *
     * date: null
     * updated_at: null
     *
     * without requiring the article
     * to be detected as new again.
     */
    for (
      const article of
        currentArticles
    ) {
      if (
        mergeArticle(
          state,
          article
        )
      ) {
        stateChanged =
          true;
      }
    }

    if (
      newArticles.length
    ) {
      const notifications =
        loadNotifications();

      const detectedAt =
        new Date().toISOString();

      for (
        const article of
          newArticles
      ) {
        notifications.push({
          type:
            "newswire_new_post",

          title:
            article.title ||
            "Newswire",

          url:
            article.url,

          date:
            article.date ||
            null,

          last_modified:
            article.lastModified ||
            null,

          updated_at:
            article.updatedAt ||
            null,

          detected_at:
            detectedAt
        });

        if (
          !state.known_urls.includes(
            article.url
          )
        ) {
          state.known_urls.push(
            article.url
          );
        }

        console.log(
          `[NEWSWIRE] New article detected: ${article.title || article.url}`
        );
      }

      writeJson(
        NOTIFICATIONS_FILE,
        notifications
      );

      stateChanged =
        true;
    }

    state.articles =
      state.articles.slice(
        -25
      );

    state.known_urls =
      Array.from(
        new Set(
          state.known_urls
        )
      ).slice(-25);

    if (
      stateChanged
    ) {
      writeJson(
        STATE_FILE,
        state
      );

      console.log(
        "[NEWSWIRE] State updated."
      );
    } else {
      console.log(
        "[NEWSWIRE] No state changes."
      );
    }

    console.log(
      `[NEWSWIRE] New articles: ${newArticles.length}`
    );
  } catch (error) {
    console.error(
      `[NEWSWIRE] Failed: ${error.message}`
    );

    process.exitCode = 1;
  }
}

main();
