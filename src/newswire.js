const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const NEWSWIRE_URL =
  'https://www.rockstargames.com/newswire';

const ROOT_DIR =
  path.resolve(__dirname, '..');

const CONFIG_FILE =
  path.join(
    ROOT_DIR,
    'config',
    'config.json'
  );

const STATE_FILE =
  path.join(
    ROOT_DIR,
    'data',
    'state',
    'newswire.json'
  );

const NOTIFICATIONS_FILE =
  path.join(
    ROOT_DIR,
    'data',
    'state',
    'notifications.json'
  );

const PENDING_NOTIFICATIONS_FILE =
  path.join(
    ROOT_DIR,
    'data',
    'state',
    'pending-notifications.json'
  );

function readJson(file) {
  try {
    if (!fs.existsSync(file)) {
      return null;
    }

    return JSON.parse(
      fs.readFileSync(
        file,
        'utf8'
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
    ) + '\n',
    'utf8'
  );
}

function normalizeUrl(value) {
  if (!value) {
    return null;
  }

  let url =
    String(value)
      .trim()
      .replace(/\\\//g, '/');

  if (url.startsWith('/')) {
    url =
      `https://www.rockstargames.com${url}`;
  }

  try {
    const parsed =
      new URL(url);

    if (
      parsed.hostname !==
        'www.rockstargames.com' &&
      parsed.hostname !==
        'rockstargames.com'
    ) {
      return null;
    }

    parsed.hash = '';
    parsed.search = '';

    return parsed.toString();
  } catch {
    return null;
  }
}

function isNewswireArticleUrl(url) {
  return Boolean(
    url &&
      /rockstargames\.com\/(?:[a-z]{2}\/)?newswire\/article\//i.test(
        url
      )
  );
}

function cleanText(value) {
  if (!value) {
    return null;
  }

  const text =
    String(value)
      .replace(/\s+/g, ' ')
      .trim();

  return text || null;
}

function parseNewswireDate(value) {
  if (!value) {
    return null;
  }

  const text =
    String(value).trim();

  /*
   * Rockstar currently exposes values such as:
   *
   * 9/3/26, 10:00 AM
   *
   * IMPORTANT:
   *
   * We deliberately preserve the time as
   * supplied by the Newswire DOM.
   *
   * The Newswire publication time must not
   * be converted through the machine timezone.
   */

  const match =
    text.match(
      /^(\d{1,2})\/(\d{1,2})\/(\d{2,4}),\s*(\d{1,2}):(\d{2})\s*(AM|PM)$/i
    );

  if (match) {
    let month =
      Number(match[1]);

    let day =
      Number(match[2]);

    let year =
      Number(match[3]);

    let hour =
      Number(match[4]);

    const minute =
      Number(match[5]);

    const period =
      match[6].toUpperCase();

    if (
      year < 100
    ) {
      year +=
        year < 70
          ? 2000
          : 1900;
    }

    if (
      month < 1 ||
      month > 12 ||
      day < 1 ||
      day > 31 ||
      hour < 1 ||
      hour > 12 ||
      minute < 0 ||
      minute > 59
    ) {
      return null;
    }

    if (
      period === 'PM' &&
      hour !== 12
    ) {
      hour += 12;
    }

    if (
      period === 'AM' &&
      hour === 12
    ) {
      hour = 0;
    }

    return {
      raw: text,
      year,
      month,
      day,
      hour,
      minute,
      hour12:
        Number(match[4]),
      period
    };
  }

  return {
    raw: text
  };
}

function formatNewswireDate(value) {
  if (!value) {
    return null;
  }

  if (
    typeof value === 'object' &&
    value.raw
  ) {
    return value.raw;
  }

  return String(value);
}

function extractTitleFromCard(link) {
  const candidates = [];

  const ariaLabel =
    cleanText(
      link.getAttribute(
        'aria-label'
      )
    );

  if (ariaLabel) {
    candidates.push(
      ariaLabel
    );
  }

  const titleAttribute =
    cleanText(
      link.getAttribute(
        'title'
      )
    );

  if (titleAttribute) {
    candidates.push(
      titleAttribute
    );
  }

  /*
   * Prefer an actual heading inside the
   * article card.
   */
  const heading =
    link.querySelector(
      'h1, h2, h3, h4, h5, h6'
    );

  if (heading) {
    const headingText =
      cleanText(
        heading.textContent
      );

    if (headingText) {
      candidates.push(
        headingText
      );
    }
  }

  /*
   * Some Newswire cards put the title
   * in an element with a title-like
   * accessibility/class attribute.
   */
  const titleNode =
    link.querySelector(
      '[data-testid*="title" i], [class*="title" i]'
    );

  if (titleNode) {
    const titleText =
      cleanText(
        titleNode.textContent
      );

    if (titleText) {
      candidates.push(
        titleText
      );
    }
  }

  /*
   * Last fallback: inspect the anchor's
   * direct text while removing obvious
   * metadata such as game/platform names
   * and dates.
   */
  const directText =
    cleanText(
      link.textContent
    );

  if (directText) {
    candidates.push(
      directText
    );
  }

  for (
    const candidate of candidates
  ) {
    if (!candidate) {
      continue;
    }

    /*
     * Reject values that are clearly the
     * complete article card instead of the
     * article title.
     */
    if (
      /^(?:GTA Online|Red Dead Online|Rockstar Games|GTA VI|GTA V)\s*/i.test(
        candidate
      ) &&
      /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/.test(
        candidate
      )
    ) {
      const cleaned =
        candidate
          .replace(
            /^(?:GTA Online|Red Dead Online|Rockstar Games|GTA VI|GTA V)\s*/i,
            ''
          )
          .replace(
            /^\d{1,2}\/\d{1,2}\/\d{2,4}\s*/,
            ''
          )
          .trim();

      if (cleaned) {
        return cleaned;
      }
    }

    /*
     * If the candidate contains the visible
     * publication date followed by the title,
     * remove the metadata prefix.
     */
    const withoutMetadata =
      candidate
        .replace(
          /^(?:GTA Online|Red Dead Online|Rockstar Games|GTA VI|GTA V)\s*/i,
          ''
        )
        .replace(
          /^\d{1,2}\/\d{1,2}\/\d{2,4}\s*/,
          ''
        )
        .trim();

    if (
      withoutMetadata &&
      withoutMetadata !== candidate
    ) {
      return withoutMetadata;
    }

    return candidate;
  }

  return null;
}

async function launchBrowser() {
  return puppeteer.launch({
    headless: true,

    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu'
    ]
  });
}

async function extractNewswireArticles(page) {
  return page.evaluate(() => {
    function clean(value) {
      if (!value) {
        return null;
      }

      const text =
        String(value)
          .replace(/\s+/g, ' ')
          .trim();

      return text || null;
    }

    function isArticleUrl(value) {
      return Boolean(
        value &&
          /rockstargames\.com\/(?:[a-z]{2}\/)?newswire\/article\//i.test(
            value
          )
      );
    }

    function extractTitle(link) {
      const candidates = [];

      const ariaLabel =
        clean(
          link.getAttribute(
            'aria-label'
          )
        );

      if (ariaLabel) {
        candidates.push(
          ariaLabel
        );
      }

      const titleAttribute =
        clean(
          link.getAttribute(
            'title'
          )
        );

      if (titleAttribute) {
        candidates.push(
          titleAttribute
        );
      }

      const heading =
        link.querySelector(
          'h1, h2, h3, h4, h5, h6'
        );

      if (heading) {
        const value =
          clean(
            heading.textContent
          );

        if (value) {
          candidates.push(
            value
          );
        }
      }

      const titleNode =
        link.querySelector(
          '[data-testid*="title" i], [class*="title" i]'
        );

      if (titleNode) {
        const value =
          clean(
            titleNode.textContent
          );

        if (value) {
          candidates.push(
            value
          );
        }
      }

      const anchorText =
        clean(
          link.textContent
        );

      if (anchorText) {
        candidates.push(
          anchorText
        );
      }

      for (
        const candidate of candidates
      ) {
        if (!candidate) {
          continue;
        }

        let result =
          candidate
            .replace(
              /^(?:GTA Online|Red Dead Online|Rockstar Games|GTA VI|GTA V)\s*/i,
              ''
            )
            .trim();

        result =
          result.replace(
            /^\d{1,2}\/\d{1,2}\/\d{2,4}\s*/,
            ''
          ).trim();

        /*
         * Remove a date appearing directly
         * before the title.
         */
        result =
          result.replace(
            /^\d{1,2}\/\d{1,2}\/\d{2,4},?\s*/,
            ''
          ).trim();

        if (result) {
          return result;
        }
      }

      return null;
    }

    const links =
      Array.from(
        document.querySelectorAll(
          'a[href]'
        )
      );

    const articles = [];
    const seen = new Set();

    for (
      const link of links
    ) {
      const rawHref =
        link.href || '';

      if (
        !isArticleUrl(
          rawHref
        )
      ) {
        continue;
      }

      let url;

      try {
        const parsed =
          new URL(
            rawHref
          );

        parsed.hash = '';
        parsed.search = '';

        url =
          parsed.toString();
      } catch {
        continue;
      }

      if (
        seen.has(url)
      ) {
        continue;
      }

      /*
       * Find the closest DOM container
       * containing the publication <time>.
       */
      let container =
        link;

      let time =
        null;

      for (
        let depth = 0;
        depth < 12 && container;
        depth += 1
      ) {
        time =
          container.querySelector(
            'time[datetime]'
          );

        if (time) {
          break;
        }

        container =
          container.parentElement;
      }

      if (!time) {
        continue;
      }

      const datetime =
        clean(
          time.getAttribute(
            'datetime'
          )
        );

      const visibleDate =
        clean(
          time.textContent
        );

      const title =
        extractTitle(
          link
        );

      if (!title) {
        continue;
      }

      seen.add(url);

      articles.push({
        url,
        title,
        datetime:
          datetime || '',
        visibleDate:
          visibleDate || ''
      });
    }

    return articles;
  });
}

async function openNewswire(page) {
  await page.goto(
    NEWSWIRE_URL,
    {
      waitUntil:
        'domcontentloaded',
      timeout: 60000
    }
  ).catch(error => {
    console.log(
      `[NEWSWIRE] Navigation warning: ${error.message}`
    );
  });

  await page.waitForNetworkIdle({
    idleTime: 1500,
    timeout: 30000
  }).catch(() => {
    console.log(
      '[NEWSWIRE] Network did not become fully idle, continuing.'
    );
  });

  await new Promise(resolve =>
    setTimeout(
      resolve,
      2500
    )
  );
}

async function getArticleLastModified(
  browser,
  url
) {
  const page =
    await browser.newPage();

  try {
    const response =
      await page.goto(
        url,
        {
          waitUntil:
            'domcontentloaded',
          timeout: 30000
        }
      ).catch(error => {
        console.log(
          `[NEWSWIRE] Article request warning: ${error.message}`
        );

        return null;
      });

    if (!response) {
      return null;
    }

    const headers =
      response.headers();

    /*
     * IMPORTANT:
     *
     * This is the raw HTTP Last-Modified
     * header from the ARTICLE response.
     *
     * It is intentionally not parsed,
     * converted or reformatted.
     */
    return (
      headers['last-modified'] ||
      null
    );
  } finally {
    await page.close();
  }
}

function loadState() {
  const state =
    readJson(
      STATE_FILE
    );

  if (
    !state ||
    typeof state !== 'object'
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

function loadNotificationArray(
  file
) {
  const value =
    readJson(
      file
    );

  return Array.isArray(
    value
  )
    ? value
    : [];
}

function appendNotifications(
  notifications
) {
  if (
    !notifications.length
  ) {
    return;
  }

  const existing =
    loadNotificationArray(
      NOTIFICATIONS_FILE
    );

  writeJson(
    NOTIFICATIONS_FILE,
    [
      ...existing,
      ...notifications
    ]
  );
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
    loadNotificationArray(
      PENDING_NOTIFICATIONS_FILE
    );

  const keys =
    new Set(
      pending.map(
        event =>
          [
            event.type || '',
            event.url || '',
            event.detected_at || ''
          ].join('|')
      )
    );

  for (
    const notification of notifications
  ) {
    const key =
      [
        notification.type || '',
        notification.url || '',
        notification.detected_at || ''
      ].join('|');

    if (
      keys.has(key)
    ) {
      continue;
    }

    pending.push(
      notification
    );

    keys.add(key);
  }

  writeJson(
    PENDING_NOTIFICATIONS_FILE,
    pending
  );
}

function updateArticleState(
  state,
  article
) {
  const existing =
    state.articles.find(
      item =>
        item &&
        item.url === article.url
    );

  if (!existing) {
    state.articles.push({
      title:
        article.title,

      url:
        article.url,

      date:
        article.date || null,

      last_modified:
        article.lastModified || null
    });

    return;
  }

  existing.title =
    article.title ||
    existing.title ||
    null;

  existing.date =
    article.date ||
    existing.date ||
    null;

  existing.last_modified =
    article.lastModified ||
    existing.last_modified ||
    null;
}

async function main() {
  console.log(
    '[NEWSWIRE] Checking Rockstar Newswire...'
  );

  const config =
    readJson(
      CONFIG_FILE
    ) || {};

  const configuredLimit =
    Number(
      config?.newswire?.latest_articles
    );

  const limit =
    Number.isInteger(
      configuredLimit
    ) &&
    configuredLimit > 0
      ? configuredLimit
      : 3;

  const state =
    loadState();

  const browser =
    await launchBrowser();

  try {
    const page =
      await browser.newPage();

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36'
    );

    await page.setViewport({
      width: 1440,
      height: 900
    });

    await page.setExtraHTTPHeaders({
      'accept-language':
        'en-US,en;q=0.9'
    });

    await openNewswire(
      page
    );

    const allArticles =
      await extractNewswireArticles(
        page
      );

    console.log(
      `[NEWSWIRE] Article links detected: ${allArticles.length}`
    );

    if (
      !allArticles.length
    ) {
      throw new Error(
        'No Newswire articles detected.'
      );
    }

    /*
     * Rockstar currently places the
     * featured/pinned article before the
     * normal article feed.
     *
     * We explicitly ignore that first
     * featured item.
     */
    const latestArticles =
      allArticles.slice(
        1,
        limit + 1
      );

    console.log(
      `[NEWSWIRE] Latest ${latestArticles.length} articles:`
    );

    for (
      let index = 0;
      index < latestArticles.length;
      index += 1
    ) {
      const article =
        latestArticles[index];

      console.log(
        `${index + 1}. ${article.title}`
      );

      console.log(
        `   Posted: ${article.visibleDate || article.datetime || 'unknown'}`
      );
    }

    /*
     * Get metadata directly from each
     * article page.
     */
    for (
      const article of latestArticles
    ) {
      console.log(
        `[NEWSWIRE] Reading article header: ${article.url}`
      );

      article.date =
        formatNewswireDate(
          parseNewswireDate(
            article.datetime
          )
        );

      article.lastModified =
        await getArticleLastModified(
          browser,
          article.url
        );

      console.log(
        `[NEWSWIRE] Posted: ${article.date || 'unknown'}`
      );

      console.log(
        `[NEWSWIRE] Last-Modified: ${article.lastModified || 'unknown'}`
      );
    }

    const knownUrls =
      new Set(
        state.known_urls
      );

    for (
      const article of state.articles
    ) {
      if (
        article?.url
      ) {
        knownUrls.add(
          article.url
        );
      }
    }

    const newArticles =
      latestArticles.filter(
        article =>
          article.url &&
          !knownUrls.has(
            article.url
          )
      );

    console.log(
      `[NEWSWIRE] New articles detected: ${newArticles.length}`
    );

    const detectedAt =
      new Date().toISOString();

    const notifications =
      newArticles.map(
        article => ({
          type:
            'newswire_new_post',

          title:
            article.title,

          url:
            article.url,

          date:
            article.date || null,

          last_modified:
            article.lastModified ||
            null,

          detected_at:
            detectedAt
        })
      );

    for (
      const article of latestArticles
    ) {
      updateArticleState(
        state,
        article
      );

      if (
        article.url &&
        !state.known_urls.includes(
          article.url
        )
      ) {
        state.known_urls.push(
          article.url
        );
      }
    }

    /*
     * Keep enough history to prevent
     * duplicate notifications without
     * allowing the state file to grow
     * forever.
     */
    state.articles =
      state.articles
        .filter(
          article =>
            article &&
            article.url
        )
        .slice(-25);

    state.known_urls =
      Array.from(
        new Set(
          state.known_urls.filter(
            Boolean
          )
        )
      ).slice(-25);

    writeJson(
      STATE_FILE,
      state
    );

    if (
      notifications.length
    ) {
      appendNotifications(
        notifications
      );

      appendPendingNotifications(
        notifications
      );

      console.log(
        `[NEWSWIRE] Notifications generated: ${notifications.length}`
      );
    } else {
      console.log(
        '[NEWSWIRE] No new articles.'
      );
    }
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(
    `[NEWSWIRE] Failed: ${error.message}`
  );

  process.exitCode = 1;
});
