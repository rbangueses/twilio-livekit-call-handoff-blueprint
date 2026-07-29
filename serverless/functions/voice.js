exports.handler = function (context, event, callback) {
  const response = new Twilio.twiml.VoiceResponse();

  const missingFields = requiredFieldNames(context, event).filter((name) =>
    isBlank(name === "CallSid" ? event.CallSid : context[name]),
  );

  if (missingFields.length > 0) {
    console.error("voice_config_missing", { missingFields });
    response.say("Sorry, this phone line is temporarily unavailable. Please try again later.");
    return callback(null, response);
  }

  const dial = response.dial();

  const parentCallSid = event.CallSid;
  const handoffId = event.CallSid;
  const sipParams = new URLSearchParams({
    "X-Parent-CallSid": parentCallSid,
    "X-Handoff-Id": handoffId,
  });

  const sipUri =
    `sip:${context.LIVEKIT_PHONE_NUMBER}@${context.LIVEKIT_SIP_HOST};transport=tcp?${sipParams.toString()}`;

  dial.sip(
    {
      username: context.LIVEKIT_SIP_USERNAME,
      password: context.LIVEKIT_SIP_PASSWORD,
    },
    sipUri,
  );

  callback(null, response);
};

function requiredFieldNames() {
  return [
    "CallSid",
    "LIVEKIT_PHONE_NUMBER",
    "LIVEKIT_SIP_HOST",
    "LIVEKIT_SIP_USERNAME",
    "LIVEKIT_SIP_PASSWORD",
  ];
}

function isBlank(value) {
  return typeof value !== "string" || value.trim() === "";
}
