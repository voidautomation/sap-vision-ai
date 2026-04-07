require("dotenv").config(); 
const express = require("express");
const path = require("path");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const puppeteer = require("puppeteer");
const { marked } = require("marked");

const app = express();

app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));

// ─── AI Prompting Logic (One-Shot) ─────────────────────────────────────────────
async function getSapSolution(messageText, imageBase64, retryCount = 0) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("API Key is missing in .env file.");

    const genAI = new GoogleGenerativeAI(apiKey);
    
    // Using 'gemini-1.5-flash' is standard, but some SDKs prefer the explicit version
    const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" })

    let systemInstruction = `
    You are an Elite Level 3 SAP Basis and Functional Architect. 
    Provide a detailed, step-by-step resolution guide in Markdown.
    The first line MUST be a Level 1 Heading Title (e.g., # Title).
    `;

    const requestParts = [{ text: systemInstruction }];
    if (messageText) requestParts.push({ text: `User Issue: ${messageText}` });
    
    if (imageBase64) {
        const mimeType = imageBase64.substring(imageBase64.indexOf(":") + 1, imageBase64.indexOf(";"));
        const base64Data = imageBase64.substring(imageBase64.indexOf(",") + 1);
        requestParts.push({ inlineData: { data: base64Data, mimeType: mimeType } });
    }

    try {
        const result = await model.generateContent(requestParts);
        return result.response.text();
    } catch (err) {
        // If 1.5-flash still gives a 404, fallback to gemini-pro (the most universal string)
        if (err.message.includes("404") || err.message.includes("not found")) {
            console.log("Model not found. Trying universal fallback...");
            const fallbackModel = genAI.getGenerativeModel({ model: "gemini-pro" });
            const result = await fallbackModel.generateContent(requestParts);
            return result.response.text();
        }
        throw err;
    }
}
// ─── API Routes ───────────────────────────────────────────────────────────────
app.post("/solve", async (req, res) => {
    const { message, image } = req.body;
    if (!message && !image) return res.status(400).json({ error: "Please provide an error description or screenshot." });

    try {
        const solution = await getSapSolution(message, image);
        res.json({ solution: solution });
    } catch (err) {
        res.status(500).json({ error: err.message || "Failed to generate a solution." });
    }
});

// PDF Generator Route with AI-Style Typography
app.post("/generate-pdf", async (req, res) => {
    const { markdownData, title } = req.body;
    if (!markdownData) return res.status(400).json({ error: "No data provided for PDF." });

    const pdfTitle = title || "SAP Resolution Report";
    const safeFilename = pdfTitle.replace(/[^a-zA-Z0-9]/g, '_');

    try {
        const htmlContent = marked.parse(markdownData);
        const pdfHtmlTemplate = `
        <!DOCTYPE html><html><head>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
        <style>
            body { font-family: 'Inter', -apple-system, sans-serif; padding: 30px; color: #202124; line-height: 1.7; }
            .header { text-align: center; border-bottom: 1px solid #dadce0; padding-bottom: 20px; margin-bottom: 30px; }
            .header h1 { color: #202124; margin: 0; font-size: 26px; font-weight: 600; }
            .header p { color: #5f6368; margin: 8px 0 0 0; font-size: 13px; }
            
            /* AI Typography Styles */
            h1 { font-size: 22px; color: #202124; border-bottom: 1px solid #dadce0; padding-bottom: 8px; margin-top: 30px; font-weight: 600; }
            h2 { font-size: 18px; color: #1a73e8; margin-top: 24px; margin-bottom: 12px; font-weight: 600; }
            p, li { font-size: 15px; line-height: 1.7; color: #3c4043; margin-bottom: 14px; }
            strong { color: #202124; font-weight: 600; }
            code { background-color: #f1f3f4; padding: 3px 6px; border-radius: 4px; color: #d93025; font-family: 'Courier New', monospace; font-size: 13px; }
            pre { background-color: #202124; color: #f8f9fa; padding: 16px; border-radius: 8px; overflow-x: auto; }
            pre code { background-color: transparent; color: inherit; padding: 0; }
            .uploaded-img { max-width: 100%; border-radius: 8px; margin-top: 16px; border: 1px solid #dadce0; }
        </style></head><body>
            <div class="header">
                <h1>🛡️ ${pdfTitle}</h1>
                <p>Resolution Report &mdash; ${new Date().toLocaleDateString()}</p>
            </div>
            ${htmlContent}
        </body></html>`;

        const browser = await puppeteer.launch({ headless: "new" });
        const page = await browser.newPage();
        await page.setContent(pdfHtmlTemplate, { waitUntil: 'networkidle0' });
        const pdfBuffer = await page.pdf({ format: 'A4', margin: { top: '0.8in', bottom: '0.8in', left: '0.8in', right: '0.8in' } });
        await browser.close();
        
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=${safeFilename}.pdf`);
        res.send(pdfBuffer);
    } catch (err) {
        res.status(500).json({ error: "Failed to generate PDF." });
    }
});

const PORT = 3000;
app.listen(PORT, () => console.log(`🚀 Spotlight AI running securely at http://localhost:${PORT}`));