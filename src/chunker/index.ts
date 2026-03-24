export interface QAChunk {
  question: string;
  answer: string;
}

interface TranscriptLine {
  type: string;
  message?: {
    content: string | Array<{ type: string; text?: string }>;
  };
}

function extractText(content: string | Array<{ type: string; text?: string }>): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter((block) => block.type === "text" && typeof block.text === "string")
      .map((block) => block.text!)
      .join("\n");
  }
  return "";
}

export function chunkTranscript(jsonlContent: string): QAChunk[] {
  const lines = jsonlContent.split("\n");

  // Parse lines into typed messages, skipping system and parse errors
  const messages: Array<{ role: "human" | "assistant"; text: string }> = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let parsed: TranscriptLine;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue; // skip malformed JSON
    }

    if (parsed.type === "system" || !parsed.message?.content) continue;

    if (parsed.type === "human" || parsed.type === "assistant") {
      const text = extractText(parsed.message.content);
      if (text.trim()) {
        messages.push({ role: parsed.type, text: text.trim() });
      }
    }
  }

  // Build Q&A pairs: merge consecutive humans, pair with next assistant
  const chunks: QAChunk[] = [];
  let i = 0;

  while (i < messages.length) {
    // Collect consecutive human messages as the question
    if (messages[i].role !== "human") {
      i++;
      continue;
    }

    const questionParts: string[] = [];
    while (i < messages.length && messages[i].role === "human") {
      questionParts.push(messages[i].text);
      i++;
    }

    // Collect the next assistant message as the answer
    if (i < messages.length && messages[i].role === "assistant") {
      const question = questionParts.join("\n");
      const answer = messages[i].text;
      if (question && answer) {
        chunks.push({ question, answer });
      }
      i++;
    }
    // If no assistant follows, the question is discarded (empty A)
  }

  return chunks;
}
