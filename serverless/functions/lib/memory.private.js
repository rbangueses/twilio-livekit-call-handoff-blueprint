const MEMORY_BASE_URL = "https://memory.twilio.com";

async function resolveMemoryProfile(context, phoneNumber) {
  if (!hasMemoryConfig(context) || isBlank(phoneNumber)) {
    return null;
  }

  const response = await memoryFetch(
    context,
    `/v1/Stores/${encodeURIComponent(context.MEMORY_STORE_ID)}/Profiles/Lookup`,
    {
      method: "POST",
      body: JSON.stringify({
        idType: "phone",
        value: phoneNumber,
      }),
    },
  );

  const memoryProfileId =
    response.id ||
    response.profile?.id ||
    response.profiles?.[0]?.id ||
    null;

  return {
    memoryStoreId: context.MEMORY_STORE_ID,
    memoryProfileId,
    customerPhone: phoneNumber,
  };
}

async function recallMemoryProfile(
  context,
  {
    memoryStoreId,
    memoryProfileId,
    query,
    customerPhone,
    observationsLimit = 5,
    summariesLimit = 3,
  },
) {
  if (isBlank(memoryStoreId)) {
    throw new Error("missing_memory_store_id");
  }
  if (isBlank(memoryProfileId) && !isBlank(customerPhone)) {
    const memoryProfile = await resolveMemoryProfile(
      { ...context, MEMORY_STORE_ID: memoryStoreId },
      customerPhone,
    );
    memoryProfileId = memoryProfile?.memoryProfileId;
  }
  if (isBlank(memoryProfileId)) {
    throw new Error("missing_memory_profile_id");
  }

  return memoryFetch(
    context,
    `/v1/Stores/${encodeURIComponent(memoryStoreId)}/Profiles/${encodeURIComponent(
      memoryProfileId,
    )}/Recall`,
    {
      method: "POST",
      body: JSON.stringify({
        query: isBlank(query) ? undefined : query,
        observationsLimit,
        summariesLimit,
      }),
    },
  );
}

async function memoryFetch(context, path, options) {
  const fetchImpl = context.fetch || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch_unavailable");
  }

  const response = await fetchImpl(`${MEMORY_BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: basicAuthHeader(context),
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`memory_http_${response.status}: ${body}`);
  }

  return response.json();
}

function hasMemoryConfig(context) {
  return (
    !isBlank(context.MEMORY_STORE_ID) &&
    !isBlank(accountSid(context)) &&
    !isBlank(authToken(context))
  );
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

function isBlank(value) {
  return typeof value !== "string" || value.trim() === "";
}

module.exports = {
  resolveMemoryProfile,
  recallMemoryProfile,
};
