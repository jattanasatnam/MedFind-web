import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import type { MedicalFacility } from './src/types/medfind.ts';
import {
  analyzeFacilityPriorities,
  recommendHospitalsFromReviews,
  searchMedicineOnClinicPages,
} from './server/geminiService.ts';
import { searchNearbyMedicalPlaces } from './server/placesService.ts';

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '1mb' }));

function isValidLatLng(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

function validateFacilitiesArray(input: unknown): MedicalFacility[] | null {
  if (!Array.isArray(input) || input.length === 0 || input.length > 30) {
    return null;
  }
  return input.filter(
    (item): item is MedicalFacility =>
      Boolean(item) &&
      typeof item === 'object' &&
      typeof (item as MedicalFacility).id === 'string' &&
      typeof (item as MedicalFacility).name === 'string'
  );
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'medfind-api' });
});

app.get('/api/maps-config', (_req, res) => {
  const mapsApiKey =
    process.env.VITE_GOOGLE_MAPS_API_KEY ||
    process.env.GOOGLE_MAPS_API_KEY ||
    '';
  res.json({ mapsApiKey });
});

app.post('/api/places/nearby', async (req, res) => {
  try {
    const { lat, lng, radiusMeters = 5000, query } = req.body ?? {};
    if (!isValidLatLng(lat, lng)) {
      res.status(400).json({ error: 'Valid latitude and longitude coordinates are required.' });
      return;
    }

    const mapsApiKey =
      process.env.GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY;
    if (!mapsApiKey) {
      res.status(503).json({ error: 'Google Maps API key is not configured on the server.' });
      return;
    }

    const safeRadius =
      typeof radiusMeters === 'number' && Number.isFinite(radiusMeters)
        ? radiusMeters
        : 5000;
    const safeQuery = typeof query === 'string' ? query.slice(0, 120) : undefined;

    const facilities = await searchNearbyMedicalPlaces({
      origin: { lat, lng },
      radiusMeters: safeRadius,
      query: safeQuery,
      apiKey: mapsApiKey,
    });

    res.json({ facilities });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch nearby facilities.';
    if (message.includes('429') || message.includes('RESOURCE_EXHAUSTED')) {
      res.status(429).json({ error: 'Google Maps Places quota reached.', code: 'RESOURCE_EXHAUSTED' });
      return;
    }
    res.status(500).json({ error: message });
  }
});

function handleAiError(res: express.Response, err: unknown, fallbackMessage: string) {
  const raw = err instanceof Error ? err.message : fallbackMessage;
  console.error('[MedFind AI Error]', raw.slice(0, 400));
  if (raw === 'GEMINI_API_KEY_MISSING') {
    res.status(503).json({
      error: 'Gemini API key is not configured in Settings > Secrets.',
    });
    return;
  }
  if (raw.includes('429') || raw.includes('RESOURCE_EXHAUSTED')) {
    res.status(429).json({
      error: 'AI service rate limit reached. Please wait a moment and try again.',
    });
    return;
  }
  if (raw.includes('503') || raw.includes('UNAVAILABLE') || raw.includes('high demand')) {
    res.status(503).json({
      error: 'AI analysis service is temporarily experiencing high demand. Please retry in a few seconds.',
    });
    return;
  }
  res.status(500).json({ error: fallbackMessage });
}

app.post('/api/ai/prioritize', async (req, res) => {
  try {
    const { facilities, needQuery } = req.body ?? {};
    const validFacilities = validateFacilitiesArray(facilities);
    if (!validFacilities) {
      res.status(400).json({ error: 'Provide between 1 and 30 facilities to analyze.' });
      return;
    }

    const safeNeed = typeof needQuery === 'string' ? needQuery.slice(0, 160) : undefined;
    const result = await analyzeFacilityPriorities(validFacilities, safeNeed);
    res.json(result);
  } catch (err) {
    handleAiError(res, err, 'Unable to prioritize facilities right now.');
  }
});

app.post('/api/ai/medicines', async (req, res) => {
  try {
    const { medicineQuery, facilities, origin, locationLabel, radiusMeters } = req.body ?? {};
    if (typeof medicineQuery !== 'string' || medicineQuery.trim().length < 2) {
      res.status(400).json({ error: 'Enter a medication name (at least 2 characters).' });
      return;
    }

    const safeFacilities: MedicalFacility[] = Array.isArray(facilities)
      ? facilities
          .filter(
            (item): item is MedicalFacility =>
              Boolean(item) &&
              typeof item === 'object' &&
              typeof (item as MedicalFacility).id === 'string' &&
              typeof (item as MedicalFacility).name === 'string'
          )
          .slice(0, 30)
      : [];

    const validOrigin =
      origin && isValidLatLng(origin.lat, origin.lng)
        ? { lat: Number(origin.lat), lng: Number(origin.lng) }
        : undefined;

    if (safeFacilities.length === 0 && !validOrigin) {
      res.status(400).json({ error: 'Provide either nearby facilities or a search location.' });
      return;
    }

    const safeLocationLabel =
      typeof locationLabel === 'string' ? locationLabel.trim().slice(0, 120) : undefined;
    const safeRadius =
      typeof radiusMeters === 'number' && Number.isFinite(radiusMeters)
        ? Math.max(2000, Math.min(25000, radiusMeters))
        : 10000;

    const result = await searchMedicineOnClinicPages({
      medicineQuery: medicineQuery.trim().slice(0, 120),
      facilities: safeFacilities,
      origin: validOrigin,
      locationLabel: safeLocationLabel,
      radiusMeters: safeRadius,
    });
    res.json(result);
  } catch (err) {
    handleAiError(res, err, 'Unable to search nearby pharmacies and web data right now.');
  }
});

app.post('/api/ai/hospitals', async (req, res) => {
  try {
    const { hospitals } = req.body ?? {};
    const validHospitals = validateFacilitiesArray(hospitals);
    if (!validHospitals) {
      res.status(400).json({ error: 'Nearby hospitals are required for review analysis.' });
      return;
    }

    const result = await recommendHospitalsFromReviews(validHospitals);
    res.json(result);
  } catch (err) {
    handleAiError(res, err, 'Unable to analyze hospital reviews right now.');
  }
});

async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`MedFind server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start MedFind server:', err);
  process.exit(1);
});
