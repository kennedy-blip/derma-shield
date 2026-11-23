/**
 * DERMA-SHIELD · product-presets.js
 * -----------------------------------------------------------------------------
 * Four instant INCI strings engineered to exercise every branch of the
 * photostability rule pack (PHOTO-1 … PHOTO-14). Each preset carries the exact
 * finding IDs the auditor must emit — `engine-selftest.mjs` asserts them, so a
 * regression in the rules engine cannot ship silently.
 * ------------------------------------------------------------------------- */

export const PRODUCT_PRESETS = Object.freeze([
  {
    id: 'unstable-us',
    name: 'Unstabilized US Chemical Sunscreen',
    tagline: 'Avobenzone 3 % + Octinoxate 7.5 %',
    tone: 'danger',
    inci: 'Avobenzone 3%, Octinoxate 7.5%, Homosalate 10%, Octisalate 5%, Oxybenzone 4%, Alcohol Denat, Fragrance, Tocopheryl Acetate, Caprylic/Capric Triglyceride',
    expected: {
      score: [0, 55],
      grade: ['D', 'F'],
      mustFlag: ['PHOTO-1', 'PHOTO-2', 'PHOTO-4', 'PHOTO-12'],
      summary:
        'Loses ~50 % of its UVA1 protection within 60 minutes of sunlight through [2+2] cycloaddition between avobenzone and the cinnamate filter.'
    }
  },
  {
    id: 'reef-safe',
    name: 'Next-Gen Photostable Mineral / Hybrid Reef-Safe',
    tagline: 'Non-Nano Zinc 18 % + Tinosorb S',
    tone: 'ok',
    inci: 'Non-Nano Zinc Oxide 18%, Bis-Ethylhexyloxyphenol Methoxyphenyl Triazine 3%, Diethylamino Hydroxybenzoyl Hexyl Benzoate 5%, Caprylic/Capric Triglyceride, Squalane, Dimethicone, Glycerin, Niacinamide, Tocopherol, Iron Oxides CI 77492',
    expected: {
      score: [74, 100],
      grade: ['A', 'B'],
      mustFlag: [],
      mustNotFlag: ['PHOTO-1', 'PHOTO-2', 'PHOTO-5', 'PHOTO-6', 'PHOTO-12'],
      summary:
        'Broad-spectrum UVA1/UVB past 380 nm with a photostable triplet-quencher pool and iron-oxide visible-light coverage.'
    }
  },
  {
    id: 'comedogenic-cream',
    name: 'Heavy Comedogenic Facial Cream',
    tagline: 'Isopropyl Myristate + Coconut Alkanes + Fragrance',
    tone: 'warn',
    inci: 'Water, Isopropyl Myristate, Coconut Alkanes, Acetylated Lanolin Alcohol, Cocoa Butter, Prunus Amygdalus Dulcis Oil, Citrus Bergamia Peel Oil, Parfum, Limonene, Linalool, Methylisothiazolinone, Avobenzone 2%, Octisalate 5%',
    expected: {
      score: [0, 60],
      grade: ['C', 'D', 'F'],
      mustFlag: ['PHOTO-5', 'PHOTO-9', 'PHOTO-10', 'PHOTO-11'],
      summary:
        'Pore-clogging ester stack (5/5 comedogenic) plus phototoxic bergamot furocoumarins and a banned-in-EU preservative — never wear this in daylight.'
    }
  },
  {
    id: 'night-serum',
    name: 'Photosensitizing AHA / Retinoid Night Serum',
    tagline: 'Glycolic Acid 10 % + Retinol',
    tone: 'warn',
    inci: 'Water, Glycolic Acid 10%, Retinol 0.3%, Niacinamide 5%, Panthenol, Sodium Hyaluronate, Ceramide NP, Glycerin, Phenoxyethanol',
    expected: {
      score: [40, 85],
      grade: ['—', 'B', 'C', 'D'],
      mustFlag: ['PHOTO-8', 'PHOTO-0'],
      summary:
        'Raises erythemal UV sensitivity by roughly +35 % for 1–2 weeks; strictly a night product with mandatory morning SPF 50.'
    }
  }
]);

export const DEFAULT_INCI = PRODUCT_PRESETS[0].inci;
