/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// User provided API Key
const YELP_API_KEY = 'MYQSBdh5ZQvsfMz-ub6_Wn7mphdYsEDxYMnnVG8iHaJ63pF8s1X5Lw0dln9L1aXg7Tuv021nmhdVMqnABK9WoyWN78usbWWfZFqtD6vLwZOdVYm_FUMPaYPRXJMeaXYx';

export interface YelpBusiness {
  id: string;
  name: string;
  image_url: string;
  url: string;
  review_count: number;
  categories: {alias: string; title: string}[];
  rating: number;
  coordinates: {
    latitude: number;
    longitude: number;
  };
  price?: string;
  location: {
    address1: string;
    city: string;
    zip_code: string;
    country: string;
    display_address: string[];
  };
  phone: string;
  display_phone: string;
  is_closed?: boolean;
  distance?: number;
}

export interface YelpSearchResponse {
  businesses: YelpBusiness[];
  total: number;
  region: {
    center: {
      latitude: number;
      longitude: number;
    };
  };
}

export async function searchYelp(
  location: string | null,
  term: string,
  price?: string,
  open_now?: boolean,
  latitude?: number,
  longitude?: number
): Promise<YelpSearchResponse> {
  // Check if we have a key.
  if (!YELP_API_KEY) {
    throw new Error('No Yelp API Key provided. Please add your API key to yelp_api.ts');
  }

  // Construct query parameters
  const params = new URLSearchParams();
  
  if (latitude !== undefined && longitude !== undefined) {
      params.append('latitude', latitude.toString());
      params.append('longitude', longitude.toString());
  } else if (location) {
      params.append('location', location);
  } else {
      throw new Error('Must provide either location name or latitude/longitude');
  }

  params.append('term', term);
  if (price) params.append('price', price); // 1, 2, 3, 4
  if (open_now) params.append('open_now', 'true');
  
  // If searching by coordinate, we want results close to the point
  if (latitude && longitude) {
      params.append('sort_by', 'distance');
      params.append('limit', '5');
  } else {
      params.append('limit', '10');
  }

  const base_url = `https://api.yelp.com/v3/businesses/search?${params.toString()}`;
  
  // Use a CORS proxy for browser-based requests to Yelp
  const url = `https://corsproxy.io/?${encodeURIComponent(base_url)}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${YELP_API_KEY}`,
        'accept': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Yelp API Error ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    console.log('Raw Yelp API Response:', data);
    return data;
  } catch (error) {
    console.error('Failed to fetch from Yelp API:', error);
    throw error;
  }
}