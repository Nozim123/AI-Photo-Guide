
import { GoogleGenAI, Type, Modality } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

/**
 * Identify a landmark from an image using gemini-3-pro-preview
 */
export async function identifyLandmark(base64Image: string) {
  const imagePart = {
    inlineData: {
      mimeType: 'image/jpeg',
      data: base64Image.split(',')[1] || base64Image,
    },
  };

  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: {
      parts: [
        imagePart,
        { text: "Identify the landmark in this image. If it's not a specific landmark, describe the place. Provide the result in JSON format with 'name', 'description', 'location', and approximate GPS 'latitude' and 'longitude' if known." }
      ]
    },
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          description: { type: Type.STRING },
          location: { type: Type.STRING },
          latitude: { type: Type.NUMBER },
          longitude: { type: Type.NUMBER },
        },
        required: ["name", "description"]
      }
    }
  });

  return JSON.parse(response.text);
}

/**
 * Identify a landmark by name using text-only prompt
 */
export async function searchLandmarkByName(name: string) {
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `Find information about the landmark "${name}". Provide the result in JSON format with 'name', 'description', 'location', and approximate GPS 'latitude' and 'longitude' if known.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          description: { type: Type.STRING },
          location: { type: Type.STRING },
          latitude: { type: Type.NUMBER },
          longitude: { type: Type.NUMBER },
        },
        required: ["name", "description"]
      }
    }
  });

  return JSON.parse(response.text);
}

/**
 * Fetch detailed history using Search Grounding with gemini-3-flash-preview
 */
export async function getLandmarkHistory(landmarkName: string) {
  const prompt = `Provide a comprehensive history and interesting facts about the landmark: ${landmarkName}. 
  Organize the content into clear sections using Markdown headers (##) for different eras or themes (e.g., Origins, Construction, Cultural Impact, Modern Day).
  Use Google Search to ensure accuracy.`;

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: prompt,
    config: {
      tools: [{ googleSearch: {} }],
    },
  });

  const sources = response.candidates?.[0]?.groundingMetadata?.groundingChunks?.map((chunk: any) => ({
    title: chunk.web?.title || 'Source',
    uri: chunk.web?.uri || '',
  })).filter((s: any) => s.uri) || [];

  return {
    text: response.text,
    sources
  };
}

/**
 * Suggest related landmarks based on theme or location
 */
export async function getRelatedLandmarks(landmarkName: string, location: string) {
  const prompt = `Based on the landmark "${landmarkName}" in "${location}", suggest 2-3 other related landmarks or historical sites that a visitor would find interesting. For each, provide the name and a brief one-sentence reason why it is related (e.g., same architect, similar historical era, nearby location). Return as a JSON array of objects with 'name' and 'reason'.`;

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING },
            reason: { type: Type.STRING },
          },
          required: ["name", "reason"]
        }
      }
    }
  });

  return JSON.parse(response.text);
}

/**
 * Generate an AI reimagining of the landmark.
 * Supports 'cinematic' (default) or 'abstract' styles.
 */
export async function generateLandmarkImage(landmarkName: string, style: 'cinematic' | 'abstract' = 'cinematic'): Promise<string> {
  const prompt = style === 'abstract' 
    ? `An abstract, artistic, and stylized digital painting of ${landmarkName}. Use vibrant neon colors, geometric patterns, and dreamlike atmosphere. High-end museum art style, 8k, majestic.`
    : `A cinematic, highly detailed wide-angle architectural photograph of ${landmarkName} during the golden hour. Professional lighting, 8k resolution, majestic atmosphere.`;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash-image',
    contents: {
      parts: [{ text: prompt }],
    },
    config: {
      imageConfig: {
        aspectRatio: "16:9",
      },
    },
  });

  for (const part of response.candidates[0].content.parts) {
    if (part.inlineData) {
      return `data:image/png;base64,${part.inlineData.data}`;
    }
  }
  throw new Error("Failed to generate image");
}

/**
 * Generate TTS narration using gemini-2.5-flash-preview-tts
 */
export async function generateNarration(text: string): Promise<string> {
  const scriptPrompt = `Summarize this history into a 30-second immersive tour guide narration. Be charismatic and engaging: ${text}`;
  
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: [{ parts: [{ text: scriptPrompt }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: 'Kore' },
        },
      },
    },
  });

  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!base64Audio) throw new Error("No audio data received from TTS");
  
  return base64Audio;
}
