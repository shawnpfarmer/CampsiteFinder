import { TestBed } from '@angular/core/testing';
import { GeolocationService } from './geolocation.service';

describe('GeolocationService', () => {
  let service: GeolocationService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(GeolocationService);
  });

  it('resolves coordinates from navigator.geolocation', async () => {
    const mockGeolocation = {
      getCurrentPosition: (success: PositionCallback) => {
        success({ coords: { latitude: 44.31, longitude: -68.2 } } as GeolocationPosition);
      },
    };
    Object.defineProperty(window.navigator, 'geolocation', {
      value: mockGeolocation,
      configurable: true,
    });

    const coords = await service.getCurrentPosition();
    expect(coords).toEqual({ lat: 44.31, lng: -68.2 });
  });

  it('rejects when geolocation is unsupported', async () => {
    // Delete geolocation to simulate unsupported browser
    delete (window.navigator as any).geolocation;

    await expect(service.getCurrentPosition()).rejects.toThrow(
      'Geolocation is not supported by this browser',
    );
  });
});
