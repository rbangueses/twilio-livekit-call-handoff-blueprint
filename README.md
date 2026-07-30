# Twilio LiveKit Flex Handoff

Conversational AI agents need a clean path to escalate to a human when they cannot resolve an interaction on their own.

This repo is a working blueprint for handing an active phone call from a LiveKit voice agent back to Twilio, then routing that caller to a human agent. The example assumes Twilio Flex is the agent desktop and embedded softphone, but the same pattern works with any agent experience built on Twilio Programmable Voice. TaskRouter is used to enqueue the voice task and carry handoff context into the human-agent workflow.

For a visual walkthrough, open [livekit-flex-handoff-reference-blueprint.html](livekit-flex-handoff-reference-blueprint.html).

In this example the Twilio-side backend uses **Twilio Functions**.

The call flow is:

1. Caller dials your Twilio number.
2. Twilio invokes the `/voice` Function.
3. `/voice` returns `<Dial><Sip>` to send the caller to LiveKit, including the original inbound `CallSid` as handoff context.
4. The LiveKit agent calls the `/escalate` Function when it needs a human.
5. `/escalate` updates the original Twilio Call resource with `<Enqueue workflowSid="...">`.
6. Flex receives the voice task through its TaskRouter workflow.

The key handoff detail is the parent call SID. `/voice` passes the inbound caller's original Twilio `CallSid` to LiveKit as `parentCallSid` using the `X-Parent-CallSid` SIP header. When the agent escalates, `/escalate` updates that parent call, not the LiveKit SIP child leg. Updating the parent call is what moves the live caller into Flex.

You can use the same pattern without Flex if your human-agent stack also uses TaskRouter: enqueue the parent call and pass handoff context as task attributes. If you are not using TaskRouter, the routing step can still be done with TwiML such as `<Dial>`, but you will need a separate way to pass conversation context to the destination agent experience.

## 1. Prerequisites

You need:

- A Twilio account with Flex enabled.
- A Twilio phone number for inbound calls.
- The Flex TaskRouter Workflow SID that should receive escalated voice tasks. This must start with `WW`; do not use the Flex TaskRouter Workspace SID, which starts with `WS`.
- A LiveKit Cloud project.
- Your LiveKit SIP host, for example `abcde.sip.livekit.cloud`.
- The LiveKit CLI if you want to create the SIP trunk and dispatch rule from the terminal.
- The Twilio CLI if you want to deploy the Functions from this repo.

Install and authenticate the Twilio CLI:

```bash
twilio login
twilio plugins:install @twilio-labs/plugin-serverless
```

Find your LiveKit SIP host from the LiveKit Cloud project settings. If LiveKit shows:

```text
sip:abcd.sip.livekit.cloud
```

then use:

```text
LIVEKIT_SIP_HOST=abcd.sip.livekit.cloud
```

Choose these two secrets yourself:

- `LIVEKIT_SIP_USERNAME` and `LIVEKIT_SIP_PASSWORD`: shared by Twilio `<Sip>` and the LiveKit inbound SIP trunk.
- `HANDOFF_TOKEN`: shared by the LiveKit agent and the Twilio `/escalate` Function.

As an example, you can generate strong values with:

```bash
openssl rand -base64 32
```

## 2. Setup

### 2.1 Deploy the Twilio Functions

Choose one of these routes. Both produce the same two public Function URLs: `/voice` and `/escalate`.

#### 2.1.1 CLI Deployment

Use this route if you want the repo to create and deploy the required Twilio Functions.

Create the deployment env file:

```bash
cp serverless/.env.example serverless/.env
```

Fill in `serverless/.env`:

```text
TWILIO_SERVERLESS_SERVICE_NAME=your-preferred-name
TWILIO_PROFILE=XYZ
FLEX_WORKFLOW_SID=WWxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
LIVEKIT_SIP_HOST=your-project.sip.livekit.cloud
LIVEKIT_PHONE_NUMBER=+1xxxx
LIVEKIT_SIP_USERNAME=your-desired-username
LIVEKIT_SIP_PASSWORD=replace_with_a_long_random_password
HANDOFF_TOKEN=replace_with_a_long_random_token
```

Deploy:

```bash
cd serverless
npm run deploy
```

The deploy script validates the required variables and runs:

```bash
twilio serverless:deploy --service-name "$TWILIO_SERVERLESS_SERVICE_NAME" --env .env
```

If `TWILIO_PROFILE` is set, the deploy script passes `-p <profile>` to the Twilio CLI. Use this when the phone number/Flex account is not your active Twilio CLI profile.

The deploy script validates that `FLEX_WORKFLOW_SID` looks like a `WW...` Workflow SID.

#### 2.1.2 Manual Console Deployment

Use this route if you prefer creating the Function Service and Functions in Twilio Console.

Create a Twilio Functions Service and add the same environment variables from `serverless/.env.example`.

Then create a public Function named `/voice` using [serverless/functions/voice.js](serverless/functions/voice.js), and a public Function named `/escalate` using [serverless/functions/escalate.js](serverless/functions/escalate.js).

After either route, keep the generated Function URLs handy. You will use `/voice` as the Twilio number webhook and `/escalate` as the LiveKit handoff endpoint:

```text
https://your-functions-service-1234.twil.io/voice
https://your-functions-service-1234.twil.io/escalate
```

### 2.2 Create the LiveKit SIP Trunk

Create your local LiveKit SIP config from the example, then replace `+15551234567` with your Twilio number:

```bash
cp livekit/inbound-trunk.example.json livekit/inbound-trunk.json
```

Load the same values from `serverless/.env` into your shell, or paste the values directly into the command:

```bash
set -a
source serverless/.env
set +a
```

Create the inbound trunk:

```bash
lk sip inbound create livekit/inbound-trunk.json \
  --auth-user "$LIVEKIT_SIP_USERNAME" \
  --auth-pass "$LIVEKIT_SIP_PASSWORD"
```

Copy the returned trunk ID. It starts with `ST`.

Create the dispatch rule and bind it to that trunk:

```bash
cp livekit/dispatch-rule.example.json livekit/dispatch-rule.json
lk sip dispatch create livekit/dispatch-rule.json --trunks "STxxxxxxxxxxxxxxxx"
```

If you omit `--trunks`, LiveKit treats the dispatch rule as a wildcard rule that can match all inbound trunks in the project. For this integration, binding the rule to the Twilio inbound trunk is safer and easier to reason about.

The inbound trunk maps custom SIP headers into LiveKit participant attributes:

- `X-Parent-CallSid` -> `parentCallSid`
- `X-Handoff-Id` -> `handoffId`

### 2.3 Configure the Twilio Number Webhook

In Twilio Console, configure the phone number's incoming voice webhook:

```text
POST https://your-functions-service-1234.twil.io/voice
```

The `/voice` Function returns TwiML like:

```xml
<Response>
  <Dial>
    <Sip username="twilio-livekit" password="...">
      sip:+15551234567@your-project.sip.livekit.cloud;transport=tcp?X-Parent-CallSid=CA...&amp;X-Handoff-Id=CA...
    </Sip>
  </Dial>
</Response>
```

### 2.4 Add the LiveKit Agent Tool

The LiveKit agent only has access to the Flex escalation tool if the tool is implemented in the agent source code. This is not configured in the LiveKit SIP trunk or Twilio Function.

For the Python agent you are running, use [examples/livekit_agent_tool.py](examples/livekit_agent_tool.py) as the model. It adds:

- `@function_tool()` on `transfer_to_flex`
- `RunContext.wait_for_playout()` before changing the Twilio call
- SIP participant lookup in the `entrypoint`
- `parentCallSid` extraction from LiveKit SIP participant attributes
- a POST to `/escalate`

Also include [examples/livekit_flex_handoff_helpers.py](examples/livekit_flex_handoff_helpers.py) next to your `agent.py`, or copy those helper functions into your agent file.

Set these in your LiveKit agent environment:

```bash
HANDOFF_SERVICE_URL=https://your-functions-service-1234.twil.io
HANDOFF_TOKEN=replace_with_a_long_random_token
```

If you use the LiveKit CLI config file, create a local copy from the template and fill in your project values:

```bash
cp agent/livekit.example.toml agent/livekit.toml
```

The key Python tool shape is:

```python
@function_tool()
async def transfer_to_flex(self, context: RunContext, intent: str, summary: str) -> str:
    await context.wait_for_playout()
    payload = build_escalation_payload(
        self.sip_participant.attributes,
        intent=intent,
        summary=summary,
    )
    await asyncio.to_thread(
        post_flex_escalation,
        os.environ["HANDOFF_SERVICE_URL"],
        os.environ["HANDOFF_TOKEN"],
        payload,
    )
    return "The caller is being connected to a human agent."
```

If you are using the Node.js LiveKit Agents SDK instead, use [examples/livekit-agent-tool.ts](examples/livekit-agent-tool.ts) as the model. The important call is:

```ts
await fetch(`${HANDOFF_SERVICE_URL}/escalate`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${HANDOFF_TOKEN}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    parentCallSid,
    handoffId,
    intent,
    summary,
  }),
});
```

For the current test flow, add this behavior to the agent instructions:

```text
First, quickly try a self-serve account access scenario. Ask what the caller is trying to access, then suggest one practical self-serve step such as checking their email for a fresh sign-in code.

The caller is the person experiencing the account access issue. You are the support agent helping them. Never say or imply that you are the one experiencing the issue, locked out, unable to sign in, or waiting for a code.

After the caller says it still is not working, says they want a person, or sounds blocked, briefly say that you are connecting them to a support specialist. Then call transfer_to_flex with intent account_access and a concise summary of what the caller tried, what failed, and what they need next.
```

## 3. How Escalation Targets the Right Call

The key is that the LiveKit agent must escalate the **original inbound caller leg**, not just any SIP leg it can see.

When Twilio receives the inbound call, the `/voice` Function receives `event.CallSid`. That CallSid identifies the original caller leg. The Function stores it as `parentCallSid` and passes it to LiveKit inside the SIP URI as a custom header:

```js
const parentCallSid = event.CallSid;
const sipParams = new URLSearchParams({
  "X-Parent-CallSid": parentCallSid,
  "X-Handoff-Id": event.CallSid,
});
```

Twilio then dials LiveKit with:

```xml
<Dial>
  <Sip>
    sip:+15551234567@your-project.sip.livekit.cloud;transport=tcp?X-Parent-CallSid=CA...
  </Sip>
</Dial>
```

LiveKit receives the SIP call and maps `X-Parent-CallSid` to the SIP participant attribute `parentCallSid`. The LiveKit agent tool reads that attribute and sends it to `/escalate`.

The `/escalate` Function then updates that exact parent Call resource:

```js
await context.getTwilioClient().calls(parentCallSid).update({
  twiml: enqueueTwiml.toString(),
});
```

The replacement TwiML is:

```xml
<Response>
  <Enqueue workflowSid="WW...">
    <Task>{"reason":"ai_escalation","summary":"..."}</Task>
  </Enqueue>
</Response>
```

That update interrupts the original call's current TwiML execution and moves the caller into the Flex/TaskRouter workflow. This is why we pass the parent CallSid explicitly instead of relying on a SIP-leg CallSid exposed inside LiveKit.

## 4. Test End to End

1. Call the Twilio number.
2. Confirm the call lands in a LiveKit room with the `inbound-agent-code`.
3. Confirm the SIP participant has `parentCallSid` and `handoffId` attributes.
4. Trigger the LiveKit `transferToFlex` tool.
5. Confirm a new Flex voice task appears with `reason=ai_escalation` and the handoff summary in task attributes.

## 5. Display Task Attributes in Flex

The escalation Function passes handoff context into Flex as TaskRouter task attributes. At minimum, the Flex task should include fields such as:

- `reason=ai_escalation`
- `intent=account_access`
- `summary` and `description`
- `parentCallSid`
- `handoffId`
- caller metadata such as `from` and `channelType`

Flex does not expose all task attributes in the default task canvas. For demos or debugging, add a small Flex plugin that renders the active task attributes in a dedicated tab.

![Flex task attributes sample](assets/flex-task-attributes-sample.svg)

For a sample implementation, see [rbangueses/TaskAttributesViewer](https://github.com/rbangueses/TaskAttributesViewer). That plugin adds an **Attributes** tab to Flex and displays the active task attributes as searchable key/value rows, which makes it easy to verify the LiveKit handoff summary and parent call metadata.

You can also inspect active task attributes from the Flex browser console:

```js
const manager = Twilio.Flex.Manager.getInstance();

[...manager.store.getState().flex.worker.tasks.values()].map((task) => ({
  taskSid: task.taskSid || task.sid,
  status: task.status,
  attributes: task.attributes,
}));
```

## 6. Local Checks

The automated tests exercise the Twilio Function handlers directly:

```bash
cd serverless
npm test
```
