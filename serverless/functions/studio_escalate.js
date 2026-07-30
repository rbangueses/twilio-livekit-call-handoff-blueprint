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
  const parentCallSid = payload.parentCallSid || payload.callSid;

  if (!parentCallSid) {
    response.setStatusCode(400);
    response.setBody({ error: "missing_parent_call_sid" });
    return callback(null, response);
  }

  if (isBlank(context.STUDIO_FLOW_WEBHOOK_URL)) {
    response.setStatusCode(500);
    response.setBody({ error: "missing_studio_flow_webhook_url" });
    return callback(null, response);
  }

  let studioReturnUrl;
  try {
    studioReturnUrl = buildStudioReturnUrl(context.STUDIO_FLOW_WEBHOOK_URL, {
      parentCallSid,
      handoffId: payload.handoffId || parentCallSid,
      intent: normalizedText(payload.intent, "general_support", 80),
      summary: normalizedText(
        payload.summary ||
          payload.handoffSummary ||
          payload.escalationSummary ||
          payload.conversationSummary ||
          payload.description,
        "The LiveKit agent requested a human handoff.",
        320,
      ),
      description: normalizedText(
        payload.description ||
          payload.summary ||
          payload.handoffSummary ||
          payload.escalationSummary ||
          payload.conversationSummary,
        "The LiveKit agent requested a human handoff.",
        500,
      ),
    });
  } catch (error) {
    response.setStatusCode(500);
    response.setBody({
      error: "invalid_studio_flow_webhook_url",
      message: error.message,
    });
    return callback(null, response);
  }

  const redirectTwiml = new Twilio.twiml.VoiceResponse();
  redirectTwiml.redirect({ method: "POST" }, studioReturnUrl);

  try {
    await context.getTwilioClient().calls(parentCallSid).update({
      twiml: redirectTwiml.toString(),
    });
  } catch (error) {
    response.setStatusCode(502);
    response.setBody({
      error: "call_update_failed",
      message: error.message,
    });
    return callback(null, response);
  }

  console.log("studio_escalation_payload", {
    hasParentCallSid: Boolean(parentCallSid),
    intent: payload.intent || "",
    payloadKeys: Object.keys(payload).filter((key) => key !== "request"),
  });

  response.setBody({
    ok: true,
    parentCallSid,
  });
  callback(null, response);
};

function buildStudioReturnUrl(flowWebhookUrl, params) {
  const url = new URL(flowWebhookUrl);
  url.searchParams.set("FlowEvent", "return");
  url.searchParams.set("route", "flex");

  for (const [key, value] of Object.entries(params)) {
    if (!isBlank(value)) {
      url.searchParams.set(key, value);
    }
  }

  return url.toString();
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

function normalizedText(value, fallback, maxLength) {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value
    .replace(/[\r\n\t]+/g, " ")
    .replace(/["\\]/g, "'")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return fallback;
  }

  return normalized.slice(0, maxLength);
}

function isBlank(value) {
  return typeof value !== "string" || value.trim() === "";
}
