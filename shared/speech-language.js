/**
 * Which voice should read a reply: 'hi' for Hindi or Hinglish, 'en' for English.
 * Decided once per reply (a reply is voiced in parts, and switching voice between
 * them would sound like two people).
 */

const DEVANAGARI = /[ऀ-ॿ]/;

/**
 * Everyday Hindi words that mark Latin-script Hinglish. Words that are also
 * common English ("the", "to", "do", "hi", "main") are left out on purpose.
 */
const HINDI_WORDS = new Set([
  'hai', 'hain', 'ho', 'hoga', 'hogi', 'hua', 'hui', 'gaya', 'gayi', 'gaye', 'tha', 'thi', 'raha', 'rahi', 'rahe',
  'kya', 'kyun', 'kyon', 'kab', 'kaise', 'kahan', 'kaun', 'kitna', 'kitne',
  'ka', 'ki', 'ke', 'ko', 'se', 'mein', 'par', 'pe', 'tak', 'liye', 'wala', 'wali', 'wale',
  'aur', 'ya', 'bhi', 'toh', 'lekin', 'magar', 'phir', 'abhi', 'jab', 'agar',
  'mai', 'mera', 'meri', 'mere', 'aap', 'aapka', 'aapki', 'aapke', 'hum', 'hamara', 'tum', 'tumhara',
  'ye', 'yeh', 'woh', 'wo', 'isko', 'usko', 'iska', 'uska', 'inka', 'unka', 'yahan', 'wahan',
  'kar', 'karo', 'karna', 'karke', 'kiya', 'kiye', 'karunga', 'karenge', 'dijiye', 'dena', 'diya', 'liya',
  'nahi', 'nahin', 'haan', 'han', 'ji', 'theek', 'thik', 'achha', 'acha', 'accha', 'sakta', 'sakte', 'sakti', 'chahiye',
  'bata', 'batao', 'bataiye', 'dekho', 'dekhiye', 'sab', 'kuch', 'koi', 'bahut', 'zyada', 'naya', 'nayi',
]);

/** Share of Hindi words above which a Latin-script reply is Hinglish. */
const HINGLISH_SHARE = 0.2;

/** @param {string} text @returns {'hi' | 'en'} */
export function speechLanguage(text) {
  const value = String(text || '');
  if (DEVANAGARI.test(value)) return 'hi';
  const words = value.toLowerCase().match(/[a-z]+/g) || [];
  if (!words.length) return 'en';
  const hindi = words.filter((word) => HINDI_WORDS.has(word)).length;
  // A lone match proves nothing ("par" in "on par"); Hinglish has several.
  return hindi >= 2 && hindi / words.length >= HINGLISH_SHARE ? 'hi' : 'en';
}
