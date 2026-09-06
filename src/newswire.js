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

    if (year < 100) {
      year +=
        year < 70
          ? 2000
          : 1900;
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

    const date =
      new Date(
        Date.UTC(
          year,
          month - 1,
          day,
          hour,
          minute
        )
      );

    if (
      !Number.isNaN(
        date.getTime()
      )
    ) {
      return date.toISOString();
    }
  }

  const fallback =
    new Date(text);

  if (
    !Number.isNaN(
      fallback.getTime()
    )
  ) {
    return fallback.toISOString();
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
    const links =
      Array.from(
        document.querySelectorAll(
          'a[href]'
        )
      );

    const articles = [];
    const seen = new Set();

    for (const link of links) {
      const href =
        link.href || '';

      if (
        !/rockstargames\.com\/(?:[a-z]{2}\/)?newswire\/article\//i.test(
          href
        )
      ) {
        continue;
      }

      let url;

      try {
        const parsed =
          new URL(href);

        parsed.hash = '';
        parsed.search = '';

        url =
          parsed.toString();
      } catch {
        continue;
      }

      if (seen.has(url)) {
        continue;
      }

      /*
       * Walk up the DOM to find the
       * article card containing the
       * publication <time>.
       */
      let container =
        link;

      let time =
        null;

      for (
        let depth = 0;
        depth < 10 && container;
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
        time.getAttribute(
          'datetime'
        );

      const visibleDate =
        time.textContent;

      /*
       * Prefer the article title
       * from the card rather than
       * arbitrary text from the page.
       */
      let title =
        link.getAttribute(
          'aria-label'
        );

      if (!title) {
        title =
          link.textContent;
      }

      title =
        String(title || '')
          .replace(/\s+/g, ' ')
          .trim();

      if (!title) {
        continue;
      }

      seen.add(url);

      articles.push({
        url,
        title,
        datetime:
          String(
            datetime || ''
          ).trim(),
        visibleDate:
          String(
            visibleDate || ''
          )
            .replace(/\s+/g, ' ')
            .trim()
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
     * We do not parse it.
     * We do not convert it.
     * We do not replace it with
     * the publication date.
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
    readJson(STATE_FILE);

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
    readJson(file);

  return Array.isArray(value)
    ? value
    : [];
}

function appendNotifications(
  notifications
) {
  if (!notifications.length) {
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
  if (!notifications.length) {
    return;
  }

  const pending =
    loadNotificationArray(
      PENDING_NOTIFICATIONS_FILE
    );

  const keys =
    new Set(
      pending.map(event =>
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

    if (keys.has(key)) {
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
    readJson(CONFIG_FILE) || {};

  const configuredLimit =
    Number(
      config?.newswire?.latest_articles
    );

  /*
   * Newswire is intentionally limited
   * to the 3 latest posted articles.
   */
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

    if (!allArticles.length) {
      throw new Error(
        'No Newswire articles detected.'
      );
    }

    /*
     * Rockstar puts the featured/pinned
     * article first.
     *
     * The actual latest posts therefore
     * start at index 1.
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
     * Get the raw HTTP Last-Modified
     * header from each article itself.
     */
    for (
      const article of latestArticles
    ) {
      console.log(
        `[NEWSWIRE] Reading article header: ${article.url}`
      );

      article.date =
        parseNewswireDate(
          article.datetime
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
      if (article?.url) {
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
     * Keep the state small while
     * retaining enough history to
     * prevent duplicate notifications.
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

    if (notifications.length) {
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
