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
      const item of value
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
        value.date ||
        value.datePublished ||
        value.publishedAt ||
        value.published_at ||
        value.createdAt ||
        value.created_at
      );

    const updatedAt =
      normalizeDate(
        value.updatedAt ||
        value.updated_at ||
        value.dateModified ||
        value.modifiedAt ||
        value.modified_at
      );

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
          null
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

async function enrichArticleMetadata(
  page,
  article
) {
  if (
    !article ||
    !article.url
  ) {
    return article;
  }

  try {
    const metadata =
      await page.evaluate(
        async url => {
          function clean(value) {
            if (!value) {
              return null;
            }

            const text =
              String(value)
                .replace(
                  /\s+/g,
                  " "
                )
                .trim();

            return text || null;
          }

          function parseJsonLd(
            value,
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
                parseJsonLd(
                  item,
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

            if (
              !result.date &&
              value.datePublished
            ) {
              result.date =
                value.datePublished;
            }

            if (
              !result.updatedAt &&
              value.dateModified
            ) {
              result.updatedAt =
                value.dateModified;
            }

            if (
              !result.date &&
              value.dateCreated
            ) {
              result.date =
                value.dateCreated;
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
                parseJsonLd(
                  child,
                  result
                );
              }
            }
          }

          try {
            const response =
              await fetch(
                url,
                {
                  credentials:
                    "include"
                }
              );

            const lastModified =
              response.headers.get(
                "last-modified"
              );

            const html =
              await response.text();

            const parser =
              new DOMParser();

            const document =
              parser.parseFromString(
                html,
                "text/html"
              );

            const result = {
              date: null,
              updatedAt: null,
              lastModified:
                clean(
                  lastModified
                )
            };

            const publishedSelectors = [
              'meta[property="article:published_time"]',
              'meta[name="article:published_time"]',
              'meta[property="datePublished"]',
              'meta[name="datePublished"]',
              'meta[itemprop="datePublished"]',
              'meta[name="publish-date"]',
              'meta[name="publication-date"]',
              'meta[name="date"]'
            ];

            const updatedSelectors = [
              'meta[property="article:modified_time"]',
              'meta[name="article:modified_time"]',
              'meta[property="dateModified"]',
              'meta[name="dateModified"]',
              'meta[itemprop="dateModified"]',
              'meta[name="modified"]',
              'meta[name="lastmod"]'
            ];

            for (
              const selector of
                publishedSelectors
            ) {
              const element =
                document.querySelector(
                  selector
                );

              if (!element) {
                continue;
              }

              const value =
                element.getAttribute(
                  "content"
                ) ||
                element.getAttribute(
                  "datetime"
                ) ||
                element.textContent;

              if (value) {
                result.date =
                  value.trim();

                break;
              }
            }

            for (
              const selector of
                updatedSelectors
            ) {
              const element =
                document.querySelector(
                  selector
                );

              if (!element) {
                continue;
              }

              const value =
                element.getAttribute(
                  "content"
                ) ||
                element.getAttribute(
                  "datetime"
                ) ||
                element.textContent;

              if (value) {
                result.updatedAt =
                  value.trim();

                break;
              }
            }

            const jsonScripts =
              Array.from(
                document.querySelectorAll(
                  'script[type="application/ld+json"]'
                )
              );

            for (
              const script of
                jsonScripts
            ) {
              const text =
                script.textContent;

              if (!text) {
                continue;
              }

              try {
                const parsed =
                  JSON.parse(text);

                parseJsonLd(
                  parsed,
                  result
                );
              } catch {
                // Ignore invalid JSON-LD.
              }
            }

            if (
              !result.date
            ) {
              const time =
                document.querySelector(
                  'time[datetime]'
                );

              if (time) {
                result.date =
                  time.getAttribute(
                    "datetime"
                  );
              }
            }

            return result;
          } catch {
            return {
              date: null,
              updatedAt: null,
              lastModified:
                null
            };
          }
        },
        article.url
      );

    if (
      metadata &&
      metadata.date
    ) {
      article.date =
        normalizeDate(
          metadata.date
        ) ||
        article.date ||
        null;
    }

    if (
      metadata &&
      metadata.updatedAt
    ) {
      article.updatedAt =
        normalizeDate(
          metadata.updatedAt
        ) ||
        article.updatedAt ||
        null;
    }

    if (
      metadata &&
      metadata.lastModified
    ) {
      article.lastModified =
        metadata.lastModified;
    }
  } catch (error) {
    console.log(
      `[NEWSWIRE] Metadata lookup failed for ${article.url}: ${error.message}`
    );
  }

  return article;
}

async function enrichArticles(
  page,
  articles
) {
  if (
    !articles.length
  ) {
    return articles;
  }

  console.log(
    `[NEWSWIRE] Enriching metadata for ${articles.length} articles...`
  );

  for (
    const article of
      articles
  ) {
    await enrichArticleMetadata(
      page,
      article
    );

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

    page.on(
      "response",
      async response => {
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

          graphqlUrls.add(url);

          const contentType =
            response
              .headers()[
              "content-type"
            ] || "";

          if (
            !contentType.includes(
              "json"
            )
          ) {
            return;
          }

          const text =
            await response.text();

          if (!text) {
            return;
          }

          try {
            graphqlPayloads.push(
              JSON.parse(text)
            );
          } catch {
            // Ignore non-JSON GraphQL responses.
          }
        } catch {
          // Ignore destroyed/aborted responses.
        }
      }
    );

    await page.goto(
      NEWSWIRE_URL,
      {
        waitUntil:
          "domcontentloaded",
        timeout: 60000
      }
    );

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

    if (
      graphqlArticles.length
    ) {
      console.log(
        `[NEWSWIRE] Articles recovered from GraphQL: ${graphqlArticles.length}`
      );
    }

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
                    container
                      ?.textContent ||
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
      page,
      candidates
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
