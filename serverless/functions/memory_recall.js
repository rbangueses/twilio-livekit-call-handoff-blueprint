const { recallMemoryProfile } = requireFunction("/lib/memory", "./lib/memory.private");

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

  try {
    const recall = await recallMemoryProfile(context, {
      memoryStoreId: payload.memoryStoreId,
      memoryProfileId: payload.memoryProfileId,
      customerPhone: payload.customerPhone,
      query: payload.query,
      observationsLimit: Number(payload.observationsLimit) || 5,
      summariesLimit: Number(payload.summariesLimit) || 3,
      relevanceThreshold: numberValue(
        payload.relevanceThreshold,
        context.MEMORY_RECALL_RELEVANCE_THRESHOLD,
      ),
      beginDate:
        textValue(payload.beginDate) ||
        beginDateFromLookbackDays(context.MEMORY_RECALL_LOOKBACK_DAYS),
      endDate: textValue(payload.endDate),
    });

    response.setBody({
      ok: true,
      observations: recall.observations || [],
      summaries: recall.summaries || [],
      text: formatRecallText(recall),
    });
  } catch (error) {
    response.setStatusCode(error.message.startsWith("missing_") ? 400 : 502);
    response.setBody({
      error: error.message.startsWith("missing_")
        ? error.message
        : "memory_recall_failed",
      message: error.message,
    });
  }

  callback(null, response);
};

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

function formatRecallText(recall) {
  const observationLines = (recall.observations || [])
    .map((observation) => observation.content)
    .filter(Boolean);
  const summaryLines = (recall.summaries || [])
    .map((summary) => summary.content)
    .filter(Boolean);

  return [...observationLines, ...summaryLines].join("\n");
}

function numberValue(...values) {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function textValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function beginDateFromLookbackDays(value) {
  const lookbackDays = Number(value);
  if (!Number.isFinite(lookbackDays) || lookbackDays <= 0) {
    return undefined;
  }

  return new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
}

function requireFunction(functionPath, localPath) {
  if (typeof Runtime !== "undefined" && Runtime.getFunctions) {
    const functions = Runtime.getFunctions();
    const normalized = functionPath.startsWith("/") ? functionPath : `/${functionPath}`;
    const candidates = [normalized, normalized.slice(1), functionPath];
    const entry =
      candidates.map((key) => functions[key]).find(Boolean) ||
      Object.entries(functions).find(([key]) =>
        candidates.some((candidate) => key === candidate || key.endsWith(candidate)),
      )?.[1];

    if (!entry?.path) {
      throw new Error(`Private Function not found for ${functionPath}`);
    }

    return require(entry.path);
  }

  return require(localPath);
}
