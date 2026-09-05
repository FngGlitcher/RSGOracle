const fs = require("fs");
const path = require("path");

const NEWSWIRE_URL = "https://www.rockstargames.com/newswire";
const GRAPHQL_URL = "https://www.rockstargames.com/graphql";

const NEWSWIRE_LIST_HASH = "NewswireList";
const NEWSWIRE_POST_HASH = "NewswirePost";

const ROOT_DIR = path.resolve(__dirname, "..");
const CONFIG_FILE = path.join(ROOT_DIR, "config", "config.json");
const STATE_FILE = path.join(ROOT_DIR, "data", "state", "newswire.json");
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

    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    console.log(
      `[NEWSWIRE] Failed to read ${file}: ${error.message}`
    );
    return null;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), {
    recursive: true
  });

  fs.writeFileSync(
    file,
    JSON.stringify(data, null, 2) + "\n",
    "utf8"
  );
}

function decodeHtml(value) {
  if (!value || typeof value !== "string") {
    return value;
  }

  return value
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
    .trim();
}

function cleanTitle(value) {
  if (!value) {
    return null;
  }

  const title = decodeHtml(String(value))
    .replace(/\s+/g, " ")
    .trim();

  return title || null;
}

function normalizeUrl(value) {
  if (!value) {
    return null;
  }

  let url = String(value).trim();

  if (url.startsWith("/")) {
    url = `https://www.rockstargames.com${url}`;
  }

  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return null;
  }

  try {
    const parsed = new URL(url);

    if (
      parsed.hostname !== "www.rockstargames.com" &&
      parsed.hostname !== "rockstargames.com"
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

function isNewswireArticleUrl(value) {
  const url = normalizeUrl(value);

  if (!url) {
    return false;
  }

  return (
    /\/newswire\/article\//i.test(url) &&
    !/\/newswire\/?$/i.test(url)
  );
}

function isValidDate(value) {
  if (!value) {
    return false;
  }

  const date = new Date(value);

  return !Number.isNaN(date.getTime());
}

function normalizeDate(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return isValidDate(value)
      ? value.toISOString()
      : null;
  }

  const stringValue = String(value).trim();

  if (!stringValue) {
    return null;
  }

  if (isValidDate(stringValue)) {
    return new Date(stringValue).toISOString();
  }

  return null;
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
  if (!value || typeof value !== "string") {
    return null;
  }

  const text = value
    .replace(/\s+/g, " ")
    .trim();

  let match = text.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})\b/i
  );

  if (match) {
    const month = MONTHS[match[1].toLowerCase()];
    const day = Number(match[2]);
    const year = Number(match[3]);

    return new Date(
      Date.UTC(year, month, day)
    ).toISOString();
  }

  match = text.match(
    /\b(\d{1,2})\s+(janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)\s+(\d{4})\b/i
  );

  if (match) {
    const day = Number(match[1]);
    const month = MONTHS[match[2].toLowerCase()];
    const year = Number(match[3]);

    return new Date(
      Date.UTC(year, month, day)
    ).toISOString();
  }

  return null;
}

function findDateInObject(object, keys) {
  if (!object || typeof object !== "object") {
    return null;
  }

  for (const key of keys) {
    if (
      Object.prototype.hasOwnProperty.call(object, key)
    ) {
      const value = object[key];

      const normalized = normalizeDate(value);

      if (normalized) {
        return normalized;
      }

      const human = parseHumanDate(
        typeof value === "string"
          ? value
          : ""
      );

      if (human) {
        return human;
      }
    }
  }

  return null;
}

function recursivelyFindDate(
  object,
  keys,
  depth = 0
) {
  if (!object || depth > 12) {
    return null;
  }

  if (Array.isArray(object)) {
    for (const item of object) {
      const found = recursivelyFindDate(
        item,
        keys,
        depth + 1
      );

      if (found) {
        return found;
      }
    }

    return null;
  }

  if (typeof object !== "object") {
    return null;
  }

  const direct = findDateInObject(
    object,
    keys
  );

  if (direct) {
    return direct;
  }

  for (const value of Object.values(object)) {
    if (
      value &&
      typeof value === "object"
    ) {
      const found = recursivelyFindDate(
        value,
        keys,
        depth + 1
      );

      if (found) {
        return found;
      }
    }
  }

  return null;
}

function recursivelyFindString(
  object,
  keys,
  depth = 0
) {
  if (!object || depth > 12) {
    return null;
  }

  if (Array.isArray(object)) {
    for (const item of object) {
      const found = recursivelyFindString(
        item,
        keys,
        depth + 1
      );

      if (found) {
        return found;
      }
    }

    return null;
  }

  if (typeof object !== "object") {
    return null;
  }

  for (const key of keys) {
    if (
      Object.prototype.hasOwnProperty.call(
        object,
        key
      )
    ) {
      const value = object[key];

      if (
        typeof value === "string" &&
        value.trim()
      ) {
        return value.trim();
      }
    }
  }

  for (const value of Object.values(object)) {
    if (
      value &&
      typeof value === "object"
    ) {
      const found = recursivelyFindString(
        value,
        keys,
        depth + 1
      );

      if (found) {
        return found;
      }
    }
  }

  return null;
}

function normalizeArticle(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const url = normalizeUrl(
    recursivelyFindString(raw, [
      "url",
      "canonicalUrl",
      "canonical_url",
      "href",
      "link",
      "permalink"
    ])
  );

  if (!isNewswireArticleUrl(url)) {
    return null;
  }

  const title = cleanTitle(
    recursivelyFindString(raw, [
      "title",
      "name",
      "headline"
    ])
  );

  const date = recursivelyFindDate(raw, [
    "datePublished",
    "date_published",
    "publishedAt",
    "published_at",
    "publicationDate",
    "publication_date",
    "publishDate",
    "publish_date",
    "published",
    "createdAt",
    "created_at",
    "publishedDate",
    "published_date"
  ]);

  const updatedAt = recursivelyFindDate(raw, [
    "dateModified",
    "date_modified",
    "updatedAt",
    "updated_at",
    "modifiedAt",
    "modified_at",
    "modifiedDate",
    "modified_date",
    "lastUpdated",
    "last_updated",
    "updated"
  ]);

  return {
    title: title || null,
    url,
    date: date || null,
    updatedAt: updatedAt || null,
    lastModified: null
  };
}

function extractMetaValue(html, names) {
  for (const name of names) {
    const escaped = name.replace(
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
      const match = html.match(pattern);

      if (match && match[1]) {
        return decodeHtml(match[1]);
      }
    }
  }

  return null;
}

function extractJsonLdDates(html) {
  const result = {
    published: null,
    modified: null
  };

  const matches = html.match(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  );

  if (!matches) {
    return result;
  }

  for (const block of matches) {
    const content = block
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
      const json = JSON.parse(content);

      if (!result.published) {
        result.published =
          recursivelyFindDate(json, [
            "datePublished",
            "date_published"
          ]);
      }

      if (!result.modified) {
        result.modified =
          recursivelyFindDate(json, [
            "dateModified",
            "date_modified"
          ]);
      }
    } catch {
      const publishedMatch =
        content.match(
          /"datePublished"\s*:\s*"([^"]+)"/i
        );

      const modifiedMatch =
        content.match(
          /"dateModified"\s*:\s*"([^"]+)"/i
        );

      if (
        !result.published &&
        publishedMatch
      ) {
        result.published =
          normalizeDate(
            publishedMatch[1]
          ) ||
          parseHumanDate(
            publishedMatch[1]
          );
      }

      if (
        !result.modified &&
        modifiedMatch
      ) {
        result.modified =
          normalizeDate(
            modifiedMatch[1]
          ) ||
          parseHumanDate(
            modifiedMatch[1]
          );
      }
    }
  }

  return result;
}

function extractVisibleDate(html) {
  const patterns = [
    /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\b/i,
    /\b\d{1,2}\s+(?:janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)\s+\d{4}\b/i
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);

    if (match) {
      const parsed = parseHumanDate(
        match[0]
      );

      if (parsed) {
        return parsed;
      }
    }
  }

  return null;
}

async function fetchNewswirePageMetadata(url) {
  try {
    const response = await fetch(url, {
      headers: {
        "user-agent":
          "Mozilla/5.0 RSGOracle Newswire",
        accept:
          "text/html,application/xhtml+xml"
      }
    });

    if (!response.ok) {
      return {};
    }

    const html = await response.text();

    const jsonLd = extractJsonLdDates(html);

    const publishedMeta =
      extractMetaValue(html, [
        "article:published_time",
        "datePublished",
        "publication_date",
        "published_time"
      ]);

    const modifiedMeta =
      extractMetaValue(html, [
        "article:modified_time",
        "dateModified",
        "modified_time",
        "last-modified"
      ]);

    const title =
      extractMetaValue(html, [
        "og:title",
        "twitter:title",
        "title"
      ]);

    const published =
      jsonLd.published ||
      normalizeDate(publishedMeta) ||
      parseHumanDate(publishedMeta) ||
      extractVisibleDate(html);

    const modified =
      jsonLd.modified ||
      normalizeDate(modifiedMeta) ||
      parseHumanDate(modifiedMeta);

    return {
      title: cleanTitle(title),
      published: published || null,
      modified: modified || null
    };
  } catch (error) {
    console.log(
      `[NEWSWIRE] Metadata fetch failed for ${url}: ${error.message}`
    );

    return {};
  }
}

async function fetchNewswireLastModified(url) {
  try {
    const response = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      headers: {
        "user-agent":
          "Mozilla/5.0 RSGOracle Newswire"
      }
    });

    if (!response.ok) {
      return null;
    }

    return (
      response.headers.get(
        "last-modified"
      ) || null
    );
  } catch {
    return null;
  }
}

async function graphqlRequest(
  operationName,
  variables
) {
  const query =
    operationName === NEWSWIRE_LIST_HASH
      ? `
        query NewswireList($limit: Int!) {
          newswire {
            posts(limit: $limit) {
              id
              title
              url
              slug
              datePublished
              publishedAt
              createdAt
            }
          }
        }
      `
      : `
        query NewswirePost($id: ID, $url: String) {
          newswirePost(id: $id, url: $url) {
            id
            title
            url
            slug
            datePublished
            publishedAt
            createdAt
            dateModified
            updatedAt
            modifiedAt
          }
        }
      `;

  console.log(
    `[NEWSWIRE] GraphQL request: ${operationName}`
  );

  const response = await fetch(
    GRAPHQL_URL,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "user-agent":
          "Mozilla/5.0 RSGOracle Newswire"
      },
      body: JSON.stringify({
        operationName,
        variables,
        query
      })
    }
  );

  if (!response.ok) {
    throw new Error(
      `GraphQL HTTP ${response.status}`
    );
  }

  const json = await response.json();

  if (json.errors) {
    throw new Error(
      json.errors
        .map((error) => error.message)
        .join("; ")
    );
  }

  return json.data;
}

function extractPosts(data) {
  if (!data) {
    return [];
  }

  const candidates = [
    data?.newswire?.posts,
    data?.newswire?.articles,
    data?.newswireList?.posts,
    data?.newswireList?.articles,
    data?.posts,
    data?.articles
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  return [];
}

function extractPostData(data) {
  if (!data) {
    return null;
  }

  const candidates = [
    data?.newswirePost,
    data?.newswire?.post,
    data?.post,
    data?.article,
    data?.newswireArticle
  ];

  for (const candidate of candidates) {
    if (
      candidate &&
      typeof candidate === "object"
    ) {
      return candidate;
    }
  }

  return null;
}

async function fetchNewswire(latestArticles) {
  console.log(
    "[NEWSWIRE] Checking Rockstar Newswire..."
  );

  const requested =
    Math.max(
      1,
      Number(latestArticles) || 5
    );

  const data = await graphqlRequest(
    NEWSWIRE_LIST_HASH,
    {
      limit: requested + 1
    }
  );

  const posts = extractPosts(data);

  console.log(
    `[NEWSWIRE] NewswireList returned ${posts.length} posts.`
  );

  const normalized = posts
    .map(normalizeArticle)
    .filter(Boolean);

  if (normalized.length > 0) {
    const first = normalized[0];

    console.log(
      `[NEWSWIRE] Ignoring first Newswire result as featured/pinned: ${first.title || first.url}`
    );
  }

  const latestPosts = normalized.slice(
    1,
    requested + 1
  );

  const articles = [];

  for (const post of latestPosts) {
    try {
      const postData =
        await graphqlRequest(
          NEWSWIRE_POST_HASH,
          {
            id: post.id || null,
            url: post.url
          }
        );

      const detailed =
        extractPostData(postData);

      const merged = normalizeArticle({
        ...post,
        ...(detailed || {})
      });

      if (merged) {
        if (!merged.title) {
          merged.title = post.title;
        }

        if (!merged.date) {
          merged.date = post.date;
        }

        if (!merged.updatedAt) {
          merged.updatedAt =
            post.updatedAt;
        }

        articles.push(merged);
      } else {
        articles.push(post);
      }
    } catch (error) {
      console.log(
        `[NEWSWIRE] NewswirePost failed for ${post.url}: ${error.message}`
      );

      articles.push(post);
    }
  }

  console.log(
    `[NEWSWIRE] GraphQL articles detected: ${articles.length}`
  );

  const enriched = [];

  for (const article of articles) {
    const [
      lastModified,
      pageMetadata
    ] = await Promise.all([
      fetchNewswireLastModified(
        article.url
      ),
      fetchNewswirePageMetadata(
        article.url
      )
    ]);

    if (
      !article.title &&
      pageMetadata.title
    ) {
      article.title =
        pageMetadata.title;
    }

    if (
      !article.date &&
      pageMetadata.published
    ) {
      article.date =
        pageMetadata.published;
    }

    if (
      !article.updatedAt &&
      pageMetadata.modified
    ) {
      article.updatedAt =
        pageMetadata.modified;
    }

    /*
     * IMPORTANT:
     *
     * lastModified is ONLY the raw HTTP
     * Last-Modified header.
     *
     * If Rockstar returns:
     * Thu, 31 Aug 2045 02:39:53 GMT
     *
     * we keep exactly that value.
     *
     * It is NOT used as publication date.
     */
    article.lastModified =
      lastModified || null;

    enriched.push(article);

    console.log(
      `[NEWSWIRE] ${article.title || article.url}`
    );
    console.log(
      `[NEWSWIRE] Published: ${article.date || "unknown"}`
    );
    console.log(
      `[NEWSWIRE] Last-Modified header: ${article.lastModified || "unknown"}`
    );
    console.log(
      `[NEWSWIRE] Updated: ${article.updatedAt || "unknown"}`
    );
  }

  return enriched;
}

function normalizeState(state) {
  if (!state || typeof state !== "object") {
    return {
      articles: [],
      known_urls: []
    };
  }

  return {
    articles: Array.isArray(state.articles)
      ? state.articles
      : [],
    known_urls: Array.isArray(
      state.known_urls
    )
      ? state.known_urls
      : []
  };
}

function uniqueArticles(articles) {
  const map = new Map();

  for (const article of articles) {
    if (!article || !article.url) {
      continue;
    }

    map.set(article.url, article);
  }

  return Array.from(map.values());
}

function sortArticles(articles) {
  return [...articles].sort(
    (a, b) => {
      const da = a.date
        ? new Date(a.date).getTime()
        : 0;

      const db = b.date
        ? new Date(b.date).getTime()
        : 0;

      return db - da;
    }
  );
}

function findNewArticles(
  currentArticles,
  previousState
) {
  const known = new Set(
    previousState.known_urls || []
  );

  for (const article of previousState.articles || []) {
    if (article?.url) {
      known.add(article.url);
    }
  }

  return currentArticles.filter(
    (article) =>
      article &&
      article.url &&
      !known.has(article.url)
  );
}

function mergeArticleIntoState(
  state,
  article
) {
  const existingIndex =
    state.articles.findIndex(
      (item) =>
        item?.url === article.url
    );

  if (existingIndex === -1) {
    state.articles.push(article);
    return;
  }

  const existing =
    state.articles[existingIndex];

  state.articles[existingIndex] = {
    ...existing,
    ...article,

    /*
     * Never erase recovered values with null.
     */
    date:
      article.date ||
      existing.date ||
      null,

    last_modified:
      article.last_modified ||
      existing.last_modified ||
      null,

    updated_at:
      article.updated_at ||
      existing.updated_at ||
      null
  };
}

function repairExistingArticle(
  state,
  article
) {
  const index =
    state.articles.findIndex(
      (item) =>
        item?.url === article.url
    );

  if (index === -1) {
    return false;
  }

  const existing =
    state.articles[index];

  let changed = false;

  if (
    article.date &&
    existing.date !== article.date
  ) {
    existing.date = article.date;
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

  if (
    article.title &&
    existing.title !== article.title
  ) {
    existing.title = article.title;
    changed = true;
  }

  return changed;
}

function createNotification(
  article,
  detectedAt
) {
  return {
    type: "newswire_new_post",
    title: article.title || "Newswire",
    url: article.url,
    date: article.date || null,
    last_modified:
      article.lastModified || null,
    updated_at:
      article.updatedAt || null,
    detected_at: detectedAt
  };
}

function loadNotifications() {
  const data =
    readJson(NOTIFICATIONS_FILE);

  return Array.isArray(data)
    ? data
    : [];
}

function saveNotifications(
  notifications
) {
  writeJson(
    NOTIFICATIONS_FILE,
    notifications
  );
}

async function main() {
  try {
    const config =
      readJson(CONFIG_FILE) || {};

    const latestArticles =
      Number.isInteger(
        config?.newswire?.latest_articles
      ) &&
      config.newswire.latest_articles > 0
        ? config.newswire.latest_articles
        : 5;

    const previousState =
      normalizeState(
        readJson(STATE_FILE)
      );

    const articles =
      await fetchNewswire(
        latestArticles
      );

    console.log(
      `[NEWSWIRE] Articles detected: ${articles.length}`
    );

    if (!articles.length) {
      console.log(
        "[NEWSWIRE] No Newswire articles detected."
      );
      return;
    }

    const normalizedCurrent =
      uniqueArticles(articles);

    const newArticles =
      findNewArticles(
        normalizedCurrent,
        previousState
      );

    const nextState = {
      articles: [
        ...(previousState.articles || [])
      ],
      known_urls: [
        ...(previousState.known_urls || [])
      ]
    };

    let stateChanged = false;

    /*
     * Always repair/enrich existing articles.
     * This is important when an old state contains:
     *
     * date: null
     * updated_at: null
     *
     * but the current Rockstar page now exposes
     * those values.
     */
    for (const article of normalizedCurrent) {
      const existingChanged =
        repairExistingArticle(
          nextState,
          article
        );

      if (existingChanged) {
        stateChanged = true;
      }
    }

    if (newArticles.length > 0) {
      const detectedAt =
        new Date().toISOString();

      const notifications =
        loadNotifications();

      for (const article of newArticles) {
        const storedArticle = {
          title:
            article.title || "Newswire",
          url: article.url,
          date: article.date || null,
          last_modified:
            article.lastModified || null,
          updated_at:
            article.updatedAt || null
        };

        mergeArticleIntoState(
          nextState,
          storedArticle
        );

        if (
          !nextState.known_urls.includes(
            article.url
          )
        ) {
          nextState.known_urls.push(
            article.url
          );
        }

        notifications.push(
          createNotification(
            article,
            detectedAt
          )
        );

        stateChanged = true;

        console.log(
          `[NEWSWIRE] New article detected: ${article.title || article.url}`
        );
      }

      saveNotifications(
        notifications
      );
    }

    /*
     * Keep only a reasonable history.
     */
    nextState.articles =
      sortArticles(
        uniqueArticles(
          nextState.articles
        )
      ).slice(0, 25);

    nextState.known_urls =
      Array.from(
        new Set(
          nextState.known_urls
        )
      ).slice(-25);

    if (stateChanged) {
      writeJson(
        STATE_FILE,
        nextState
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
