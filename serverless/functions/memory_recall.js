const { recallMemoryProfile } = require("./lib/memory.private");

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
      query: payload.query,
      observationsLimit: Number(payload.observationsLimit) || 5,
      summariesLimit: Number(payload.summariesLimit) || 3,
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
