import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { CampgroundsService } from './campgrounds.service';
import { SupabaseService } from './supabase.service';

describe('CampgroundsService', () => {
  let service: CampgroundsService;
  let rpcSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    rpcSpy = vi.fn();
    TestBed.configureTestingModule({
      providers: [{ provide: SupabaseService, useValue: { client: { rpc: rpcSpy } } }],
    });
    service = TestBed.inject(CampgroundsService);
  });

  it('maps RPC rows to Campground objects', async () => {
    rpcSpy.mockResolvedValue({
      data: [{
        id: 'abc', park_code: 'acad', name: 'Blackwoods', description: 'desc',
        lat: 44.31, lng: -68.2, amenities: {}, fees: [], reservation_url: 'https://x',
        directions_url: 'https://y', images: [], contact: {}, distance_m: 1200,
      }],
      error: null,
    });

    const result = await service.getNearest({ lat: 44.3, lng: -68.1 });

    expect(rpcSpy).toHaveBeenCalledWith('nearest_campgrounds', {
      user_lat: 44.3, user_lng: -68.1, result_limit: 50,
    });
    expect(result[0].name).toBe('Blackwoods');
    expect(result[0].distanceMeters).toBe(1200);
  });

  it('throws when the RPC call errors', async () => {
    rpcSpy.mockResolvedValue({ data: null, error: new Error('boom') });

    await expect(service.getNearest({ lat: 0, lng: 0 })).rejects.toThrow();
  });
});
