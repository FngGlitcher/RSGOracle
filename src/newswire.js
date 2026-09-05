const fs = require('fs');
const path = require('path');

const {
  ROOT,
  loadConfig
} = require('./lib/config');

const NEWSWIRE_URL =
  'https://www.rockstargames.com/newswire';

const STATE_FILE =
  path.join(
    ROOT,
    'data',
    'state',
    'newswire.json'
  );

const NOTIFICATIONS_FILE =
  path.join(
    ROOT,
    'data',
    'state',
    'pending-notifications.json'
  );

function ensureDirectory(file) {
  fs.mkdirSync(
    path.dirname(file),
    {
      recursive: true
    }
  );
}

function readJson(file, fallback) {
  if (!fs.existsSync(file)) {
    return fallback;
  }

  try {
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

    return fallback;
  }
}

function writeJson(file, data) {
  ensureDirectory(file);

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

function normalizeUrl(url) {
  if (!url) {
    return null;
  }

  try {
    const parsed =
      new URL(
        String(url),
        NEWSWIRE_URL
      );

    parsed.hash = '';

    return parsed.toString();
  } catch {
    return null;
  }
}

function decodeHtml(value) {
  return String(value || '')
    .replace(
      /&amp;/gi,
      '&'
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
      '<'
    )
    .replace(
      /&gt;/gi,
      '>'
    )
    .replace(
      /&#x2F;/gi,
      '/'
    )
    .replace(
      /&#47;/gi,
      '/'
    )
    .replace(
      /&#(\d+);/g,
      (_, code) =>
        String.fromCharCode(
          Number(code)
        )
    )
    .trim();
}

function cleanTitle(value) {
  return decodeHtml(
    String(value || '')
      .replace(
        /<[^>]+>/g,
        ' '
      )
      .replace(
        /\s+/g,
        ' '
      )
      .trim()
  );
}

function parseDate(value) {
  if (!value) {
    return null;
  }

  const timestamp =
    Date.parse(
      String(value).trim()
    );

  if (
    Number.isNaN(
      timestamp
    )
  ) {
    return null;
  }

  return new Date(
    timestamp
  ).toISOString();
}

function isNewswireArticleUrl(url) {
  if (!url) {
    return false;
  }

  try {
    const parsed =
      new URL(
        url,
        NEWSWIRE_URL
      );

    return (
      parsed.hostname ===
        'www.rockstargames.com' &&
      /^\/newswire\/article\//i.test(
        parsed.pathname
      )
    );
  } catch {
    return false;
  }
}

function extractDateCandidates(source) {
  const dates = [];

  const html =
    String(source || '');

  const timePattern =
    /<time\b[^>]*(?:datetime|date-time)\s*=\s*["']([^"']+)["'][^>]*>/gi;

  let match;

  while (
    (match =
      timePattern.exec(html))
  ) {
    const date =
      parseDate(
        decodeHtml(
          match[1]
        )
      );

    if (date) {
      dates.push({
        position:
          match.index,
        date
      });
    }
  }

  const attributePattern =
    /(?:datePublished|publishedAt|published_at|publicationDate|publishDate)\s*[:=]\s*["']([^"']+)["']/gi;

  while (
    (match =
      attributePattern.exec(html))
  ) {
    const date =
      parseDate(
        decodeHtml(
          match[1]
        )
      );

    if (date) {
      dates.push({
        position:
          match.index,
        date
      });
    }
  }

  const englishDatePattern =
    /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\b/gi;

  while (
    (match =
      englishDatePattern.exec(html))
  ) {
    const date =
      parseDate(
        match[0]
      );

    if (date) {
      dates.push({
        position:
          match.index,
        date
      });
    }
  }

  return dates;
}

function findNearestDate(
  dates,
  position,
  source
) {
  if (
    !dates.length
  ) {
    return null;
  }

  let nearestBefore =
    null;

  for (
    const item of dates
  ) {
    if (
      item.position <=
      position
    ) {
      if (
        !nearestBefore ||
        item.position >
          nearestBefore.position
      ) {
        nearestBefore =
          item;
      }
    }
  }

  if (nearestBefore) {
    const distance =
      position -
      nearestBefore.position;

    if (
      distance <= 5000
    ) {
      return nearestBefore.date;
    }
  }

  let nearestAfter =
    null;

  for (
    const item of dates
  ) {
    if (
      item.position >
      position
    ) {
      if (
        !nearestAfter ||
        item.position <
          nearestAfter.position
      ) {
        nearestAfter =
          item;
      }
    }
  }

  if (nearestAfter) {
    const distance =
      nearestAfter.position -
      position;

    if (
      distance <= 5000
    ) {
      return nearestAfter.date;
    }
  }

  return null;
}

function extractArticles(html) {
  const articles = [];
  const seen = new Set();

  const source =
    String(html || '');

  const dates =
    extractDateCandidates(
      source
    );

  const articlePattern =
    /<a\b[^>]*href\s*=\s*["']([^"']*\/newswire\/article\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  let match;

  while (
    (match =
      articlePattern.exec(
        source
      ))
  ) {
    const rawUrl =
      decodeHtml(
        match[1]
      );

    const url =
      normalizeUrl(
        rawUrl
      );

    if (
      !url ||
      !isNewswireArticleUrl(
        url
      )
    ) {
      continue;
    }

    const title =
      cleanTitle(
        match[2]
      );

    if (
      !title ||
      title.length < 3
    ) {
      continue;
    }

    if (
      seen.has(url)
    ) {
      continue;
    }

    seen.add(url);

    const date =
      findNearestDate(
        dates,
        match.index,
        source
      );

    articles.push({
      title,
      url,
      date
    });
  }

  return articles;
}

function extractJsonScripts(html) {
  const scripts = [];

  const source =
    String(html || '');

  const pattern =
    /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

  let match;

  while (
    (match =
      pattern.exec(
        source
      ))
  ) {
    scripts.push(
      match[1]
    );
  }

  return scripts;
}

function collectJsonArticles(
  value,
  articles
) {
  if (!value) {
    return;
  }

  if (
    Array.isArray(value)
  ) {
    for (
      const item of value
    ) {
      collectJsonArticles(
        item,
        articles
      );
    }

    return;
  }

  if (
    typeof value !==
    'object'
  ) {
    return;
  }

  const url =
    normalizeUrl(
      value.url ||
      value.mainEntityOfPage?.['@id'] ||
      value.mainEntityOfPage
    );

  if (
    url &&
    isNewswireArticleUrl(
      url
    )
  ) {
    const title =
      cleanTitle(
        value.headline ||
        value.name ||
        ''
      );

    const date =
      parseDate(
        value.datePublished ||
        value.publishedAt ||
        value.date ||
        ''
      );

    articles.push({
      title,
      url,
      date
    });
  }

  for (
    const child of Object.values(
      value
    )
  ) {
    if (
      child &&
      typeof child ===
        'object'
    ) {
      collectJsonArticles(
        child,
        articles
      );
    }
  }
}

function extractArticlesFromJson(
  html
) {
  const articles = [];

  const scripts =
    extractJsonScripts(
      html
    );

  for (
    const script of scripts
  ) {
    try {
      const parsed =
        JSON.parse(
          script.trim()
        );

      collectJsonArticles(
        parsed,
        articles
      );
    } catch {
      continue;
    }
  }

  return articles;
}

function extractArticlesFromEmbeddedData(
  html
) {
  const articles = [];
  const seen = new Set();

  const source =
    String(html || '');

  const urlPattern =
    /https?:\/\/www\.rockstargames\.com\/newswire\/article\/[a-zA-Z0-9]+\/[^"'\\\s<]+/gi;

  const urls =
    source.match(
      urlPattern
    ) || [];

  for (
    const rawUrl of urls
  ) {
    const url =
      normalizeUrl(
        rawUrl
      );

    if (
      !url ||
      !isNewswireArticleUrl(
        url
      ) ||
      seen.has(url)
    ) {
      continue;
    }

    seen.add(url);

    const index =
      source.indexOf(
        rawUrl
      );

    const before =
      source.slice(
        Math.max(
          0,
          index - 5000
        ),
        index
      );

    const after =
      source.slice(
        index,
        Math.min(
          source.length,
          index + 3000
        )
      );

    const context =
      `${before}\n${after}`;

    const titleMatches =
      [
        ...context.matchAll(
          /"(?:headline|title|name)"\s*:\s*"([^"]{3,300})"/gi
        )
      ];

    let title =
      null;

    if (
      titleMatches.length
    ) {
      title =
        cleanTitle(
          titleMatches[
            titleMatches.length - 1
          ][1]
        );
    }

    const dateMatches =
      [
        ...context.matchAll(
          /"(?:datePublished|publishedAt|published_at|publicationDate|publishDate|date)"\s*:\s*"([^"]+)"/gi
        )
      ];

    let date =
      null;

    if (
      dateMatches.length
    ) {
      for (
        let i =
          dateMatches.length - 1;
        i >= 0;
        i--
      ) {
        date =
          parseDate(
            dateMatches[i][1]
          );

        if (date) {
          break;
        }
      }
    }

    articles.push({
      title:
        title ||
        null,
      url,
      date
    });
  }

  return articles;
}

function mergeArticles(...lists) {
  const map =
    new Map();

  for (
    const list of lists
  ) {
    for (
      const article of list
    ) {
      if (
        !article ||
        !article.url
      ) {
        continue;
      }

      const url =
        normalizeUrl(
          article.url
        );

      if (
        !url ||
        !isNewswireArticleUrl(
          url
        )
      ) {
        continue;
      }

      const existing =
        map.get(
          url
        );

      if (!existing) {
        map.set(
          url,
          {
            title:
              article.title ||
              null,
            url,
            date:
              article.date ||
              null
          }
        );

        continue;
      }

      if (
        (!existing.title ||
          existing.title.length < 3) &&
        article.title
      ) {
        existing.title =
          article.title;
      }

      if (
        !existing.date &&
        article.date
      ) {
        existing.date =
          article.date;
      }
    }
  }

  return [
    ...map.values()
  ];
}

function getSlugTitle(url) {
  try {
    const parsed =
      new URL(
        url
      );

    const slug =
      parsed.pathname
        .split('/')
        .filter(Boolean)
        .pop();

    if (!slug) {
      return 'Unknown article';
    }

    return slug
      .replace(
        /-/g,
        ' '
      )
      .replace(
        /\s+/g,
        ' '
      )
      .trim();
  } catch {
    return 'Unknown article';
  }
}

function selectLatestArticle(
  articles
) {
  const valid =
    articles.filter(
      article =>
        article &&
        article.url &&
        article.date
    );

  if (!valid.length) {
    return null;
  }

  valid.sort(
    (a, b) =>
      Date.parse(
        b.date
      ) -
      Date.parse(
        a.date
      )
  );

  const latest =
    valid[0];

  if (
    !latest.title ||
    latest.title.length < 3
  ) {
    latest.title =
      getSlugTitle(
        latest.url
      );
  }

  return latest;
}

async function fetchNewswire() {
  const response =
    await fetch(
      NEWSWIRE_URL,
      {
        headers: {
          'User-Agent':
            'gtav-tunables-monitor/1.0',
          'Accept':
            'text/html,application/xhtml+xml'
        }
      }
    );

  if (!response.ok) {
    throw new Error(
      `Newswire HTTP ${response.status}`
    );
  }

  return response.text();
}

function addNotification(
  article,
  detectedAt
) {
  const events =
    readJson(
      NOTIFICATIONS_FILE,
      []
    );

  if (
    !Array.isArray(
      events
    )
  ) {
    return;
  }

  const alreadyPending =
    events.some(
      event =>
        event &&
        event.event ===
          'newswire_new_article' &&
        event.url ===
          article.url
    );

  if (
    alreadyPending
  ) {
    return;
  }

  events.push({
    event:
      'newswire_new_article',
    title:
      article.title,
    url:
      article.url,
    date:
      article.date,
    detected_at:
      detectedAt
  });

  writeJson(
    NOTIFICATIONS_FILE,
    events
  );
}

async function main() {
  const config =
    loadConfig();

  if (
    config.features?.newswire !== true
  ) {
    console.log(
      '[NEWSWIRE] Disabled in config.'
    );

    return;
  }

  const detectedAt =
    new Date().toISOString();

  console.log(
    '[NEWSWIRE] Checking Rockstar Newswire...'
  );

  const html =
    await fetchNewswire();

  const htmlArticles =
    extractArticles(
      html
    );

  const jsonArticles =
    extractArticlesFromJson(
      html
    );

  const embeddedArticles =
    extractArticlesFromEmbeddedData(
      html
    );

  const articles =
    mergeArticles(
      htmlArticles,
      jsonArticles,
      embeddedArticles
    );

  console.log(
    `[NEWSWIRE] Articles detected: ${articles.length}`
  );

  const latest =
    selectLatestArticle(
      articles
    );

  if (!latest) {
    throw new Error(
      'No dated Newswire article could be detected.'
    );
  }

  console.log(
    `[NEWSWIRE] Latest article: ${latest.title}`
  );

  console.log(
    `[NEWSWIRE] Published: ${latest.date}`
  );

  console.log(
    `[NEWSWIRE] URL: ${latest.url}`
  );

  const state =
    readJson(
      STATE_FILE,
      null
    );

  if (
    !state ||
    !state.last_article
  ) {
    writeJson(
      STATE_FILE,
      {
        last_article:
          latest.url,
        last_title:
          latest.title,
        last_date:
          latest.date,
        last_checked:
          detectedAt
      }
    );

    console.log(
      '[NEWSWIRE] First run: article saved without notification.'
    );

    return;
  }

  if (
    state.last_article ===
    latest.url
  ) {
    writeJson(
      STATE_FILE,
      {
        ...state,
        last_checked:
          detectedAt
      }
    );

    console.log(
      '[NEWSWIRE] No new article.'
    );

    return;
  }

  addNotification(
    latest,
    detectedAt
  );

  writeJson(
    STATE_FILE,
    {
      last_article:
        latest.url,
      last_title:
        latest.title,
      last_date:
        latest.date,
      previous_article:
        state.last_article,
      previous_title:
        state.last_title ||
        null,
      previous_date:
        state.last_date ||
        null,
      last_checked:
        detectedAt
    }
  );

  console.log(
    `[NEWSWIRE] New article detected: ${latest.title}`
  );
}

main().catch(
  error => {
    console.error(
      `[NEWSWIRE] ${error.message}`
    );

    process.exit(1);
  }
);
