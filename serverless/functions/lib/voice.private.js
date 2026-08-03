const { resolveMemoryProfile } = requireFunction("/lib/memory", "./memory.private");

async function dialLiveKit(context, event, callback, { withMemory = false, logPrefix = "voice" } = {}) {
  const response = new Twilio.twiml.VoiceResponse();

  const missingFields = requiredFieldNames().filter((name) =>
    isBlank(name === "CallSid" ? event.CallSid : context[name]),
  );

  if (missingFields.length > 0) {
    console.error(`${logPrefix}_config_missing`, { missingFields });
    response.say("Sorry, this phone line is temporarily unavailable. Please try again later.");
    return callback(null, response);
  }

  const dial = response.dial();
  const parentCallSid = event.CallSid;
  const handoffId = event.CallSid;
  const sipHeaders = {
    "X-Parent-CallSid": parentCallSid,
    "X-Handoff-Id": handoffId,
  };

  if (withMemory) {
    try {
      const memoryProfile = await resolveMemoryProfile(context, event.From);
      if (memoryProfile?.memoryStoreId && memoryProfile?.customerPhone) {
        sipHeaders["X-Customer-Phone"] = memoryProfile.customerPhone;
        sipHeaders["X-Memory-Store-Id"] = memoryProfile.memoryStoreId;
      }
      if (memoryProfile?.memoryProfileId) {
        sipHeaders["X-Memory-Profile-Id"] = memoryProfile.memoryProfileId;
      }
    } catch (error) {
      console.error("memory_profile_resolution_failed", {
        message: error.message,
        from: event.From,
      });
    }
  }

  const sipParams = new URLSearchParams(sipHeaders);
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
}

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

module.exports = {
  dialLiveKit,
};

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
