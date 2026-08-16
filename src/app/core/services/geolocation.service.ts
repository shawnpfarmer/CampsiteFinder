import { Injectable } from '@angular/core';

export interface Coordinates {
  lat: number;
  lng: number;
}

@Injectable({ providedIn: 'root' })
export class GeolocationService {
  getCurrentPosition(): Promise<Coordinates> {
    return new Promise((resolve, reject) => {
      if (!('geolocation' in navigator)) {
        reject(new Error('Geolocation is not supported by this browser'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
        (error) => reject(error),
        { timeout: 10000 },
      );
    });
  }
}
