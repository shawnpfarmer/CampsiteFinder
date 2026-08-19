import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { CampgroundDetailComponent } from './campground-detail.component';
import { CampgroundsService } from '../../core/services/campgrounds.service';

describe('CampgroundDetailComponent', () => {
  it('loads the campground matching the route id', async () => {
    const getByIdsSpy = vi.fn().mockResolvedValue([
      {
        id: 'cg-1', parkCode: 'acad', name: 'Blackwoods', description: 'desc',
        lat: 44.3, lng: -68.2, amenities: {}, fees: [], reservationUrl: 'https://x',
        directionsUrl: 'https://y', images: [], contact: {}, distanceMeters: 0,
      },
    ]);

    TestBed.configureTestingModule({
      imports: [CampgroundDetailComponent],
      providers: [
        { provide: CampgroundsService, useValue: { getByIds: getByIdsSpy } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ id: 'cg-1' }) } },
        },
      ],
    });

    const component = TestBed.createComponent(CampgroundDetailComponent).componentInstance;
    await component.ngOnInit();

    expect(getByIdsSpy).toHaveBeenCalledWith(['cg-1']);
    expect(component.campground()?.name).toBe('Blackwoods');
    expect(component.notFound()).toBe(false);
  });

  it('sets notFound when no campground matches the route id', async () => {
    const getByIdsSpy = vi.fn().mockResolvedValue([]);

    TestBed.configureTestingModule({
      imports: [CampgroundDetailComponent],
      providers: [
        { provide: CampgroundsService, useValue: { getByIds: getByIdsSpy } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ id: 'missing' }) } },
        },
      ],
    });

    const component = TestBed.createComponent(CampgroundDetailComponent).componentInstance;
    await component.ngOnInit();

    expect(component.notFound()).toBe(true);
  });

  it('sets notFound when CampgroundsService.getByIds rejects', async () => {
    const getByIdsSpy = vi.fn().mockRejectedValue(new Error('network error'));

    TestBed.configureTestingModule({
      imports: [CampgroundDetailComponent],
      providers: [
        { provide: CampgroundsService, useValue: { getByIds: getByIdsSpy } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ id: 'cg-1' }) } },
        },
      ],
    });

    const component = TestBed.createComponent(CampgroundDetailComponent).componentInstance;
    await component.ngOnInit();

    expect(component.notFound()).toBe(true);
  });
});
