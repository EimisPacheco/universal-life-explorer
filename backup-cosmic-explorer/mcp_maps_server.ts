/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { searchYelp, YelpBusiness } from './yelp_api';

export interface MapParams {
  location?: string;
  origin?: string;
  destination?: string;
  search?: string;
  businesses?: YelpBusiness[];
  highlightIndex?: number;
  latitude?: number;
  longitude?: number;
}

export class ToolExecutor {
  private mapQueryHandler: (params: MapParams) => void;
  private mapStateGetter?: () => { lat: number; lng: number };
  private userLocationGetter?: () => Promise<{ lat: number; lng: number }>;

  constructor(
    mapQueryHandler: (params: MapParams) => void,
    mapStateGetter?: () => { lat: number; lng: number },
    userLocationGetter?: () => Promise<{ lat: number; lng: number }>
  ) {
    this.mapQueryHandler = mapQueryHandler;
    this.mapStateGetter = mapStateGetter;
    this.userLocationGetter = userLocationGetter;
  }

  async executeTool(name: string, args: Record<string, unknown>): Promise<any> {
    console.log(`Executing tool: ${name}`, args);

    if (name === 'view_location_google_maps') {
      const query = args['query'] as string;
      if (query) {
        this.mapQueryHandler({location: query});
        return { content: [{type: 'text', text: `Navigating to: ${query}`}] };
      }
    } else if (name === 'directions_on_google_maps') {
      const origin = args['origin'] as string;
      const destination = args['destination'] as string;
      
      if (origin === 'user_location' && destination && this.userLocationGetter) {
          try {
              const userLoc = await this.userLocationGetter();
              this.mapQueryHandler({origin: `${userLoc.lat},${userLoc.lng}`, destination});
              return { content: [{type: 'text', text: `Navigating from your location to ${destination}`}] };
          } catch(e) { return { content: [{type: 'text', text: "Error: Could not retrieve user location."}] }; }
      } else if (origin && destination) {
        this.mapQueryHandler({origin, destination});
        return { content: [{type: 'text', text: `Navigating from ${origin} to ${destination}`}] };
      }
    } else if (name === 'highlight_business') {
      const index = args['index'] as number;
      if (typeof index === 'number') {
        this.mapQueryHandler({ highlightIndex: index });
        return { content: [{ type: 'text', text: `Focusing on result #${index + 1}` }] };
      }
    } else if (name === 'identify_current_location') {
        if (!this.mapStateGetter) return { error: "No map state" };
        const center = this.mapStateGetter();
        try {
            const result = await searchYelp(null, "business", undefined, undefined, center.lat, center.lng);
            if (result.businesses?.length > 0) {
                const topResults = result.businesses.slice(0, 3);
                this.mapQueryHandler({ businesses: topResults, highlightIndex: 0 });
                const descriptions = topResults.map(b => `${b.name} (${b.rating}★)`).join('; ');
                return { content: [{ type: 'text', text: `I found: ${descriptions}` }] };
            }
            return { content: [{ type: 'text', text: "Nothing identifiable here." }] };
        } catch (e: any) { return { error: e.message }; }
    } else if (name === 'search_yelp') {
      let location = args['location'] as string;
      const term = args['term'] as string;
      const price = args['price'] as string | undefined;
      const open_now = args['open_now'] as boolean | undefined;
      let lat, lng;

      if (location === 'user_location' && this.userLocationGetter) {
          try {
              const userLoc = await this.userLocationGetter();
              lat = userLoc.lat; lng = userLoc.lng;
              location = "";
          } catch(e) { return { error: "GPS failed" }; }
      }

      try {
        const result = await searchYelp(location || null, term, price, open_now, lat, lng);
        if (result.businesses?.length > 0) {
          this.mapQueryHandler({ businesses: result.businesses });
          const summary = result.businesses.map((b, i) => `${i}. ${b.name} (${b.rating}★)`).join('\n');
          return { content: [{ type: 'text', text: `Results:\n${summary}` }] };
        }
        return { content: [{ type: 'text', text: "No results found." }] };
      } catch (e: any) { return { error: e.message }; }
    }
    return { content: [{type: 'text', text: `Task complete.`}] };
  }
}