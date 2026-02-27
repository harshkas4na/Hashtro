/**
 * Geocoding utility - converts place names to coordinates
 * Uses OpenStreetMap Nominatim API (free, no API key required)
 */

export interface GeocodingResult {
    latitude: number;
    longitude: number;
    displayName: string;
    success: boolean;
    error?: string;
}

/**
 * Geocode a place name to coordinates using OpenStreetMap Nominatim
 * @param placeName - The place name to geocode (e.g., "New Delhi, India")
 * @returns GeocodingResult with coordinates or error
 */
export async function geocodePlace(placeName: string): Promise<GeocodingResult> {
    if (!placeName || placeName.trim().length === 0) {
        return {
            latitude: 0,
            longitude: 0,
            displayName: '',
            success: false,
            error: 'Place name is required'
        };
    }

    try {
        const encodedPlace = encodeURIComponent(placeName.trim());
        const url = `https://nominatim.openstreetmap.org/search?q=${encodedPlace}&format=json&limit=1&addressdetails=1`;

        const response = await fetch(url, {
            headers: {
                'Accept': 'application/json',
                // Nominatim requires a User-Agent header
                'User-Agent': 'Hastrology/1.0 (astrology horoscope app)'
            }
        });

        if (!response.ok) {
            throw new Error(`Geocoding request failed: ${response.status}`);
        }

        const data = await response.json();

        if (!data || data.length === 0) {
            return {
                latitude: 0,
                longitude: 0,
                displayName: placeName,
                success: false,
                error: 'Location not found. Please try a more specific place name.'
            };
        }

        const result = data[0];

        return {
            latitude: parseFloat(result.lat),
            longitude: parseFloat(result.lon),
            displayName: result.display_name,
            success: true
        };
    } catch (error) {
        console.error('Geocoding error:', error);
        return {
            latitude: 0,
            longitude: 0,
            displayName: placeName,
            success: false,
            error: error instanceof Error ? error.message : 'Geocoding failed'
        };
    }
}

/**
 * Get timezone offset for a location (approximate based on longitude)
 * For more accuracy, consider using a timezone API
 * @param longitude - The longitude of the location
 * @returns Approximate timezone offset in hours
 */
export function estimateTimezoneOffset(longitude: number): number {
    // Simple approximation: 15 degrees = 1 hour
    // This is approximate and doesn't account for DST or political boundaries
    return Math.round(longitude / 15 * 2) / 2; // Round to nearest 0.5 hour
}

/**
 * Common timezone offsets for major regions
 */
export const TIMEZONE_HINTS: Record<string, number> = {
    'india': 5.5,
    'ist': 5.5,
    'new delhi': 5.5,
    'mumbai': 5.5,
    'usa': -5,
    'new york': -5,
    'los angeles': -8,
    'london': 0,
    'uk': 0,
    'paris': 1,
    'tokyo': 9,
    'sydney': 10,
    'dubai': 4,
};

/**
 * Try to get a better timezone estimate based on place name
 * @param placeName - The place name
 * @param longitude - The longitude (fallback)
 * @returns Timezone offset in hours
 */
export function getTimezoneOffset(placeName: string, longitude: number): number {
    const lowerPlace = placeName.toLowerCase();

    for (const [hint, offset] of Object.entries(TIMEZONE_HINTS)) {
        if (lowerPlace.includes(hint)) {
            return offset;
        }
    }

    return estimateTimezoneOffset(longitude);
}
