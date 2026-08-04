const MEMORY_BASE_URL = "https://memory.twilio.com";
const CONVERSATIONS_BASE_URL = "https://conversations.twilio.com";

exports.handler = async function (context, event, callback) {
  const response = new Twilio.Response();
  response.appendHeader("Content-Type", "application/json");

  const authorization =
    event.request?.headers?.authorization ||
    event.request?.headers?.Authorization;

  if (authorization !== `Bearer ${context.HANDOFF_TOKEN}`) {
    response.setStatusCode(401);
    response.setBody({ error: "unauthorized" });
    return callback(null, response);
  }

  const payload = parsePayload(event);
  const memoryStoreId = payload.memoryStoreId || context.MEMORY_STORE_ID;
  const customerPhone = payload.customerPhone || payload.from || payload.From;
  const configurationId = payload.configurationId || payload.conversationConfigurationId;

  const body = {
    memoryStoreId,
    customerPhone,
  };

  if (isBlank(memoryStoreId)) {
    body.memoryStore = {
      statusCode: 400,
      error: "missing_memory_store_id",
    };
  } else {
    body.memoryStore = await fetchMemoryStore(context, memoryStoreId);
  }

  if (isBlank(memoryStoreId) || isBlank(customerPhone)) {
    body.profileLookup = {
      statusCode: 400,
      error: isBlank(customerPhone) ? "missing_customer_phone" : "missing_memory_store_id",
      profileFound: false,
    };
  } else {
    body.profileLookup = await lookupProfile(context, memoryStoreId, customerPhone);
  }

  if (!isBlank(configurationId)) {
    body.orchestratorConfig = await fetchOrchestratorConfig(
      context,
      configurationId,
      memoryStoreId,
    );
  }

  response.setBody(body);
  return callback(null, response);
};

async function fetchMemoryStore(context, memoryStoreId) {
  const result = await fetchJson(
    context,
    `${MEMORY_BASE_URL}/v1/ControlPlane/Stores/${encodeURIComponent(memoryStoreId)}`,
    { method: "GET" },
  );

  return {
    statusCode: result.statusCode,
    body: pick(result.body, ["id", "displayName", "status", "description"]),
    error: result.error,
  };
}

async function lookupProfile(context, memoryStoreId, customerPhone) {
  const result = await fetchJson(
    context,
    `${MEMORY_BASE_URL}/v1/Stores/${encodeURIComponent(memoryStoreId)}/Profiles/Lookup`,
    {
      method: "POST",
      body: JSON.stringify({
        idType: "phone",
        value: customerPhone,
      }),
    },
  );

  const profiles = Array.isArray(result.body?.profiles) ? result.body.profiles : [];
  const profileId = extractMemoryProfileId(result.body);
  const firstProfile = profiles[0] || result.body?.profile || result.body || {};

  return {
    statusCode: result.statusCode,
    profileFound: !isBlank(profileId),
    profileId,
    profileCount: profiles.length || (profileId ? 1 : 0),
    profileKeys: Object.keys(firstProfile).sort(),
    profileIdCandidates:
      typeof firstProfile === "string"
        ? { value: firstProfile }
        : pick(firstProfile, ["id", "profileId", "profile_id", "sid"]),
    error: result.error,
  };
}

async function fetchOrchestratorConfig(context, configurationId, memoryStoreId) {
  const result = await fetchJson(
    context,
    `${CONVERSATIONS_BASE_URL}/v2/ControlPlane/Configurations/${encodeURIComponent(
      configurationId,
    )}`,
    { method: "GET" },
  );

  const config = result.body || {};

  return {
    statusCode: result.statusCode,
    id: config.id,
    displayName: config.displayName,
    conversationGroupingType: config.conversationGroupingType,
    memoryStoreId: config.memoryStoreId,
    memoryStoreMatches:
      !isBlank(memoryStoreId) && config.memoryStoreId === memoryStoreId,
    memoryExtractionEnabled: config.memoryExtractionEnabled,
    intelligenceConfigurationIds: config.intelligenceConfigurationIds,
    channelSettings: config.channelSettings,
    error: result.error,
  };
}

async function fetchJson(context, url, options) {
  const fetchImpl = context.fetch || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    return {
      statusCode: 500,
      body: {},
      error: "fetch_unavailable",
    };
  }

  try {
    const response = await fetchImpl(url, {
      ...options,
      headers: {
        Authorization: basicAuthHeader(context),
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });
    const text = await response.text();
    const body = parseJson(text);

    return {
      statusCode: response.status,
      body,
      error: response.ok ? undefined : body.message || body.error || response.statusText,
    };
  } catch (error) {
    return {
      statusCode: 502,
      body: {},
      error: error.message,
    };
  }
}

function basicAuthHeader(context) {
  return `Basic ${Buffer.from(`${accountSid(context)}:${authToken(context)}`).toString(
    "base64",
  )}`;
}

function accountSid(context) {
  return context.TWILIO_ACCOUNT_SID || context.ACCOUNT_SID;
}

function authToken(context) {
  return context.TWILIO_AUTH_TOKEN || context.AUTH_TOKEN;
}

function parsePayload(event) {
  if (typeof event.body === "string" && event.body.trim()) {
    try {
      return { ...event, ...JSON.parse(event.body) };
    } catch {
      return event;
    }
  }

  return event;
}

function parseJson(text) {
  if (isBlank(text)) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 500) };
  }
}

function pick(source, keys) {
  return Object.fromEntries(
    keys
      .map((key) => [key, source?.[key]])
      .filter(([, value]) => value !== undefined),
  );
}

function isBlank(value) {
  return typeof value !== "string" || value.trim() === "";
}

function extractMemoryProfileId(response) {
  const firstProfile = response?.profiles?.[0];

  return (
    response?.id ||
    response?.profileId ||
    response?.profile_id ||
    response?.profile?.id ||
    response?.profile?.profileId ||
    response?.profile?.profile_id ||
    profileIdFromProfile(firstProfile) ||
    null
  );
}

function profileIdFromProfile(profile) {
  if (typeof profile === "string") {
    return profile;
  }

  return profile?.id || profile?.profileId || profile?.profile_id || profile?.sid || null;
}
