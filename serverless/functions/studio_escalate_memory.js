const { handleStudioEscalation } = require("./lib/studio-escalation.private");

exports.handler = async function (context, event, callback) {
  return handleStudioEscalation(context, event, callback, {
    includeMemoryAttributes: true,
  });
};
