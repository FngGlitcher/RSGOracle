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
[NEWSWIRE] Failed to read ${file}: ${error.message}
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
if (
value === null ||
value === undefined ||
value === ''
) {
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

parsed.hash = '';

return parsed.toString();

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

return (
  parsed.hostname ===
    'www.rockstargames.com' &&
  /^\/(?:[a-z]{2}(?:-[A-Z]{2})?\/)?newswire\/article\//i.test(
    parsed.pathname
  )
);

} catch {
return false;
}
}

const PUBLISHED_KEYS = [
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

const UPDATED_KEYS = [
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

function findDateByKeys(
value,
keys,
visited = new Set()
) {
if (!value) {
return null;
}

if (
typeof value !== 'object'
) {
return null;
}

if (
visited.has(value)
) {
return null;
}

visited.add(value);

for (
const key of keys
) {
if (
Object.prototype.hasOwnProperty.call(
value,
key
)
) {
const parsed =
parseDate(
value[key]
);

  if (parsed) {
    return parsed;
  }
}

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
const result =
findDateByKeys(
child,
keys,
visited
);

  if (result) {
    return result;
  }
}

}

return null;
}

function findNewswireDates(
value
) {
return {
published:
findDateByKeys(
value,
PUBLISHED_KEYS
),

updated:
  findDateByKeys(
    value,
    UPDATED_KEYS
  )

};
}

function extractArticleId(article) {
if (!article) {
return null;
}

return (
article.id ||
article.id_hash ||
article.idHash ||
article.slug ||
article.articleId ||
article.article_id ||
null
);
}

function extractArticleUrl(article) {
if (!article) {
return null;
}

const candidates = [
article.url,
article.urlOfficial,
article.url_official,
article.link,
article.href,
article.path,
article.metaUrl,
article.meta_url
];

for (
const candidate of candidates
) {
const normalized =
normalizeUrl(
candidate
);

if (
  normalized &&
  isNewswireArticleUrl(
    normalized
  )
) {
  return normalized;
}

}

return null;
}

function extractArticleTitle(article) {
if (!article) {
return null;
}

const candidates = [
article.title,
article.headline,
article.name,
article.displayTitle,
article.display_title
];

for (
const candidate of candidates
) {
const title =
cleanTitle(
candidate
);

if (title) {
  return title;
}

}

return null;
}

function normalizeArticle(article) {
if (!article) {
return null;
}

const url =
extractArticleUrl(
article
);

if (
!url
) {
return null;
}

const dates =
findNewswireDates(
article
);

return {
title:
extractArticleTitle(
article
),

url,

date:
  dates.published,

lastModified:
  article.lastModified ||
  article.last_modified ||
  null,

updatedAt:
  dates.updated

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

if (
Array.isArray(value)
) {
for (
const item of value
) {
findJsonLdDates(
item,
result
);
}

return;

}

if (
typeof value !== 'object'
) {
return;
}

const published =
findDateByKeys(
value,
PUBLISHED_KEYS
);

const updated =
findDateByKeys(
value,
UPDATED_KEYS
);

if (
published &&
!result.published
) {
result.published =
published;
}

if (
updated &&
!result.modified
) {
result.modified =
updated;
}
}

function extractJsonLdDates(html) {
const result = {
published: null,
modified: null
};

const regex =
/<script[^>]+type=["']application/ld+json["'][^>]>([\s\S]?)</script>/gi;

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

  findJsonLdDates(
    parsed,
    result
  );
} catch {
  /*
   * Ignore malformed JSON-LD.
   */
}

}

return result;
}

function extractDatesFromRawHtml(
html
) {
/*

Rockstar pages often contain the article
timestamps inside serialized application data.


We therefore inspect the complete HTML for
ISO timestamps and prioritize timestamps
located near publication/update field names.
*/

const publishedPatterns = [
/(?|publishedAt|publicationDate|publishDate|published)[^]{0,250}?(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:.\d+)?Z)/i,
/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:.\d+)?Z)[^]{0,250}?(?|publishedAt|publicationDate|publishDate|published)/i
];

const updatedPatterns = [
/(?|updatedAt|modifiedAt|modifiedDate|lastUpdated|lastModified|updated|modified)[^]{0,250}?(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:.\d+)?Z)/i,
/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:.\d+)?Z)[^]{0,250}?(?|updatedAt|modifiedAt|modifiedDate|lastUpdated|lastModified|updated|modified)/i
];

let published = null;
let modified = null;

for (
const pattern of publishedPatterns
) {
const match =
html.match(
pattern
);

if (
  match &&
  match[1]
) {
  published =
    parseDate(
      match[1]
    );

  if (published) {
    break;
  }
}

}

for (
const pattern of updatedPatterns
) {
const match =
html.match(
pattern
);

if (
  match &&
  match[1]
) {
  modified =
    parseDate(
      match[1]
    );

  if (modified) {
    break;
  }
}

}

/*

Fallback for a visible English date.
*/
if (!published) {
const visibleDate =
html.match(
/\b(?|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\b/i
);
if (
  visibleDate
) {
  published =
    parseDate(
      visibleDate[0]
    );
}

}

return {
published,
modified
};
}

function extractPageMetadata(
html
) {
const jsonLd =
extractJsonLdDates(
html
);

const rawHtml =
extractDatesFromRawHtml(
html
);

const publishedMeta =
parseDate(
extractMetaValue(
html,
[
'article',
'article',
'datePublished',
'datepublished',
'publish_date',
'publication_date',
'og'
]
)
);

const modifiedMeta =
parseDate(
extractMetaValue(
html,
[
'article',
'article',
'dateModified',
'datemodified',
'modified_date',
'og'
]
)
);

const title =
cleanTitle(
extractMetaValue(
html,
[
'og',
'twitter'
]
)
);

return {
published:
publishedMeta ||
jsonLd.published ||
rawHtml.published ||
null,

modified:
  modifiedMeta ||
  jsonLd.modified ||
  rawHtml.modified ||
  null,

title:
  title || null

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
[NEWSWIRE] Reading article page: ${url}
);

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
    `[NEWSWIRE] Article page returned ${response.status} ${response.statusText}`
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

} catch (error) {
console.log(
[NEWSWIRE] Failed to read article page: ${error.message}
);

return {
  published: null,
  modified: null,
  title: null
};

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
[NEWSWIRE] Reading HTTP Last-Modified header: ${url}
);

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
  return null;
}

return (
  response.headers.get(
    'last-modified'
  ) || null
);

} catch (error) {
console.log(
[NEWSWIRE] Failed to read Last-Modified header: ${error.message}
);

return null;

}
}

async function graphqlRequest(
operationName,
hash,
variables
) {
console.log(
[NEWSWIRE] GraphQL request: ${operationName}
);

const response =
await fetch(
GRAPHQL_URL,
{
method: 'POST',

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

const text =
await response.text();

let payload;

try {
payload =
JSON.parse(
text
);
} catch {
throw new Error(
Invalid GraphQL response: ${text.slice(0, 300)}
);
}

if (
!response.ok
) {
throw new Error(
payload?.errors?.[0]?.message ||
GraphQL HTTP ${response.status}
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

const possible = [
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

const possible = [
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

if (
typeof data === 'object'
) {
return data;
}

return null;
}

function mergeArticle(
base,
extra
) {
if (!base && !extra) {
return null;
}

if (!base) {
return {
...extra
};
}

if (!extra) {
return {
...base
};
}

return {
title:
extra.title ||
base.title ||
null,

url:
  extra.url ||
  base.url ||
  null,

date:
  extra.date ||
  base.date ||
  null,

lastModified:
  extra.lastModified ||
  base.lastModified ||
  null,

updatedAt:
  extra.updatedAt ||
  base.updatedAt ||
  null

};
}

async function fetchNewswire(
latestArticles
) {
/*

Rockstar puts the pinned/featured article first.
Request one extra item so we can ignore it and
still receive exactly latestArticles real posts.
*/
const limit =
latestArticles + 1;

const data =
await graphqlRequest(
'NewswireList',
NEWSWIRE_LIST_HASH,
{
tagId: 0,

    page: 1,

    metaUrl:
      '/newswire',

    limit,

    locale:
      'en_us'
  }
);

const posts =
extractPosts(
data
);

console.log(
[NEWSWIRE] NewswireList returned ${posts.length} posts.
);

if (
posts.length
) {
const pinned =
normalizeArticle(
posts[0]
);

console.log(
  `[NEWSWIRE] Ignoring pinned article: ${pinned?.title || 'unknown'}`
);

}

const latestPosts =
posts.slice(
1,
latestArticles + 1
);

console.log(
[NEWSWIRE] Checking ${latestPosts.length} non-pinned posts.
);

const articles = [];

for (
const item of latestPosts
) {
let article =
normalizeArticle(
item
);

const id =
  extractArticleId(
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

    const detailedArticle =
      normalizeArticle(
        detailed
      );

    article =
      mergeArticle(
        article,
        detailedArticle
      );

    /*
     * Search the entire GraphQL response,
     * because Rockstar can nest timestamps
     * differently between operations.
     */
    const dates =
      findNewswireDates(
        postData
      );

    if (
      article &&
      !article.date &&
      dates.published
    ) {
      article.date =
        dates.published;
    }

    if (
      article &&
      !article.updatedAt &&
      dates.updated
    ) {
      article.updatedAt =
        dates.updated;
    }
  } catch (error) {
    console.log(
      `[NEWSWIRE] NewswirePost ${id} failed: ${error.message}`
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

}

console.log(
[NEWSWIRE] GraphQL articles detected: ${articles.length}
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

url:
  stateUrl &&
  isNewswireArticleUrl(
    stateUrl
  )
    ? stateUrl
    : null,

known_urls:
  knownUrls

};
}

function uniqueArticles(
articles
) {
const unique =
new Map();

for (
const rawArticle of articles
) {
const article =
normalizeArticle(
rawArticle
);

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

unique.set(
  article.url,
  mergeArticle(
    existing,
    article
  )
);

}

return [
...unique.values()
];
}

function sortArticles(
articles
) {
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

/*
 * If the URL changed but the publication date
 * is exactly the same as the current state,
 * consider it the same article.
 */
if (
  knownDate &&
  article.date &&
  article.date ===
    knownDate
) {
  continue;
}

newArticles.push(
  article
);

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
[NEWSWIRE] Notification already queued: ${article.url}
);

return false;

}

notifications.push({
type:
'newswire_new_post',

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

});

writeJson(
NOTIFICATIONS_FILE,
notifications
);

console.log(
[NEWSWIRE] Notification queued: ${article.title || article.url}
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

  fetchNewswirePageMetadata(
    article.url
  )
]);

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

IMPORTANT:


lastModified is ONLY the HTTP Last-Modified
header.


It is never used as publication date.
*/
article.lastModified =
lastModified ||
article.lastModified ||
null;

return article;
}

function buildState(
article,
detectedAt,
knownUrls
) {
return {
url:
article?.url ||
null,

title:
  article?.title ||
  null,

date:
  article?.date ||
  null,

last_modified:
  article?.lastModified ||
  null,

updated_at:
  article?.updatedAt ||
  null,

detected_at:
  detectedAt,

known_urls:
  [
    ...new Set(
      knownUrls.filter(
        Boolean
      )
    )
  ].slice(
    0,
    25
  )

};
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

return;

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
[NEWSWIRE] Latest article window: ${latestArticles}
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
[NEWSWIRE] Request failed: ${error.message}
);

return;

}

const rawState =
readJson(
STATE_FILE,
null
);

const {
normalizedState,
normalizedArticles
} =
findNewArticles(
articles,
rawState
);

console.log(
[NEWSWIRE] Articles detected: ${normalizedArticles.length}
);

/*

Always complete metadata for the five visible
articles. This also repairs an existing state
whose URL is already known but whose date/update
fields are null.
*/
for (
const article of normalizedArticles
) {
await completeArticleMetadata(
article
);
console.log(
  `[NEWSWIRE] Article: ${article.title || article.url}`
);

console.log(
  `[NEWSWIRE] Published: ${article.date || 'unknown'}`
);

console.log(
  `[NEWSWIRE] Last-Modified header: ${article.lastModified || 'unknown'}`
);

console.log(
  `[NEWSWIRE] Last update: ${article.updatedAt || 'unknown'}`
);

}

/*

Re-run detection after metadata completion.
*/
const {
newArticles
} =
findNewArticles(
normalizedArticles,
normalizedState
);

/*

Find the currently stored article in the
freshly completed list.
*/
const currentArticle =
normalizedState.url
? normalizedArticles.find(
article =>
article.url ===
normalizedState.url
)
: null;

/*

Repair existing state even if the URL is already
known and only the dates were missing.
*/
if (
currentArticle
) {
const repairedState =
buildState(
currentArticle,
normalizedState.detected_at ||
detectedAt,
normalizedState.known_urls
);
const changed =
  repairedState.title !==
    normalizedState.title ||
  repairedState.date !==
    normalizedState.date ||
  repairedState.last_modified !==
    normalizedState.last_modified ||
  repairedState.updated_at !==
    normalizedState.updated_at;

if (
  changed
) {
  writeJson(
    STATE_FILE,
    repairedState
  );

  console.log(
    '[NEWSWIRE] Existing state metadata repaired.'
  );
}

}

if (
!newArticles.length
) {
console.log(
'[NEWSWIRE] No new Newswire article.'
);

return;

}

/*

The newest article is the first one after sorting.
*/
const sortedNewArticles =
sortArticles(
newArticles
);

for (
const article of sortedNewArticles
) {
addNotification(
article,
detectedAt
);
}

const latest =
sortedNewArticles[0];

const knownUrls = [
...normalizedState.known_urls,

...normalizedArticles.map(
  article =>
    article.url
)

];

writeJson(
STATE_FILE,
buildState(
latest,
detectedAt,
knownUrls
)
);

console.log(
[NEWSWIRE] ${sortedNewArticles.length} new article(s) detected.
);
}

main().catch(
error => {
console.error(
[NEWSWIRE] Fatal error: ${error.stack || error.message}
);

process.exitCode = 1;

}
);
