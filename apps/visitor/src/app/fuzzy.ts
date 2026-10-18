/**
 * Forgiving search for first-time visitors: they don't know a room's exact name, how it is
 * spelled, or where the spaces go. "liberary", "xray", "comp lab", "washroom", "g3",
 * "second floor office" all find something sensible. Plain code, no library.
 *
 * A query is split into words; each word scores against the words of a place:
 *   exact 1 · start of a word 0.9 · inside a word 0.75 · one or two typos 0.7–0.6 ·
 *   a known synonym ("washroom" → toilet, "canteen" → food) 0.85 × that match.
 * The place's score is the average over the query's words (most words must match),
 * and the whole query without spaces is also tried against the name ("xray" ≈ "X-Ray").
 */

/** "X-Ray (Room G04)" → "x ray room g04". Accents and punctuation go. */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** No spaces, and no leading zeros in numbers: "G-03" and "g 3" both become "g3". */
export function squash(text: string): string {
  return normalize(text)
    .replace(/ /g, '')
    .replace(/(^|\D)0+(\d)/g, '$1$2');
}

/** Words that mean the same thing to a visitor (Indian campuses and hospitals). */
const GROUPS = [
  'toilet toilets washroom washrooms restroom bathroom loo wc lavatory urinal',
  'canteen cafeteria cafe mess food court dining eat lunch snacks tea coffee',
  'lab labs laboratory',
  'library lib books reading',
  'office cabin chamber',
  'hod head',
  'principal director dean',
  'admission admissions enquiry inquiry',
  'fee fees accounts cash billing payment cashier',
  'xray radiology scan ct mri',
  'doctor opd clinic consultation',
  'medical dispensary hospital health firstaid',
  'emergency casualty trauma accident',
  'pharmacy chemist medicine medicines',
  'computer cse it',
  'electronics ece',
  'mechanical mech me',
  'civil ce',
  'hostel hostels',
  'lift elevator',
  'stairs staircase steps',
  'exam exams examination',
  'reception help desk information info',
  'class classroom classrooms lecture',
  'auditorium seminar',
  'atm bank',
  'water drinking cooler',
  'parking park',
  'gym fitness sports',
  'ward wards bed admit',
  'gate entrance entry',
  'ground g',
  'first 1st one 1',
  'second 2nd two 2',
  'third 3rd three 3',
].map((group) => group.split(' '));

/** Edit distance with swaps counting as one ("libary", "liberary", "radiolgy"); stops past `max`. */
export function typos(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let low = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min((prev[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        v = Math.min(v, (prev2[j - 2] ?? 0) + 1);
      row.push(v);
      low = Math.min(low, v);
    }
    if (low > max) return max + 1;
    prev2 = prev;
    prev = row;
  }
  return prev[b.length] ?? max + 1;
}

/** How well one typed word matches the best of `words` (0 = not at all). */
function wordScore(q: string, words: readonly string[]): number {
  let best = 0;
  const allowed = q.length >= 7 ? 2 : q.length >= 4 ? 1 : 0;
  for (const w of words) {
    if (w === q) return 1;
    if (q.length >= 2 && w.startsWith(q)) best = Math.max(best, 0.9);
    else if (q.length >= 3 && w.includes(q)) best = Math.max(best, 0.75);
    else if (allowed > 0) {
      const d = typos(q, w, allowed);
      if (d <= allowed) best = Math.max(best, d === 1 ? 0.7 : 0.6);
      // A half-typed word with a typo: "comptr" → "computer".
      else if (w.length > q.length && typos(q, w.slice(0, q.length), 1) <= 1)
        best = Math.max(best, 0.6);
    }
  }
  return best;
}

/** The typed word, or a word that means the same, against the place's words. */
function withSynonyms(q: string, words: readonly string[]): number {
  let best = wordScore(q, words);
  if (best === 1) return best;
  for (const group of GROUPS) {
    if (!group.some((g) => g === q || (q.length >= 5 && typos(q, g, 1) <= 1))) continue;
    for (const g of group) {
      if (g !== q && words.includes(g)) best = Math.max(best, 0.85);
    }
  }
  return best;
}

/**
 * Score of `query` against a place described by `texts` (name, number, kind, building,
 * floor…): 0 = no match, up to 1. Most of the typed words must match something.
 */
export function matchScore(query: string, texts: readonly string[]): number {
  const q = normalize(query);
  if (!q) return 0;
  // Each text's words, plus the text without spaces or leading zeros ("G-03" → "g3").
  const words = [
    ...new Set(texts.flatMap((t) => [...normalize(t).split(' '), squash(t)]).filter(Boolean)),
  ];
  const qWords = q.split(' ');
  const scores = qWords.map((w) => withSynonyms(w, words));
  const matched = scores.filter((s) => s > 0).length;
  let score =
    matched / qWords.length >= 0.6 ? scores.reduce((a, b) => a + b, 0) / qWords.length : 0;
  // Spaces typed differently: "xray" / "x ray" / "comp lab" against the whole name.
  const whole = squash(query);
  if (whole.length >= 3) {
    for (const t of texts) {
      const s = squash(t);
      if (s === whole) score = Math.max(score, 1);
      else if (s.includes(whole)) score = Math.max(score, 0.9);
    }
  }
  return score;
}
