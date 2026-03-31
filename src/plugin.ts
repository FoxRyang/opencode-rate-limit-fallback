import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { loadConfig, parseModel, type FallbackModel, type FallbackModelObject } from "./config"
import { createLogger } from "./log"

interface SessionState {
  fallbackActive: boolean
  cooldownEndTime: number
  attemptCount: number
}

interface MessageInfo {
  id: string
  role: "user" | "assistant"
  sessionID: string
  model?: {
    providerID: string
    modelID: string
  }
  agent?: string
}

interface MessagePart {
  id: string
  type: string
  text?: string
  mime?: string
  filename?: string
  url?: string
  name?: string
}

interface MessageWithParts {
  info: MessageInfo
  parts: MessagePart[]
}

interface PromptBody {
  agent?: string
  parts: Array<{ type: "text"; text: string } | { type: "file"; mime: string; filename?: string; url: string } | { type: "agent"; name: string }>
  model?: FallbackModelObject
}

// Track model information for each session
const sessionModelInfo = new Map<string, {
  originalModel: string;
  currentModel: string;
  fallbackHistory: Array<{timestamp: number; from: string; to: string; reason: string}>;
}>();

const sessionStates = new Map<string, SessionState>()

function normalizeFallbackModels(config: FallbackModel | FallbackModel[]): FallbackModelObject[] {
  const models = Array.isArray(config) ? config : [config]
  return models.map(model => parseModel(model))
}

function getNextFallbackModel(
  fallbackModels: FallbackModelObject[],
  attemptCount: number
): { model: FallbackModelObject | null; shouldUseMain: boolean } {
  if (fallbackModels.length === 0) {
    return { model: null, shouldUseMain: true }
  }
  
  if (attemptCount === 1) {
    return { model: fallbackModels[0], shouldUseMain: false }
  }
  
  if (attemptCount === 2) {
    return { model: null, shouldUseMain: true }
  }
  
  if (attemptCount === 3) {
    return { model: fallbackModels[0], shouldUseMain: false }
  }
  
  const fallbackIndex = attemptCount - 3
  if (fallbackIndex < fallbackModels.length) {
    return { model: fallbackModels[fallbackIndex], shouldUseMain: false }
  }
  
  return { model: fallbackModels[fallbackModels.length - 1], shouldUseMain: false }
}

// Create fallback notice message to be shown in chat
function createFallbackNoticeParts(
  originalParts: Array<{ type: "text"; text: string } | { type: "file"; mime: string; filename?: string; url: string } | { type: "agent"; name: string }>,
  reason: string,
  fromModel: string,
  toModel: string | FallbackModelObject,
  attemptCount: number
): Array<{ type: "text"; text: string } | { type: "file"; mime: string; filename?: string; url: string } | { type: "agent"; name: string }> {
  
  const toModelStr = typeof toModel === "string" 
    ? toModel 
    : `${toModel.providerID}/${toModel.modelID}`;
  
  const reasonShort = reason.length > 60 ? reason.substring(0, 60) + "..." : reason;
  
  const noticeText = `⚠️ **[Rate Limit Fallback]** Attempt #${attemptCount}\n` +
    `📝 **Reason**: ${reasonShort}\n` +
    `🔄 **Model Switch**: ${fromModel} → ${toModelStr}\n` +
    `⏱️ **Time**: ${new Date().toLocaleString()}\n` +
    `---\n\n`;
  
  const newParts = [...originalParts];
  const firstTextIndex = newParts.findIndex(p => p.type === "text");
  
  if (firstTextIndex >= 0) {
    const firstText = newParts[firstTextIndex] as { type: "text"; text: string };
    newParts[firstTextIndex] = {
      type: "text",
      text: noticeText + firstText.text
    };
  } else {
    newParts.unshift({ type: "text", text: noticeText });
  }
  
  return newParts;
}

function createPatternMatcher(patterns: string[]) {
  return (message: string): boolean => {
    const lower = message.toLowerCase()
    return patterns.some(pattern => lower.includes(pattern.toLowerCase()))
  }
}

export async function createPlugin(context: PluginInput): Promise<Hooks> {
  const config = loadConfig()
  const logger = createLogger(config.logging)
  const isRateLimitMessage = createPatternMatcher(config.patterns)
  const fallbackModels = normalizeFallbackModels(config.fallbackModel)

  await logger.info("Plugin initialized", {
    enabled: config.enabled,
    fallbackModel: config.fallbackModel,
    fallbackModelsCount: fallbackModels.length,
    patterns: config.patterns,
    cooldownMs: config.cooldownMs,
  })

  if (!config.enabled) {
    await logger.info("Plugin disabled via config")
    return {}
  }

  return {
    event: async ({ event }) => {
      if (event.type === "session.status") {
        const props = event.properties as {
          sessionID: string
          status: {
            type: "idle" | "retry" | "busy"
            attempt?: number
            message?: string
            next?: number
          }
        }

        if (props.status.type === "retry" && props.status.message) {
          if (isRateLimitMessage(props.status.message)) {
            const sessionID = props.sessionID
            let state = sessionStates.get(sessionID)

            if (state?.fallbackActive && Date.now() < state.cooldownEndTime) {
              await logger.info("Skipping fallback, cooldown active", {
                sessionID,
                cooldownRemaining: state.cooldownEndTime - Date.now(),
              })
              return
            }

            // Initialize or increment attempt count
            if (!state) {
              state = {
                fallbackActive: true,
                cooldownEndTime: Date.now() + config.cooldownMs,
                attemptCount: 1,
              }
              sessionStates.set(sessionID, state)
            } else {
              state.attemptCount += 1
              state.fallbackActive = true
              state.cooldownEndTime = Date.now() + config.cooldownMs
            }

            const { model: nextModel, shouldUseMain } = getNextFallbackModel(
              fallbackModels,
              state.attemptCount
            )

            await logger.info("Rate limit detected, switching to fallback", {
              sessionID,
              message: props.status.message,
              attemptCount: state.attemptCount,
              shouldUseMain,
              nextModel: shouldUseMain ? "main" : nextModel,
            })

            try {
              await logger.info("Aborting session", { sessionID })
              await context.client.session.abort({ path: { id: sessionID } })
              await new Promise(resolve => setTimeout(resolve, 200))

              await logger.info("Fetching messages", { sessionID })
              const messagesResponse = await context.client.session.messages({ path: { id: sessionID } })
              const messages = messagesResponse.data as MessageWithParts[] | undefined

              if (!messages || messages.length === 0) {
                await logger.error("No messages found in session", { sessionID })
                return
              }

              const lastUserMessage = [...messages].reverse().find(m => m.info.role === "user")
              if (!lastUserMessage) {
                await logger.error("No user message found in session", { sessionID })
                return
              }

              // Track current model information
              const originalModel = lastUserMessage.info.model 
                ? `${lastUserMessage.info.model.providerID}/${lastUserMessage.info.model.modelID}`
                : "main";
              
              const targetModel = shouldUseMain ? "main" : 
                (nextModel ? `${nextModel.providerID}/${nextModel.modelID}` : "unknown");

              // Store model info
              let modelInfo = sessionModelInfo.get(sessionID);
              if (!modelInfo) {
                modelInfo = {
                  originalModel,
                  currentModel: targetModel,
                  fallbackHistory: []
                };
              }
              modelInfo.currentModel = targetModel;
              modelInfo.fallbackHistory.push({
                timestamp: Date.now(),
                from: originalModel,
                to: targetModel,
                reason: props.status.message || "rate limit"
              });
              sessionModelInfo.set(sessionID, modelInfo);

              await logger.info("Found last user message", {
                sessionID,
                messageId: lastUserMessage.info.id,
                totalMessages: messages.length,
                originalModel,
                targetModel,
              })

              await logger.info("Reverting session", { sessionID, messageId: lastUserMessage.info.id })
              const revertResponse = await context.client.session.revert({
                path: { id: sessionID },
                body: { messageID: lastUserMessage.info.id },
              })
              await logger.info("Revert completed", {
                sessionID,
                revertStatus: revertResponse.response?.status,
              })
              await new Promise(resolve => setTimeout(resolve, 500))

              const originalParts = lastUserMessage.parts
                .filter(p => !isSyntheticPart(p))
                .map(p => convertToPromptPart(p))
                .filter((p): p is NonNullable<typeof p> => p !== null)

              if (originalParts.length === 0) {
                await logger.error("No valid parts found in user message", { sessionID })
                return
              }

              // Create parts with fallback notice
              const partsWithNotice = createFallbackNoticeParts(
                originalParts,
                props.status.message || "rate limit",
                originalModel,
                shouldUseMain ? "main" : nextModel!,
                state.attemptCount
              );

              await logger.info("Sending prompt with fallback model and notice", {
                sessionID,
                originalModel,
                targetModel,
                attemptCount: state.attemptCount,
              })
              
              const promptBody: PromptBody = {
                agent: lastUserMessage.info.agent,
                parts: partsWithNotice,
              }
              
              if (!shouldUseMain && nextModel) {
                promptBody.model = nextModel
              }
              
              await context.client.session.prompt({
                path: { id: sessionID },
                body: promptBody,
              })

              await logger.info("Fallback prompt sent successfully", { sessionID })
            } catch (err) {
              await logger.error("Failed to send fallback prompt", {
                sessionID,
                error: err instanceof Error ? err.message : String(err),
              })
            }
          }
        }

        if (props.status.type === "idle") {
          const sessionID = props.sessionID
          const state = sessionStates.get(sessionID)
          if (state && state.fallbackActive && Date.now() >= state.cooldownEndTime) {
            state.fallbackActive = false
            state.attemptCount = 0
            await logger.info("Cooldown expired, fallback reset", { sessionID })
          }
        }
      }

      if (event.type === "session.deleted") {
        const props = event.properties as { info?: { id?: string } }
        if (props.info?.id) {
          sessionStates.delete(props.info.id)
          sessionModelInfo.delete(props.info.id)
          await logger.info("Session cleaned up", { sessionID: props.info.id })
        }
      }
    },
  }
}

function isSyntheticPart(part: MessagePart): boolean {
  return (part as any).synthetic === true
}

function convertToPromptPart(part: MessagePart): { type: "text"; text: string } | { type: "file"; mime: string; filename?: string; url: string } | { type: "agent"; name: string } | null {
  switch (part.type) {
    case "text":
      if (part.text) {
        return { type: "text", text: part.text }
      }
      return null
    case "file":
      if (part.url && part.mime) {
        return { type: "file", mime: part.mime, filename: part.filename, url: part.url }
      }
      return null
    case "agent":
      if (part.name) {
        return { type: "agent", name: part.name }
      }
      return null
    default:
      return null
  }
}
