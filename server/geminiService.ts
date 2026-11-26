import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type {
  AiPrioritizationResult,
  HospitalRecommendationResult,
  LatLng,
  MedicalFacility,
  MedicineFacilityFinding,
  MedicineSearchResult,
  MedicineSourceLink,
} from '../src/types/medfind.ts';
import { isSafePublicHttpUrl, sanitizeExternalUrl } from '../src/utils/urlSafety.ts';
import { searchMedicineShopsNearby } from './placesService.ts';

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}_TIMEOUT`)), ms);
    promise.then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim() === '' || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error('GEMINI_API_KEY_MISSING');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function withGeminiFallback<T>(
  runWithModel: (modelName: string, isLite: boolean) => Promise<T>
): Promise<T> {
  const attempts: Array<{ model: string; isLite: boolean; delayMs: number }> = [
    { model: 'gemini-4-hydrogen', isLite: false, delayMs: 0 },
    { model: 'gemini-3.1-flash-lite', isLite: true, delayMs: 250 },
  ];
  let lastError: unknown;
  for (const step of attempts) {
    if (step.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, step.delayMs));
    }
    try {
      return await runWithModel(step.model, step.isLite);
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isTransient =
        msg.includes('503') ||
        msg.includes('UNAVAILABLE') ||
        msg.includes('high demand') ||
        msg.includes('429') ||
        msg.includes('RESOURCE_EXHAUSTED');
      if (!isTransient) {
        throw err;
      }
    }
  }
  throw lastError;
}

function extractJsonObject<T>(rawText: string): T | null {
  const trimmed = rawText.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  try {
    return JSON.parse(candidate) as T;
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1)) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}

export async function analyzeFacilityPriorities(
  facilities: MedicalFacility[],
  needQuery?: string
): Promise<AiPrioritizationResult> {
  const ai = getAiClient();
  const conciseFacilities = facilities.slice(0, 15).map((f) => ({
    id: f.id,
    name: f.name,
    category: f.category,
    distanceKm: f.distanceKm,
    rating: f.rating,
    userRatingCount: f.userRatingCount,
    openNow: f.openNow,
    hoursSummary: f.hoursSummary,
    weekdayDescriptions: f.weekdayDescriptions.slice(0, 3),
    address: f.address,
  }));

  const prompt = [
    'You are a clinical care navigation analyst for MedFind.',
    'Analyze the following real nearby medical facilities (clinics, pharmacies, hospitals) and prioritize the best-rated facilities based on real-time availability (openNow and hours), rating confidence, and proximity.',
    needQuery && needQuery.trim()
      ? `User care need or search context: "${needQuery.trim()}".`
      : 'User wants the best immediately available care or pharmacy nearby.',
    'Do NOT invent any address, rating, or opening hours not present in the input.',
    `Facilities JSON: ${JSON.stringify(conciseFacilities)}`,
  ].join('\n\n');

  const response = await withGeminiFallback((model, isLite) =>
    ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        systemInstruction:
          'Be concise, clinically objective, and strictly grounded in the provided facility JSON. Prioritize open facilities with strong ratings and low distance.',
        ...(isLite ? {} : { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }),
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            overview: {
              type: Type.STRING,
              description: '2-sentence executive summary of the best available facilities right now.',
            },
            topPickId: {
              type: Type.STRING,
              description: 'The facility id of the #1 recommended facility right now.',
            },
            rankedFacilities: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  facilityId: { type: Type.STRING },
                  facilityName: { type: Type.STRING },
                  priorityRank: { type: Type.INTEGER },
                  availabilityVerdict: {
                    type: Type.STRING,
                    description: 'Short label like Open Now - High Availability or Closed Until Tomorrow.',
                  },
                  clinicalSummary: {
                    type: Type.STRING,
                    description: '1 concise sentence explaining why this facility ranks here.',
                  },
                  watchout: {
                    type: Type.STRING,
                    description: 'Optional caution such as limited review count or closed status, or empty string.',
                  },
                },
              },
            },
          },
        },
      },
    })
  );

  const parsed = JSON.parse((response.text ?? '{}').trim()) as {
    overview?: string;
    topPickId?: string;
    rankedFacilities?: Array<{
      facilityId: string;
      facilityName: string;
      priorityRank: number;
      availabilityVerdict: string;
      clinicalSummary: string;
      watchout?: string;
    }>;
  };

  return {
    overview:
      parsed.overview ||
      'Facilities prioritized by real-time open status, verified patient ratings, and travel distance.',
    topPickId: parsed.topPickId || conciseFacilities[0]?.id || null,
    rankedFacilities: (parsed.rankedFacilities ?? []).map((item, idx) => ({
      facilityId: item.facilityId,
      facilityName: item.facilityName,
      priorityRank: item.priorityRank || idx + 1,
      availabilityVerdict: item.availabilityVerdict || 'Check Hours',
      clinicalSummary: item.clinicalSummary || '',
      watchout: item.watchout && item.watchout.trim().length > 0 ? item.watchout.trim() : null,
    })),
  };
}

async function fetchSafeClinicPageExcerpt(
  rawUrl: string
): Promise<{ url: string; title: string; excerpt: string } | null> {
  if (!isSafePublicHttpUrl(rawUrl)) return null;
  try {
    let targetUrl = rawUrl;
    let res = await fetch(targetUrl, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(3500),
      headers: {
        'User-Agent': 'MedFindClinicChecker/1.0',
        Accept: 'text/html,application/xhtml+xml,text/plain',
      },
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) return null;
      const resolved = new URL(location, targetUrl).toString();
      if (!isSafePublicHttpUrl(resolved)) return null;
      targetUrl = resolved;
      res = await fetch(targetUrl, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(3500),
        headers: {
          'User-Agent': 'MedFindClinicChecker/1.0',
          Accept: 'text/html,application/xhtml+xml,text/plain',
        },
      });
    }

    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || '';
    if (
      !contentType.includes('text/html') &&
      !contentType.includes('text/plain') &&
      !contentType.includes('application/xhtml+xml')
    ) {
      return null;
    }

    const rawHtml = (await res.text()).slice(0, 140_000);
    const titleMatch = rawHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch
      ? titleMatch[1].replace(/\s+/g, ' ').trim().slice(0, 120)
      : new URL(targetUrl).hostname;

    const textOnly = rawHtml
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 2000);

    if (!textOnly) return null;
    return { url: targetUrl, title, excerpt: textOnly };
  } catch {
    return null;
  }
}

export async function searchMedicineOnClinicPages(params: {
  medicineQuery: string;
  facilities: MedicalFacility[];
  origin?: LatLng;
  locationLabel?: string;
  radiusMeters?: number;
}): Promise<MedicineSearchResult> {
  const { medicineQuery, facilities, origin, locationLabel, radiusMeters = 10000 } = params;
  const ai = getAiClient();

  let mergedFacilities = [...facilities];
  const existingPharmacies = mergedFacilities.filter((f) => f.category === 'pharmacy').length;
  const mapsApiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY;

  if (origin && mapsApiKey && existingPharmacies < 4) {
    try {
      const freshShops = await withTimeout(
        searchMedicineShopsNearby({
          origin,
          radiusMeters,
          locationLabel,
          apiKey: mapsApiKey,
        }),
        6000,
        'PLACES_SHOPS'
      );
      const seenIds: Record<string, boolean> = {};
      for (const f of mergedFacilities) seenIds[f.id] = true;
      for (const shop of freshShops) {
        if (!seenIds[shop.id]) {
          seenIds[shop.id] = true;
          mergedFacilities.push(shop);
        }
      }
    } catch {
      // Continue with existing facilities
    }
  }

  const candidates = [...mergedFacilities]
    .filter((f) => f.category === 'pharmacy' || f.category === 'clinic' || f.category === 'hospital')
    .sort((a, b) => {
      const catWeight = (c: MedicalFacility['category']) => (c === 'pharmacy' ? 0 : c === 'clinic' ? 1 : 2);
      const openWeight = (f: MedicalFacility) => (f.openNow === true ? 0 : f.openNow === null ? 1 : 2);
      const urlWeight = (f: MedicalFacility) => (isSafePublicHttpUrl(f.websiteUri) ? 0 : 1);
      return (
        catWeight(a.category) - catWeight(b.category) ||
        openWeight(a) - openWeight(b) ||
        urlWeight(a) - urlWeight(b) ||
        a.distanceKm - b.distanceKm
      );
    })
    .slice(0, 8);

  const safeWebsites = candidates
    .map((f) => f.websiteUri)
    .filter((u): u is string => isSafePublicHttpUrl(u));

  const uniqueUrls = Array.from(new Set(safeWebsites)).slice(0, 4);

  const fetchedPagesPromise = Promise.all(
    uniqueUrls.map((u) => fetchSafeClinicPageExcerpt(u))
  ).then((items) =>
    items.filter((p): p is { url: string; title: string; excerpt: string } => p !== null)
  );

  const facilitySummary = candidates.map((f) => ({
    id: f.id,
    name: f.name,
    category: f.category,
    address: f.address,
    distanceKm: f.distanceKm,
    openNow: f.openNow,
    phone: f.phone,
    websiteUri: isSafePublicHttpUrl(f.websiteUri) ? f.websiteUri : null,
  }));

  const locationContextText = locationLabel
    ? `${locationLabel}${origin ? ` (${origin.lat.toFixed(4)}, ${origin.lng.toFixed(4)})` : ''}`
    : origin
      ? `${origin.lat.toFixed(4)}, ${origin.lng.toFixed(4)}`
      : 'the user area';

  const webSearchPrompt = [
    `Use Google Search to check web listings, pharmacy chains, clinic/dispensary pages, and online medicine directories for "${medicineQuery}" near ${locationContextText}.`,
    `Also evaluate these real nearby medical shops and clinics discovered via Google Maps:\n${JSON.stringify(facilitySummary)}`,
    'Return ONLY a JSON object with this exact structure (no markdown or extra commentary):',
    `{
  "clinicalGuidance": "2 concise sentences covering whether ${medicineQuery} requires a prescription, typical availability at local medical shops vs online pharmacies serving ${locationContextText}, and confirming stock by phone.",
  "findings": [
    {
      "facilityId": "exact facility id from input when referring to a local shop, or web-1/web-2 for an online/regional pharmacy found via Google Search",
      "facilityName": "string",
      "websiteUri": "optional verified url or null",
      "availabilityStatus": "Listed on Clinic/Pharmacy Page" | "Pharmacy Department Confirmed" | "Call Pharmacy to Confirm" | "Not Listed Online",
      "confidenceLabel": "High" | "Moderate" | "Verify by Phone",
      "evidenceSummary": "1-2 sentences citing what Google web data or the pharmacy page indicates about dispensing/carrying this medicine.",
      "dosageOrFormNote": "Optional note about Rx requirement, generic/brand forms, or delivery/pickup, or null"
    }
  ]
}`,
    'Include the nearby Google Maps pharmacies/shops first, plus up to 2 relevant online/regional pharmacy sources from Google Search if helpful. Never invent fake private store shelf counts.',
  ].join('\n\n');

  let responseText = '';
  let groundingChunks: Array<{ web?: { uri?: string; title?: string } }> = [];
  let webSearchUsed = false;

  try {
    const response = await withTimeout(
      ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: webSearchPrompt,
        config: {
          tools: [{ googleSearch: {} }],
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      }),
      18000,
      'GOOGLE_SEARCH'
    );
    responseText = response.text ?? '';
    groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
    webSearchUsed = true;
  } catch (toolErr) {
    const toolMsg = toolErr instanceof Error ? toolErr.message : String(toolErr);
    const shouldFallback =
      toolMsg.includes('429') ||
      toolMsg.includes('RESOURCE_EXHAUSTED') ||
      toolMsg.includes('503') ||
      toolMsg.includes('UNAVAILABLE') ||
      toolMsg.includes('400') ||
      toolMsg.includes('TIMEOUT');

    if (!shouldFallback) {
      throw toolErr;
    }

    const fetchedPages = await fetchedPagesPromise;
    const structuredPrompt = [
      `Evaluate availability of "${medicineQuery}" for a patient near ${locationContextText}.`,
      candidates.length > 0
        ? `Nearby Pharmacies, Medical Stores & Clinics (from Google Maps):\n${JSON.stringify(facilitySummary)}`
        : `No local pharmacies matched in Google Places near ${locationContextText}; provide clear guidance on prescription status and common pharmacy/clinic channels to obtain ${medicineQuery}.`,
      fetchedPages.length > 0
        ? `Fetched Clinic & Pharmacy Webpage Excerpts:\n${JSON.stringify(fetchedPages)}`
        : 'Local shops did not expose direct public HTML formularies; advise calling the pharmacy counter directly to verify same-day stock.',
      'Never fabricate live shelf inventory counts. Distinguish clearly between pharmacy/dispensary capabilities versus medications requiring direct pharmacy counter confirmation.',
    ].join('\n\n');

    const runLite = () =>
      ai.models.generateContent({
        model: 'gemini-3.1-flash-lite',
        contents: structuredPrompt,
        config: {
          systemInstruction:
            'Be accurate and transparent. Ground findings strictly in the provided Google Maps shop metadata and fetched webpage excerpts.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              clinicalGuidance: { type: Type.STRING },
              findings: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    facilityId: { type: Type.STRING },
                    facilityName: { type: Type.STRING },
                    availabilityStatus: {
                      type: Type.STRING,
                      description:
                        'Must be one of: Listed on Clinic/Pharmacy Page, Pharmacy Department Confirmed, Call Pharmacy to Confirm, Not Listed Online.',
                    },
                    confidenceLabel: {
                      type: Type.STRING,
                      description: 'Must be one of: High, Moderate, Verify by Phone.',
                    },
                    evidenceSummary: { type: Type.STRING },
                    dosageOrFormNote: { type: Type.STRING },
                  },
                },
              },
            },
          },
        },
      });

    let fallbackResponse;
    try {
      fallbackResponse = await runLite();
    } catch (liteErr) {
      const msg = liteErr instanceof Error ? liteErr.message : String(liteErr);
      if (msg.includes('503') || msg.includes('UNAVAILABLE')) {
        await new Promise((r) => setTimeout(r, 600));
        fallbackResponse = await runLite();
      } else {
        throw liteErr;
      }
    }
    responseText = fallbackResponse.text ?? '';
  }

  const fetchedPages = await fetchedPagesPromise;
  const groundingSources: MedicineSourceLink[] = [];
  const seenUrls: Record<string, boolean> = {};

  for (const page of fetchedPages) {
    if (!seenUrls[page.url]) {
      seenUrls[page.url] = true;
      groundingSources.push({ title: page.title, uri: page.url });
    }
  }
  for (const chunk of groundingChunks) {
    const uri = sanitizeExternalUrl(chunk.web?.uri);
    if (uri && !seenUrls[uri]) {
      seenUrls[uri] = true;
      groundingSources.push({
        title: chunk.web?.title || new URL(uri).hostname,
        uri,
      });
    }
  }

  const parsed = extractJsonObject<{
    clinicalGuidance?: string;
    findings?: Array<{
      facilityId?: string;
      facilityName?: string;
      websiteUri?: string | null;
      availabilityStatus?: MedicineFacilityFinding['availabilityStatus'];
      confidenceLabel?: MedicineFacilityFinding['confidenceLabel'];
      evidenceSummary?: string;
      dosageOrFormNote?: string | null;
    }>;
  }>(responseText);

  const facilityMap: Record<string, MedicalFacility> = {};
  for (const c of candidates) {
    facilityMap[c.id] = c;
  }

  const findings: MedicineFacilityFinding[] = (parsed?.findings ?? []).map((item, idx) => {
    const matched =
      (item.facilityId && facilityMap[item.facilityId]) ||
      candidates.find(
        (c) =>
          item.facilityName &&
          c.name.toLowerCase().includes(item.facilityName.toLowerCase())
      ) ||
      null;

    const websiteUri = matched?.websiteUri ?? sanitizeExternalUrl(item.websiteUri);
    const sourceLinks: MedicineSourceLink[] = [];
    if (websiteUri) {
      sourceLinks.push({
        title: `${matched?.name ?? item.facilityName ?? 'Pharmacy'} Website`,
        uri: websiteUri,
      });
    }
    for (const gs of groundingSources.slice(0, 2)) {
      if (!sourceLinks.some((s) => s.uri === gs.uri)) {
        sourceLinks.push(gs);
      }
    }

    const rawStatus = String(item.availabilityStatus || '').trim();
    const normalizedStatus: MedicineFacilityFinding['availabilityStatus'] =
      rawStatus === 'Listed on Clinic/Pharmacy Page' ||
      rawStatus === 'Pharmacy Department Confirmed' ||
      rawStatus === 'Call Pharmacy to Confirm' ||
      rawStatus === 'Not Listed Online'
        ? rawStatus
        : matched?.websiteUri
          ? 'Pharmacy Department Confirmed'
          : 'Call Pharmacy to Confirm';

    const rawConf = String(item.confidenceLabel || '').trim();
    const normalizedConfidence: MedicineFacilityFinding['confidenceLabel'] =
      rawConf === 'High' || rawConf === 'Moderate' || rawConf === 'Verify by Phone'
        ? rawConf
        : 'Verify by Phone';

    return {
      facilityId: matched?.id || item.facilityId || `web-${idx + 1}`,
      facilityName: matched?.name || item.facilityName || 'Pharmacy / Web Source',
      address: matched?.address ?? null,
      distanceKm: matched?.distanceKm ?? null,
      openNow: matched?.openNow ?? null,
      phone: matched?.phone ?? null,
      websiteUri,
      googleMapsUri: matched?.googleMapsUri ?? null,
      facility: matched ?? null,
      availabilityStatus: normalizedStatus,
      confidenceLabel: normalizedConfidence,
      evidenceSummary:
        item.evidenceSummary ||
        'Review facility webpage or call the pharmacy counter directly to verify same-day stock.',
      dosageOrFormNote: item.dosageOrFormNote || null,
      sourceLinks,
    };
  });

  // Ensure discovered nearby shops appear if parsed findings omitted them
  for (const c of candidates) {
    if (!findings.some((f) => f.facilityId === c.id)) {
      findings.push({
        facilityId: c.id,
        facilityName: c.name,
        address: c.address,
        distanceKm: c.distanceKm,
        openNow: c.openNow,
        phone: c.phone,
        websiteUri: c.websiteUri,
        googleMapsUri: c.googleMapsUri,
        facility: c,
        availabilityStatus: c.websiteUri ? 'Pharmacy Department Confirmed' : 'Call Pharmacy to Confirm',
        confidenceLabel: 'Verify by Phone',
        evidenceSummary: c.phone
          ? `Nearby ${c.primaryTypeLabel.toLowerCase()} ${c.distanceKm.toFixed(1)} km away. Call ${c.phone} to confirm ${medicineQuery} stock.`
          : `Nearby ${c.primaryTypeLabel.toLowerCase()} ${c.distanceKm.toFixed(1)} km away. Visit or check Maps listing for counter stock.`,
        dosageOrFormNote: null,
        sourceLinks: c.websiteUri
          ? [{ title: `${c.name} Website`, uri: c.websiteUri }]
          : groundingSources.slice(0, 2),
      });
    }
  }

  return {
    medicineQuery,
    clinicalGuidance:
      parsed?.clinicalGuidance ||
      'Nearby medical shops and web pharmacy listings help locate dispensing counters. Always confirm exact dosage stock by phone before traveling.',
    findings,
    groundingSources,
    nearbyShopsCount: candidates.length,
    webSearchUsed,
  };
}

export async function recommendHospitalsFromReviews(
  hospitals: MedicalFacility[]
): Promise<HospitalRecommendationResult> {
  const ai = getAiClient();
  const payload = hospitals.slice(0, 10).map((h) => ({
    id: h.id,
    name: h.name,
    distanceKm: h.distanceKm,
    rating: h.rating,
    userRatingCount: h.userRatingCount,
    openNow: h.openNow,
    address: h.address,
    reviews: h.reviews.slice(0, 4).map((r) => ({
      rating: r.rating,
      text: r.text.slice(0, 350),
      when: r.relativePublishTimeDescription ?? '',
    })),
  }));

  const prompt = [
    'Analyze the following nearby hospitals based strictly on their patient reviews, rating volume, open status, and proximity (distanceKm).',
    'Produce objective hospital recommendations highlighting review sentiment, wait-time or care quality patterns, proximity trade-offs, and best-fit scenarios.',
    `Hospitals JSON: ${JSON.stringify(payload)}`,
  ].join('\n\n');

  const response = await withGeminiFallback((model, isLite) =>
    ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        systemInstruction:
          'Ground every insight strictly in the supplied patient review snippets, ratings, and distances. Do not fabricate medical outcomes or external ratings.',
        ...(isLite ? {} : { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }),
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: {
              type: Type.STRING,
              description: '2-sentence summary comparing the top nearby hospitals on patient reviews and distance.',
            },
            recommendations: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  facilityId: { type: Type.STRING },
                  hospitalName: { type: Type.STRING },
                  rank: { type: Type.INTEGER },
                  reviewSentimentScore: {
                    type: Type.STRING,
                    description: 'Concise qualitative sentiment label e.g. Strongly Positive or Mixed Wait Times.',
                  },
                  proximityNote: { type: Type.STRING },
                  patientReviewHighlights: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                  },
                  potentialDrawback: { type: Type.STRING },
                  bestFor: { type: Type.STRING },
                },
              },
            },
          },
        },
      },
    })
  );

  const parsed = JSON.parse((response.text ?? '{}').trim()) as {
    summary?: string;
    recommendations?: Array<{
      facilityId: string;
      hospitalName: string;
      rank: number;
      reviewSentimentScore: string;
      proximityNote: string;
      patientReviewHighlights: string[];
      potentialDrawback?: string;
      bestFor: string;
    }>;
  };

  return {
    summary:
      parsed.summary ||
      'Hospitals ranked by verified patient review sentiment, review count confidence, and proximity.',
    recommendations: (parsed.recommendations ?? []).map((rec, idx) => ({
      facilityId: rec.facilityId,
      hospitalName: rec.hospitalName,
      rank: rec.rank || idx + 1,
      reviewSentimentScore: rec.reviewSentimentScore || 'Reviewed',
      proximityNote: rec.proximityNote || '',
      patientReviewHighlights: rec.patientReviewHighlights ?? [],
      potentialDrawback:
        rec.potentialDrawback && rec.potentialDrawback.trim().length > 0
          ? rec.potentialDrawback.trim()
          : null,
      bestFor: rec.bestFor || 'General Hospital Care',
    })),
  };
}
