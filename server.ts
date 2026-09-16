import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

// Load environment variables in development
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // JSON request body parser
  app.use(express.json());

  // Health check endpoint
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Diagnostic Endpoint using Google GenAI
  app.post("/api/diagnose", async (req, res): Promise<any> => {
    try {
      const {
        rpm,
        coolantTemp,
        speed,
        dtcCodes = [],
        carModel = "Bilinmeyen Araç",
        customDtcInput = "",
        userApiKey
      } = req.body;

      // Select API Key: custom key from client, or system env key
      const apiKey = (userApiKey && userApiKey.trim().length > 0) 
        ? userApiKey.trim() 
        : process.env.GEMINI_API_KEY;

      if (!apiKey) {
        return res.status(400).json({
          error: "Gemini API anahtarı bulunamadı. Lütfen Ayarlar panelinden bir API anahtarı girin veya sistem yöneticisinden sunucu anahtarını tanımlamasını isteyin."
        });
      }

      // Initialize Google GenAI with appropriate telemetry header
      const ai = new GoogleGenAI({
        apiKey: apiKey,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build",
          }
        }
      });

      // Construct a professional diagnostic prompt
      const dtcString = dtcCodes.length > 0 ? dtcCodes.join(", ") : "Hata kodu yok";
      const customDtcInfo = customDtcInput ? `Kullanıcı Ek Notu/DTC: ${customDtcInput}` : "";

      const prompt = `
Aşağıdaki verilere sahip bir araç için profesyonel bir otomotiv teşhis ve arıza analiz raporu hazırla. 
Lütfen tamamen Türkçe dilinde, anlaşılır, yapıcı ve profesyonel bir üslupla yanıt ver.

Araç Bilgisi: ${carModel}
Canlı Sensör Verileri:
- Motor Devri (RPM): ${rpm} RPM
- Soğutma Suyu Sıcaklığı: ${coolantTemp} °C
- Araç Hızı: ${speed} km/s

Okunan DTC (Arıza Teşhis Kodları): ${dtcString}
${customDtcInfo}

Rapor Şunları İçermelidir:
1. **Genel Durum Analizi**: Sensör değerlerinin (RPM, Soğutma suyu sıcaklığı, Hız) normal sınırlar içinde olup olmadığını değerlendir (Örn: Motor sıcaklığı normal mi yoksa aşırı ısınma/hararet riski var mı? Rölanti devri normal mi?).
2. **Hata Kodu (DTC) Analizi**: Eğer hata kodları varsa, bu kodların tam olarak ne anlama geldiğini (teknik açıklaması ve olası arızalı parçalar) Türkçe olarak açıkla. Yoksa, sistemin temiz olduğunu belirt.
3. **Olası Nedenler**: Mevcut hata kodları veya anormal sensör değerlerinin arkasındaki en olası fiziksel sebepleri listele (Örn: Sensör arızası, kablolama hatası, kaçaklar vb.).
4. **Çözüm ve Aksiyon Önerileri**: Kullanıcının (veya tamircinin) sırasıyla atması gereken adımları belirt. Hangi parçaların kontrol edilmesi veya değiştirilmesi gerektiğini açıkla. Sürüş güvenliği açısından risk olup olmadığını da belirt.

Lütfen çıktıyı şık bir Markdown formatında ver. Başlıklar için "##" ve kalın yazılar için "**" kullan.
`;

      const response = await ai.models.generateContent({
        model: "gemini-3.8-flash",
        contents: prompt,
      });

      const diagnosisText = response.text || "Yapay zeka analiz sonucu üretemedi.";
      
      res.json({ success: true, diagnosis: diagnosisText });
    } catch (error: any) {
      console.error("Gemini API Diagnostic Error:", error);
      res.status(500).json({
        error: error.message || "Gemini AI ile bağlantı kurulurken beklenmeyen bir hata oluştu."
      });
    }
  });

  // Serve static assets or use Vite dev server
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
