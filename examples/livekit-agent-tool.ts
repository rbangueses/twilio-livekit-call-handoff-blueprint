import { getJobContext, llm, voice } from "@livekit/agents";
import { ParticipantKind } from "@livekit/rtc-node";
import { z } from "zod";

const HANDOFF_SERVICE_URL = process.env.HANDOFF_SERVICE_URL!;
const HANDOFF_TOKEN = process.env.HANDOFF_TOKEN!;

export class InboundAgent extends voice.Agent {
  constructor() {
    super({
      instructions:
        "You are a helpful phone support agent. If you cannot solve the issue, confirm the caller wants a human and then call transferToFlex.",
      tools: {
        transferToFlex: llm.tool({
          description: "Escalate this live phone call to a human agent in Twilio Flex.",
          parameters: z.object({
            intent: z.string().describe("Short routing intent, such as billing, sales, or support."),
            summary: z.string().describe("Brief handoff summary for the Flex agent."),
          }),
          execute: async ({ intent, summary }, { ctx }) => {
            await ctx.session.generateReply({
              instructions: "Tell the caller you are connecting them to a human agent now.",
            });
            await ctx.waitForPlayout();

            const job = getJobContext();
            const sipParticipant = Array.from(job.room.remoteParticipants.values()).find(
              (participant) => participant.kind === ParticipantKind.SIP,
            );

            if (!sipParticipant) {
              return "No active SIP caller was found for escalation.";
            }

            const parentCallSid =
              sipParticipant.attributes.parentCallSid ||
              sipParticipant.attributes["sip.h.X-Parent-CallSid"];

            if (!parentCallSid) {
              return "Could not find the Twilio parent CallSid for escalation.";
            }

            const response = await fetch(`${HANDOFF_SERVICE_URL}/escalate`, {
              method: "POST",
              headers: {
                authorization: `Bearer ${HANDOFF_TOKEN}`,
                "content-type": "application/json",
              },
              body: JSON.stringify({
                parentCallSid,
                handoffId:
                  sipParticipant.attributes.handoffId ||
                  sipParticipant.attributes["sip.h.X-Handoff-Id"],
                from: sipParticipant.attributes["sip.phoneNumber"],
                intent,
                summary,
              }),
            });

            if (!response.ok) {
              return `Flex escalation failed with HTTP ${response.status}.`;
            }

            return "The caller is being connected to Twilio Flex.";
          },
        }),
      },
    });
  }
}
