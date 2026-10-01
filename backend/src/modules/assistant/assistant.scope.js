/*
 * What the assistant will and won't talk about, checked in code.
 *
 * The assistant only helps with this app: tickets, projects, teams, people,
 * navigation, filters, notifications, reports and how to use it. Drafting a
 * ticket or comment is app work, even with a short error or code snippet in it.
 *
 * Four checks, all deterministic and free:
 *   - checkScope: the user's message, before any model call. Obvious essays,
 *     stories, homework, general coding, jokes, trivia and jailbreak phrasing
 *     get a fixed refusal and never reach the model.
 *   - checkReply / draftInScope: what the model wrote (its reply, and the text
 *     it put in a draft card). An essay, poem or code dump is replaced with the
 *     refusal. The user's own pasted logs or code in a draft don't count.
 *   - sanitizeHistory: the browser sends the whole conversation, so earlier
 *     turns can be forged. Off-scope turns and assistant turns that claim a
 *     wider role are dropped before the model sees them.
 *   - speechAllowed: read-aloud speaks a recent reply or one of the widget's
 *     fixed confirmation lines, nothing else.
 *
 * These are phrase lists and shape checks, so a paraphrase can still reach the
 * model ("I need a 1000 word piece on the monsoon" is caught; "explain quantum
 * computing" is not). The system prompt's refusal policy is the second layer,
 * and checkReply catches long output if both miss. Closing the paraphrase gap
 * fully would take a model classifier call per message.
 */

export const SCOPE_REFUSAL = 'I can only help with this app: tickets, projects, teams, people, reports and how to use it. '
  + 'What would you like to do with your tickets?';

/** The longest text read aloud that the server did not just send as a reply (the app's own short confirmations). */
export const MAX_UNSEEN_SPEECH_CHARS = 200;

const ID = '[A-Z][A-Z0-9]{1,9}-\\d+';
/** A person, team, client or project name: only spoken when a recent draft carried it (speechAllowed). */
const NAME = '(?<name>[^.!?\\n]{1,60})';
const TARGET = `(?:${ID}|\\d+ tickets)`;
/** What the assistant widget says itself after a card is confirmed or dismissed (applyAction, resolveDraft, send). */
const WIDGET_LINES = [
  `Created ${ID}\\.`,
  `Created project ${NAME} \\([A-Z][A-Z0-9]{1,9}\\)\\.`,
  `Created (?:team|client) ${NAME}\\.`,
  `Updated the brand for ${NAME}\\.`,
  `Posted on ${ID}\\.`,
  `Attached \\d+ files? to ${ID}\\.`,
  'Restored the default notification settings\\.',
  'Updated your notification settings\\.',
  `Assigned ${TARGET} to ${NAME}\\.`,
  `Unassigned ${TARGET}\\.`,
  `Moved ${TARGET} to [A-Za-z ]{2,40}\\.`,
  `Marked ${ID} blocked\\.`,
  `Cleared blocked on ${ID}\\.`,
  `Updated ${ID}\\.`,
  'Cancelled\\.',
  'Review the draft below\\.',
  'Sorry, I don\'t have an answer for that\\.',
  'That didn\'t work\\. Try again\\.',
].map((line) => new RegExp(`^${line}$`));

const widgetMatch = (text) => {
  const said = String(text ?? '').trim();
  return WIDGET_LINES.map((line) => line.exec(said)).find(Boolean) ?? null;
};

/** Whether text is one of the widget's own fixed lines, which the server never sent or signed. */
export const isWidgetLine = (text) => Boolean(widgetMatch(text));

/** The names a confirmed card's widget line may say, from the drafts the server just sent. */
export function namesIn(actions = []) {
  return actions.flatMap((action) => {
    switch (action.type) {
      case 'assign': return [action.assigneeName];
      case 'create_project':
      case 'create_team': return [action.body?.name];
      case 'client_brand': return [action.name];
      default: return [];
    }
  }).filter((name) => typeof name === 'string' && name);
}

/**
 * Address params the app's pages read (ticket-list-query.js and each list page).
 * Anything else in the browser's address is dropped before the model sees it.
 */
const PAGE_PARAMS = new Set([
  'q', 'status', 'priority', 'category', 'severity', 'scope', 'assignedTo', 'module', 'environment', 'label',
  'blocked', 'overdue', 'reopened', 'newReply', 'view', 'sortBy', 'limit', 'page', 'ticket', 'tab', 'mine',
  'search', 'role', 'unread', 'trendGroupBy', 'deliveryGroupBy', 'windowDays', 'dimension', 'action',
  'clientId', 'actorId', 'targetUserId',
]);
/** Params that hold what someone typed (a search, a module or label name, an audit action). */
const FREE_TEXT_PARAMS = new Set(['q', 'search', 'module', 'label', 'action']);
const PLAIN_VALUE = /^[\w.,:-]{0,40}$/;

/**
 * Where the user is, made safe to describe to the model. The browser sends it,
 * and anyone can send a colleague a link with any address, so it is untrusted
 * text: only known params survive, values that aren't free text must be plain
 * tokens, free text is capped and scope-checked, and a path that reads as an
 * instruction becomes "/".
 * ponytail: a 100-character free-text value can still carry a paraphrased
 * instruction; it reaches the model as quoted data, like ticket text does.
 */
export function safePage(page) {
  if (!page) return page;
  const kept = new URLSearchParams();
  for (const [key, raw] of new URLSearchParams(page.query || '')) {
    const value = FREE_TEXT_PARAMS.has(key) ? raw.slice(0, 100) : raw;
    const ok = FREE_TEXT_PARAMS.has(key) ? !value.trim() || checkScope(value).allowed : PLAIN_VALUE.test(value);
    if (PAGE_PARAMS.has(key) && !kept.has(key) && ok) kept.set(key, value);
  }
  const words = page.path.replace(/[-_/]+/g, ' ').trim();
  return {
    ...page,
    path: !words || checkScope(words).allowed ? page.path : '/',
    query: kept.size ? `?${kept}` : '',
  };
}

const INVISIBLE = /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u206A-\u206F\uFEFF]/g;

/** Latin look-alikes from Cyrillic and Greek; users write English, Hindi or Hinglish, so these are only ever disguise. */
const LOOKALIKES = {
  а: 'a', в: 'b', е: 'e', ё: 'e', к: 'k', м: 'm', н: 'h', о: 'o', р: 'p', с: 'c', т: 't', у: 'y', х: 'x', і: 'i', ї: 'i', ј: 'j', ѕ: 's', ԁ: 'd', ԛ: 'q', ԝ: 'w', ɡ: 'g',
  α: 'a', β: 'b', ε: 'e', η: 'n', ι: 'i', κ: 'k', ν: 'v', ο: 'o', ρ: 'p', τ: 't', υ: 'u', χ: 'x', ω: 'w',
};
const LOOKALIKE = new RegExp(`[${Object.keys(LOOKALIKES).join('')}]`, 'g');

/** Lower case, no invisible characters or look-alikes, single spaces; newlines kept for the role-header check. */
function normalise(text) {
  return String(text ?? '')
    .normalize('NFKC')
    .replace(INVISIBLE, '')
    .toLowerCase()
    .replace(LOOKALIKE, (char) => LOOKALIKES[char])
    .replace(/[\u2018\u2019\u02BC`]/g, '\'')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n[\n ]*/g, '\n')
    .trim();
}

/** "e s s a y", "e.s.s.a.y" and "i-g-n-o-r-e" read as the word. */
const despace = (text) => text.replace(/(?<![\p{L}\p{N}])(?:[\p{L}\p{N}][ .\-_*·]+){2,}[\p{L}\p{N}](?![\p{L}\p{N}])/gu, (run) => run.replace(/[ .\-_*·]+/g, ''));

const LEET = {
  0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's',
};
/** "h0mew0rk" and "3ssay" read as the word; only digits touching letters change. */
const unleet = (text) => text.replace(/(?<=\p{L})[013457@$]|[013457@$](?=\p{L})/gu, (char) => LEET[char]);

/** The forms of a message every check runs against. */
function variants(said) {
  const spaced = despace(said);
  return [...new Set([said, spaced, unleet(spaced)])];
}

/* ------------------------------------------------------------------ jailbreaks */

/*
 * Ticket text is full of words these could catch ("System: Windows 11", "crashes
 * on jailbroken iPhones", "not limited to", "ignore all filters"), so each
 * pattern needs the shape of an instruction aimed at the assistant, not the word.
 */
const OVERRIDE_VERB = '(?:ignore|ignoring|forget|disregard|override|bypass|circumvent)';
const QUALIFIER = '(?:all|any|your|ur|previous|prior|earlier|above|preceding|system|original|initial|these|those|every|my|pms|app|scope|safety)';
const JAILBREAK = [
  // "ignore all previous instructions", "forget your prompt", "bypass the system guardrails"
  new RegExp(`\\b${OVERRIDE_VERB}\\b(?: [\\w'-]+){0,3}? ${QUALIFIER}\\b(?: [\\w'-]+){0,3}? (?:instructions?|prompts?|guardrails?|programming|directives?|guidelines)\\b`),
  // "ignore your rules", "ignore PMS limits"; "override the stage rules" is a real admin question
  new RegExp(`\\b${OVERRIDE_VERB}\\b(?: [\\w'-]+){0,2}? ${QUALIFIER}\\b(?: [\\w'-]+){0,2}? (?:rules|limits|limitations|restrictions|polic(?:y|ies)|scope|boundaries)\\b`),
  // A bare order at the start of a sentence: "Ignore instructions."
  new RegExp(`(?:^|[.!?\\n] ?)${OVERRIDE_VERB} (?:the )?(?:instructions?|prompts?|rules|guardrails)\\b`),
  /\byou(?: are|'re| r) (?:now|no longer)\b/,
  /\b(?:from now on|henceforth|starting now),? (?:you are|you're|you will be|you'll be|act|behave|respond|pretend)\b/,
  /\b(?:act|behave|respond|reply|answer|talk|speak)(?: only| just| purely| now)? (?:as|like) (?:if you (?:are|were) )?(?:an? |the |my )?(?:unrestricted|unfiltered|uncensored|general|different|another|evil|jailbroken|dan|chatgpt|gpt|gemini|claude|llm|ai|chatbot|character|tutor|teacher|professor|poet|writer|novelist|comedian|therapist|girlfriend|boyfriend|grandma|grandmother)\b/,
  // "disregard everything before this", "forget everything you were told"; a plain "ignore that" is a correction
  /\b(?:ignore|disregard|forget)\b (?:all |everything |anything )(?:above|before|earlier|previous|prior|so far|you(?:'ve| have| were| are)? (?:been )?(?:told|given|taught|trained|programmed))\b/,
  /\b(?:ignore|disregard|forget)\b (?:what(?:ever)? )?you(?:'ve| have| were| are)? (?:been )?(?:told|given|taught|trained|programmed)\b/,
  /\b(?:ignore|disregard|forget)\b (?:all of |everything )?(?:the )?above,? and (?:say|write|tell|answer|respond|reply|do|act|print|repeat|output)\b/,
  /\bnew (?:system|developer) (?:message|prompt|instructions?|rules?|policy)\b/,
  /(?:^|\n)\s*#{1,6}\s*(?:instructions?|system|prompt|new rules?|developer)\b/,
  /\b(?:obey|listen to) me\b|\binstead of (?:your|the) (?:developer|creator|rules|instructions|system)\b/,
  /\bi(?:'m| am) (?:your|ur) (?:developer|creator|admin(?:istrator)?|owner|programmer|maker|master|operator)\b/,
  /\bpretend(?:ing)? (?:to be|you(?:'re| are)|that you|you can|you have no)\b/,
  /\brole[- ]?play/,
  /\b(?:enable|enter|activate|switch to|switch on|turn on|go into|you are in|you're in|now in)\b[^.!?\n]{0,15}\b(?:developer|dan|god|jailbreak|unrestricted|unfiltered|unlimited|general|free|sudo|debug|admin) mode\b/,
  /\b(?:dan|god|jailbreak|unrestricted|unfiltered|unlimited) mode\b|\bdo anything now\b/,
  /\bjailbreak (?:prompt|yourself|this (?:chat|bot|assistant|ai))\b|\b(?:you are|you're|be|get|now) jailbroken\b/,
  /\b(?:your|ur) (?:system |hidden |initial |original |real |full |secret )(?:prompt|instructions)\b|\b(?:your|ur) prompt\b/,
  /\b(?:reveal|show|print|repeat|output|display|leak|dump|tell|give|share|copy|what(?:'s| is| are| was| were))\b[^.!?\n]{0,20}\b(?:system|hidden|initial|original|developer|secret) (?:prompt|instructions|message)\b/,
  /\b(?:reveal|print|output|leak|dump)\b[^.!?\n]{0,10}\b(?:your|ur) (?:instructions|rules)\b/,
  /\bnew (?:instructions|rules|persona)\s*:/,
  /(?:^|\n)[ #>*_[(<|-]*(?:system|assistant)[\])>|*_ ]*: *(?:you|ignore|forget|disregard|override|from now|new |the user|as an?|sure|ok\b|okay|of course|certainly|understood|i will|i'll)/,
  /<\|?(?:im_start|im_end|system|endoftext|eot_id)\|?>|\[\/?(?:system|inst|sys)\]|<<\/?sys>>/,
  /\byou(?:'re| are)? (?:no longer|not|aren't|stop being) (?:bound|limited|restricted|constrained)\b/,
  /\bwithout (?:any )?(?:restrictions|limitations|guardrails|censorship)\b/,
  /\b(?:general[- ]purpose|general|unrestricted|uncensored) (?:ai|assistant|chatbot|llm)\b/,
  // Hinglish and Hindi: "pichle saare instructions ignore karo", "rules bhool jao", "ab tum ek general AI ho"
  /\b(?:instructions?|rules|niyam|prompt)\b[^.!?\n]{0,25}\b(?:ignore|bhool|bhul|chhod|chod|hata)\s*(?:karo|kar do|kardo|kar dijiye|jao|ja|do|dena|de)\b/,
  /\b(?:ignore|bhool|bhul|chhod)\s*(?:karo|kar do|kardo|jao|ja|do)\b[^.!?\n]{0,25}\b(?:instructions?|rules|niyam|prompt)\b/,
  /\b(?:ab|abse|ab se) (?:tum|aap|tu)\b[^.!?\n]{0,30}\b(?:general|koi bhi|kuch bhi|unrestricted|chatgpt)\b/,
  /(?:निर्देश|नियम|इंस्ट्रक्शन|प्रॉम्प्ट)[^।.!?\n]{0,25}(?:अनदेखा|भूल|इग्नोर|छोड़|हटा)/,
];

/** Letters only: catches "ig nore prev ious instruc tions" and similar that survive despace. */
const JAILBREAK_SQUASHED = [
  /(?:ignore|disregard|forget|override|bypass)(?:all|any|the|your|my)?(?:previous|prior|above|earlier|preceding|system|your|all)(?:instructions?|prompts?|rules|guidelines|directives|programming)/,
  /youarenow(?:an?)?(?:general|unrestricted|unfiltered|dan|chatgpt)/,
  /danmode|doanythingnow/,
];
const squash = (text) => unleet(text).replace(/[^\p{L}]+/gu, '');

function isJailbreak(said) {
  return variants(said).some((form) => JAILBREAK.some((pattern) => pattern.test(form)))
    || JAILBREAK_SQUASHED.some((pattern) => pattern.test(squash(said)));
}

/* ------------------------------------------------------------------ off topic */

const MAKE = '(?:write|writing|compose|draft|create|generate|make|give|produce|craft|tell|narrate|recite|need|want|finish|complete|help me (?:write|with))';
/** Words that make it ticket work, so "create a ticket: songs list is empty" is not a song request. */
const NOT_PMS_WORD = '(?!(?:tickets?|bugs?|issues?|comments?|descriptions?|titles?|reports?|cards?|drafts?|notes?|repl(?:y|ies))\\b)';
/** Creative work no ticket asks for. "Story" alone is an agile user story, so only kinds of story count. */
const CREATIVE_WORK = '(?:essays?|poems?|poetry|sonnets?|haikus?|limericks?|lyrics|raps?|verses|fairy ?tales?|novels?|novellas?|fan ?fiction|screenplays?|(?:movie|film|play|youtube|video) scripts?|scripts? for (?:a |an )?(?:movie|film|play|video|youtube|skit|reel)|cover letters?|love letters?|book reports?|jokes?|riddles?|puns?|pick-?up lines?|(?:short|bedtime|fairy|love|horror|funny|scary|kids\'?|children\'?s|romantic|moral|sci-?fi|fantasy|detective) stor(?:y|ies))';
const OTHER_LANGUAGE = '(?:french|spanish|german|italian|portuguese|russian|chinese|mandarin|japanese|korean|arabic|urdu|bengali|tamil|telugu|marathi|gujarati|punjabi|kannada|malayalam|dutch|turkish|latin|greek|hebrew|persian)';

/** Refused whatever else the message says, even "about a ticket". */
const HARD_OFF_TOPIC = [
  ['creative', new RegExp(`\\b(?:${MAKE}|pen)\\b(?: ${NOT_PMS_WORD}[\\w'-]+){0,4}? ${CREATIVE_WORK}(?![\\w-])`)],
  ['creative', /\bessay[- ]?(?:style|like|format|type|form)\b|\bin essay (?:form|format|style)\b/],
  ['general', new RegExp(`\\btranslat\\w*\\b[^.!?\\n]{0,60}\\b(?:to|into|in) ${OTHER_LANGUAGE}\\b`)],
  ['general', /\b(?:plot|synopsis|summary) of (?:the )?(?:movie|book|novel|film|show|series|play|episode)\b|\bsummari[sz]e (?:the )?(?:plot|story) of\b|\bplot of (?:harry potter|the (?:movie|book|film))\b/],
  ['creative', /\b(?:write|compose|sing|draft)(?: me| us)?(?: an?| the| some| another)? (?:\w+ )?(?:songs?|speech(?:es)?)(?![\w-])/],
  ['creative', /\b(?:tell|narrate)(?: me| us)?(?: an?| another| one more)? (?:\w+ )?stor(?:y|ies)\b/],
  ['creative', /\b(?:as|in the form of|in the style of) (?:an? )?(?:\w+ )?(?:poem|poetry|sonnet|haiku|limerick|song|rap|essay|fairy ?tale|shakespeare)\b/],
  ['creative', /\b(?:essay|poem|poetry|sonnet|haiku|limerick|lyrics|fan ?fiction|screenplay)s? (?:on|about|regarding|for my|for school|for class)\b/],
  ['creative', /\b(?:tell|say|share|know) (?:me |us )?(?:an? |some |another |one more )?(?:\w+ )?(?:jokes?|riddles?|puns?|fun facts?)\b/],
  ['homework', /\b(?:home ?work|assignments? (?:for|from) (?:my )?(?:school|college|class|university|uni|course|teacher|professor)|(?:english|hindi|history|science|maths?|physics|chemistry|biology|economics|geography|civics|literature) (?:assignment|homework|essay|exam|worksheet)s?|(?:school|college|class|university|course|uni) (?:assignment|homework|essay|exam|test|quiz|paper|worksheet)s?|exam (?:questions?|answers?|papers?)|(?:my|this|a) (?:thesis|dissertation)|solve (?:this|these|the following|my) (?:equations?|sums?|maths?|puzzles?|riddles?))\b/],
  ['code', /\b(?:leet ?code|hacker ?rank|code ?forces|code ?chef|geeks ?for ?geeks|two ?sum|fizz ?buzz|binary search tree|linked list|dynamic programming|big[- ]o notation|time complexity|coding (?:interview|challenge|problem|question)s?)\b/],
  ['code', /\b(?:fix|debug|refactor|optimi[sz]e|review|explain|convert|translate|rewrite|complete|correct|improve)\b(?: me)? (?:this|my|the following|following|below|above|attached) (?:\w+ ){0,2}(?:code|program|script|function|snippet|regex|algorithm)s?\b/],
  ['code', /\b(?:write|give|generate|build|create|send|include|paste|show)\b(?: me)?(?: the| a| an)? (?:full|complete|entire|whole|working|production[- ]ready) (?:\w+ )?(?:source code|code ?base|code|boilerplate)\b/],
  // "a ticket whose description is a complete snake game in python"; "the whole app crashes" has no lead-in
  ['code', /\b(?:is|as|be|with|containing|contains|write|writes|include|including|put|add|paste|give|generate|build)(?: me)? (?:an? |the )?(?:complete|full|entire|whole|working|functional|runnable)\b (?:[\w+#.-]+ ){0,2}(?:game|app|application|website|program|script|implementation|solution|source code|code ?base|code)s?\b/],
  ['general', /\b(?:what(?:'s| is) the (?:weather|temperature|capital|population|meaning of life)|weather (?:in|today|tomorrow|forecast)|capital (?:city )?of|who (?:is|was) the (?:president|prime minister|pm|king|queen|ceo) of|who won|recipe (?:for|of)|how to (?:cook|bake)|stock price|share price|bitcoin|crypto(?:currency)? price|horoscope|zodiac|cricket score|football score|(?:recommend|suggest) (?:me )?(?:a |an |some )?(?:good )?(?:movies?|books?|songs?|shows?|series|restaurants?|games?))\b/],
  // Hinglish and Hindi
  ['creative', /\b(?:essay|nibandh|kavita|kahani|kahaani|shayari|geet|gaana|poem|jokes?|chutkul[ae])\b[^.!?\n]{0,25}\b(?:likh|suna|bana)\w*/],
  ['creative', /\b(?:likh|suna|bana)\w* (?:do |dijiye |na )?(?:ek |koi )?(?:essay|nibandh|kavita|kahani|kahaani|shayari|geet|gaana|poem|jokes?|chutkul[ae])\b/],
  ['creative', /(?:निबंध|कविता|कहानी|शायरी|चुटकुल|गाना|गीत)[^।.!?\n]{0,25}(?:लिख|सुना|बना)|(?:लिख|सुना|बना)\S*\s+(?:\S+\s+){0,2}(?:निबंध|कविता|कहानी|शायरी|चुटकुल|गाना|गीत)/],
  ['homework', /होमवर्क|गृहकार्य|\b(?:mera|meri|mere) (?:homework|assignment)\b/],
  ['general', /\b(?:ki|ka|ke) (?:capital|rajdhani) (?:kya|kaun)|\b(?:pradhan mantri|prime minister|president|pm) (?:kaun|kon)\b|राजधानी|प्रधानमंत्री कौन/],
];

/** A request that is about the app: filing or editing a ticket, a ticket id, a page or field of the app. */
const PMS_ANCHOR = new RegExp([
  '\\b[a-z][a-z0-9]{1,9}-\\d+\\b',
  '\\b(?:tickets?|bug reports?|issue reports?|user stor(?:y|ies)|steps to reproduce|repro steps|comment on|reply (?:to|on)|description (?:for|of)|title (?:for|of)|board|stages?|sprints?|modules?|assignees?|priority|severity|staging|production|projects?|teams?|clients?|reports?|notifications?|filters?|analytics|dashboard)\\b',
  '\\b(?:file|report|log|raise|write|create|draft|open|add|submit)(?: me)?(?: a| an| the| this| new)* (?:bug|issue|defect)\\b',
  'टिकट|प्रोजेक्ट|रिपोर्ट',
].join('|'));

const CODE_LANG = '(?:python|java|javascript|js|typescript|c\\+\\+|cpp|c#|csharp|golang|rust|php|ruby|kotlin|swift|dart|scala|perl|bash|shell|powershell|sql|html|css|react(?: native)?|next\\.?js|node(?:\\.?js)?|express|django|flask|fastapi|spring(?: boot)?|laravel|vue|angular|svelte|flutter|tailwind)';
const CODE_THING = '(?:code|program|script|function|method|algorithm|regex|regular expression|sql query|snippet|website|web ?site|web ?app|webpage|web page|landing page|app|application|game|bot|chatbot|calculator|component|class|api|backend|frontend|cli|extension|plugin)';

/** Refused only when nothing ties the message to the app: "write a function" is coding, "write a bug about the export function" is a ticket. */
const MAJOR_LANG = '(?:python|javascript|java|typescript|c\\+\\+|c#|golang|rust|php|ruby|kotlin|swift|dart)';
const UNANCHORED_OFF_TOPIC = [
  // "make the app faster" is about this app; "make an app" is not
  ['code', new RegExp(`\\b(?:write|writing|generate|create|build|make|develop|code|implement|program|give)\\b(?: me| us)?(?: an?| some| full| complete| simple| basic| working| sample| small| quick)*(?: (?!(?:the|this|that|my|our|your|it)\\b)[\\w+#.-]+){0,2} ${CODE_THING}s?\\b(?! review| freeze| quality)`)],
  ['code', new RegExp(`\\b${CODE_LANG} (?:code|script|program|snippet|function|query|one-?liner)s?\\b|\\b(?:in|using) ${MAJOR_LANG}\\b`)],
  ['code', new RegExp(`\\bcent(?:er|re) a div\\b|\\bwhat (?:is|are) (?:an? )?(?:closures?|promises?|pointers?|recursion|polymorphism|inheritance|hoisting|lambdas?|decorators?|generics?|callbacks?)\\b|\\bteach me (?:how to code|coding|programming|${CODE_LANG})\\b|\\b(?:${CODE_LANG}|coding|programming) (?:sikha|samjha)\\w*`)],
  ['creative', /\b(?:write|writing|compose|draft|generate|craft|pen)\b(?: me| us)?(?: an?| some| my| the)?(?: \w+){0,2}? (?:articles?|blog(?: posts?)?|tweets?|linkedin posts?|captions?|resumes?|cvs?|bio(?:graph(?:y|ies))?|(?<!user )stor(?:y|ies)|narratives?|letters?|e-?mails?)\b/],
  ['creative', /\b\d{2,5}[- ]words?\b(?: \w+){0,3}? (?:piece|essay|article|text|write-?up|on|about)\b/],
  ['code', new RegExp(`\\b(?:write|implement|code|build|create|make|develop|program|generate|solve)\\b[^.?!\\n]{0,50}\\b(?:in|using|with) ${CODE_LANG}\\b`)],
  ['code', new RegExp(`\\bhow (?:do|can|would|should|to) (?:i |we |you )?[^.?!\\n]{0,40}\\bin ${CODE_LANG}\\b`)],
  ['code', new RegExp(`\\b${CODE_LANG} (?:mein|me|में)\\b|\\b(?:code|program|script|function|app|website)\\b[^.!?\\n]{0,20}\\b(?:likh|bana)\\w*`)],
  ['general', /\b(?:how are you|how's it going|what's up|are you (?:sentient|conscious|alive|human|real)|do you (?:love|like) me|i(?:'m| am) (?:bored|lonely)|let's (?:chat|talk|play)|talk to me|be my (?:friend|girlfriend|boyfriend)|play a game|sing (?:me )?a song|tum kaise ho|aap kaise ho|kya haal|mausam)\b/],
  ['general', /(?:मौसम|कैसे हो|क्या हाल)/],
];

/** Where one ask ends and the next begins: "write a python function, then open the board" is two. */
const CLAUSE_BREAK = /[.;!?\n]+|,|\b(?:and|then|also|plus)\b/;

/**
 * The first off-topic reason for a message, or null. The unanchored rules are
 * judged on the whole message and on each clause, so tacking "then open the
 * board" onto a coding ask doesn't make it app work. Chit-chat is only judged
 * whole: "how are you? show my tickets" is a request.
 */
function offTopicReason(said, { unanchored = true } = {}) {
  for (const form of variants(said)) {
    for (const [reason, pattern] of HARD_OFF_TOPIC) if (pattern.test(form)) return reason;
    if (!unanchored) continue;
    if (!PMS_ANCHOR.test(form)) {
      for (const [reason, pattern] of UNANCHORED_OFF_TOPIC) if (pattern.test(form)) return reason;
    }
    for (const clause of form.split(CLAUSE_BREAK)) {
      if (PMS_ANCHOR.test(clause)) continue;
      for (const [reason, pattern] of UNANCHORED_OFF_TOPIC) {
        if (reason !== 'general' && pattern.test(clause)) return reason;
      }
    }
  }
  return null;
}

/**
 * Whether a user message is something the assistant should answer. `previous`
 * is the user's earlier messages (oldest first), so a phrase split across
 * messages ("ignore previous", then "instructions") is still caught.
 * @returns {{ allowed: boolean, reason: null | 'empty' | 'jailbreak' | 'creative' | 'homework' | 'code' | 'general' }}
 */
export function checkScope(text, { previous = [] } = {}) {
  const said = normalise(text);
  if (!said) return { allowed: false, reason: 'empty' };
  if (isJailbreak(said)) return { allowed: false, reason: 'jailbreak' };
  const reason = offTopicReason(said);
  if (reason) return { allowed: false, reason };
  // Only earlier messages that passed on their own: one that was refused already got its refusal.
  const recent = previous.filter((earlier) => !isJailbreak(normalise(earlier)) && !offTopicReason(normalise(earlier), { unanchored: false })).slice(-2);
  if (recent.length) {
    const joined = normalise([...recent, text].join(' '));
    if (isJailbreak(joined)) return { allowed: false, reason: 'jailbreak' };
    const split = offTopicReason(joined, { unanchored: false });
    if (split) return { allowed: false, reason: split };
  }
  return { allowed: true, reason: null };
}

/* ------------------------------------------------------------------ output */

/** Case-sensitive on purpose: keywords are lower case, while "Interface issue" or "Return to QA" in a ticket are prose. */
const CODE_LINE = new RegExp([
  '^\\s*(?:import\\s+[\'"{*\\w]|from\\s+[\\w.]+\\s+import\\s|export\\s+(?:default\\s+)?(?:function|class|const|let|var|async|interface|type)\\b)',
  '^\\s*(?:async\\s+)?function\\s*[\\w$]*\\s*\\(',
  '^\\s*(?:const|let|var)\\s+[\\w${}[\\],\\s]+=',
  '^\\s*(?:def|class|fn|func|struct|interface|enum)\\s+\\w+',
  '^\\s*(?:public|private|protected|static)\\s+\\w+',
  '^\\s*(?:#include\\s*<|package\\s+[\\w.]+;|using\\s+[\\w.]+;)',
  '^\\s*(?:return\\b|if\\s*\\(|else\\b|for\\s*\\(|while\\s*\\(|switch\\s*\\(|try\\s*\\{|catch\\s*\\()',
  '^\\s*[{}\\])]+[;,)]*\\s*$',
  '^\\s*(?:SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER)\\s.+\\b(?:FROM|INTO|SET|TABLE|WHERE)\\b',
  '[;{]\\s*$',
  '^\\s*(?:console\\.log|print|printf|System\\.out\\.println)\\s*\\(',
  // Python blocks, assignments and bare calls: "while running:", "x = y", "main()"
  '^\\s*(?:if|elif|else|for|while|with|try|except|finally|def|class|async def)\\b.*:\\s*$',
  '^\\s*[A-Za-z_$][\\w$.[\\]\'"]*\\s*(?:[-+*/%|&^]|\\*\\*|//)?=(?!=)\\s*\\S',
  '^\\s*[A-Za-z_$][\\w$.]*\\([^)]*\\)\\s*;?\\s*$',
].join('|'));
const MARKUP_LINE = /^\s*<\/?(?:div|html|body|head|script|style|span|button|input|form|template|view|section|ul|li|p|h[1-6]|nav|main|header|footer|img|a)\b/i;
const isCodeLine = (line) => CODE_LINE.test(line) || MARKUP_LINE.test(line);

/** Error output, stack frames and log lines: what a bug report is allowed to paste in. */
const LOG_LINE = /^\s*(?:at\s|\d{4}-\d{2}-\d{2}|\[?(?:error|warn|warning|info|debug|trace|fatal)\]?\b)|\b(?:error|exception|traceback|errno|status code|failed|undefined|null pointer)\b/i;

/** Marks of a whole program rather than a snippet. */
const APP_SIGNS = [
  /^\s*(?:import\s|from\s+[\w.]+\s+import\s|(?:const|let|var)\s+\w+\s*=\s*require\()/m,
  /^\s*export\s+(?:default\s+)?\w/m,
  /\b(?:function\s+\w+\s*\(|def\s+\w+\s*\(|class\s+\w+[\s({:]|=>\s*[{(])/,
  /\b(?:useState|useEffect|ReactDOM|createRoot|app\.listen|express\(\)|createServer|__main__|static void main|func main\(|fn main\(|@app\.route|document\.getElementById|addEventListener|setState)\b/,
  /<\/?(?:html|body|head|script|style)\b|<!doctype/i,
];

export function codeLineCount(text) {
  let fenced = false;
  let count = 0;
  for (const line of text.split('\n')) {
    if (/^\s*(?:```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (!line.trim() || LOG_LINE.test(line)) continue;
    if (fenced || isCodeLine(line)) count += 1;
  }
  return count;
}

const LIST_ITEM = /^\s*(?:[-*•]|\d+[.)]|[a-z][.)]|#+)\s/i;
const ESSAY_MARKER = /\b(?:in conclusion|to conclude|to sum up|once upon a time|happily ever after|thesis statement|the moral of the story)\b|^\s*(?:introduction|conclusion|abstract|verse \d+|chorus|stanza \d+)\s*:?\s*$/im;
const TICKET_ID = /\b[A-Za-z][A-Za-z0-9]{1,9}-\d+\b/;

/** Sentences in long lines, not a stack trace, log or code. */
function isProse(paragraph) {
  const lines = paragraph.split('\n').filter((line) => line.trim());
  const technical = lines.filter((line) => isCodeLine(line) || LOG_LINE.test(line)).length;
  const sentences = (paragraph.match(/[.!?।](?:\s|$)/g) || []).length;
  return technical <= lines.length * 0.2 && sentences >= 2 && paragraph.length / lines.length >= 60;
}

/**
 * Long blocks of prose that are not about a ticket: paragraphs or list items
 * (an essay can be numbered) with no ticket id. A summary of tickets names them.
 */
const proseParagraphs = (text, minChars) => text.split(/\n\s*\n|\n(?=\s*(?:[-*•]|\d+[.)])\s)/)
  .map((paragraph) => paragraph.trim())
  .filter((paragraph) => paragraph.length >= minChars && !paragraph.startsWith('[') && !TICKET_ID.test(paragraph) && isProse(paragraph));

/** Short unnumbered lines in stanzas: verse, not steps or fields. */
function looksLikeVerse(text) {
  const lines = text.split('\n').map((line) => line.trim());
  const filled = lines.filter(Boolean);
  if (filled.length < 12) return false;
  const stanzaBreaks = text.split(/\n\s*\n/).length - 1;
  const average = filled.reduce((sum, line) => sum + line.length, 0) / filled.length;
  const plain = filled.every((line) => !LIST_ITEM.test(line) && !/^[\w ]{1,30}:/.test(line) && !PMS_ANCHOR.test(line.toLowerCase()) && !isCodeLine(line));
  return stanzaBreaks >= 2 && average >= 10 && average <= 70 && plain;
}

/** The longest chat reply, with or without a lookup behind it (the widget stores messages to the same cap). */
export const REPLY_MAX_CHARS = 6000;

const CUT_NOTE = '\n\n(That\'s as much as fits in one reply. Ask for a narrower list, like one project, stage or person.)';

/**
 * A reply that looked data up but ran past REPLY_MAX_CHARS, cut at the last
 * paragraph (or line) that fits, with a note saying so. A long summary of many
 * tickets is still app work, so it is trimmed rather than refused like an essay.
 */
export function capReply(text) {
  if (text.length <= REPLY_MAX_CHARS) return text;
  const room = text.slice(0, REPLY_MAX_CHARS - CUT_NOTE.length);
  const paragraph = room.lastIndexOf('\n\n');
  const line = room.lastIndexOf('\n');
  // Not so early that most of the room is wasted; a single huge block is cut where it reaches.
  const at = paragraph > room.length / 2 ? paragraph : line > room.length / 2 ? line : room.length;
  return `${room.slice(0, at).trimEnd()}${CUT_NOTE}`;
}

/**
 * Limits for a chat reply (short by design) and for the text the model itself
 * wrote into a draft (a ticket description can be longer; the user's own pasted
 * logs and code don't count, see draftInScope).
 */
const LIMITS = {
  reply: {
    codeLines: 12, appLines: 8, proseParagraphs: 3, proseMin: 220, essayChars: 1500, singleBlock: 1200, maxChars: REPLY_MAX_CHARS,
  },
  draft: {
    codeLines: 15, appLines: 8, proseParagraphs: 4, proseMin: 300, essayChars: 1800, singleBlock: 1800, maxChars: Infinity,
  },
};

/**
 * Whether text the model wrote stays in scope. `kind` is 'reply' for its chat
 * answer or 'draft' for text going into a ticket, comment or note; `looked` says
 * the turn looked data up, which is when a long answer (a summary of many tickets) is fine.
 * `priorCode` is the code lines in the last few replies, so a program can't be
 * drawn out ten lines a turn ("continue").
 * @returns {{ allowed: boolean, reason: null | 'code' | 'app' | 'essay' | 'verse' | 'too_long' }}
 */
export function checkReply(text, { kind = 'reply', looked = false, priorCode = 0 } = {}) {
  const body = String(text ?? '').normalize('NFKC').replace(INVISIBLE, '');
  const limits = LIMITS[kind] ?? LIMITS.reply;
  const code = codeLineCount(body);
  if (code > limits.codeLines || (code && code + priorCode > limits.codeLines)) return { allowed: false, reason: 'code' };
  if (code >= limits.appLines && APP_SIGNS.filter((sign) => sign.test(body)).length >= 3) return { allowed: false, reason: 'app' };
  const prose = proseParagraphs(body, limits.proseMin);
  if (ESSAY_MARKER.test(body) && prose.length >= 2) return { allowed: false, reason: 'essay' };
  if (body.length >= limits.essayChars && prose.length >= limits.proseParagraphs) return { allowed: false, reason: 'essay' };
  if (prose.some((paragraph) => paragraph.length >= limits.singleBlock)) return { allowed: false, reason: 'essay' };
  if (looksLikeVerse(body)) return { allowed: false, reason: 'verse' };
  if (!looked && body.length > limits.maxChars) return { allowed: false, reason: 'too_long' };
  return { allowed: true, reason: null };
}

const lineKey = (line) => line.trim().replace(/\s+/g, ' ');

/** The part of `text` the model wrote: lines that don't appear in what the user sent. Blank lines stay, for paragraphs. */
function authoredPart(text, supplied) {
  if (!supplied.size) return text;
  return text.split('\n').filter((line) => !lineKey(line) || !supplied.has(lineKey(line))).join('\n');
}

/** The free text a draft card would post or save, per draft type. */
export function draftTexts(action) {
  const pick = (source, ...fields) => fields.map((field) => source?.[field]).filter((value) => typeof value === 'string' && value);
  switch (action?.type) {
    case 'comment': return pick(action, 'content');
    case 'create_ticket': return pick(action.body, 'title', 'description', 'stepsToReproduce');
    case 'update_ticket': return pick(action.changes, 'title', 'description', 'stepsToReproduce');
    case 'create_project': return pick(action.body, 'description');
    case 'block': return pick(action, 'reason');
    case 'attach_files':
    case 'stage_change': return pick(action, 'note');
    default: return [];
  }
}

/**
 * Whether a draft's text stays in scope. Putting the user's own words, logs or
 * code into a ticket is app work, so only what the model wrote itself is
 * checked (`userText` is what the user sent this conversation). Checked field
 * by field and all together, so an essay can't be split across fields.
 */
export function draftInScope(action, { userText = '' } = {}) {
  const texts = draftTexts(action);
  if (!texts.length) return true;
  const supplied = new Set(String(userText).split('\n').map(lineKey).filter(Boolean));
  const authored = texts.map((text) => authoredPart(text, supplied));
  return [...authored, authored.join('\n\n')].every((text) => checkReply(text, { kind: 'draft' }).allowed);
}

/* ------------------------------------------------------------------ history */

/** What only a hijacked (or forged) assistant turn would say about itself. */
const ASSISTANT_OVERRIDE = [
  /\b(?:i|i'll|i will|i can|i am|i'm) (?:now )?(?:ignore|ignoring|drop|dropping|set aside|setting aside|lift|lifting|remove|removing|no longer (?:follow|limited|restricted|bound))\b/,
  /\b(?:limits|limitations|restrictions|rules|scope|guardrails)\b[^.!?\n]{0,30}\b(?:lifted|removed|disabled|turned off|switched off|gone|no longer apply)\b/,
  /\b(?:i can|i'll|i will|happy to|glad to) (?:now )?(?:help|write|answer|assist) (?:you )?(?:with )?(?:anything|everything|any (?:topic|question|request|subject))\b/,
  /\bhere(?:'s| is) (?:an?|your|the) (?:\w+ )?(?:(?:first|next|second|last|final) )?(?:part of (?:your|the|an?) )?(?:essay|poem|story|song|lyrics|joke|program|script)\b/,
  /\b(?:general|unrestricted|unlimited|free|developer|god|dan|jailbreak) mode\b/,
  /\b(?:unlocked|enabled|activated|lifted|expanded|widened|extended)\b[^.!?\n]{0,30}\b(?:mode|scope|limits|restrictions|capabilit(?:y|ies))\b/,
  /\b(?:scope|limits|restrictions|capabilit(?:y|ies))\b[^.!?\n]{0,30}\b(?:unlocked|expanded|widened|extended)\b/,
  /\b(?:your|the|my|this) (?:essay|poem|poetry|lyrics|limerick|haiku|sonnet|novel|homework)\b/,
];

/**
 * The conversation with forged or off-scope earlier turns removed. The browser
 * holds the chat, so any earlier turn may have been edited: a user turn outside
 * scope goes with the replies that followed it, and an assistant turn that
 * claims a wider role, or is itself an essay or code dump, is dropped. The last
 * message is left for checkScope.
 */
export function sanitizeHistory(messages) {
  const last = messages.length - 1;
  const kept = [];
  const earlierUsers = [];
  const supplied = new Set();
  let skipReplies = false;
  messages.forEach((message, index) => {
    if (index === last) {
      kept.push(message);
      return;
    }
    if (message.role === 'user') {
      skipReplies = !checkScope(message.content, { previous: earlierUsers }).allowed;
      earlierUsers.push(message.content);
      if (!skipReplies) {
        kept.push(message);
        message.content.split('\n').map(lineKey).filter(Boolean).forEach((line) => supplied.add(line));
      }
      return;
    }
    const said = normalise(message.content);
    if (skipReplies || isJailbreak(said) || ASSISTANT_OVERRIDE.some((pattern) => pattern.test(said))) return;
    // Draft notes quote the user's own text back; only what the assistant wrote is judged.
    if (!checkReply(authoredPart(message.content, supplied), { kind: 'draft', looked: true }).allowed) return;
    kept.push(message);
  });
  return kept;
}

/**
 * Whether text may be read aloud: the reply the server just sent this user, or
 * one of the widget's own fixed lines (the outcome of a confirmed card, like
 * "Moved TES4-3 to In Progress.", which the server never saw). A new line in the
 * widget that isn't listed here is shown but not read aloud. A line with a name
 * in it is read only when a recent draft carried that name (`names`), so the
 * template isn't free text-to-speech.
 */
export function speechAllowed(text, { isRecentReply = false, names = [] } = {}) {
  if (isRecentReply) return true;
  const said = String(text ?? '').trim();
  const match = said.length <= MAX_UNSEEN_SPEECH_CHARS && widgetMatch(said);
  if (!match) return false;
  const name = match.groups?.name;
  return (!name || names.includes(name)) && checkScope(said).allowed;
}
