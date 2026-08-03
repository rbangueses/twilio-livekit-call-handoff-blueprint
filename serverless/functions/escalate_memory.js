const { handleEscalation } = require("./lib/escalation.private");

exports.handler = async function (context, event, callback) {
  return handleEscalation(context, event, callback, {
    includeMemoryAttributes: true,
  });
};
