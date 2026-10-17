// Languages a field worker can speak a voice update in — every language Sarvam
// Saaras recognises (22 scheduled Indian languages + English). `tts` marks the
// subset Sarvam Bulbul can read the confirmation back in. Client-safe.

export interface SpeechLanguage {
  code: string; // Sarvam BCP-47 code
  native: string;
  english: string;
  tts: boolean;
}

export const AUTO_DETECT = "unknown";

export const SPEECH_LANGUAGES: SpeechLanguage[] = [
  { code: "hi-IN", native: "हिन्दी", english: "Hindi", tts: true },
  { code: "mr-IN", native: "मराठी", english: "Marathi", tts: true },
  { code: "en-IN", native: "English", english: "English", tts: true },
  { code: "bn-IN", native: "বাংলা", english: "Bengali", tts: true },
  { code: "gu-IN", native: "ગુજરાતી", english: "Gujarati", tts: true },
  { code: "kn-IN", native: "ಕನ್ನಡ", english: "Kannada", tts: true },
  { code: "ml-IN", native: "മലയാളം", english: "Malayalam", tts: true },
  { code: "od-IN", native: "ଓଡ଼ିଆ", english: "Odia", tts: true },
  { code: "pa-IN", native: "ਪੰਜਾਬੀ", english: "Punjabi", tts: true },
  { code: "ta-IN", native: "தமிழ்", english: "Tamil", tts: true },
  { code: "te-IN", native: "తెలుగు", english: "Telugu", tts: true },
  { code: "as-IN", native: "অসমীয়া", english: "Assamese", tts: false },
  { code: "brx-IN", native: "बड़ो", english: "Bodo", tts: false },
  { code: "doi-IN", native: "डोगरी", english: "Dogri", tts: false },
  { code: "kok-IN", native: "कोंकणी", english: "Konkani", tts: false },
  { code: "ks-IN", native: "کٲشُر", english: "Kashmiri", tts: false },
  { code: "mai-IN", native: "मैथिली", english: "Maithili", tts: false },
  { code: "mni-IN", native: "ꯃꯤꯇꯩꯂꯣꯟ", english: "Manipuri", tts: false },
  { code: "ne-IN", native: "नेपाली", english: "Nepali", tts: false },
  { code: "sa-IN", native: "संस्कृतम्", english: "Sanskrit", tts: false },
  { code: "sat-IN", native: "ᱥᱟᱱᱛᱟᱲᱤ", english: "Santali", tts: false },
  { code: "sd-IN", native: "سنڌي", english: "Sindhi", tts: false },
  { code: "ur-IN", native: "اردو", english: "Urdu", tts: false },
];

const BY_CODE = new Map(SPEECH_LANGUAGES.map((l) => [l.code, l]));

export function speechLanguage(code: string | null | undefined): SpeechLanguage | undefined {
  return code ? BY_CODE.get(code) : undefined;
}

export function canReadBack(code: string | null | undefined): boolean {
  return speechLanguage(code)?.tts ?? false;
}
