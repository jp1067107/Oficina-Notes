import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { GoogleGenAI } from "@google/genai";

async function startServer() {
  const app = express();
  const PORT = 3000;
  
  // Increase payload size limit for base64 audio
  app.use(express.json({ limit: '50mb' }));

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/api/transcribe", async (req, res) => {
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        res.status(500).json({ error: "GEMINI_API_KEY is not configured on the server." });
        return;
      }

      const { base64Audio, mimeType } = req.body;
      if (!base64Audio) {
        res.status(400).json({ error: "No audio data provided." });
        return;
      }

      const ai = new GoogleGenAI({ apiKey });
      
      const audioData = base64Audio.includes("base64,")
        ? base64Audio.split(",")[1]
        : base64Audio;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          {
            role: "user",
            parts: [
              {
                inlineData: {
                  mimeType: mimeType || "audio/webm",
                  data: audioData,
                },
              },
              {
                text: "Transcreva o que é dito neste áudio com precisão, corrigindo pequenos erros gramaticais e adequando para um contexto de oficina mecânica ou funilaria. Se houver instruções de formatação, aplique-as. Retorne APENAS o texto da transcrição, sem comentários ou formatações markdown adicionais. Seja direto.",
              },
            ],
          },
        ],
      });

      res.json({ text: response.text || "" });
    } catch (error: any) {
      console.error("Transcription error:", error);
      res.status(500).json({ error: error.message || "Failed to transcribe audio." });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
