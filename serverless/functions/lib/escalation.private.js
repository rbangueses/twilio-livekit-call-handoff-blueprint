async function handleEscalation(
  context,
  event,
  callback,
  { includeMemoryAttributes = false } = {},
) {
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

  if (!isWorkflowSid(context.FLEX_WORKFLOW_SID)) {
    response.setStatusCode(500);
    response.setBody({
      error: "invalid_flex_workflow_sid",
      message: "FLEX_WORKFLOW_SID must be a TaskRouter Workflow SID that starts with WW.",
    });
    return callback(null, response);
  }

  const summary = normalizedSummary(payload);
  const taskAttributes = taskAttributesForPayload(
    payload,
    parentCallSid,
    summary,
    includeMemoryAttributes,
  );

  console.log("escalation_payload", {
    hasParentCallSid: Boolean(parentCallSid),
    hasSummary: Boolean(summary),
    summaryLength: summary.length,
    intent: payload.intent || "",
    includeMemoryAttributes,
    payloadKeys: Object.keys(payload).filter((key) => key !== "request"),
  });

  const enqueueTwiml = new Twilio.twiml.VoiceResponse();
  const enqueueAttrs = {
    workflowSid: context.FLEX_WORKFLOW_SID,
  };

  if (context.FLEX_WAIT_URL) {
    enqueueAttrs.waitUrl = context.FLEX_WAIT_URL;
  }

  enqueueTwiml.enqueue(enqueueAttrs).task(JSON.stringify(taskAttributes));

  try {
    await context.getTwilioClient().calls(parentCallSid).update({
      twiml: enqueueTwiml.toString(),
    });
  } catch (error) {
    response.setStatusCode(502);
    response.setBody({
      error: "call_update_failed",
      message: error.message,
    });
    return callback(null, response);
  }

  response.setBody({
    ok: true,
    parentCallSid,
    taskAttributes,
  });
  callback(null, response);
}

function taskAttributesForPayload(payload, parentCallSid, summary, includeMemoryAttributes) {
  const taskAttributes = {
    direction: "inbound",
    channelType: "voice",
    reason: "ai_escalation",
    name: payload.name || "LiveKit AI escalation",
    from: payload.from,
    parentCallSid,
    handoffId: payload.handoffId,
    customerId: payload.customerId,
    intent: payload.intent,
    summary,
    description: summary,
    transcript: payload.transcript,
  };

  if (includeMemoryAttributes) {
    taskAttributes.customerPhone = payload.customerPhone;
    taskAttributes.memoryStoreId = payload.memoryStoreId;
    taskAttributes.memoryProfileId = payload.memoryProfileId;
  }

  return taskAttributes;
}

function isWorkflowSid(value) {
  return typeof value === "string" && /^WW[a-fA-F0-9]{32}$/.test(value);
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

function normalizedSummary(payload) {
  const fallback = "The LiveKit agent requested a human handoff.";
  const value =
    payload.summary ||
    payload.handoffSummary ||
    payload.escalationSummary ||
    payload.conversationSummary ||
    payload.description;

  if (typeof value !== "string") {
    return fallback;
  }

  return value.trim() || fallback;
}

module.exports = {
  handleEscalation,
};
