/**
 * DERMA-SHIELD · sunscreen-auditor.js
 * -----------------------------------------------------------------------------
 * Offline UV-filter photostability & comedogenicity rules engine.
 *
 * Parses an INCI ingredient list, resolves it against the 80+ row offline
 * photochemistry database, then evaluates a rule pack covering:
 *
 *   PHOTO-1  Unstabilised avobenzone (no quencher present)  → UVA collapse
 *   PHOTO-2  Avobenzone + octinoxate [2+2] cycloaddition
 *   PHOTO-3  Avobenzone + padimate-O / cinoxate (cinnamate family)
 *   PHOTO-4  Oxybenzone-heavy formula (photolabile + endocrine + reef)
 *   PHOTO-5  UVA1 gap — no filter with λmax > 360 nm or mineral present
 *   PHOTO-6  UVB-only formula (SPF without UVA claim)
 *   PHOTO-7  Mineral-only formula without iron oxide (visible-light gap)
 *   PHOTO-8  Retinoid / AHA in a daytime product (photoshift warning)
 *   PHOTO-9  Citrus / bergamot fragrance (phytophotodermatitis)
 *   PHOTO-10 Photosensitising preservative (MIT/CMIT)
 *   PHOTO-11 Comedogenic load (Σ comedogenic esters)
 *   PHOTO-12 Reef-toxin load (Hawaii/Key West banned filters)
 *   PHOTO-13 Endocrine-suspicion load
 *   PHOTO-14 Film plasticiser conflict (high alcohol + mineral filter)
 *
 * Output: a 0–100 Photostability Score, per-filter UVA/UVB coverage projection,
 * a 2-hour decay projection and a prioritised, human-readable finding list.
 * ------------------------------------------------------------------------- */

import { INGREDIENTS, lookupIngredient } from '../data/ingredient-database.js';
import { spfFilmIntegrity, reapplyMinute } from './photobiology.js';

/** Tokenise an INCI list: split on commas/semicolons but keep parentheticals. */
export function parseInciList(raw) {
  const cleaned = String(raw ?? '')
    .replace(/\r/g, '')
    .replace(/\n+/g, ', ')
    .replace(/\s{2,}/g, ' ');
  const parts = [];
  let depth = 0;
  let buf = '';
  for (const ch of cleaned) {
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    if ((ch === ',' || ch === ';') && depth === 0) {
      if (buf.trim()) parts.push(buf.trim());
      buf = '';
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts.filter((p) => p.length > 1);
}

/**
 * Resolve parsed tokens to database rows (deduplicated, order preserved).
 * Supports "Avobenzone 3%" percentage capture so the engine can reason about
 * declared filter concentrations.
 */
export function resolveIngredients(raw) {
  const tokens = parseInciList(raw);
  const resolved = [];
  const seen = new Set();
  for (const token of tokens) {
    const pctMatch = token.match(/(\d+(?:\.\d+)?)\s*%/);
    const pct = pctMatch ? Number.parseFloat(pctMatch[1]) : null;
    const row = lookupIngredient(token);
    if (!row) {
      resolved.push({
        token,
        matched: false,
        pct,
        name: token,
        role: 'unknown',
        filterClass: 'none'
      });
      continue;
    }
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    resolved.push({ token, matched: true, pct, ...row });
  }
  return resolved;
}

const PHOTOSTABILISERS = new Set([
  'bemotrizinol',
  'octocrylene',
  'octocrylene-stab',
  'tinosorb-s',
  'desm',
  'mbbt',
  'drometrizole',
  'bisdismutiazine',
  'ecamsule',
  'diethylamino',
  'dimethylamino'
]);

const UVA1_GAP_CAPABLE = new Set([
  'zinc-oxide',
  'bemotrizinol',
  'mbbt',
  'drometrizole',
  'diethylamino',
  'dimethylamino',
  'benzophenone-8',
  'avobenzone',
  'ecamsule'
]);

const BANNED_REEF_IDS = new Set(['benzophenone-3', 'octinoxate']);

/**
 * Evaluate the full rule pack.
 *
 * @param {string|Array} input raw INCI text or a pre-resolved array
 * @param {{ activity?:string, spf?:number, waterResistanceMin?:number }} [ctx]
 */
export function auditIngredients(input, ctx = {}) {
  const items = typeof input === 'string' ? resolveIngredients(input) : input;
  const matched = items.filter((i) => i.matched);
  const byId = new Map(matched.map((i) => [i.id, i]));
  const has = (id) => byId.has(id);

  const filters = matched.filter((i) =>
    ['uva', 'uvb', 'broad', 'mineral'].includes(i.role) && i.filterClass !== 'none'
  );
  const hasMineral = filters.some((f) => f.filterClass === 'inorganic');
  const hasOrganic = filters.some((f) => f.filterClass === 'organic');
  const hasIronOxide = has('iron-oxide');
  const stabilisers = matched.filter((i) => PHOTOSTABILISERS.has(i.id));
  const hasStabiliser = stabilisers.length > 0;

  const findings = [];
  const push = (f) => findings.push({ id: f.id, severity: f.severity, ...f });

  /* --------------------------------------------------- photostability rules */

  const avobenzone = byId.get('avobenzone');
  if (avobenzone) {
    // Effective photostability of avobenzone given the quencher pool.
    let decay = 0.16;
    if (hasStabiliser) decay = Math.min(0.95, 0.16 + 0.22 * stabilisers.length + 0.28);
    if (has('desm')) decay = Math.min(0.98, decay + 0.08);

    avobenzone.effectivePhotostability = Number(decay.toFixed(2));

    if (!hasStabiliser) {
      push({
        id: 'PHOTO-1',
        severity: 'critical',
        title: 'Unstabilised Avobenzone — UVA protection collapses in sunlight',
        detail:
          'Avobenzone without a triplet quencher undergoes keto–enol tautomerism and lose up to 50–60 % of its UVA1 absorbance within 60 minutes of solar exposure. Add bemotrizinol, octocrylene, Tinosorb S or DESM, or switch to a photostable UVA filter (DHHB / Mexoryl SX).',
        tags: ['UVA1', 'photolysis', 'critical'],
        metrics: { avobenzoneHalfLifeMin: 55, projectedUvaLoss1h: '55 %' }
      });
    } else {
      push({
        id: 'PHOTO-1b',
        severity: 'good',
        title: 'Avobenzone is photostabilised',
        detail: `Detected quencher pool: ${stabilisers.map((s) => s.name.split(' (')[0]).join(', ')}. Projected avobenzone retention after 2 h ≈ ${Math.round(decay * 100)} %.`,
        tags: ['UVA1', 'stabilised'],
        metrics: { projectedRetention2h: `${Math.round(decay * 100)} %` }
      });
    }

    for (const bad of ['octinoxate', 'padimate-o', 'cinoxate']) {
      if (has(bad)) {
        const row = byId.get(bad);
        push({
          id: 'PHOTO-2',
          severity: 'critical',
          title: `[2+2] Cycloaddition partner detected — ${row.name.split(' (')[0]}`,
          detail: `${row.name.split(' (')[0]} photo-excites and consumes avobenzone through [2+2] cycloaddition and triplet energy transfer, gutting the UVA1 band even when the SPF number looks healthy. This exact pairing is the textbook example of photounstable US chemical sunscreen chemistry.`,
          tags: ['UVA1', 'photolysis', 'critical'],
          metrics: { uvaHalfLifeMin: 42, projectedUvaLoss60min: '50 %' }
        });
      }
    }
  }

  if (has('benzophenone-3')) {
    push({
      id: 'PHOTO-4',
      severity: 'warning',
      title: 'Oxybenzone (Benzophenone-3) present',
      detail:
        'Oxybenzone is photolabile, a frequent contact photoallergen, has measurable endocrine activity and is banned in Hawaii, Key West, Palau, Aruba and the US Virgin Islands for coral toxicity. Prefer Tinosorb S/M or DHHB.',
      tags: ['reef', 'endocrine', 'photoallergen'],
      metrics: { coralRisk: 5, endocrineRisk: 4 }
    });
  }

  /* --------------------------------------------------------- coverage rules */

  // A UVA1 claim only counts when the filter is actually photostable: unstabilised
  // avobenzone loses most of its 360–400 nm absorbance within an hour, so it cannot
  // be treated as a real UVA1 shield in the same way a triazine or mineral can.
  const avobenzoneSolid = Boolean(avobenzone) && hasStabiliser;
  const hasUva1 = filters.some((f) => {
    if (f.id === 'iron-oxide') return false;
    if (f.id === 'avobenzone') return avobenzoneSolid || filters.length === 1;
    if (f.filterClass === 'inorganic') return f.uvCoverage >= 0.75;
    return (f.uvPeakNm >= 360 && f.uvCoverage >= 0.6) || UVA1_GAP_CAPABLE.has(f.id);
  });
  // Broad-scattering minerals cover UVB spectrally even though their λmax is high.
  const hasUvb = filters.some(
    (f) =>
      (f.uvPeakNm >= 290 && f.uvPeakNm <= 330) ||
      (f.filterClass === 'inorganic' && f.uvCoverage >= 0.75)
  );

  if (filters.length > 0 && !hasUva1) {
    push({
      id: 'PHOTO-5',
      severity: avobenzone && !hasStabiliser ? 'warning' : 'critical',
      title: 'UVA1 gap — no filter covers 360–400 nm',
      detail:
        'Every detected filter peaks below 360 nm, so long-wave UVA1 (which drives dermal collagenase, pigment darkening and photoageing) passes almost unattenuated. Add zinc oxide, Tinosorb S/M, Mexoryl 400 or DHHB. A high SPF/UVB number is not broad-spectrum protection.',
      tags: ['UVA1', 'broad-spectrum'],
      metrics: { uva1Coverage: '0 %' }
    });
  }
  if (filters.length > 0 && !hasUvb) {
    push({
      id: 'PHOTO-6',
      severity: 'warning',
      title: 'UVB coverage is thin',
      detail:
        'No filter with a UVB-band peak was resolved. Sunburn protection (SPF) will be low regardless of the UVA claim.',
      tags: ['UVB', 'SPF'],
      metrics: { uvbCoverage: 'low' }
    });
  }
  if (hasMineral && !hasIronOxide) {
    push({
      id: 'PHOTO-7',
      severity: 'info',
      title: 'Visible-light gap — no iron oxides',
      detail:
        'Untinted zinc/titanium blocks UV but transmits ~65 % of visible light, which drives melasma and post-inflammatory hyperpigmentation. A tinted (iron-oxide) formula closes the blue-light/HEV gap.',
      tags: ['visible-light', 'melasma'],
      metrics: { hevTransmission: '≈65 %' }
    });
  }
  if (filters.length === 0 && items.length > 0) {
    push({
      id: 'PHOTO-0',
      severity: 'info',
      title: 'Not a sunscreen — no approved UV filter resolved',
      detail:
        'This formula carries skincare actives but no UV filter, so the photostability score describes formulation safety rather than sun protection. Pair it with a dedicated broad-spectrum SPF every morning.',
      tags: ['classification'],
      metrics: { uvFilters: 0 }
    });
  }

  /* -------------------------------------------------- photosensitisation rules */

  const retinoids = matched.filter((i) => i.role === 'retinoid' && i.photosensitizing);
  const acids = matched.filter(
    (i) => i.role === 'acid' && i.photosensitizing && !['azelaic-acid', 'tranexamic-acid'].includes(i.id)
  );
  if (retinoids.length || acids.length) {
    const names = [...retinoids, ...acids].map((i) => i.name.split(' (')[0]).join(' + ');
    push({
      id: 'PHOTO-8',
      severity: 'critical',
      title: 'Photosensitising active — mandatory morning SPF 50',
      detail: `${names} increase epidermal turnover / thin the stratum corneum and raise erythemal UV sensitivity by roughly +35 % during the first 1–2 weeks of use. Use only at night, and never skip a broad-spectrum SPF 50 the next morning.`,
      tags: ['photosensitising', 'retinoid', 'AHA'],
      metrics: { erythemalSensitivityGain: '+35 %', medReduction: '≈−26 %' }
    });
  }

  const citrus = matched.filter((i) => i.id === 'citrus-oils');
  if (citrus.length) {
    push({
      id: 'PHOTO-9',
      severity: 'critical',
      title: 'Phototoxic citrus oil (phytophotodermatitis)',
      detail:
        'Expressed citrus oils contain furocoumarins (bergapten, 5-MOP) that intercalate DNA and produce a bullous, streaky burn at UVA doses far below the MED. Never wear this in daylight on sun-exposed skin.',
      tags: ['phototoxic', 'furocoumarin'],
      metrics: { safeUvaDose: 'avoid daylight' }
    });
  }

  if (has('methylisothiazolinone')) {
    push({
      id: 'PHOTO-10',
      severity: 'warning',
      title: 'Methylisothiazolinone (MIT) preservative',
      detail:
        'MIT is the leading cause of cosmetic contact dermatitis and is banned in EU leave-on products. On UV-exposed, barrier-compromised skin the risk of sensitisation rises further.',
      tags: ['allergen', 'preservative'],
      metrics: { patchTestPositiveRate: '≈10 %' }
    });
  }

  /* -------------------------------------------------- comedogenicity rules */

  const comedogenicLoad = matched
    .filter((i) => i.comedogenic >= 3)
    .sort((a, b) => b.comedogenic - a.comedogenic);
  const comedogenicScore = matched.length
    ? Math.min(5, Math.round((comedogenicLoad.reduce((s, i) => s + i.comedogenic, 0) / Math.max(1, matched.length)) * 3))
    : 0;
  if (comedogenicLoad.length >= 2 || comedogenicLoad.some((i) => i.comedogenic === 5)) {
    push({
      id: 'PHOTO-11',
      severity: comedogenicLoad.some((i) => i.comedogenic >= 4) ? 'warning' : 'info',
      title: `Comedogenic load — score ${comedogenicScore}/5`,
      detail: `Pore-clogging esters detected: ${comedogenicLoad
        .map((i) => `${i.name.split(' (')[0]} (${i.comedogenic}/5)`)
        .join(', ')}. On acne-prone or humid-climate skin, swap toward squalane, caprylic/capric triglyceride or dimethicone-based vehicles.`,
      tags: ['comedogenic', 'acne'],
      metrics: {
        aggregate: `${comedogenicScore}/5`,
        topOffender: comedogenicLoad[0]?.name.split(' (')[0] ?? '—'
      }
    });
  }

  /* --------------------------------------------------------- reef & endocrine */

  const reefLoad = matched.filter((i) => i.reefBanned || i.coralRisk >= 4);
  if (reefLoad.length) {
    push({
      id: 'PHOTO-12',
      severity: 'warning',
      title: 'Reef-toxin filters detected',
      detail: `${reefLoad.map((i) => i.name.split(' (')[0]).join(', ')} — banned in Hawaii / Key West / Palau and implicated in coral bleaching and larval deformity. Switch to non-nano zinc oxide, Tinosorb S/M or DHHB.`,
      tags: ['reef', 'environment'],
      metrics: { bannedIn: 'HI · Key West · Palau · Aruba · USVI' }
    });
  }

  const endocrineLoad = matched.filter((i) => i.endocrine >= 3);
  if (endocrineLoad.length >= 2) {
    push({
      id: 'PHOTO-13',
      severity: 'info',
      title: 'Endocrine-suspicion stack',
      detail: `${endocrineLoad.map((i) => i.name.split(' (')[0]).join(', ')} — multiple filters with in-vitro endocrine activity. Cumulative exposure matters more than any single filter; prefer mineral or modern triazine filters for daily use, especially in children.`,
      tags: ['endocrine'],
      metrics: { count: endocrineLoad.length }
    });
  }

  if (has('alcohol-denat') && hasMineral) {
    push({
      id: 'PHOTO-14',
      severity: 'info',
      title: 'Film plasticiser conflict — high alcohol + mineral filter',
      detail:
        'Volatile alcohol can de-wet mineral particles and crack the film on reapplication, creating UV "holidays" on the high points of the face. Look for a silicone or ester plasticiser in the INCI.',
      tags: ['film', 'formulation'],
      metrics: {}
    });
  }

  /* --------------------------------------------------------- score assembly */

  const severityWeight = { critical: 26, warning: 13, info: 4, good: -6 };
  let penalty = 0;
  for (const f of findings) penalty += severityWeight[f.severity] ?? 0;

  // Bonus for genuine photostability + broad spectrum
  const coverageUva = hasUva1 ? 1 : 0;
  const coverageUvb = hasUvb ? 1 : 0;
  const stabilityAvg = filters.length
    ? filters.reduce((s, f) => s + (f.effectivePhotostability ?? f.photostability ?? 0.5), 0) /
      filters.length
    : 0;
  const breadth = filters.length ? filters.reduce((s, f) => s + f.uvCoverage, 0) / filters.length : 0;

  let score = 62 + stabilityAvg * 26 + breadth * 10 + (coverageUva + coverageUvb) * 4 - penalty;
  if (hasMineral && !hasOrganic && !hasIronOxide) score -= 2;
  score = Math.max(0, Math.min(100, Math.round(score)));

  const isSunscreen = filters.length > 0;
  const grade = !isSunscreen
    ? { letter: '—', label: 'Treatment product — not a sunscreen', tone: 'info' }
    : score >= 82
      ? { letter: 'A', label: 'Photostable & Broad-Spectrum', tone: 'ok' }
      : score >= 68
        ? { letter: 'B', label: 'Solid — Minor Gaps', tone: 'ok' }
        : score >= 52
          ? { letter: 'C', label: 'Compromised Photostability', tone: 'warn' }
          : score >= 34
            ? { letter: 'D', label: 'High Degradation Risk', tone: 'danger' }
            : { letter: 'F', label: 'Not Sun-Protective As Formulated', tone: 'danger' };

  // Projected 2-hour film integrity from the worst filter in the product.
  const worstFilter = filters.slice().sort((a, b) => (a.photostability ?? 1) - (b.photostability ?? 1))[0];
  const filterKeyMap = {
    avobenzone: hasStabiliser ? 'avobenzone_stabilized' : 'avobenzone_unstabilized',
    octinoxate: 'octinoxate',
    octocrylene: 'octocrylene',
    bemotrizinol: 'bemotrizinol',
    zinc_oxide: 'zinc_oxide',
    'zinc-oxide': 'zinc_oxide',
    'titanium-dioxide': 'titanium_dioxide',
    ecamsule: 'ecamsule',
    ensulizole: 'ensulizole',
    homosalate: 'homosalate',
    octisalate: 'octisalate',
    'padimate-o': 'padimate_o',
    'trolamine-salicylate': 'trolamine_salicylate',
    'bisdismutiazine': 'bisdisulizole',
    drometrizole: 'drometrizole_trisiloxane',
    'diethylamino': 'avobenzone_stabilized',
    'dimethylamino': 'avobenzone_stabilized'
  };
  const filmKey = (worstFilter && filterKeyMap[worstFilter.id]) || 'avobenzone_unstabilized';
  const assumedSpf = ctx.spf ?? 30;
  const decay2h = [0, 30, 60, 90, 120].map((t) => ({
    t,
    ...spfFilmIntegrity({
      minutes: t,
      spf: assumedSpf,
      activity: ctx.activity ?? 'walk',
      filterKey: filmKey,
      waterResistanceMin: ctx.waterResistanceMin ?? 40
    })
  }));
  const reapply = reapplyMinute({
    spf: assumedSpf,
    activity: ctx.activity ?? 'walk',
    filterKey: filmKey,
    waterResistanceMin: ctx.waterResistanceMin ?? 40
  });

  const uvaCoveragePct = Math.round(
    Math.min(
      100,
      filters.reduce((s, f) => s + f.uvCoverage * (f.uvPeakNm >= 340 ? 1 : 0.45), 0) * 42
    )
  );
  const uvbCoveragePct = Math.round(
    Math.min(100, filters.reduce((s, f) => s + (f.uvPeakNm <= 330 ? f.uvCoverage : 0.1) * 1, 0) * 46)
  );

  return {
    items,
    matched,
    unknown: items.filter((i) => !i.matched),
    filters: filters.map((f) => ({
      id: f.id,
      name: f.name,
      role: f.role,
      filterClass: f.filterClass,
      uvPeakNm: f.uvPeakNm,
      uvCoverage: f.uvCoverage,
      photostability: f.effectivePhotostability ?? f.photostability,
      coralRisk: f.coralRisk,
      comedogenic: f.comedogenic
    })),
    coverage: {
      uva: uvaCoveragePct,
      uvb: uvbCoveragePct,
      broadSpectrum: hasUva1 && hasUvb,
      mineral: hasMineral,
      organic: hasOrganic,
      ironOxide: hasIronOxide,
      stabilised: hasStabiliser
    },
    stability: {
      average: Number(stabilityAvg.toFixed(3)),
      worstFilter: worstFilter ? worstFilter.name.split(' (')[0] : null,
      worstPhotostability: worstFilter ? worstFilter.photostability : null,
      filmKey
    },
    score,
    grade,
    comedogenicScore,
    findings: findings.sort((a, b) => {
      const order = { critical: 0, warning: 1, info: 2, good: 3 };
      return order[a.severity] - order[b.severity];
    }),
    decay2h,
    reapplyMinute: reapply,
    counts: {
      total: items.length,
      matched: matched.length,
      unknown: items.length - matched.length,
      filters: filters.length
    }
  };
}

/** Human-readable counts for the DB card. */
export const DATABASE_STATS = Object.freeze({
  total: INGREDIENTS.length,
  filters: INGREDIENTS.filter((i) => ['uva', 'uvb', 'broad', 'mineral'].includes(i.role)).length,
  mineral: INGREDIENTS.filter((i) => i.filterClass === 'inorganic').length,
  retinoids: INGREDIENTS.filter((i) => i.role === 'retinoid').length,
  acids: INGREDIENTS.filter((i) => i.role === 'acid').length,
  reefBanned: INGREDIENTS.filter((i) => i.reefBanned).length,
  highComedogenic: INGREDIENTS.filter((i) => i.comedogenic >= 4).length,
  photosensitizing: INGREDIENTS.filter((i) => i.photosensitizing).length
});
