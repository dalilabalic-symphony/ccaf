// A deterministic, offline stand-in for "the internet" — used by every
// coordinator/subagent example so the interesting part of the run is the
// orchestration, not the network.
//
// Two things here are deliberate teaching props, not incidental design:
//
// 1. Every snippet carries `sourceType`. That gives the coordinator a real
//    axis to partition work along ("you take academic, you take news"),
//    which is how you keep parallel subagents from doing the same search
//    three times.
// 2. `searchCorpus` returns *structured* records — content in `text`,
//    attribution in `id`/`title`/`url`/`published`. When a coordinator later
//    hands these findings to a synthesis subagent, the citation survives the
//    handoff because it was never mashed into prose.

export type SourceType = "news" | "academic" | "industry";

export type Snippet = {
  id: string;
  title: string;
  sourceType: SourceType;
  url: string;
  published: string;
  /** Rough subtopic tag — also what the mock search matches against. */
  tags: string[];
  text: string;
};

// Topic: residential heat pump adoption. Chosen because it splits cleanly
// into three subtopics (cost, performance, policy) that a coordinator can
// hand to three different subagents without overlap.
export const CORPUS: Snippet[] = [
  {
    id: "doc-01",
    title: "Heat pump installs outpace gas boilers in three EU markets",
    sourceType: "news",
    url: "https://example.com/news/eu-heatpump-installs",
    published: "2025-11-04",
    tags: ["cost", "adoption", "policy"],
    text: "Installations overtook gas boiler sales in Finland, Norway and France last year. Installers cite upfront cost as the remaining barrier: a typical air-source retrofit runs 12,000-18,000 EUR before subsidy, against 3,500 EUR for a replacement gas boiler.",
  },
  {
    id: "doc-02",
    title: "Seasonal performance of air-source heat pumps in cold climates",
    sourceType: "academic",
    url: "https://example.com/papers/aship-cold-climate",
    published: "2025-06-12",
    tags: ["performance", "efficiency"],
    text: "Across 412 monitored installations, mean seasonal coefficient of performance was 2.8. Units held above 2.0 down to -15C. The dominant driver of underperformance was not outdoor temperature but oversized emitters left over from the previous boiler.",
  },
  {
    id: "doc-03",
    title: "Retrofit economics: payback under four tariff regimes",
    sourceType: "academic",
    url: "https://example.com/papers/retrofit-payback",
    published: "2025-09-30",
    tags: ["cost", "payback", "tariffs"],
    text: "Simple payback ranged from 6 to 24 years depending almost entirely on the electricity-to-gas price ratio. Where that ratio exceeded 4:1, no subsidy level tested produced a payback under 12 years.",
  },
  {
    id: "doc-04",
    title: "2026 subsidy schedules and eligibility changes",
    sourceType: "news",
    url: "https://example.com/news/subsidy-2026",
    published: "2026-01-15",
    tags: ["policy", "subsidy", "cost"],
    text: "Grant ceilings rise to 9,000 EUR but are now means-tested and conditional on a post-install commissioning report. Analysts expect the commissioning requirement to slow uptake in the first two quarters.",
  },
  {
    id: "doc-05",
    title: "Installer capacity is the binding constraint, survey finds",
    sourceType: "industry",
    url: "https://example.com/reports/installer-capacity",
    published: "2025-10-08",
    tags: ["adoption", "workforce", "policy"],
    text: "78% of surveyed installers report booking six or more weeks out. Trade bodies estimate a shortfall of 24,000 trained fitters against 2030 targets, which they argue caps deployment regardless of subsidy generosity.",
  },
  {
    id: "doc-06",
    title: "Field data on low-temperature radiator compatibility",
    sourceType: "industry",
    url: "https://example.com/reports/lowtemp-radiators",
    published: "2025-08-21",
    tags: ["performance", "retrofit", "efficiency"],
    text: "Homes that resized at least the two largest radiators saw flow temperatures drop from 55C to 45C, lifting measured COP by roughly 0.4. Whole-house emitter replacement was rarely necessary.",
  },
  {
    id: "doc-07",
    title: "Noise complaints and siting rules tighten in dense housing",
    sourceType: "news",
    url: "https://example.com/news/noise-siting",
    published: "2025-12-02",
    tags: ["policy", "siting"],
    text: "Three cities introduced boundary noise limits of 42 dB(A) at night. Manufacturers say compliant units exist but cost 8-12% more, and siting constraints rule out roughly one in six terraced properties.",
  },
  {
    id: "doc-08",
    title: "Grid impact of winter-peak electrification",
    sourceType: "academic",
    url: "https://example.com/papers/grid-winter-peak",
    published: "2025-07-19",
    tags: ["policy", "grid", "performance"],
    text: "At 40% household penetration, modeled winter evening peak rises 18% without flexible tariffs and 6% with them. Distribution-level reinforcement, not generation, dominates the cost.",
  },
  {
    id: "doc-09",
    title: "Maintenance cost over the first five years",
    sourceType: "industry",
    url: "https://example.com/reports/maintenance-5yr",
    published: "2026-02-10",
    tags: ["cost", "reliability"],
    text: "Mean annual servicing came to 190 EUR against 140 EUR for gas. Refrigerant-circuit faults were rare (1.9% of units over five years) but expensive when they occurred, averaging 1,400 EUR.",
  },
  {
    id: "doc-10",
    title: "Consumer awareness lags installed base",
    sourceType: "news",
    url: "https://example.com/news/awareness-gap",
    published: "2026-03-01",
    tags: ["adoption", "consumer"],
    text: "Only 31% of homeowners surveyed could describe how a heat pump differs from an electric boiler. Among those who had one installed, 84% reported satisfaction, suggesting the gap is informational rather than experiential.",
  },
];

export type SearchResult = Pick<
  Snippet,
  "id" | "title" | "sourceType" | "url" | "published" | "text"
>;

/**
 * Substring/tag match over the corpus. Crude on purpose — the point is that
 * it returns *structured* records, not that it is a good search engine.
 *
 * `sourceType` is the knob a coordinator uses to partition scope across
 * subagents so their results don't overlap.
 */
export function searchCorpus(
  query: string,
  sourceType?: SourceType,
): SearchResult[] {
  // Terms that appear in nearly every document carry no signal — without
  // dropping them, "heat pump anything" matches the whole corpus and a
  // researcher will keep re-searching in the hope of better results.
  const STOPWORDS = new Set([
    "heat", "pump", "pumps", "home", "house", "the", "and", "for", "with",
    "air", "source", "residential", "heating",
  ]);

  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));

  if (terms.length === 0) return [];

  const scored = CORPUS.filter(
    (doc) => sourceType === undefined || doc.sourceType === sourceType,
  )
    .map((doc) => {
      const body = `${doc.title} ${doc.text}`.toLowerCase();
      const tags = doc.tags.join(" ").toLowerCase();
      // A tag hit is a topical match; a body hit may be incidental.
      const score = terms.reduce(
        (n, t) => n + (tags.includes(t) ? 2 : 0) + (body.includes(t) ? 1 : 0),
        0,
      );
      return { doc, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return [];

  // Keep only results close to the best match, so a weak query returns few
  // results rather than a shrug-shaped list of everything.
  const cutoff = Math.max(2, scored[0]!.score * 0.45);
  return scored
    .filter(({ score }) => score >= cutoff)
    .slice(0, 4)
    .map(({ doc }) => ({
      id: doc.id,
      title: doc.title,
      sourceType: doc.sourceType,
      url: doc.url,
      published: doc.published,
      text: doc.text,
    }));
}
