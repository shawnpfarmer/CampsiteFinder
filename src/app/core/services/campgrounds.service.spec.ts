import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { CampgroundsService } from './campgrounds.service';
import { SupabaseService } from './supabase.service';

describe('CampgroundsService', () => {
  let service: CampgroundsService;
  let rpcSpy: ReturnType<typeof vi.fn>;
  let fromSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    rpcSpy = vi.fn();
    fromSpy = vi.fn();
    TestBed.configureTestingModule({
      providers: [{ provide: SupabaseService, useValue: { client: { rpc: rpcSpy, from: fromSpy } } }],
    });
    service = TestBed.inject(CampgroundsService);
  });

  it('maps RPC rows to Campground objects', async () => {
    rpcSpy.mockResolvedValue({
      data: [{
        id: 'abc', park_code: 'acad', name: 'Blackwoods', description: 'desc',
        lat: 44.31, lng: -68.2, agency: 'NPS', amenities: {}, fees: [], reservation_url: 'https://x',
        directions_url: 'https://y', images: [], contact: {}, distance_m: 1200,
      }],
      error: null,
    });

    const result = await service.getNearest({ lat: 44.3, lng: -68.1 });

    expect(rpcSpy).toHaveBeenCalledWith('nearest_campgrounds', {
      user_lat: 44.3, user_lng: -68.1, result_limit: 50, agency_filter: null,
    });
    expect(result[0].name).toBe('Blackwoods');
    expect(result[0].agency).toBe('NPS');
    expect(result[0].distanceMeters).toBe(1200);
  });

  it('forwards an agency filter to the RPC', async () => {
    rpcSpy.mockResolvedValue({ data: [], error: null });

    await service.getNearest({ lat: 44.3, lng: -68.1 }, 50, ['USFS', 'BLM']);

    expect(rpcSpy).toHaveBeenCalledWith('nearest_campgrounds', {
      user_lat: 44.3, user_lng: -68.1, result_limit: 50, agency_filter: ['USFS', 'BLM'],
    });
  });

  it('throws when the RPC call errors', async () => {
    rpcSpy.mockResolvedValue({ data: null, error: new Error('boom') });

    await expect(service.getNearest({ lat: 0, lng: 0 })).rejects.toThrow();
  });

  it('maps RPC rows to Campground objects for getByIds', async () => {
    rpcSpy.mockResolvedValue({
      data: [{
        id: 'cg-1', park_code: 'acad', name: 'Blackwoods', description: 'desc',
        lat: 44.31, lng: -68.2, agency: 'NPS', amenities: {}, fees: [], reservation_url: 'https://x',
        directions_url: 'https://y', images: [], contact: {},
      }],
      error: null,
    });

    const result = await service.getByIds(['cg-1']);

    expect(rpcSpy).toHaveBeenCalledWith('get_campgrounds_by_ids', {
      campground_ids: ['cg-1'], agency_filter: null,
    });
    expect(result[0].name).toBe('Blackwoods');
    expect(result[0].agency).toBe('NPS');
    expect(result[0].distanceMeters).toBe(0);
  });

  it('throws when the getByIds RPC call errors', async () => {
    rpcSpy.mockResolvedValue({ data: null, error: new Error('boom') });

    await expect(service.getByIds(['cg-1'])).rejects.toThrow();
  });

  it('searches campgrounds by name', async () => {
    const builder: any = {};
    ['select', 'ilike', 'limit'].forEach((method) => {
      builder[method] = vi.fn().mockReturnValue(builder);
    });
    builder.then = (resolve: any) => resolve({ data: [{ id: 'cg-1', name: 'Blackwoods Campground' }], error: null });
    fromSpy.mockReturnValue(builder);

    const results = await service.searchByName('black');

    expect(fromSpy).toHaveBeenCalledWith('campgrounds');
    expect(builder.ilike).toHaveBeenCalledWith('name', '%black%');
    expect(builder.limit).toHaveBeenCalledWith(20);
    expect(results).toEqual([{ id: 'cg-1', name: 'Blackwoods Campground' }]);
  });

  it('throws when searchByName errors', async () => {
    const builder: any = {};
    ['select', 'ilike', 'limit'].forEach((method) => {
      builder[method] = vi.fn().mockReturnValue(builder);
    });
    builder.then = (resolve: any) => resolve({ data: null, error: new Error('boom') });
    fromSpy.mockReturnValue(builder);

    await expect(service.searchByName('black')).rejects.toThrow('boom');
  });
});
