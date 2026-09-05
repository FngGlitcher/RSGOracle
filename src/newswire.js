const fs = require('fs');
const path = require('path');

const {
ROOT,
loadConfig
} = require('./lib/config');

const NEWSWIRE_URL =
'https://www.rockstargames.com/newswire';

const GRAPHQL_URL =
'https://graph.rockstargames.com/';

const NEWSWIRE_LIST_HASH =
'aef12205cdcce5be34d9a2aa5e118635df895336ea5ea87e73b6b5d8a18ccc1a';

const NEWSWIRE_POST_HASH =
'555658813abe5acc8010de1a1feddd6fd8fddffbdc35d3723d4dc0fe4ded6810';

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

```
parsed.hash = '';

return parsed.toString();
```

} catch {
return null;
}
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
  /^\/(?:[a-z]{2}(?:-[A-Z]{2})?\/)?newswire\/article\//i.test(
    parsed.pathname
  )
);
```

} catch {
return false;
}
}

function normalizeArticle(article) {
if (!article) {
return null;
}

const rawUrl =
article.url ||
article.urlOfficial ||
article.link ||
article.href ||
article.path ||
null;

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
return null;
}

const title =
cleanTitle(
article.title ||
article.headline ||
article.name ||
''
);

const date =
parseDate(
article.datePublished ||
article.publishedAt ||
article.published_at ||
article.publicationDate ||
article.publishDate ||
article.date ||
article.published ||
article.createdAt ||
article.created_at ||
article.created ||
''
);

return {
title:
title || null,

```
url,

date
```

};
}

function collectArticles(
value,
output
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
collectArticles(
item,
output
);
}

```
return;
```

}

if (
typeof value !==
'object'
) {
return;
}

const normalized =
normalizeArticle(
value
);

if (normalized) {
output.push(
normalized
);
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
collectArticles(
child,
output
);
}
}
}

function graphUrl(
operationName,
variables,
hash
) {
const url =
new URL(
GRAPHQL_URL
);

url.searchParams.set(
'origin',
'https://www.rockstargames.com'
);

url.searchParams.set(
'operationName',
operationName
);

url.searchParams.set(
'variables',
JSON.stringify(
variables
)
);

url.searchParams.set(
'extensions',
JSON.stringify({
persistedQuery: {
version: 1,
sha256Hash:
hash
}
})
);

return url;
}

async function fetchGraphQLPersisted(
operationName,
variables,
hash
) {
const url =
graphUrl(
operationName,
variables,
hash
);

console.log(
`[NEWSWIRE] GraphQL request: ${operationName}`
);

const response =
await fetch(
url,
{
headers: {
'User-Agent':
'RSGOracle/1.0',

```
      Accept:
        '*/*',

      Referer:
        NEWSWIRE_URL
    }
  }
);
```

if (
!response.ok
) {
throw new Error(
`GraphQL HTTP ${response.status}`
);
}

const text =
await response.text();

let json;

try {
json =
JSON.parse(
text
);
} catch {
throw new Error(
'GraphQL returned invalid JSON'
);
}

if (
Array.isArray(
json.errors
) &&
json.errors.length
) {
const message =
json.errors
.map(
error =>
error?.message
)
.filter(Boolean)
.join(
' | '
) ||
'GraphQL query failed';

```
throw new Error(
  message
);
```

}

return json;
}

async function fetchNewswireGraphQL() {
const list =
await fetchGraphQLPersisted(
'NewswireList',
{
tagId: 0,
page: 1,
metaUrl: '/newswire',
limit: 20,
locale: 'en_us'
},
NEWSWIRE_LIST_HASH
);

const results =
list?.data?.posts?.results;

if (
!Array.isArray(
results
) ||
!results.length
) {
console.log(
'[NEWSWIRE] NewswireList returned no posts.'
);

```
return [];
```

}

console.log(
`[NEWSWIRE] NewswireList returned ${results.length} posts.`
);

const articles =
[];

for (
const item of results
) {
if (
!item ||
!item.id
) {
continue;
}

```
try {
  const post =
    await fetchGraphQLPersisted(
      'NewswirePost',
      {
        locale:
          'en_us',

        id_hash:
          item.id
      },
      NEWSWIRE_POST_HASH
    );

  const article =
    normalizeArticle({
      ...item,
      ...(post?.data?.post || {})
    });

  if (article) {
    articles.push(
      article
    );
  }
} catch (error) {
  console.log(
    `[NEWSWIRE] Failed to load article ${item.id}: ${error.message}`
  );

  const article =
    normalizeArticle(
      item
    );

  if (article) {
    articles.push(
      article
    );
  }
}
```

}

if (
articles.length
) {
console.log(
`[NEWSWIRE] GraphQL articles detected: ${articles.length}`
);
}

return articles;
}

function extractHtmlArticles(
html
) {
const articles = [];
const seen = new Set();

const source =
String(html || '');

const pattern =
/<a\b[^>]*href\s*=\s*["']([^%22']*/newswire/article/[^%22']+)["'][^>]*>([\s\S]*?)</a>/gi;

let match;

while (
(match =
pattern.exec(
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
  ) ||
  seen.has(url)
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

seen.add(
  url
);

const position =
  match.index;

const context =
  source.slice(
    Math.max(
      0,
      position - 3000
    ),
    Math.min(
      source.length,
      position + 5000
    )
  );

const dates =
  [
    ...context.matchAll(
      /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\b/gi
    )
  ];

let date =
  null;

for (
  const dateMatch of dates
) {
  const parsed =
    parseDate(
      dateMatch[0]
    );

  if (parsed) {
    date =
      parsed;

    break;
  }
}

articles.push({
  title,
  url,
  date
});
```

}

return articles;
}

async function fetchNewswire() {
try {
const graphQLArticles =
await fetchNewswireGraphQL();

```
if (
  graphQLArticles.length
) {
  return graphQLArticles;
}
```

} catch (error) {
console.log(
`[NEWSWIRE] GraphQL failed: ${error.message}`
);
}

console.log(
'[NEWSWIRE] Falling back to Newswire HTML.'
);

const response =
await fetch(
NEWSWIRE_URL,
{
headers: {
'User-Agent':
'RSGOracle/1.0',

```
      Accept:
        'text/html,application/xhtml+xml'
    }
  }
);
```

if (
!response.ok
) {
throw new Error(
`Newswire HTTP ${response.status}`
);
}

const html =
await response.text();

return extractHtmlArticles(
html
);
}

function selectLatestArticle(
articles
) {
const normalized =
articles
.map(
normalizeArticle
)
.filter(Boolean);

if (
!normalized.length
) {
return null;
}

const unique =
new Map();

for (
const article of normalized
) {
const existing =
unique.get(
article.url
);

```
if (!existing) {
  unique.set(
    article.url,
    article
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
```

}

const dated =
[
...unique.values()
].filter(
article =>
article.date
);

if (
!dated.length
) {
return null;
}

dated.sort(
(a, b) =>
Date.parse(
b.date
) -
Date.parse(
a.date
)
);

return dated[0];
}

function addNotification(
article,
detectedAt
) {
const notifications =
readJson(
NOTIFICATIONS_FILE,
[]
);

notifications.push({
event:
'newswire_new_article',

```
title:
  article.title,

url:
  article.url,

date:
  article.date,

detected_at:
  detectedAt
```

});

writeJson(
NOTIFICATIONS_FILE,
notifications
);
}

async function main() {
const config =
loadConfig();

if (
config.features?.newswire !== true
) {
console.log(
'[NEWSWIRE] Feature disabled.'
);

```
return;
```

}

console.log(
'[NEWSWIRE] Checking Rockstar Newswire...'
);

const detectedAt =
new Date().toISOString();

let articles;

try {
articles =
await fetchNewswire();
} catch (error) {
console.error(
`[NEWSWIRE] Request failed: ${error.message}`
);

```
return;
```

}

console.log(
`[NEWSWIRE] Articles detected: ${articles.length}`
);

const latest =
selectLatestArticle(
articles
);

if (!latest) {
console.log(
'[NEWSWIRE] No dated Newswire article could be detected.'
);

```
return;
```

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

if (!state) {
writeJson(
STATE_FILE,
{
url:
latest.url,

```
    title:
      latest.title,

    date:
      latest.date,

    detected_at:
      detectedAt
  }
);

console.log(
  '[NEWSWIRE] Initial state saved. No notification sent.'
);

return;
```

}

if (
state.url ===
latest.url
) {
if (
state.date !==
latest.date ||
state.title !==
latest.title
) {
writeJson(
STATE_FILE,
{
...state,

```
      title:
        latest.title,

      date:
        latest.date
    }
  );
}

console.log(
  '[NEWSWIRE] No new article.'
);

return;
```

}

addNotification(
latest,
detectedAt
);

writeJson(
STATE_FILE,
{
url:
latest.url,

```
  title:
    latest.title,

  date:
    latest.date,

  detected_at:
    detectedAt
}
```

);

console.log(
'[NEWSWIRE] New article detected and notification queued.'
);
}

main().catch(
error => {
console.error(
`[NEWSWIRE] Fatal error: ${error.message}`
);

```
process.exit(1);
```

}
);
",
[L3]   "title": "newswire.js",
[L4]   "modified_date": "2026-09-05T20:57:34Z",
[L5]   "url": "https://github.com/FngGlitcher/RSGOracle/blob/main/src/newswire.js",
[L6]   "display_url": "https://github.com/FngGlitcher/RSGOracle/blob/main/src/newswire.js",
[L7]   "display_title": "newswire.js",
[L8]   "structuredContent": {
[L9]   "content": "const fs...Need concise. Could provide full file as writing block; it's long but user asked code entire. Need not actually write GitHub. Mention source evidence. But the code has `writeJson` issue in read_resource due escaped newline display; actual file fine.

Need perhaps verify syntax mentally. One concern POST hash may be current, but if expired, failure. We can say based on current public implementation. Could also perhaps run check via no code write? We don't have repo checkout. Could use Node syntax with provided code but huge; no need.

Final answer in French, explain exactly root cause and full file. Use writing block. Need no citations inside writing block. Cite outside. The user asked issue, not explicitly ask code but likely wants fix. We should provide. Need writing block title.
