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

```
return fallback;
```

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
url,
NEWSWIRE_URL
);

```
parsed.hash = '';

return parsed.toString();
```

} catch {
return null;
}
}

function decodeHtml(value) {
return String(value || '')
.replace(
/&/gi,
'&'
)
.replace(
/"/gi,
'"'
)
.replace(
/'/gi,
"'"
)
.replace(
/'/gi,
"'"
)
.replace(
/</gi,
'<'
)
.replace(
/>/gi,
'>'
)
.replace(
///gi,
'/'
)
.replace(
///gi,
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
value
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

```
return (
  parsed.hostname ===
    'www.rockstargames.com' &&
  /^\/newswire\/article\//i.test(
    parsed.pathname
  )
);
```

} catch {
return false;
}
}

function extractArticles(html) {
const articles = [];
const seen = new Set();

const source =
String(html || '');

const articlePattern =
/<a[^>]+href=["']([^%22']*/newswire/article/[^%22']+)["'][^>]*>([\s\S]*?)</a>/gi;

let match;

while (
(match =
articlePattern.exec(
source
))
) {
const url =
normalizeUrl(
decodeHtml(
match[1]
)
);

```
if (
  !url ||
  !isNewswireArticleUrl(
    url
  )
) {
  continue;
}

const block =
  match[2] || '';

const title =
  cleanTitle(
    block
  );

if (
  !title ||
  title.length < 3
) {
  continue;
}

const key =
  `${url}|${title}`;

if (
  seen.has(key)
) {
  continue;
}

seen.add(key);

articles.push({
  title,
  url,
  date: null
});
```

}

const datePattern =
/(?:<time[^>]*(?:datetime|date-time)=["']([^%22']+)["'][^>]*>|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4})/gi;

const dates = [];

while (
(match =
datePattern.exec(
source
))
) {
const raw =
match[1] ||
match[0];

```
const normalized =
  parseDate(
    decodeHtml(
      raw.replace(
        /<[^>]+>/g,
        ''
      )
    )
  );

if (normalized) {
  dates.push({
    position:
      match.index,
    date:
      normalized
  });
}
```

}

for (
const article of articles
) {
const position =
source.indexOf(
article.url
.replace(
/[.*+?^${}()|[]\]/g,
'\$&'
)
);

```
let nearest =
  null;

for (
  const date of dates
) {
  if (
    date.position <=
    position
  ) {
    nearest = date;
  }
}

if (nearest) {
  article.date =
    nearest.date;
}
```

}

return articles;
}

function extractArticlesFromJson(html) {
const articles = [];

const source =
String(html || '');

const urlPattern =
/https?:\/\/[www.rockstargames.com\/newswire\/article\/[a-zA-Z0-9]+\/[^"'\]+/g](http://www.rockstargames.com\/newswire\/article\/[a-zA-Z0-9]+\/[^%22'\]+/g);

const urls =
source.match(
urlPattern
) || [];

const seen =
new Set();

for (
const rawUrl of urls
) {
const url =
normalizeUrl(
rawUrl.replace(
/\//g,
'/'
)
);

```
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
      index - 3000
    ),
    index
  );

const titleMatches =
  before.match(
    /"(?:title|headline|name)"\s*:\s*"([^"]{3,300})"/gi
  ) || [];

let title =
  null;

if (
  titleMatches.length
) {
  const last =
    titleMatches[
      titleMatches.length - 1
    ];

  const titleMatch =
    last.match(
      /:\s*"([^"]+)"/
    );

  if (
    titleMatch
  ) {
    title =
      cleanTitle(
        titleMatch[1]
      );
  }
}

const dateMatch =
  before.match(
    /"(?:datePublished|publishedAt|published_at|date)"\s*:\s*"([^"]+)"/gi
  );

let date =
  null;

if (
  dateMatch &&
  dateMatch.length
) {
  const last =
    dateMatch[
      dateMatch.length - 1
    ];

  const value =
    last.match(
      /:\s*"([^"]+)"/
    );

  if (
    value
  ) {
    date =
      parseDate(
        value[1]
      );
  }
}

articles.push({
  title:
    title ||
    url
      .split('/')
      .pop()
      .replace(
        /-/g,
        ' '
      ),
  url,
  date
});
```

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

```
  const existing =
    map.get(
      article.url
    );

  if (!existing) {
    map.set(
      article.url,
      {
        ...article
      }
    );

    continue;
  }

  if (
    !existing.title &&
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
```

}

return [
...map.values()
];
}

function selectLatestArticle(articles) {
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

return valid[0];
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

function addNotification(article) {
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
new Date().toISOString()
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

```
return;
```

}

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

const articles =
mergeArticles(
htmlArticles,
jsonArticles
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
`[NEWSWIRE] Date: ${latest.date}`
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
new Date().toISOString()
}
);

```
console.log(
  '[NEWSWIRE] First run: article saved without notification.'
);

return;
```

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
new Date().toISOString()
}
);

```
console.log(
  '[NEWSWIRE] No new article.'
);

return;
```

}

addNotification(
latest
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
new Date().toISOString()
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

```
process.exit(1);
```

}
);
