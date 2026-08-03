const assert = require("node:assert/strict");

const tests = [];

test("/voice returns Dial Sip TwiML with parent call headers", async () => {
  installTwilioStub();
  const { handler } = require("../functions/voice");

  const result = await invoke(handler, {
    context: {
      LIVEKIT_PHONE_NUMBER: "+14155550123",
      LIVEKIT_SIP_HOST: "abc123.sip.livekit.cloud",
      LIVEKIT_SIP_USERNAME: "lk-user",
      LIVEKIT_SIP_PASSWORD: "lk-pass",
    },
    event: {
      CallSid: "CAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
  });

  assert.equal(
    result.toString(),
    '<Response><Dial><Sip username="lk-user" password="lk-pass">sip:+14155550123@abc123.sip.livekit.cloud;transport=tcp?X-Parent-CallSid=CAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&amp;X-Handoff-Id=CAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa</Sip></Dial></Response>',
  );
});

test("/voice returns a voice error when the inbound CallSid is missing", async () => {
  installTwilioStub();
  const { handler } = require("../functions/voice");

  const result = await withSilencedConsoleError(() =>
    invoke(handler, {
      context: {
        LIVEKIT_PHONE_NUMBER: "+14155550123",
        LIVEKIT_SIP_HOST: "abc123.sip.livekit.cloud",
        LIVEKIT_SIP_USERNAME: "lk-user",
        LIVEKIT_SIP_PASSWORD: "lk-pass",
      },
      event: {},
    }),
  );

  const twiml = result.toString();
  assert.match(twiml, /<Say>/);
  assert.match(twiml, /temporarily unavailable/);
  assert.doesNotMatch(twiml, /<Sip/);
});

test("/voice returns a voice error when LiveKit SIP config is incomplete", async () => {
  installTwilioStub();
  const { handler } = require("../functions/voice");

  const result = await withSilencedConsoleError(() =>
    invoke(handler, {
      context: {
        LIVEKIT_PHONE_NUMBER: "+14155550123",
        LIVEKIT_SIP_USERNAME: "lk-user",
        LIVEKIT_SIP_PASSWORD: "lk-pass",
      },
      event: {
        CallSid: "CAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
    }),
  );

  const twiml = result.toString();
  assert.match(twiml, /<Say>/);
  assert.match(twiml, /temporarily unavailable/);
  assert.doesNotMatch(twiml, /<Sip/);
});

test("/studio_voice returns Dial Sip TwiML with parent call headers", async () => {
  installTwilioStub();
  const { handler } = require("../functions/studio_voice");

  const result = await invoke(handler, {
    context: {
      LIVEKIT_PHONE_NUMBER: "+14155550123",
      LIVEKIT_SIP_HOST: "abc123.sip.livekit.cloud",
      LIVEKIT_SIP_USERNAME: "lk-user",
      LIVEKIT_SIP_PASSWORD: "lk-pass",
    },
    event: {
      CallSid: "CAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
  });

  assert.equal(
    result.toString(),
    '<Response><Dial><Sip username="lk-user" password="lk-pass">sip:+14155550123@abc123.sip.livekit.cloud;transport=tcp?X-Parent-CallSid=CAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&amp;X-Handoff-Id=CAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa</Sip></Dial></Response>',
  );
});

test("/voice_memory passes resolved Memory profile headers to LiveKit", async () => {
  installTwilioStub();
  const { handler } = require("../functions/voice_memory");
  const memoryCalls = [];

  const result = await invoke(handler, {
    context: {
      LIVEKIT_PHONE_NUMBER: "+14155550123",
      LIVEKIT_SIP_HOST: "abc123.sip.livekit.cloud",
      LIVEKIT_SIP_USERNAME: "lk-user",
      LIVEKIT_SIP_PASSWORD: "lk-pass",
      MEMORY_STORE_ID: "mem_store_123",
      TWILIO_ACCOUNT_SID: "ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      TWILIO_AUTH_TOKEN: "auth-token",
      fetch: async (url, options) => {
        memoryCalls.push({ url, options });
        return jsonResponse(200, { id: "mem_profile_123" });
      },
    },
    event: {
      CallSid: "CAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      From: "+14155550100",
    },
  });

  assert.equal(memoryCalls.length, 1);
  assert.equal(
    memoryCalls[0].url,
    "https://memory.twilio.com/v1/Stores/mem_store_123/Profiles",
  );
  assert.match(result.toString(), /X-Customer-Phone=%2B14155550100/);
  assert.match(result.toString(), /X-Memory-Store-Id=mem_store_123/);
  assert.match(result.toString(), /X-Memory-Profile-Id=mem_profile_123/);
});

test("/studio_voice_memory still dials LiveKit when Memory lookup is unavailable", async () => {
  installTwilioStub();
  const { handler } = require("../functions/studio_voice_memory");

  const result = await withSilencedConsoleError(() =>
    invoke(handler, {
      context: {
        LIVEKIT_PHONE_NUMBER: "+14155550123",
        LIVEKIT_SIP_HOST: "abc123.sip.livekit.cloud",
        LIVEKIT_SIP_USERNAME: "lk-user",
        LIVEKIT_SIP_PASSWORD: "lk-pass",
        MEMORY_STORE_ID: "mem_store_123",
        TWILIO_ACCOUNT_SID: "ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        TWILIO_AUTH_TOKEN: "auth-token",
        fetch: async () => {
          throw new Error("memory unavailable");
        },
      },
      event: {
        CallSid: "CAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        From: "+14155550100",
      },
    }),
  );

  assert.match(result.toString(), /<Sip/);
  assert.match(result.toString(), /X-Parent-CallSid=CAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/);
  assert.doesNotMatch(result.toString(), /X-Memory-Profile-Id/);
});

test("/memory_recall returns observations and summaries for a Memory profile", async () => {
  installTwilioStub();
  const { handler } = require("../functions/memory_recall");
  const memoryCalls = [];

  const result = await invoke(handler, {
    context: {
      HANDOFF_TOKEN: "expected-token",
      TWILIO_ACCOUNT_SID: "ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      TWILIO_AUTH_TOKEN: "auth-token",
      fetch: async (url, options) => {
        memoryCalls.push({ url, options });
        return jsonResponse(200, {
          observations: [{ content: "Caller prefers email updates.", score: 0.91 }],
          summaries: [{ content: "Prior account access issue." }],
        });
      },
    },
    event: {
      request: { headers: { authorization: "Bearer expected-token" } },
      memoryStoreId: "mem_store_123",
      memoryProfileId: "mem_profile_123",
      query: "account access preferences",
    },
  });

  assert.equal(result.statusCode, 200);
  assert.equal(
    memoryCalls[0].url,
    "https://memory.twilio.com/v1/Stores/mem_store_123/Profiles/mem_profile_123/Recall",
  );
  assert.equal(result.body.ok, true);
  assert.equal(result.body.observations[0].content, "Caller prefers email updates.");
  assert.match(result.body.text, /Caller prefers email updates/);
});

test("/escalate rejects requests without the bearer token", async () => {
  installTwilioStub();
  const { handler } = require("../functions/escalate");

  const result = await invoke(handler, {
    context: {
      HANDOFF_TOKEN: "expected-token",
      getTwilioClient: () => {
        throw new Error("Twilio client should not be used");
      },
    },
    event: {
      request: { headers: { authorization: "Bearer wrong-token" } },
      parentCallSid: "CAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
  });

  assert.equal(result.statusCode, 401);
  assert.deepEqual(result.body, { error: "unauthorized" });
});

test("/escalate updates the parent call with Flex enqueue TwiML", async () => {
  installTwilioStub();
  const { handler } = require("../functions/escalate");
  const updates = [];

  const result = await invoke(handler, {
    context: {
      HANDOFF_TOKEN: "expected-token",
      FLEX_WORKFLOW_SID: "WWaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      FLEX_WAIT_URL: "https://example.com/hold",
      getTwilioClient: () => ({
        calls: (callSid) => ({
          update: async (payload) => {
            updates.push({ callSid, payload });
            return { sid: callSid };
          },
        }),
      }),
    },
    event: {
      request: { headers: { authorization: "Bearer expected-token" } },
      parentCallSid: "CAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      handoffId: "handoff-123",
      from: "+14155550100",
      intent: "billing",
      summary: "Caller needs invoice help.",
    },
  });

  assert.equal(result.statusCode, 200);
  assert.equal(updates[0].callSid, "CAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  assert.match(
    updates[0].payload.twiml,
    /^<Response><Enqueue workflowSid="WWaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" waitUrl="https:\/\/example.com\/hold"><Task>/,
  );
  assert.match(updates[0].payload.twiml, /&quot;reason&quot;:&quot;ai_escalation&quot;/);
  assert.match(updates[0].payload.twiml, /&quot;summary&quot;:&quot;Caller needs invoice help\.&quot;/);
  assert.equal(result.body.ok, true);
});

test("/escalate ignores Memory identifiers on the baseline endpoint", async () => {
  installTwilioStub();
  const { handler } = require("../functions/escalate");
  const updates = [];

  const result = await invoke(handler, {
    context: {
      HANDOFF_TOKEN: "expected-token",
      FLEX_WORKFLOW_SID: "WWaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      getTwilioClient: () => ({
        calls: (callSid) => ({
          update: async (payload) => {
            updates.push({ callSid, payload });
            return { sid: callSid };
          },
        }),
      }),
    },
    event: {
      request: { headers: { authorization: "Bearer expected-token" } },
      parentCallSid: "CAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      memoryStoreId: "mem_store_123",
      memoryProfileId: "mem_profile_123",
      customerPhone: "+14155550100",
      summary: "Caller needs human help.",
    },
  });

  assert.equal(result.statusCode, 200);
  assert.doesNotMatch(updates[0].payload.twiml, /memoryStoreId/);
  assert.doesNotMatch(updates[0].payload.twiml, /memoryProfileId/);
  assert.doesNotMatch(updates[0].payload.twiml, /customerPhone/);
});

test("/escalate_memory passes Memory identifiers into TaskRouter attributes", async () => {
  installTwilioStub();
  const { handler } = require("../functions/escalate_memory");
  const updates = [];

  const result = await invoke(handler, {
    context: {
      HANDOFF_TOKEN: "expected-token",
      FLEX_WORKFLOW_SID: "WWaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      getTwilioClient: () => ({
        calls: (callSid) => ({
          update: async (payload) => {
            updates.push({ callSid, payload });
            return { sid: callSid };
          },
        }),
      }),
    },
    event: {
      request: { headers: { authorization: "Bearer expected-token" } },
      parentCallSid: "CAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      memoryStoreId: "mem_store_123",
      memoryProfileId: "mem_profile_123",
      customerPhone: "+14155550100",
      summary: "Caller needs human help.",
    },
  });

  assert.equal(result.statusCode, 200);
  assert.match(updates[0].payload.twiml, /&quot;memoryStoreId&quot;:&quot;mem_store_123&quot;/);
  assert.match(updates[0].payload.twiml, /&quot;memoryProfileId&quot;:&quot;mem_profile_123&quot;/);
  assert.match(updates[0].payload.twiml, /&quot;customerPhone&quot;:&quot;\+14155550100&quot;/);
});

test("/escalate normalizes alternate summary fields into summary and description", async () => {
  installTwilioStub();
  const { handler } = require("../functions/escalate");
  const updates = [];

  const result = await invoke(handler, {
    context: {
      HANDOFF_TOKEN: "expected-token",
      FLEX_WORKFLOW_SID: "WWaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      getTwilioClient: () => ({
        calls: (callSid) => ({
          update: async (payload) => {
            updates.push({ callSid, payload });
            return { sid: callSid };
          },
        }),
      }),
    },
    event: {
      request: { headers: { authorization: "Bearer expected-token" } },
      body: JSON.stringify({
        parentCallSid: "CAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        intent: "account_access",
        handoffSummary: "Caller tried a new sign-in code and still needs help.",
      }),
    },
  });

  assert.equal(result.statusCode, 200);
  assert.match(
    updates[0].payload.twiml,
    /&quot;summary&quot;:&quot;Caller tried a new sign-in code and still needs help\.&quot;/,
  );
  assert.match(
    updates[0].payload.twiml,
    /&quot;description&quot;:&quot;Caller tried a new sign-in code and still needs help\.&quot;/,
  );
});

test("/escalate rejects a Workspace SID before updating the live call", async () => {
  installTwilioStub();
  const { handler } = require("../functions/escalate");
  let updateCalled = false;

  const result = await invoke(handler, {
    context: {
      HANDOFF_TOKEN: "expected-token",
      FLEX_WORKFLOW_SID: "WSaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      getTwilioClient: () => ({
        calls: () => ({
          update: async () => {
            updateCalled = true;
            return {};
          },
        }),
      }),
    },
    event: {
      request: { headers: { authorization: "Bearer expected-token" } },
      parentCallSid: "CAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      summary: "Caller asked for a person.",
    },
  });

  assert.equal(result.statusCode, 500);
  assert.deepEqual(result.body, {
    error: "invalid_flex_workflow_sid",
    message: "FLEX_WORKFLOW_SID must be a TaskRouter Workflow SID that starts with WW.",
  });
  assert.equal(updateCalled, false);
});

test("/studio_escalate updates the parent call with Studio return Redirect TwiML", async () => {
  installTwilioStub();
  const { handler } = require("../functions/studio_escalate");
  const updates = [];

  const result = await invoke(handler, {
    context: {
      HANDOFF_TOKEN: "expected-token",
      STUDIO_FLOW_WEBHOOK_URL:
        "https://webhooks.twilio.com/v1/Accounts/ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/Flows/FWaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      getTwilioClient: () => ({
        calls: (callSid) => ({
          update: async (payload) => {
            updates.push({ callSid, payload });
            return { sid: callSid };
          },
        }),
      }),
    },
    event: {
      request: { headers: { authorization: "Bearer expected-token" } },
      parentCallSid: "CAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      handoffId: "handoff-123",
      intent: "account_access",
      summary: "Caller tried a sign-in code and still needs help.",
      description: "Caller cannot access their account.",
    },
  });

  assert.equal(result.statusCode, 200);
  assert.equal(updates[0].callSid, "CAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  assert.match(
    updates[0].payload.twiml,
    /^<Response><Redirect method="POST">https:\/\/webhooks\.twilio\.com\/v1\/Accounts\/ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\/Flows\/FWaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\?/,
  );
  assert.match(updates[0].payload.twiml, /FlowEvent=return/);
  assert.match(updates[0].payload.twiml, /route=flex/);
  assert.match(updates[0].payload.twiml, /parentCallSid=CAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/);
  assert.match(updates[0].payload.twiml, /intent=account_access/);
  assert.match(updates[0].payload.twiml, /summary=Caller\+tried\+a\+sign-in\+code\+and\+still\+needs\+help\./);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.parentCallSid, "CAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
});

test("/studio_escalate_memory returns Memory identifiers to Studio", async () => {
  installTwilioStub();
  const { handler } = require("../functions/studio_escalate_memory");
  const updates = [];

  const result = await invoke(handler, {
    context: {
      HANDOFF_TOKEN: "expected-token",
      STUDIO_FLOW_WEBHOOK_URL:
        "https://webhooks.twilio.com/v1/Accounts/ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/Flows/FWaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      getTwilioClient: () => ({
        calls: (callSid) => ({
          update: async (payload) => {
            updates.push({ callSid, payload });
            return { sid: callSid };
          },
        }),
      }),
    },
    event: {
      request: { headers: { authorization: "Bearer expected-token" } },
      parentCallSid: "CAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      customerPhone: "+14155550100",
      memoryStoreId: "mem_store_123",
      memoryProfileId: "mem_profile_123",
      summary: "Caller needs human help.",
    },
  });

  assert.equal(result.statusCode, 200);
  assert.match(updates[0].payload.twiml, /customerPhone=%2B14155550100/);
  assert.match(updates[0].payload.twiml, /memoryStoreId=mem_store_123/);
  assert.match(updates[0].payload.twiml, /memoryProfileId=mem_profile_123/);
});

test("/studio_escalate rejects requests without a Studio Flow webhook URL", async () => {
  installTwilioStub();
  const { handler } = require("../functions/studio_escalate");
  let updateCalled = false;

  const result = await invoke(handler, {
    context: {
      HANDOFF_TOKEN: "expected-token",
      getTwilioClient: () => ({
        calls: () => ({
          update: async () => {
            updateCalled = true;
            return {};
          },
        }),
      }),
    },
    event: {
      request: { headers: { authorization: "Bearer expected-token" } },
      parentCallSid: "CAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      summary: "Caller asked for a person.",
    },
  });

  assert.equal(result.statusCode, 500);
  assert.deepEqual(result.body, { error: "missing_studio_flow_webhook_url" });
  assert.equal(updateCalled, false);
});

function test(name, fn) {
  tests.push({ name, fn });
}

async function run() {
  let failed = 0;

  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`ok - ${name}`);
    } catch (error) {
      failed += 1;
      console.error(`not ok - ${name}`);
      console.error(error);
    }
  }

  if (failed > 0) {
    process.exitCode = 1;
  }
}

function invoke(handler, { context, event }) {
  return new Promise((resolve, reject) => {
    handler(context, event, (error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
  });
}

async function withSilencedConsoleError(fn) {
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = originalConsoleError;
  }
}

function installTwilioStub() {
  global.Twilio = {
    Response: FakeResponse,
    twiml: {
      VoiceResponse: FakeVoiceResponse,
    },
  };
}

class FakeResponse {
  constructor() {
    this.statusCode = 200;
    this.headers = {};
    this.body = undefined;
  }

  appendHeader(name, value) {
    this.headers[name] = value;
  }

  setStatusCode(statusCode) {
    this.statusCode = statusCode;
  }

  setBody(body) {
    this.body = body;
  }
}

class FakeVoiceResponse {
  constructor() {
    this.children = [];
  }

  say(message) {
    this.children.push(`<Say>${escapeXml(message)}</Say>`);
    return this;
  }

  dial() {
    const dial = new FakeDial();
    this.children.push(dial);
    return dial;
  }

  enqueue(attrs) {
    const enqueue = new FakeEnqueue(attrs);
    this.children.push(enqueue);
    return enqueue;
  }

  redirect(attrs, url) {
    this.children.push(new FakeRedirect(attrs, url));
    return this;
  }

  toString() {
    return `<Response>${this.children.map((child) => child.toString()).join("")}</Response>`;
  }
}

class FakeDial {
  constructor() {
    this.children = [];
  }

  sip(attrs, uri) {
    this.children.push(
      `<Sip username="${escapeXml(attrs.username)}" password="${escapeXml(attrs.password)}">${escapeXml(uri)}</Sip>`,
    );
  }

  toString() {
    return `<Dial>${this.children.join("")}</Dial>`;
  }
}

class FakeEnqueue {
  constructor(attrs) {
    this.attrs = attrs;
    this.taskPayload = "";
  }

  task(payload) {
    this.taskPayload = payload;
    return this;
  }

  toString() {
    const attrs = Object.entries(this.attrs)
      .filter(([, value]) => value)
      .map(([name, value]) => `${name}="${escapeXml(value)}"`)
      .join(" ");
    return `<Enqueue ${attrs}><Task>${escapeXml(this.taskPayload)}</Task></Enqueue>`;
  }
}

class FakeRedirect {
  constructor(attrs, url) {
    this.attrs = attrs;
    this.url = url;
  }

  toString() {
    const attrs = Object.entries(this.attrs)
      .filter(([, value]) => value)
      .map(([name, value]) => `${name}="${escapeXml(value)}"`)
      .join(" ");
    return `<Redirect ${attrs}>${escapeXml(this.url)}</Redirect>`;
  }
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 200 && status < 300 ? "OK" : "Error",
    async json() {
      return body;
    },
    async text() {
      return JSON.stringify(body);
    },
  };
}

run();
