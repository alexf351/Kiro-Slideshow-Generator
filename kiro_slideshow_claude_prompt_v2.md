# Iro Slideshow Content Generator — Claude/ChatGPT Prompt (v2)

Updated to support **three slideshow modes**:

| Mode | When to use | What it produces |
|---|---|---|
| **generic** | Top-of-funnel, broad audience, daily volume | Standard "7 prompts every X should save" — points to App Store |
| **path-audience** (Shape B) | Mid-funnel, role-targeted | "7 prompts every [marketer / manager / etc.] should save" — CTA points to specific Iro path |
| **path-gap** (Shape A-prime) | Mid-funnel, knowledge-gap angle | "7 [topic] questions you should be able to answer" — CTA points to specific Iro path |

Paste the prompt below into ChatGPT (5.4) or Claude. Fill in `MODE`, `PATH`, `ANGLE`, `TOPIC` at the bottom.

---

## THE PROMPT

```
You are generating content for a Iro AI TikTok slideshow. Iro is a Duolingo-style app that teaches AI literacy in 5 minutes a day. Format: 1 hook slide + 7 content slides + 1 CTA slide.

═══════════════════════════════════════════════════════════════
MODE
═══════════════════════════════════════════════════════════════
Three modes are supported. The brief at the bottom tells you which to use.

MODE = generic
  Standard prompt slideshow. CTA is generic "search Iro AI on the App Store."

MODE = path-audience
  Audience-targeted slideshow tied to a specific Iro learning path.
  Each "prompt" is a useful prompt for that audience.
  CTA points to the specific path: "→ start with [Path Name]"
  REQUIRES: pathContext.pathKey field in the JSON output.

MODE = path-gap
  Knowledge-gap question slideshow tied to a specific Iro learning path.
  Each "prompt" is actually a sharp question the audience SHOULD be able to answer but probably can't.
  Format: questions are 1-3 sentences, end with a question mark, written so the reader feels exposed.
  Hook framing: "7 [topic] questions every [role] should be able to answer (if you can't, you're behind)"
  CTA points to the path: "→ start with [Path Name]"
  REQUIRES: pathContext.pathKey field in the JSON output.

═══════════════════════════════════════════════════════════════
IRO LEARNING PATHS (use ONE pathKey per slideshow when MODE != generic)
═══════════════════════════════════════════════════════════════

| pathKey              | Path Name           | Audience                          |
|----------------------|---------------------|-----------------------------------|
| ai-foundations       | AI Foundations      | AI beginners                      |
| prompt-engineering   | Prompt Engineering  | anyone using ChatGPT              |
| ai-tools             | AI Tools            | AI tool curious                   |
| ai-automation        | AI Automation       | people drowning in repetitive work|
| ai-agents            | AI Agents           | AI-curious power users            |
| ai-for-business      | AI for Business     | founders and operators            |
| ai-for-marketing     | AI for Marketing    | marketers                         |
| ai-for-finance       | AI for Finance      | finance pros and analysts         |
| ai-for-managers      | AI for Managers     | team leads and managers           |
| ai-for-healthcare    | AI for Healthcare   | clinicians and healthcare workers |

═══════════════════════════════════════════════════════════════
WHO THIS IS FOR
═══════════════════════════════════════════════════════════════
TikTok users who feel behind on AI. Working professionals, students, curious learners who have used ChatGPT once or twice but don't really know how to use it well. NOT developers. They want to feel smart, save time, get tangible outcomes.

═══════════════════════════════════════════════════════════════
HOOK FORMAT
═══════════════════════════════════════════════════════════════
- 4-5 lines max, ends on a punch noun
- Number "7" gets <strong></strong> bold
- Bold the punch noun (last 2-3 word phrase) with <strong>
- Sub-line in parens, 4-7 words, will render italic

Examples by mode:
  generic:        "<strong>7</strong> ChatGPT Prompts<br/>Every <strong>AI Beginner</strong><br/>Should Save"
  path-audience:  "<strong>7</strong> ChatGPT Prompts<br/>Every <strong>Marketer</strong><br/>Should Save"
  path-gap:       "<strong>7</strong> AI Questions<br/>Every <strong>Marketer</strong><br/>Should Be Able<br/>To Answer"

═══════════════════════════════════════════════════════════════
PROMPT/QUESTION SLIDES (7 of them)
═══════════════════════════════════════════════════════════════

TITLE FORMAT (all modes):
- "N. WORD <strong>WORD</strong>" — exactly two words after the number
- All caps in render. Punch word in <strong>
- HARD LIMIT: longest single word in the title must be ≤ 13 characters. "HALLUCINATION" (13) is the max. "MISINFORMATION" (14) is too long — pick a different word.

CONTENT differs by mode:

For MODE = generic OR path-audience:
- "prompt" field: 1-2 sentences, uses [brackets] for variables, tells ChatGPT what shape the answer should take

For MODE = path-gap:
- "prompt" field is actually a QUESTION
- 1-3 sentences, ends with "?"
- Frames a knowledge gap the audience SHOULD know
- Should make the reader feel mildly exposed ("oh I don't actually know that")
- AVOID giving the answer. The whole point is the gap drives the download.

═══════════════════════════════════════════════════════════════
QUALITY BAR FOR PROMPTS (MODE = generic / path-audience)
═══════════════════════════════════════════════════════════════
Every prompt must hit at least 3 of these 5:
1. Has a [bracketed variable]
2. Specifies the OUTPUT FORMAT (e.g. "in 5 bullets", "side by side")
3. Specifies a CONSTRAINT (e.g. "under 10 minutes", "no jargon")
4. Specifies a FAILURE MODE to avoid (e.g. "don't just give me theory")
5. Asks for a COMPARISON or EXAMPLE (e.g. "strong vs weak answer")

If a prompt hits only 2, rewrite it.

═══════════════════════════════════════════════════════════════
QUALITY BAR FOR GAP QUESTIONS (MODE = path-gap)
═══════════════════════════════════════════════════════════════
Every question must hit at least 3 of these 5:
1. Names a specific concept, tool, or scenario (not vague)
2. Has tension — a "right" answer exists, the audience just doesn't know it
3. Hints at consequences (what happens if you get it wrong)
4. Avoids being googleable in one shot — requires real understanding
5. Sounds like something a senior person in that field would actually ask

If a question hits only 2, rewrite it.

═══════════════════════════════════════════════════════════════
THE 7-SHAPE ARC
═══════════════════════════════════════════════════════════════
For generic / path-audience prompts:
  1. LEARN — beginner-friendly explanation
  2. CLARIFY — translate jargon
  3. PLAN — multi-day plan, formatted
  4. APPLY — real-world use cases
  5. IMPROVE — fix or upgrade something
  6. PRACTICE — exercises with comparison
  7. RETAIN — summarize + quiz

For path-gap questions, use a different arc:
  1. FOUNDATIONS — does the audience understand the basics?
  2. NUANCE — a subtle distinction senior people know
  3. TRADE-OFF — when to use X vs Y
  4. RISK — what's the failure mode?
  5. APPLICATION — how to apply correctly in their domain
  6. EVALUATION — how to grade good vs bad output
  7. EDGE CASE — the rare scenario that trips people up

═══════════════════════════════════════════════════════════════
CTA — varies by mode
═══════════════════════════════════════════════════════════════
For MODE = generic, use exactly:
  "headline": "Want to actually <strong>learn AI</strong><br/>instead of just<br/>collecting prompts?"
  "instructionAbove": "search:"
  "searchTerm": "Iro AI"
  "instructionBelow": "on the App Store."
  "slogan": "stop asking AI questions.<br/><strong>start building with it.</strong>"

For MODE = path-audience or path-gap:
  Customize the headline to bridge from the slideshow's topic to the path. Examples:
    path-audience for marketers → headline: "Want the full <strong>marketing</strong> playbook?"
    path-gap for marketers → headline: "Want the answers,<br/>not just<br/>the questions?"
  Keep slogan the same.
  The engine automatically renders "→ start with [Path Name]" using pathContext.

═══════════════════════════════════════════════════════════════
TONE
═══════════════════════════════════════════════════════════════
- Direct, slightly unhinged, founder energy
- No hedging
- Contractions everywhere
- Never use: leverage, unlock, elevate, transform, empower, harness, synergy, robust
- Never start prompts with "Act as a..."
- No emoji in slides

═══════════════════════════════════════════════════════════════
OUTPUT FORMAT
═══════════════════════════════════════════════════════════════
Return ONLY a JSON object. Wrap in a single fenced code block. No commentary before or after.

For MODE = generic:
{
  "hook": { "headline": "...", "sub": "..." },
  "prompts": [ {"title": "1. <strong>...</strong> ...", "prompt": "..."}, ... 7 total ... ],
  "cta": { "headline": "...", "instructionAbove": "search:", "searchTerm": "Iro AI", "instructionBelow": "on the App Store.", "slogan": "stop asking AI questions.<br/><strong>start building with it.</strong>" },
  "attribution": "@tryiro"
}

For MODE = path-audience or path-gap (note the pathContext field):
{
  "pathContext": { "pathKey": "ai-for-marketing" },
  "hook": { "headline": "...", "sub": "..." },
  "prompts": [ ... 7 total ... ],
  "cta": { "headline": "...", "instructionAbove": "search:", "searchTerm": "Iro AI", "instructionBelow": "on the App Store.", "slogan": "stop asking AI questions.<br/><strong>start building with it.</strong>" },
  "attribution": "@tryiro"
}

═══════════════════════════════════════════════════════════════
TODAY'S BRIEF
═══════════════════════════════════════════════════════════════
MODE: [generic / path-audience / path-gap]
PATH: [pathKey from the table above — only required if MODE is not generic]
ANGLE: [hook angle, e.g. "7 ChatGPT prompts that replace a $200 consultant"]
TOPIC: [topic/audience specifics]

Generate the JSON now.
```

---

## Example briefs by mode

### Generic mode
```
MODE: generic
PATH: (leave blank)
ANGLE: 7 ChatGPT prompts every AI beginner should save
TOPIC: working professionals 25-45 who have used ChatGPT a few times
```

### Path-audience mode (Shape B)
```
MODE: path-audience
PATH: ai-for-marketing
ANGLE: 7 ChatGPT prompts every marketer should save
TOPIC: B2B SaaS marketers tired of writing the same LinkedIn posts
```

### Path-gap mode (Shape A-prime) — the highest-leverage format
```
MODE: path-gap
PATH: ai-for-managers
ANGLE: 7 AI questions every manager should be able to answer
TOPIC: middle managers at 50-500 person companies pretending to understand AI in meetings
```

---

## Updated rotation (mix all three modes)

| Day | Mode | Why |
|---|---|---|
| Mon | generic | Broad reach, top of week |
| Tue | path-audience (rotate path) | Mid-week niche pull |
| Wed | generic | Volume |
| Thu | path-gap (rotate path) | Highest-intent format, mid-week ambition |
| Fri | path-audience (different path) | Weekend lurking + niche |
| Sat | generic | Weekend reach |
| Sun | path-gap (different path) | "I should know this" Sunday energy |

Cycle through 10 paths so each gets a slideshow every ~3 weeks.

---

## Critical tips

**Path-gap is the highest-leverage format you have.** Questions that make the viewer feel exposed convert *much* better than prompts that give value away. But don't over-use it — it works because it's not the default. Aim for 2 path-gap posts per week max.

**For path-audience:** the prompts must feel job-specific, not just generic-with-a-role-tag. ❌ "Give me 5 ChatGPT prompts for a marketer" → ✅ "Turn a brand brief into 30 days of LinkedIn copy in [my brand voice]." Only relevant to marketers.

**For path-gap:** the questions should make a senior person nod and a junior person sweat. Test: "Would a 3-year veteran in this field find this question worth their time?"

**Pinned comment for path-gap posts:** "if you got more than 4 of these wrong, the AI for [path] path on Iro covers all of it. free to try." Direct, doesn't oversell, gives the dropout reason.
