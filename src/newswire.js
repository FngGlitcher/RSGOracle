const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");

const NEWSWIRE_URL =
  "https://www.rockstargames.com/newswire";

const ROOT_DIR =
  path.resolve(__dirname, "..");

const CONFIG_FILE =
  path.join(
    ROOT_DIR,
    "config",
    "config.json"
  );

const STATE_FILE =
  path.join(
    ROOT_DIR,
    "data",
    "state",
    "newswire.json"
  );

const NOTIFICATIONS_FILE =
  path.join(
    ROOT_DIR,
    "data",
    "state",
    "notifications.json"
  );

const PENDING_NOTIFICATIONS_FILE =
  path.join(
    ROOT_DIR,
    "data",
    "state",
    "pending-notifications.json"
  );

function readJson(file) {
  try {
    if (!fs.existsSync(file)) {
      return null;
    }

    return JSON.parse(
      fs.readFileSync(
        file,
        "utf8"
      )
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
    JSON.stringify(
      data,
      null,
      2
    ) + "\n",
    "utf8"
  );
}

function normalizeUrl(value) {
  if (!value) {
    return null;
  }

  let url =
    String(value)
      .trim()
      .replace(
        /\\\//g,
        "/"
      );

  if (
    url.startsWith("/")
  ) {
    url =
      `https://www.rockstargames.com${url}`;
  }

  try {
    const parsed =
      new URL(url);

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
      /rockstargames\.com\/(?:[a-z]{2}\/)?newswire\/article\//i.test(
        url
      )
  );
}

function getArticleIdentity(url) {
  const normalized =
    normalizeUrl(url);

  if (!normalized) {
    return null;
  }

  const match =
    normalized.match(
      /\/newswire\/article\/([^/?#]+)/i
    );

  return match
    ? match[1].toLowerCase()
    : null;
}

function normalizeDate(value) {
  if (!value) {
    return null;
  }

  const date =
    new Date(
      String(value).trim()
    );

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return null;
  }

  return date.toISOString();
}

function cleanTitle(value) {
  if (!value) {
    return null;
  }

  const title =
    String(value)
      .replace(
        /&amp;/gi,
        "&"
      )
      .replace(
        /&quot;/gi,
        '"'
      )
      .replace(
        /&#39;/gi,
        "'"
      )
      .replace(
        /&apos;/gi,
        "'"
      )
      .replace(
        /&lt;/gi,
        "<"
      )
      .replace(
        /&gt;/gi,
        ">"
      )
      .replace(
        /\s+/g,
        " "
      )
      .trim();

  if (
    !title ||
    /^access denied$/i.test(title)
  ) {
    return null;
  }

  return title;
}

function extractArticleObjects(
  value,
  results,
  seen
) {
  if (!value) {
    return;
  }

  if (
    typeof value ===
    "string"
  ) {
    return;
  }

  if (
    Array.isArray(value)
  ) {
    for (
      const item of
        value
    ) {
      extractArticleObjects(
        item,
        results,
        seen
      );
    }

    return;
  }

  if (
    typeof value !==
    "object"
  ) {
    return;
  }

  const possibleUrls = [
    value.url,
    value.link,
    value.href,
    value.path,
    value.slug
  ];

  let url = null;

  for (
    const candidate of
      possibleUrls
  ) {
    const normalized =
      normalizeUrl(
        candidate
      );

    if (
      isArticleUrl(
        normalized
      )
    ) {
      url =
        normalized;

      break;
    }
  }

  if (url) {
    const title =
      cleanTitle(
        value.title ||
        value.name ||
        value.headline ||
        value.label
      );

    const date =
      normalizeDate(
        value.datePublished ||
        value.publishedAt ||
        value.published_at ||
        value.publicationDate ||
        value.publishDate ||
        value.date ||
        value.createdAt ||
        value.created_at
      );

    const updatedAt =
      normalizeDate(
        value.dateModified ||
        value.updatedAt ||
        value.updated_at ||
        value.modifiedAt ||
        value.modified_at ||
        value.updated
      );

    const lastModified =
      value.lastModified ||
      value.last_modified ||
      value.httpLastModified ||
      null;

    if (
      title &&
      !seen.has(url)
    ) {
      seen.add(url);

      results.push({
        title,
        url,
        date,
        updatedAt,
        lastModified:
          lastModified
            ? String(
                lastModified
              ).trim()
            : null
      });
    }
  }

  for (
    const [key, child] of
      Object.entries(value)
  ) {
    if (
      key ===
        "extensions" ||
      key ===
        "headers"
    ) {
      continue;
    }

    extractArticleObjects(
      child,
      results,
      seen
    );
  }
}

function extractMetadataFromPayload(
  value,
  targetIdentity,
  result
) {
  if (!value) {
    return;
  }

  if (
    Array.isArray(value)
  ) {
    for (
      const item of
        value
    ) {
      extractMetadataFromPayload(
        item,
        targetIdentity,
        result
      );
    }

    return;
  }

  if (
    typeof value !==
    "object"
  ) {
    return;
  }

  const possibleUrls = [
    value.url,
    value.link,
    value.href,
    value.path,
    value.slug
  ];

  let matchesArticle =
    false;

  for (
    const candidate of
      possibleUrls
  ) {
    const identity =
      getArticleIdentity(
        candidate
      );

    if (
      identity &&
      identity ===
        targetIdentity
    ) {
      matchesArticle =
        true;

      break;
    }
  }

  if (matchesArticle) {
    const published =
      normalizeDate(
        value.datePublished ||
        value.publishedAt ||
        value.published_at ||
        value.publicationDate ||
        value.publishDate ||
        value.date ||
        value.createdAt ||
        value.created_at ||
        value.created
      );

    const modified =
      normalizeDate(
        value.dateModified ||
        value.updatedAt ||
        value.updated_at ||
        value.modifiedAt ||
        value.modified_at ||
        value.updated
      );

    const lastModified =
      value.lastModified ||
      value.last_modified ||
      value.httpLastModified ||
      null;

    if (
      published
    ) {
      result.date =
        published;
    }

    if (
      modified
    ) {
      result.updatedAt =
        modified;
    }

    if (
      lastModified
    ) {
      result.lastModified =
        String(
          lastModified
        ).trim();
    }
  }

  for (
    const child of
      Object.values(value)
  ) {
    if (
      child &&
      typeof child ===
        "object"
    ) {
      extractMetadataFromPayload(
        child,
        targetIdentity,
        result
      );
    }
  }
}

async function enrichArticleMetadata(
  article,
  graphqlPayloads,
  graphqlLastModified
) {
  if (
    !article ||
    !article.url
  ) {
    return article;
  }

  const targetIdentity =
    getArticleIdentity(
      article.url
    );

  if (!targetIdentity) {
    return article;
  }

  const metadata = {
    date:
      article.date ||
      null,

    updatedAt:
      article.updatedAt ||
      null,

    lastModified:
      article.lastModified ||
      null
  };

  for (
    const payload of
      graphqlPayloads
  ) {
    extractMetadataFromPayload(
      payload,
      targetIdentity,
      metadata
    );
  }

  if (
    !metadata.lastModified &&
    graphqlLastModified
  ) {
    metadata.lastModified =
      graphqlLastModified;
  }

  article.date =
    metadata.date ||
    article.date ||
    null;

  article.updatedAt =
    metadata.updatedAt ||
    article.updatedAt ||
    null;

  article.lastModified =
    metadata.lastModified ||
    article.lastModified ||
    null;

  console.log(
    `[NEWSWIRE] Metadata: ${article.title}`
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

  return article;
}

async function enrichArticles(
  articles,
  graphqlPayloads,
  graphqlLastModified
) {
  if (
    !articles.length
  ) {
    return articles;
  }

  console.log(
    `[NEWSWIRE] Enriching metadata for ${articles.length} articles from captured GraphQL...`
  );

  for (
    const article of
      articles
  ) {
    await enrichArticleMetadata(
      article,
      graphqlPayloads,
      graphqlLastModified
    );
  }

  return articles;
}

async function launchBrowser() {
  return puppeteer.launch({
    headless: true,

    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu"
    ]
  });
}

async function fetchNewswire(
  latestArticles
) {
  console.log(
    "[NEWSWIRE] Checking Rockstar Newswire..."
  );

  const browser =
    await launchBrowser();

  try {
    const page =
      await browser.newPage();

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151.0.0.0 Safari/537.36"
    );

    await page.setViewport({
      width: 1440,
      height: 900
    });

    await page.setExtraHTTPHeaders({
      "accept-language":
        "en-US,en;q=0.9"
    });

    const graphqlPayloads =
      [];

    const graphqlUrls =
      new Set();

    let graphqlLastModified =
      null;

    const pendingGraphqlReads =
      new Set();

    const responseHandler =
      response => {
        const promise =
          (async () => {
            try {
              const url =
                response.url();

              if (
                !/graph\.rockstargames\.com/i.test(
                  url
                )
              ) {
                return;
              }

              graphqlUrls.add(
                url
              );

              const headers =
                response.headers();

              if (
                !graphqlLastModified &&
                headers[
                  "last-modified"
                ]
              ) {
                graphqlLastModified =
                  String(
                    headers[
                      "last-modified"
                    ]
                  ).trim();
              }

              const contentType =
                String(
                  headers[
                    "content-type"
                  ] || ""
                ).toLowerCase();

              if (
                !contentType.includes(
                  "json"
                )
              ) {
                return;
              }

              let text = "";

              try {
                text =
                  await response.text();
              } catch {
                return;
              }

              if (!text) {
                return;
              }

              try {
                const payload =
                  JSON.parse(
                    text
                  );

                graphqlPayloads.push(
                  payload
                );
              } catch {
                // Ignore invalid GraphQL JSON.
              }
            } catch {
              // Ignore destroyed/aborted responses.
            }
          })();

        pendingGraphqlReads.add(
          promise
        );

        promise.finally(
          () => {
            pendingGraphqlReads.delete(
              promise
            );
          }
        );
      };

    page.on(
      "response",
      responseHandler
    );

    try {
      await page.goto(
        NEWSWIRE_URL,
        {
          waitUntil:
            "domcontentloaded",
          timeout: 60000
        }
      );
    } catch (error) {
      console.log(
        `[NEWSWIRE] Navigation warning: ${error.message}`
      );
    }

    try {
      await page.waitForNetworkIdle({
        idleTime: 1500,
        timeout: 30000
      });
    } catch {
      console.log(
        "[NEWSWIRE] Network did not become fully idle, continuing."
      );
    }

    await new Promise(
      resolve =>
        setTimeout(
          resolve,
          3000
        )
    );

    if (
      pendingGraphqlReads.size
    ) {
      await Promise.allSettled(
        Array.from(
          pendingGraphqlReads
        )
      );
    }

    page.off(
      "response",
      responseHandler
    );

    console.log(
      `[NEWSWIRE] GraphQL responses detected: ${graphqlPayloads.length}`
    );

    console.log(
      `[NEWSWIRE] GraphQL endpoints detected: ${graphqlUrls.size}`
    );

    const graphqlArticles =
      [];

    const graphqlSeen =
      new Set();

    for (
      const payload of
        graphqlPayloads
    ) {
      extractArticleObjects(
        payload,
        graphqlArticles,
        graphqlSeen
      );
    }

    console.log(
      `[NEWSWIRE] Articles recovered from GraphQL: ${graphqlArticles.length}`
    );

    let articles =
      graphqlArticles;

    if (
      !articles.length
    ) {
      const domArticles =
        await page.evaluate(
          () => {
            const anchors =
              Array.from(
                document.querySelectorAll(
                  "a[href]"
                )
              );

            const output =
              [];

            const seen =
              new Set();

            for (
              const anchor of
                anchors
            ) {
              const href =
                anchor.href ||
                "";

              if (
                !/rockstargames\.com\/(?:[a-z]{2}\/)?newswire\/article\//i.test(
                  href
                )
              ) {
                continue;
              }

              try {
                const parsed =
                  new URL(
                    href
                  );

                parsed.hash =
                  "";

                parsed.search =
                  "";

                const url =
                  parsed.toString();

                if (
                  seen.has(url)
                ) {
                  continue;
                }

                seen.add(url);

                let container =
                  anchor;

                for (
                  let i = 0;
                  i < 6 &&
                  container;
                  i++
                ) {
                  const text =
                    (
                      container.textContent ||
                      ""
                    )
                      .replace(
                        /\s+/g,
                        " "
                      )
                      .trim();

                  if (
                    text.length >
                      20 &&
                    text.length <
                      1000
                  ) {
                    break;
                  }

                  container =
                    container.parentElement;
                }

                const text =
                  (
                    container?.textContent ||
                    anchor.textContent ||
                    ""
                  )
                    .replace(
                      /\s+/g,
                      " "
                    )
                    .trim();

                const title =
                  (
                    anchor.textContent ||
                    anchor.getAttribute(
                      "aria-label"
                    ) ||
                    ""
                  )
                    .replace(
                      /\s+/g,
                      " "
                    )
                    .trim();

                const dateMatch =
                  text.match(
                    /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+20\d{2}\b/i
                  );

                output.push({
                  url,
                  title:
                    title || null,
                  text,
                  dateText:
                    dateMatch
                      ? dateMatch[0]
                      : null
                });
              } catch {
                // Ignore invalid links.
              }
            }

            return output;
          }
        );

      articles =
        domArticles
          .map(
            article => ({
              title:
                cleanTitle(
                  article.title
                ),

              url:
                normalizeUrl(
                  article.url
                ),

              date:
                normalizeDate(
                  article.dateText
                ),

              updatedAt:
                null,

              lastModified:
                null
            })
          )
          .filter(
            article =>
              article.title &&
              isArticleUrl(
                article.url
              )
          );
    }

    const unique =
      [];

    const seen =
      new Set();

    for (
      const article of
        articles
    ) {
      if (
        !article ||
        !article.url ||
        !isArticleUrl(
          article.url
        ) ||
        seen.has(
          article.url
        )
      ) {
        continue;
      }

      if (
        !article.title ||
        /^access denied$/i.test(
          article.title
        )
      ) {
        continue;
      }

      seen.add(
        article.url
      );

      unique.push(
        article
      );
    }

    console.log(
      `[NEWSWIRE] Article links detected: ${unique.length}`
    );

    if (
      !unique.length
    ) {
      throw new Error(
        "No valid Newswire articles found."
      );
    }

    const candidates =
      unique.slice(
        1,
        latestArticles + 1
      );

    console.log(
      `[NEWSWIRE] Ignoring first featured result, checking ${candidates.length} latest articles.`
    );

    await enrichArticles(
      candidates,
      graphqlPayloads,
      graphqlLastModified
    );

    return candidates;
  } finally {
    await browser.close();
  }
}

function normalizeState(
  state
) {
  if (
    !state ||
    typeof state !==
      "object"
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

function loadNotifications(
  file
) {
  const data =
    readJson(file);

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
      article =>
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

  let changed =
    false;

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

function migrateOldState(
  rawState
) {
  if (
    rawState &&
    typeof rawState ===
      "object" &&
    Array.isArray(
      rawState.articles
    )
  ) {
    return normalizeState(
      rawState
    );
  }

  return {
    articles: [],
    known_urls: []
  };
}

function appendPendingNotifications(
  notifications
) {
  if (
    !notifications.length
  ) {
    return;
  }

  const pending =
    loadNotifications(
      PENDING_NOTIFICATIONS_FILE
    );

  const existingKeys =
    new Set(
      pending
        .filter(Boolean)
        .map(
          event =>
            `${event.type || ""}|${event.url || ""}|${event.detected_at || ""}`
        )
    );

  for (
    const notification of
      notifications
  ) {
    const key =
      `${notification.type || ""}|${notification.url || ""}|${notification.detected_at || ""}`;

    if (
      existingKeys.has(key)
    ) {
      continue;
    }

    pending.push(
      notification
    );

    existingKeys.add(
      key
    );
  }

  writeJson(
    PENDING_NOTIFICATIONS_FILE,
    pending
  );

  console.log(
    `[NEWSWIRE] Pending notifications updated: ${pending.length}`
  );
}

async function main() {
  try {
    const config =
      readJson(
        CONFIG_FILE
      ) || {};

    const configuredLimit =
      Number(
        config?.newswire
          ?.latest_articles
      );

    const latestArticles =
      Number.isInteger(
        configuredLimit
      ) &&
      configuredLimit > 0
        ? configuredLimit
        : 5;

    const rawState =
      readJson(
        STATE_FILE
      );

    const previousState =
      migrateOldState(
        rawState
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
      if (
        article &&
        article.url
      ) {
        knownUrls.add(
          article.url
        );
      }
    }

    const newArticles =
      currentArticles.filter(
        article =>
          article &&
          article.url &&
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
        [];

      const detectedAt =
        new Date().toISOString();

      for (
        const article of
          newArticles
      ) {
        const notification = {
          type:
            "newswire_new_post",

          title:
            article.title,

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
        };

        notifications.push(
          notification
        );

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
          `[NEWSWIRE] New article detected: ${article.title}`
        );
      }

      const existingNotifications =
        loadNotifications(
          NOTIFICATIONS_FILE
        );

      writeJson(
        NOTIFICATIONS_FILE,
        [
          ...existingNotifications,
          ...notifications
        ]
      );

      appendPendingNotifications(
        notifications
      );

      stateChanged =
        true;
    }

    state.articles =
      state.articles
        .filter(
          article =>
            article &&
            article.url
        )
        .slice(
          -25
        );

    state.known_urls =
      Array.from(
        new Set(
          state.known_urls.filter(
            Boolean
          )
        )
      ).slice(
        -25
      );

    writeJson(
      STATE_FILE,
      state
    );

    if (
      stateChanged ||
      newArticles.length
    ) {
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
