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
.replace(/&/gi, '&')
.replace(/"/gi, '"')
.replace(/'/gi, "'")
.replace(/'/gi, "'")
.replace(/</gi, '<')
.replace(/>/gi, '>')
.replace(///gi, '/')
.replace(///gi, '/')
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
.replace(/<[^>]+>/g, ' ')
.replace(/\s+/g, ' ')
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

/*

* Recursively searches GraphQL data for publication/update
* timestamps. Rockstar's GraphQL response can move these
* fields around depending on the Newswire response shape.
  */
  function findGraphqlDates(
  value,
  result = {
  published: null,
  updated: null
  }
  ) {
  if (!value) {
  return result;
  }

if (Array.isArray(value)) {
for (const item of value) {
findGraphqlDates(
item,
result
);
}

```
return result;
```

}

if (
typeof value !== 'object'
) {
return result;
}

const publishedKeys = [
'datePublished',
'date_published',
'publishedAt',
'published_at',
'publicationDate',
'publication_date',
'publishDate',
'publish_date',
'published'
];

const updatedKeys = [
'dateModified',
'date_modified',
'updatedAt',
'updated_at',
'modifiedAt',
'modified_at',
'modifiedDate',
'modified_date',
'lastUpdated',
'last_updated',
'lastModified',
'last_modified',
'updated',
'modified'
];

for (
const key of publishedKeys
) {
if (
!result.published &&
value[key] !== undefined
) {
const parsed =
parseDate(
value[key]
);

```
  if (parsed) {
    result.published =
      parsed;
    break;
  }
}
```

}

for (
const key of updatedKeys
) {
if (
!result.updated &&
value[key] !== undefined
) {
const parsed =
parseDate(
value[key]
);

```
  if (parsed) {
    result.updated =
      parsed;
    break;
  }
}
```

}

for (
const child of Object.values(
value
)
) {
if (
child &&
typeof child === 'object'
) {
findGraphqlDates(
child,
result
);
}
}

return result;
}

function normalizeArticle(article) {
if (!article) {
return null;
}

const rawUrl =
article.url ||
article.urlOfficial ||
article.url_official ||
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
article.displayTitle ||
article.display_title ||
''
);

const dates =
findGraphqlDates(
article
);

const directDate =
parseDate(
article.datePublished ||
article.date_published ||
article.publishedAt ||
article.published_at ||
article.publicationDate ||
article.publication_date ||
article.publishDate ||
article.publish_date ||
article.published
);

const directUpdated =
parseDate(
article.dateModified ||
article.date_modified ||
article.updatedAt ||
article.updated_at ||
article.modifiedAt ||
article.modified_at ||
article.modifiedDate ||
article.modified_date ||
article.lastUpdated ||
article.last_updated ||
article.lastModified ||
article.last_modified ||
article.updated ||
article.modified
);

return {
title:
title || null,

```
url,

date:
  directDate ||
  dates.published ||
  null,

lastModified:
  article.lastModified ||
  article.last_modified ||
  null,

updatedAt:
  directUpdated ||
  dates.updated ||
  null
```

};
}

function extractMetaValue(
html,
attributes
) {
for (
const attribute of attributes
) {
const escaped =
attribute.replace(
/[.*+?^${}()|[]\]/g,
'\$&'
);

```
const pattern =
  new RegExp(
    `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`,
    'i'
  );

const reversePattern =
  new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`,
    'i'
  );

const match =
  html.match(
    pattern
  ) ||
  html.match(
    reversePattern
  );

if (
  match &&
  match[1]
) {
  return decodeHtml(
    match[1]
  );
}
```

}

return null;
}

function findJsonLdDates(
value,
result
) {
if (!value) {
return;
}

if (Array.isArray(value)) {
for (const item of value) {
findJsonLdDates(
item,
result
);
}

```
return;
```

}

if (
typeof value !== 'object'
) {
return;
}

const published =
parseDate(
value.datePublished ||
value.publishedAt ||
value.publicationDate
);

const modified =
parseDate(
value.dateModified ||
value.modifiedAt ||
value.updatedAt ||
value.lastModified
);

if (
published &&
!result.published
) {
result.published =
published;
}

if (
modified &&
!result.modified
) {
result.modified =
modified;
}

for (
const child of Object.values(
value
)
) {
if (
child &&
typeof child === 'object'
) {
findJsonLdDates(
child,
result
);
}
}
}

function extractJsonLdDates(html) {
const result = {
published: null,
modified: null
};

const regex =
/<script[^>]+type=["']application/ld+json["'][^>]*>([\s\S]*?)</script>/gi;

let match;

while (
(match =
regex.exec(html))
) {
try {
const parsed =
JSON.parse(
match[1].trim()
);

```
  findJsonLdDates(
    parsed,
    result
  );
} catch {
  /*
   * Ignore malformed JSON-LD blocks.
   */
}
```

}

return result;
}

function extractPageMetadata(
html
) {
const jsonLd =
extractJsonLdDates(
html
);

const publishedMeta =
parseDate(
extractMetaValue(
html,
[
'article:published_time',
'article:published',
'datePublished',
'datepublished',
'publish_date',
'publication_date',
'og:published_time'
]
)
);

const modifiedMeta =
parseDate(
extractMetaValue(
html,
[
'article:modified_time',
'article:modified',
'dateModified',
'datemodified',
'modified_date',
'og:updated_time'
]
)
);

const title =
cleanTitle(
extractMetaValue(
html,
[
'og:title',
'twitter:title'
]
)
);

/*

* Rockstar currently renders the publication date
* directly in the Newswire page as:
*
* 3 septembre 2026
*
* If JSON-LD/meta data is unavailable, look for a
* human-readable date in the article page.
  */
  let visibleDate = null;

const visibleDateMatch =
html.match(
/\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\b/i
);

if (
visibleDateMatch
) {
visibleDate =
parseDate(
visibleDateMatch[0]
);
}

return {
published:
publishedMeta ||
jsonLd.published ||
visibleDate ||
null,

```
modified:
  modifiedMeta ||
  jsonLd.modified ||
  null,

title:
  title || null
```

};
}

async function fetchNewswirePageMetadata(
url
) {
if (!url) {
return {
published: null,
modified: null,
title: null
};
}

try {
console.log(
`[NEWSWIRE] Reading article metadata: ${url}`
);

```
const response =
  await fetch(
    url,
    {
      method: 'GET',

      headers: {
        'User-Agent':
          'RSGOracle-Newswire/1.0',

        Accept:
          'text/html,application/xhtml+xml'
      }
    }
  );

if (
  !response.ok
) {
  console.log(
    `[NEWSWIRE] Unable to read article page: ${response.status} ${response.statusText}`
  );

  return {
    published: null,
    modified: null,
    title: null
  };
}

const html =
  await response.text();

return extractPageMetadata(
  html
);
```

} catch (error) {
console.log(
`[NEWSWIRE] Failed to read article metadata: ${error.message}`
);

```
return {
  published: null,
  modified: null,
  title: null
};
```

}
}

async function fetchNewswireLastModified(
url
) {
if (!url) {
return null;
}

try {
console.log(
`[NEWSWIRE] Reading last-modified header: ${url}`
);

```
let response =
  await fetch(
    url,
    {
      method: 'HEAD',

      headers: {
        'User-Agent':
          'RSGOracle-Newswire/1.0'
      }
    }
  );

if (
  !response.ok
) {
  response =
    await fetch(
      url,
      {
        method: 'GET',

        headers: {
          'User-Agent':
            'RSGOracle-Newswire/1.0'
        }
      }
    );
}

if (
  !response.ok
) {
  console.log(
    `[NEWSWIRE] Unable to read HTTP metadata: ${response.status} ${response.statusText}`
  );

  return null;
}

return (
  response.headers.get(
    'last-modified'
  ) || null
);
```

} catch (error) {
console.log(
`[NEWSWIRE] Failed to read last-modified header: ${error.message}`
);

```
return null;
```

}
}

async function graphqlRequest(
operationName,
hash,
variables
) {
console.log(
`[NEWSWIRE] GraphQL request: ${operationName}`
);

const response =
await fetch(
GRAPHQL_URL,
{
method: 'POST',

```
    headers: {
      'Content-Type':
        'application/json',

      'User-Agent':
        'RSGOracle-Newswire/1.0',

      Accept:
        'application/json'
    },

    body: JSON.stringify({
      operationName,

      variables,

      extensions: {
        persistedQuery: {
          version: 1,

          sha256Hash:
            hash
        }
      }
    })
  }
);
```

const text =
await response.text();

let payload;

try {
payload =
JSON.parse(text);
} catch {
throw new Error(
`Invalid GraphQL response: ${text.slice(0, 300)}`
);
}

if (
!response.ok
) {
throw new Error(
payload?.errors?.[0]?.message ||
`GraphQL HTTP ${response.status}`
);
}

if (
payload.errors &&
payload.errors.length
) {
throw new Error(
payload.errors
.map(
error =>
error.message
)
.join('; ')
);
}

return payload.data;
}

function extractPosts(data) {
if (!data) {
return [];
}

const possible =
[
data.posts?.results,
data.newswire?.results,
data.news?.results,
data.results,
data.posts,
data.newswire,
data.news
];

for (
const value of possible
) {
if (
Array.isArray(value)
) {
return value;
}
}

return [];
}

function extractPostData(data) {
if (!data) {
return null;
}

const possible =
[
data.post,
data.newswirePost,
data.newsPost,
data.article,
data.post?.data,
data.newswire?.post,
data.news?.post
];

for (
const value of possible
) {
if (
value &&
typeof value === 'object'
) {
return value;
}
}

return (
data &&
typeof data === 'object'
? data
: null
);
}

async function fetchNewswire(
latestArticles
) {
const limit =
latestArticles + 1;

const data =
await graphqlRequest(
'NewswireList',
NEWSWIRE_LIST_HASH,
{
tagId: 0,

```
    page: 1,

    metaUrl:
      '/newswire',

    limit,

    locale:
      'en_us'
  }
);
```

const posts =
extractPosts(
data
);

console.log(
`[NEWSWIRE] NewswireList returned ${posts.length} posts.`
);

/*

* Rockstar puts a pinned/featured article first.
* Never consider that article part of the latest list.
  */
  const latestPosts =
  posts.slice(
  1,
  latestArticles + 1
  );

if (
posts.length
) {
const pinned =
normalizeArticle(
posts[0]
);

```
console.log(
  `[NEWSWIRE] Ignoring pinned article: ${pinned?.title || 'unknown'}`
);

if (
  pinned?.url
) {
  console.log(
    `[NEWSWIRE] Pinned URL ignored: ${pinned.url}`
  );
}
```

}

console.log(
`[NEWSWIRE] Checking ${latestPosts.length} non-pinned posts.`
);

const articles = [];

for (
const item of latestPosts
) {
if (!item) {
continue;
}

```
const id =
  item.id ||
  item.id_hash ||
  item.idHash ||
  item.slug ||
  item.url ||
  item.href;

let article =
  normalizeArticle(
    item
  );

if (
  id
) {
  try {
    const postData =
      await graphqlRequest(
        'NewswirePost',
        NEWSWIRE_POST_HASH,
        {
          locale:
            'en_us',

          id_hash:
            id
        }
      );

    const detailed =
      extractPostData(
        postData
      );

    const normalizedDetailed =
      normalizeArticle(
        detailed
      );

    if (
      normalizedDetailed
    ) {
      article =
        {
          ...(article || {}),
          ...normalizedDetailed
        };
    }

    /*
     * Search the complete GraphQL response too.
     * The date can exist outside the object that
     * normalizeArticle() receives.
     */
    const graphqlDates =
      findGraphqlDates(
        postData
      );

    if (
      article &&
      !article.date &&
      graphqlDates.published
    ) {
      article.date =
        graphqlDates.published;
    }

    if (
      article &&
      !article.updatedAt &&
      graphqlDates.updated
    ) {
      article.updatedAt =
        graphqlDates.updated;
    }
  } catch (error) {
    console.log(
      `[NEWSWIRE] Failed to fetch NewswirePost ${id}: ${error.message}`
    );
  }
}

if (
  article
) {
  articles.push(
    article
  );
}
```

}

console.log(
`[NEWSWIRE] GraphQL articles detected: ${articles.length}`
);

return articles;
}

function normalizeState(state) {
if (
!state ||
typeof state !== 'object'
) {
return {
url: null,
title: null,
date: null,
last_modified: null,
updated_at: null,
detected_at: null,
known_urls: []
};
}

const knownUrls = [];

if (
Array.isArray(
state.known_urls
)
) {
for (
const value of state.known_urls
) {
const normalized =
normalizeUrl(
value
);

```
  if (
    normalized &&
    isNewswireArticleUrl(
      normalized
    ) &&
    !knownUrls.includes(
      normalized
    )
  ) {
    knownUrls.push(
      normalized
    );
  }
}
```

}

const stateUrl =
normalizeUrl(
state.url
);

if (
stateUrl &&
isNewswireArticleUrl(
stateUrl
) &&
!knownUrls.includes(
stateUrl
)
) {
knownUrls.push(
stateUrl
);
}

return {
...state,

```
url:
  stateUrl &&
  isNewswireArticleUrl(
    stateUrl
  )
    ? stateUrl
    : null,

known_urls:
  knownUrls
```

};
}

function uniqueArticles(articles) {
const unique =
new Map();

for (
const rawArticle of articles
) {
const article =
normalizeArticle(
rawArticle
);

```
if (!article) {
  continue;
}

const existing =
  unique.get(
    article.url
  );

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

if (
  !existing.lastModified &&
  article.lastModified
) {
  existing.lastModified =
    article.lastModified;
}

if (
  !existing.updatedAt &&
  article.updatedAt
) {
  existing.updatedAt =
    article.updatedAt;
}
```

}

return [
...unique.values()
];
}

function sortArticles(articles) {
return [
...articles
].sort(
(a, b) => {
if (
a.date &&
b.date
) {
return (
Date.parse(
b.date
) -
Date.parse(
a.date
)
);
}

```
  if (
    a.date &&
    !b.date
  ) {
    return -1;
  }

  if (
    !a.date &&
    b.date
  ) {
    return 1;
  }

  return 0;
}
```

);
}

function findNewArticles(
articles,
state
) {
const normalizedState =
normalizeState(
state
);

const knownUrls =
new Set(
normalizedState.known_urls
);

const normalizedArticles =
sortArticles(
uniqueArticles(
articles
)
);

const knownDate =
parseDate(
normalizedState.date
);

const newArticles = [];

for (
const article of normalizedArticles
) {
if (
knownUrls.has(
article.url
)
) {
continue;
}

```
if (
  knownDate &&
  article.date &&
  article.date ===
    knownDate
) {
  knownUrls.add(
    article.url
  );

  continue;
}

newArticles.push(
  article
);
```

}

return {
normalizedState,
normalizedArticles,
newArticles
};
}

function readNotifications() {
const value =
readJson(
NOTIFICATIONS_FILE,
[]
);

return Array.isArray(
value
)
? value
: [];
}

function addNotification(
article,
detectedAt
) {
const notifications =
readNotifications();

const exists =
notifications.some(
notification =>
normalizeUrl(
notification.url
) ===
article.url
);

if (
exists
) {
console.log(
`[NEWSWIRE] Notification already queued: ${article.url}`
);

```
return false;
```

}

notifications.push({
type:
'newswire_new_post',

```
title:
  article.title,

url:
  article.url,

date:
  article.date,

last_modified:
  article.lastModified,

updated_at:
  article.updatedAt,

detected_at:
  detectedAt
```

});

writeJson(
NOTIFICATIONS_FILE,
notifications
);

console.log(
`[NEWSWIRE] Notification queued: ${article.title || article.url}`
);

return true;
}

async function completeArticleMetadata(
article
) {
const [
lastModified,
pageMetadata
] =
await Promise.all([
fetchNewswireLastModified(
article.url
),

```
  fetchNewswirePageMetadata(
    article.url
  )
]);
```

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

if (
!article.title &&
pageMetadata.title
) {
article.title =
pageMetadata.title;
}

/*

* IMPORTANT:
*
* lastModified is ONLY the HTTP Last-Modified
* header. It must never replace the publication
* date.
  */
  article.lastModified =
  lastModified ||
  article.lastModified ||
  null;

return article;
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

const latestArticles =
Number.isInteger(
config?.newswire?.latest_articles
) &&
config.newswire.latest_articles > 0
? config.newswire.latest_articles
: 5;

console.log(
'[NEWSWIRE] Checking Rockstar Newswire...'
);

console.log(
`[NEWSWIRE] Latest article window: ${latestArticles}`
);

const detectedAt =
new Date().toISOString();

let articles;

try {
articles =
await fetchNewswire(
latestArticles
);
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

const rawState =
readJson(
STATE_FILE,
null
);

const {
normalizedState,
normalizedArticles,
newArticles
} =
findNewArticles(
articles,
rawState
);

/*

* Complete metadata for every visible article,
* not only newly detected ones.
*
* This is important because an old state may already
* contain the correct URL but have null date/update.
  */
  for (
  const article of normalizedArticles
  ) {
  await completeArticleMetadata(
  article
  );

```
console.log(
```

```
  `[NEWSWIRE] Metadata: ${article.title || article.url}`
);

console.log(
  `[NEWSWIRE] Published: ${article.date || 'unknown'}`
);

console.log(
  `[NEWSWIRE] Last modified header: ${article.lastModified || 'unknown'}`
);

console.log(
  `[NEWSWIRE] Last update: ${article.updatedAt || 'unknown'}`
);
```

}

/*

* Re-run new article detection after metadata completion.
  */
  const completed =
  findNewArticles(
  normalizedArticles,
  normalizedState
  );

const completedNewArticles =
completed.newArticles;

/*

* If an existing state already points to the article
* but dates were missing, repair those fields.
  */
  const currentArticle =
  normalizedState.url
  ? normalizedArticles.find(
  article =>
  article.url ===
  normalizedState.url
  )
  : null;

if (
currentArticle
) {
const repairedState = {
...normalizedState,

```
  url:
    currentArticle.url,

  title:
    currentArticle.title ||
    normalizedState.title,

  date:
    currentArticle.date ||
    normalizedState.date,

  last_modified:
    currentArticle.lastModified ||
    normalizedState.last_modified,

  updated_at:
    currentArticle.updatedAt ||
    normalizedState.updated_at
};

const stateChanged =
  repairedState.date !==
    normalizedState.date ||
  repairedState.last_modified !==
    normalizedState.last_modified ||
  repairedState.updated_at !==
    normalizedState.updated_at ||
  repairedState.title !==
    normalizedState.title;

if (
  stateChanged
) {
  writeJson(
    STATE_FILE,
    repairedState
  );

  console.log(
    '[NEWSWIRE] Existing state metadata repaired.'
  );
}
```

}

/*

* Use the completed article list for new article
* detection so the publication date can be used
* as the identity fallback.
  */
  const finalNewArticles =
  completedNewArticles;

if (
!finalNewArticles.length
) {
console.log(
'[NEWSWIRE] No new article.'
);

```
return;
```

}

/*

* Queue every unknown article.
  */
  for (
  const article of finalNewArticles
  ) {
  addNotification(
  article,
  detectedAt
  );
  }

/*

* Newest publication date first.
  */
  const latestNew =
  sortArticles(
  finalNewArticles
  )[0];

const knownUrls =
new Set(
normalizedState.known_urls
);

for (
const article of normalizedArticles
) {
knownUrls.add(
article.url
);
}

writeJson(
STATE_FILE,
{
url:
latestNew.url,

```
  title:
    latestNew.title,

  date:
    latestNew.date,

  last_modified:
    latestNew.lastModified,

  updated_at:
    latestNew.updatedAt,

  detected_at:
    detectedAt,

  known_urls:
    [
      ...knownUrls
    ].slice(
      0,
      25
    )
}
```

);

console.log(
`[NEWSWIRE] ${finalNewArticles.length} new article(s) detected and notification queued.`
);
}

main().catch(
error => {
console.error(
`[NEWSWIRE] Fatal error: ${error.stack || error.message}`
);

```
process.exitCode =
  1;
```

}
);
`,
L3]   "title": "newswire.js",
L4]   "modified_date": "2026-09-05T22:40:01Z",
L5]   "url": "https://github.com/FngGlitcher/RSGOracle/blob/main/src/newswire.js",
L6]   "display_url": "https://github.com/FngGlitcher/RSGOracle/blob/main/src/newswire.js",
L7]   "display_title": "newswire.js",
L8]   "structuredContent": {
L9]   "title": "newswire.js",
L10]   "content": "const fs = require('fs');
const path = require('container.exec ...
curl -L --fail --silent https://raw.githubusercontent.com/FngGlitcher/RSGOracle/main/src/newswire.js -o /tmp/newswire.js && wc -l /tmp/newswire.js && tail -40 /tmp/newswire.js'' failed with status 6.
