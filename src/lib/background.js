const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { ROOT } = require('./config');

const DEFAULT_TIMEOUT = 10000;
const DEFAULT_CONCURRENCY = 100;
const DEFAULT_BUILD_WINDOW = 50;
const DEFAULT_SUB_WINDOW = 100;

const TITLE_NAMES = {
  gta5: 'GTA5',
  gta6: 'GTA6'
};

const PLATFORM_NAMES = {
  ps4: 'PS4',
  xboxone: 'Xbox One',
  pcros: 'PC Legacy',
  ps5: 'PS5',
  xboxsx: 'Xbox Series X|S',
  pcrosalt: 'PC Enhanced',
  ps6: 'PS6'
};

function getTitleDisplayName(title) {
  return (
    TITLE_NAMES[String(title).toLowerCase()] ||
    title
  );
}

function getPlatformDisplayName(platform) {
  return (
    PLATFORM_NAMES[String(platform).toLowerCase()] ||
    platform
  );
}

function parseBuildValue(value) {
  const match = String(value || '').match(
    /^(\d+)_(\d+)$/
  );

  if (!match) {
    return {
      build: 0,
      sub: 0
    };
  }

  return {
    build: Number(match[1]),
    sub: Number(match[2])
  };
}

function compareBuilds(a, b) {
  if (a.build !== b.build) {
    return a.build - b.build;
  }

  return a.sub - b.sub;
}

function buildValue(build, sub) {
  return `${build}_${sub}`;
}

function buildUrl(config, target, build, sub) {
  return config.background_scripts.url_template
    .replaceAll('{title}', target.title)
    .replaceAll('{platform}', target.platform)
    .replaceAll('{build}', String(build))
    .replaceAll('{sub}', String(sub));
}

async function request(url, options = {}) {
  const timeout =
    options.timeout ??
    DEFAULT_TIMEOUT;

  const controller =
    new AbortController();

  const timer = setTimeout(
    () => controller.abort(),
    timeout
  );

  try {
    console.log(
      `[BACKGROUND HTTP] ${options.method || 'GET'} ${url}`
    );

    const response = await fetch(url, {
      method: options.method || 'GET',
      headers: {
        'User-Agent':
          'GTAV-Tunables-Monitor/1.0',
        Accept: '*/*',
        ...(options.headers || {})
      },
      redirect: 'follow',
      signal: controller.signal
    });

    console.log(
      `[BACKGROUND HTTP] ${response.status} ${response.statusText || ''} ${url}`
    );

    return response;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(
        `timeout after ${timeout}ms`
      );
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function checkBuild(
  config,
  target,
  build,
  sub
) {
  const url = buildUrl(
    config,
    target,
    build,
    sub
  );

  try {
    const response = await request(
      url,
      {
        method: 'HEAD',
        timeout:
          config.background_scripts
            .timeout_ms ??
          DEFAULT_TIMEOUT
      }
    );

    return {
      build,
      sub,
      exists: response.status === 200,
      status: response.status
    };
  } catch (error) {
    console.error(
      `[BACKGROUND] ${target.title}/${target.platform} ${build}_${sub}: ${error.message}`
    );

    return {
      build,
      sub,
      exists: false,
      status: null,
      error: error.message
    };
  }
}

async function runConcurrent(
  jobs,
  concurrency
) {
  const results = new Array(
    jobs.length
  );

  let nextIndex = 0;

  async function worker() {
    while (true) {
      const index = nextIndex++;

      if (index >= jobs.length) {
        return;
      }

      results[index] =
        await jobs[index]();
    }
  }

  const workers = Math.min(
    concurrency,
    jobs.length
  );

  await Promise.all(
    Array.from(
      { length: workers },
      () => worker()
    )
  );

  return results;
}

async function scanBuilds(
  config,
  target,
  currentBuildValue
) {
  const current =
    parseBuildValue(
      currentBuildValue
    );

  const buildWindow =
    Number(
      config.background_scripts
        .build_window ??
        DEFAULT_BUILD_WINDOW
    );

  const subWindow =
    Number(
      config.background_scripts
        .sub_window ??
        DEFAULT_SUB_WINDOW
    );

  const concurrency =
    Number(
      config.background_scripts
        .concurrency ??
        DEFAULT_CONCURRENCY
    );

  const jobs = [];

  for (
    let build = current.build;
    build < current.build + buildWindow;
    build++
  ) {
    for (
      let sub = 0;
      sub < subWindow;
      sub++
    ) {
      jobs.push(() =>
        checkBuild(
          config,
          target,
          build,
          sub
        )
      );
    }
  }

  console.log(
    `[BACKGROUND] ${target.title}/${target.platform}: scanning ${jobs.length} links from ${buildValue(current.build, current.sub)} with concurrency ${concurrency}`
  );

  const results =
    await runConcurrent(
      jobs,
      concurrency
    );

  let highest = null;

  for (const result of results) {
    if (!result.exists) {
      continue;
    }

    if (
      !highest ||
      compareBuilds(result, highest) > 0
    ) {
      highest = {
        build: result.build,
        sub: result.sub
      };
    }
  }

  if (!highest) {
    console.log(
      `[BACKGROUND] ${target.title}/${target.platform}: no build found in scan window`
    );

    return null;
  }

  console.log(
    `[BACKGROUND] ${target.title}/${target.platform}: highest build found ${buildValue(highest.build, highest.sub)}`
  );

  return highest;
}

async function downloadBackground(
  config,
  target,
  build,
  sub
) {
  const url = buildUrl(
    config,
    target,
    build,
    sub
  );

  const response =
    await request(
      url,
      {
        method: 'GET',
        timeout:
          config.background_scripts
            .timeout_ms ??
          DEFAULT_TIMEOUT
      }
    );

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} while downloading ${url}`
    );
  }

  const body =
    Buffer.from(
      await response.arrayBuffer()
    );

  const hash =
    crypto
      .createHash('sha256')
      .update(body)
      .digest('hex');

  const lastModified =
    response.headers.get(
      'last-modified'
    );

  const contentLength =
    body.length;

  return {
    url,
    body,
    hash,
    lastModified:
      lastModified || null,
    contentLength
  };
}

function getBackgroundState(
  state
) {
  if (!state.background_scripts) {
    state.background_scripts = {};
  }

  return state.background_scripts;
}

function getStateKey(
  target
) {
  return `${target.title}/${target.platform}`;
}

function saveRpfToHistory(
  target,
  build,
  sub,
  body,
  detectedAt
) {
  const title =
    String(target.title)
      .toLowerCase();

  const platform =
    String(target.platform)
      .toLowerCase();

  const historyDir =
    path.join(
      ROOT,
      'history',
      title,
      'background_script'
    );

  fs.mkdirSync(
    historyDir,
    {
      recursive: true
    }
  );

  const timestamp =
    new Date(detectedAt)
      .toISOString()
      .replaceAll(':', '-');

  const filename =
    `${timestamp}_${title}_${platform}_bg_ng_${build}_${sub}.rpf`;

  const filePath =
    path.join(
      historyDir,
      filename
    );

  fs.writeFileSync(
    filePath,
    body
  );

  console.log(
    `[BACKGROUND] RPF saved: ${filePath}`
  );

  return filePath;
}

async function processBackgroundTarget(
  config,
  target,
  state
) {
  const backgroundState =
    getBackgroundState(state);

  const stateKey =
    getStateKey(target);

  const endpoint =
    target.background_script;

  const configuredBuildValue =
    endpoint.current ||
    buildValue(
      endpoint.build ?? 0,
      endpoint.sub ?? 0
    );

  const previousBuild =
    parseBuildValue(
      configuredBuildValue
    );

  const detectedAt =
    new Date().toISOString();

  let latestBuild =
    await scanBuilds(
      config,
      target,
      configuredBuildValue
    );

  if (!latestBuild) {
    const existing =
      backgroundState[stateKey];

    if (existing) {
      existing.last_checked =
        detectedAt;

      existing.status =
        'no_build_found';

      existing.last_error =
        null;
    }

    return {
      stateChanged: Boolean(existing),
      configChanged: false,
      notifications: []
    };
  }

  const latestBuildValue =
    buildValue(
      latestBuild.build,
      latestBuild.sub
    );

  const buildChanged =
    compareBuilds(
      latestBuild,
      previousBuild
    ) > 0;

  if (buildChanged) {
    endpoint.build =
      latestBuild.build;

    endpoint.sub =
      latestBuild.sub;

    endpoint.current =
      latestBuildValue;

    console.log(
      `[BACKGROUND] ${target.title}/${target.platform}: new build ${latestBuildValue} (previous ${configuredBuildValue})`
    );
  }

  const selectedBuild =
    buildChanged
      ? latestBuild
      : previousBuild;

  let downloaded;

  try {
    downloaded =
      await downloadBackground(
        config,
        target,
        selectedBuild.build,
        selectedBuild.sub
      );
  } catch (error) {
    console.error(
      `[BACKGROUND] ${target.title}/${target.platform}: download failed: ${error.message}`
    );

    const existing =
      backgroundState[stateKey] || {};

    backgroundState[stateKey] = {
      ...existing,
      build:
        selectedBuild.build,
      sub:
        selectedBuild.sub,
      build_value:
        buildValue(
          selectedBuild.build,
          selectedBuild.sub
        ),
      last_checked:
        detectedAt,
      status:
        'error',
      last_error:
        error.message
    };

    return {
      stateChanged: true,
      configChanged: buildChanged,
      notifications: buildChanged
        ? [
            {
              event:
                'background_new_build',
              target,
              metadata: {
                build:
                  latestBuildValue,
                previous_build:
                  configuredBuildValue,
                detected_at:
                  detectedAt
              }
            }
          ]
        : []
    };
  }

  const previousState =
    backgroundState[stateKey] ||
    null;

  const previousHash =
    previousState?.hash ||
    null;

  const hashChanged =
    previousHash !==
    downloaded.hash;

  const eventNotifications =
    [];

  /*
   * History is only saved when something actually changed:
   *
   * - new build
   * - first seen
   * - same build with a different hash
   *
   * An unchanged build with the same hash is NOT saved.
   */
  const shouldSaveHistory =
    buildChanged ||
    !previousState ||
    hashChanged;

  let historyFile = null;

  if (shouldSaveHistory) {
    historyFile =
      saveRpfToHistory(
        target,
        selectedBuild.build,
        selectedBuild.sub,
        downloaded.body,
        detectedAt
      );
  } else {
    console.log(
      `[BACKGROUND] ${target.title}/${target.platform}: history not saved, build and hash unchanged`
    );
  }

  /*
   * IMPORTANT:
   * A new build must generate background_new_build
   * even when the downloaded file hash is unchanged.
   */
  if (buildChanged) {
    eventNotifications.push({
      event:
        'background_new_build',
      target,
      metadata: {
        detected_at:
          detectedAt,
        build:
          latestBuildValue,
        previous_build:
          configuredBuildValue
      }
    });
  } else if (!previousState) {
    eventNotifications.push({
      event:
        'background_first_seen',
      target,
      metadata: {
        detected_at:
          detectedAt,
        last_modified:
          downloaded.lastModified,
        build:
          buildValue(
            selectedBuild.build,
            selectedBuild.sub
          ),
        previous_content_length:
          downloaded.contentLength,
        content_length:
          downloaded.contentLength
      }
    });
  } else if (
    hashChanged
  ) {
    eventNotifications.push({
      event:
        'background_updated',
      target,
      metadata: {
        detected_at:
          detectedAt,
        last_modified:
          downloaded.lastModified,
        previous_last_modified:
          previousState.last_modified ||
          null,
        build:
          buildValue(
            selectedBuild.build,
            selectedBuild.sub
          ),
        previous_content_length:
          previousState.content_length ??
          downloaded.contentLength,
        content_length:
          downloaded.contentLength
      }
    });
  }

  backgroundState[stateKey] = {
    build:
      selectedBuild.build,
    sub:
      selectedBuild.sub,
    build_value:
      buildValue(
        selectedBuild.build,
        selectedBuild.sub
      ),
    hash:
      downloaded.hash,
    last_modified:
      downloaded.lastModified,
    content_length:
      downloaded.contentLength,
    last_checked:
      detectedAt,
    status:
      'ok',
    last_error:
      null
  };

  console.log(
    `[BACKGROUND] ${target.title}/${target.platform}: ${eventNotifications.length ? eventNotifications[0].event : 'unchanged'}`
  );

  if (historyFile) {
    console.log(
      `[BACKGROUND] History file: ${historyFile}`
    );
  }

  return {
    stateChanged: true,
    configChanged: buildChanged,
    notifications:
      eventNotifications
  };
}

async function processBackgroundScripts(
  config,
  state
) {
  const notifications = [];

  let stateChanged = false;
  let configChanged = false;

  if (
    !config.background_scripts ||
    !config.background_scripts.enabled
  ) {
    return {
      stateChanged: false,
      configChanged: false,
      notifications: []
    };
  }

  for (const [
    title,
    titleConfig
  ] of Object.entries(
    config.titles || {}
  )) {
    if (!titleConfig.enabled) {
      continue;
    }

    for (const [
      platform,
      endpoint
    ] of Object.entries(
      titleConfig.endpoints || {}
    )) {
      const backgroundScript =
        endpoint.background_script;

      if (
        !backgroundScript ||
        !backgroundScript.enabled
      ) {
        continue;
      }

      const target = {
        title,
        platform,
        background_script:
          backgroundScript
      };

      console.log(
        `[BACKGROUND] Starting ${getTitleDisplayName(title)}/${getPlatformDisplayName(platform)}...`
      );

      try {
        const result =
          await processBackgroundTarget(
            config,
            target,
            state
          );

        if (result.stateChanged) {
          stateChanged = true;
        }

        if (result.configChanged) {
          configChanged = true;
        }

        if (
          result.notifications.length
        ) {
          notifications.push(
            ...result.notifications
          );
        }
      } catch (error) {
        console.error(
          `[BACKGROUND] ${title}/${platform}: ERROR: ${error.message}`
        );

        if (error.stack) {
          console.error(
            error.stack
          );
        }
      }
    }
  }

  return {
    stateChanged,
    configChanged,
    notifications
  };
}

module.exports = {
  processBackgroundScripts,
  processBackgroundTarget,
  scanBuilds,
  downloadBackground,
  buildUrl,
  getTitleDisplayName,
  getPlatformDisplayName
};
