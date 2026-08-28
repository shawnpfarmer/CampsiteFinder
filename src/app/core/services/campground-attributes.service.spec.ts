import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { CampgroundAttributesService } from './campground-attributes.service';
import { SupabaseService } from './supabase.service';

function createQueryBuilderMock(result: { data?: any; error?: any }) {
  const builder: any = {};
  ['select', 'insert', 'update', 'delete', 'eq', 'order'].forEach((method) => {
    builder[method] = vi.fn().mockReturnValue(builder);
  });
  builder.single = vi.fn().mockResolvedValue(result);
  builder.then = (resolve: any) => resolve(result);
  return builder;
}

describe('CampgroundAttributesService', () => {
  let service: CampgroundAttributesService;
  let fromSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fromSpy = vi.fn();
    TestBed.configureTestingModule({
      providers: [{ provide: SupabaseService, useValue: { client: { from: fromSpy } } }],
    });
    service = TestBed.inject(CampgroundAttributesService);
  });

  it('loads attributes for a campground', async () => {
    fromSpy.mockReturnValue(
      createQueryBuilderMock({
        data: [
          {
            id: 'attr-1',
            campground_id: 'cg-1',
            type: 'accessibility',
            name: 'Wheelchair accessible',
            value: 'yes',
            created_at: '2026-08-01T00:00:00Z',
          },
        ],
        error: null,
      }),
    );

    await service.loadForCampground('cg-1');

    expect(fromSpy).toHaveBeenCalledWith('campground_attributes');
    expect(service.attributes()).toEqual([
      {
        id: 'attr-1',
        campgroundId: 'cg-1',
        type: 'accessibility',
        name: 'Wheelchair accessible',
        value: 'yes',
        createdAt: '2026-08-01T00:00:00Z',
      },
    ]);
  });

  it('throws when loadForCampground errors', async () => {
    fromSpy.mockReturnValue(createQueryBuilderMock({ data: null, error: new Error('boom') }));

    await expect(service.loadForCampground('cg-1')).rejects.toThrow('boom');
  });

  it('clears attributes before loading, even when the load fails', async () => {
    service.attributes.set([
      { id: 'attr-1', campgroundId: 'cg-old', type: 'fee', name: 'Old', value: '5', createdAt: '2026-08-01T00:00:00Z' },
    ]);
    fromSpy.mockReturnValue(createQueryBuilderMock({ data: null, error: new Error('boom') }));

    await expect(service.loadForCampground('cg-1')).rejects.toThrow('boom');

    expect(service.attributes()).toEqual([]);
  });

  it('adds an attribute and appends it locally', async () => {
    fromSpy.mockReturnValue(
      createQueryBuilderMock({
        data: {
          id: 'attr-2',
          campground_id: 'cg-1',
          type: 'fee',
          name: 'Reservation fee',
          value: '10',
          created_at: '2026-08-02T00:00:00Z',
        },
        error: null,
      }),
    );

    await service.addAttribute('cg-1', 'fee', 'Reservation fee', '10');

    expect(service.attributes()).toEqual([
      { id: 'attr-2', campgroundId: 'cg-1', type: 'fee', name: 'Reservation fee', value: '10', createdAt: '2026-08-02T00:00:00Z' },
    ]);
  });

  it('throws when addAttribute errors', async () => {
    fromSpy.mockReturnValue(createQueryBuilderMock({ data: null, error: new Error('boom') }));

    await expect(service.addAttribute('cg-1', 'fee', 'Reservation fee', '10')).rejects.toThrow('boom');
  });

  it('updates an attribute in place', async () => {
    service.attributes.set([
      { id: 'attr-1', campgroundId: 'cg-1', type: 'fee', name: 'Old', value: '5', createdAt: '2026-08-01T00:00:00Z' },
    ]);
    fromSpy.mockReturnValue(
      createQueryBuilderMock({
        data: [{ id: 'attr-1', campground_id: 'cg-1', type: 'fee', name: 'New', value: '15', created_at: '2026-08-01T00:00:00Z' }],
        error: null,
      }),
    );

    await service.updateAttribute('attr-1', 'fee', 'New', '15');

    expect(service.attributes()[0]).toEqual({
      id: 'attr-1', campgroundId: 'cg-1', type: 'fee', name: 'New', value: '15', createdAt: '2026-08-01T00:00:00Z',
    });
  });

  it('throws and leaves attributes untouched when an update matches no rows', async () => {
    service.attributes.set([
      { id: 'attr-1', campgroundId: 'cg-1', type: 'fee', name: 'Old', value: '5', createdAt: '2026-08-01T00:00:00Z' },
    ]);
    fromSpy.mockReturnValue(createQueryBuilderMock({ data: [], error: null }));

    await expect(service.updateAttribute('attr-1', 'fee', 'New', '15')).rejects.toThrow('No matching attribute to update');
    expect(service.attributes()[0].name).toBe('Old');
  });

  it('deletes an attribute', async () => {
    service.attributes.set([
      { id: 'attr-1', campgroundId: 'cg-1', type: 'fee', name: 'Old', value: '5', createdAt: '2026-08-01T00:00:00Z' },
    ]);
    fromSpy.mockReturnValue(createQueryBuilderMock({ data: [{ id: 'attr-1' }], error: null }));

    await service.deleteAttribute('attr-1');

    expect(service.attributes()).toEqual([]);
  });

  it('throws and leaves attributes untouched when a delete matches no rows', async () => {
    service.attributes.set([
      { id: 'attr-1', campgroundId: 'cg-1', type: 'fee', name: 'Old', value: '5', createdAt: '2026-08-01T00:00:00Z' },
    ]);
    fromSpy.mockReturnValue(createQueryBuilderMock({ data: [], error: null }));

    await expect(service.deleteAttribute('attr-1')).rejects.toThrow('No matching attribute to delete');
    expect(service.attributes().length).toBe(1);
  });
});
