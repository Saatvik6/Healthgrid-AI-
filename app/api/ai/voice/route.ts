import { Type } from "@google/genai";
import { GeminiUnavailable, generateWithFallback } from "@/lib/gemini";
import { getFacility } from "@/lib/server/data";
import { sarvamConfigured, sarvamLanguageCode, transcribe } from "@/lib/sarvam";
import { AUTO_DETECT, speechLanguage } from "@/lib/speech-languages";

const SCHEMA = {
  type: Type.OBJECT,
  properties: {
    updates: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          field: { type: Type.STRING, enum: ["stock", "beds", "doctors", "test"] },
          medicineId: { type: Type.STRING, description: "Required when field is 'stock'; one of the listed medicine ids" },
          testName: { type: Type.STRING, description: "Required when field is 'test'" },
          value: {
            type: Type.NUMBER,
            description:
              "The NEW TOTAL after this update (for 'test': 1 available, 0 down). Compute it from the current facility state when the speaker talks in relative terms.",
          },
        },
        required: ["field", "value"],
      },
    },
    confidence: { type: Type.NUMBER, description: "0-1: how certain you are the updates match the speech" },
    transcript: { type: Type.STRING, description: "Verbatim transcript in the language spoken" },
    echo: { type: Type.STRING, description: "One-line confirmation of what will be updated, in the worker's chosen language" },
  },
  required: ["updates", "confidence", "transcript", "echo"],
};

/** Speech → structured inventory update. NO database write happens here: the
    worker always confirms on screen before anything is applied.

    Primary path: Sarvam Saaras transcribes the Indic speech, then Gemini
    parses the transcript into structured updates. If Sarvam is unconfigured
    or fails, Gemini's own audio understanding does both steps. */
export async function POST(req: Request) {
  const { audioBase64, mimeType, facilityId, lang, speechLang } = (await req.json()) as {
    audioBase64: string;
    mimeType: string;
    facilityId: string;
    lang?: string; // "Hindi" | "Marathi" | "English" — the worker's UI language
    speechLang?: string; // Sarvam code ("ta-IN") or "unknown" to auto-detect
  };
  if (!audioBase64 || !facilityId) return Response.json({ error: "audio and facilityId required" }, { status: 400 });
  // ~30s of opus audio stays well under this; longer means something is wrong.
  if (audioBase64.length > 2_000_000) return Response.json({ error: "audio too long" }, { status: 413 });

  const facility = await getFacility(facilityId);
  if (!facility) return Response.json({ error: "facility not found" }, { status: 404 });

  const systemFor = (echoLang: string) => `You convert a health worker's spoken update (any Indian language or English, often code-mixed) at ${facility.name} into structured updates.

CURRENT FACILITY STATE (use this to resolve relative statements):
Medicines (id: name — current stock): ${Object.values(facility.inventory)
    .map((i) => `${i.medicineId}: ${i.name} — ${i.currentStock} ${i.unit}`)
    .join("; ")}.
Beds: ${facility.beds.occupied} occupied of ${facility.beds.total} total.
Doctors: ${facility.staff.doctorsPresentToday} present of ${facility.staff.doctorsSanctioned} sanctioned.
Tests: ${Object.entries(facility.tests)
    .map(([n, ok]) => `${n} (${ok ? "available" : "down"})`)
    .join("; ")}.

SEMANTICS — "value" is always the NEW TOTAL after the update:
- "X left / remaining / बचा है / बचे हैं / उरले आहेत / शिल्लक" → value = X.
- "X used / consumed / given / लग गए / इस्तेमाल हुए / खर्च हुए / वापरले" → value = current stock − X (never below 0).
- "X received / arrived / आ गए / मिले / आले" → value = current stock + X.
- "all beds full / occupied / सारे बेड भर गए / सगळे बेड भरले" → field "beds", value = total beds (${facility.beds.total}).
- "X beds empty / खाली" → field "beds", value = total beds − X. "half the beds ..." → compute from total.
- "only X doctor(s) came / X डॉक्टर आए" → field "doctors", value = X. "all/both doctors present" → value = ${facility.staff.doctorsSanctioned}.
- A test/machine "not working / down / खराब" → field "test", value = 0; "working / fixed / ठीक" → value = 1.
- Number words in any language are numbers ("दस" = 10, "बीस" = 20, "पन्नास" = 50).

RULES:
- Extract EVERY distinct update in the speech — one sentence often contains several (medicines AND beds AND doctors AND tests). Missing one is an error.
- Map spoken medicine names (e.g. "ओआरएस" → ors, "पैरासिटामोल" → paracetamol) to the listed ids only. Never invent an update that was not spoken.
- Write "echo" in ${echoLang}; when you derived a value, show the arithmetic there (e.g. "Paracetamol: 80 used → 404 left").
- If the speech is not an inventory/beds/doctors/tests update, return empty updates with confidence 0. If a quantity is genuinely ambiguous, lower the confidence below 0.7.`;

  const requested = sarvamLanguageCode(speechLang ?? lang);
  let spoken = requested === AUTO_DETECT ? null : requested;

  // 1) Sarvam speech-to-text → Gemini text parsing.
  let sarvamTranscript: string | null = null;
  if (sarvamConfigured()) {
    try {
      const stt = await transcribe({
        audio: Buffer.from(audioBase64, "base64"),
        mimeType: mimeType || "audio/webm",
        languageCode: requested,
        // Bias recognition towards this facility's vocabulary.
        keyterms: [...Object.values(facility.inventory).map((i) => i.name), ...Object.keys(facility.tests)],
      });
      sarvamTranscript = stt.transcript;
      spoken = speechLanguage(stt.languageCode)?.code ?? spoken;
    } catch (e) {
      console.warn("sarvam stt failed, falling back to gemini audio:", e instanceof Error ? e.message : e);
    }
  }

  const echoLang = speechLanguage(spoken)?.english ?? "the same language the worker spoke";
  const parseConfig = {
    responseMimeType: "application/json",
    responseSchema: SCHEMA,
    systemInstruction: systemFor(echoLang),
    // Parsing doesn't need thinking, and thinking blows the latency budget.
    thinkingConfig: { thinkingBudget: 0 },
  };

  try {
    const res = await generateWithFallback({
      contents: [
        {
          role: "user",
          parts: sarvamTranscript
            ? [
                {
                  text: `Transcript of the spoken update (Sarvam speech recognition):
"""${sarvamTranscript}"""
Convert it into structured JSON. Return this transcript verbatim in "transcript".`,
                },
              ]
            : [
                { inlineData: { mimeType: mimeType || "audio/webm", data: audioBase64 } },
                { text: "Convert this spoken update into structured JSON." },
              ],
        },
      ],
      config: { ...parseConfig, abortSignal: AbortSignal.timeout(sarvamTranscript ? 30_000 : 55_000) },
    });
    const text = res.text;
    if (!text) throw new GeminiUnavailable("empty");
    const parsed = JSON.parse(text);
    if (sarvamTranscript) parsed.transcript = sarvamTranscript;
    return Response.json({ ...parsed, engine: sarvamTranscript ? "sarvam" : "gemini", languageCode: spoken });
  } catch (e) {
    console.error("voice error:", e instanceof Error ? e.message : e);
    return Response.json({ error: "Could not understand the audio. Please try again." }, { status: 502 });
  }
}
