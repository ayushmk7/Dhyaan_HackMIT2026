// Visit detection from the family member's OWN photo library (Meta challenge):
// geotagged photos near Eleanor's home ⇒ "your last visit was N weeks ago".
// All metadata is read on-device; only the derived fact surfaces in the UI.
import * as MediaLibrary from 'expo-media-library/legacy';
import { USE_MOCKS } from './config';

// Eleanor's home (14 Elm St, Cambridge MA in the demo world).
const HOME = { lat: 42.3736, lon: -71.1097 };
const VISIT_RADIUS_M = 250;
const SCAN_LIMIT = 200;

export interface Visit {
  daysAgo: number;
  photoCount: number;
  source: 'photos' | 'demo';
}

const demoVisit: Visit = { daysAgo: 36, photoCount: 14, source: 'demo' };

const distM = (aLat: number, aLon: number, bLat: number, bLon: number) => {
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
};

export async function detectLastVisit(): Promise<Visit | null> {
  try {
    // HIG: never throw a permission dialog at someone on app launch. Use access we
    // already have; the demo value stands in until the user grants photos elsewhere.
    const perm = await MediaLibrary.getPermissionsAsync();
    if (!perm.granted) return USE_MOCKS ? demoVisit : null;

    const page = await MediaLibrary.getAssetsAsync({
      mediaType: 'photo',
      first: SCAN_LIMIT,
      sortBy: ['creationTime'],
    });

    let lastVisitDay: string | null = null;
    let lastVisitTime = 0;
    const dayCounts = new Map<string, number>();

    // getAssetInfoAsync is per-asset; batch it so 200 photos stays under ~2s.
    for (let i = 0; i < page.assets.length; i += 25) {
      const infos = await Promise.all(
        page.assets.slice(i, i + 25).map((a) => MediaLibrary.getAssetInfoAsync(a).catch(() => null)),
      );
      infos.forEach((info, j) => {
        const loc = info?.location;
        if (!loc) return;
        if (distM(loc.latitude, loc.longitude, HOME.lat, HOME.lon) > VISIT_RADIUS_M) return;
        const asset = page.assets[i + j];
        const day = new Date(asset.creationTime).toDateString();
        dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
        if (asset.creationTime > lastVisitTime) {
          lastVisitTime = asset.creationTime;
          lastVisitDay = day;
        }
      });
    }

    if (!lastVisitDay) return USE_MOCKS ? demoVisit : null; // no geotagged visits found (or simulator)
    return {
      daysAgo: Math.max(0, Math.round((Date.now() - lastVisitTime) / 86_400_000)),
      photoCount: dayCounts.get(lastVisitDay) ?? 1,
      source: 'photos',
    };
  } catch {
    return USE_MOCKS ? demoVisit : null;
  }
}
