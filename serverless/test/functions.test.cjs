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

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

run();
