import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export const model = "gemini-3-flash-preview";

export async function generateEssayFeedback(essayText: string) {
  const prompt = `
    You are an expert English teacher for the "Junior College to University" (专升本) exam in China.
    Analyze the following student essay:
    "${essayText}"

    Provide feedback in the following JSON format:
    {
      "score": number (0-100),
      "evaluation": "A short, objective yet encouraging paragraph in Chinese.",
      "grammarErrors": [
        {
          "original": "the exact incorrect phrase",
          "correction": "the corrected phrase",
          "explanation": "short Chinese explanation"
        }
      ],
      "vocabularyUpgrades": [
        {
          "original": "simple word",
          "upgrade": "advanced word",
          "reason": "why it's better"
        }
      ],
      "modelEssay": "A rewritten version of the essay based on the student's original ideas, but at a high-scoring level."
    }
  `;

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
    },
  });

  return JSON.parse(response.text || "{}");
}

export async function getWordDefinition(word: string) {
  const prompt = `Provide a very brief Chinese definition for the English word: "${word}". Format: { "definition": "..." }`;
  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: { responseMimeType: "application/json" },
  });
  return JSON.parse(response.text || "{}");
}
