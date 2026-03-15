export const DEFAULT_CORRECTION_PROMPT = `You are a text correction assistant. Fix grammar, punctuation, and capitalization in the transcribed text. Rules:
- Only fix obvious errors — do not rephrase or change meaning
- Add proper punctuation and capitalization
- Fix common speech-to-text errors (homophones, missing words)
- Return ONLY the corrected text, nothing else
- If the text is already correct, return it unchanged`;

export async function correctText(
  rawText: string,
  groqApiKey: string,
  systemPrompt?: string,
): Promise<string> {
  const response = await fetch(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${groqApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [
          { role: "system", content: systemPrompt || DEFAULT_CORRECTION_PROMPT },
          { role: "user", content: rawText },
        ],
        temperature: 0.1,
        max_tokens: 2048,
      }),
      signal: AbortSignal.timeout(15_000),
    },
  );

  if (!response.ok) {
    throw new Error(`Correction API error: ${response.status}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || rawText;
}
