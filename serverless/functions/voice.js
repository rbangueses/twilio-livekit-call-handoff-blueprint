const { dialLiveKit } = require("./lib/voice.private");

exports.handler = function (context, event, callback) {
  return dialLiveKit(context, event, callback, { logPrefix: "voice" });
};
