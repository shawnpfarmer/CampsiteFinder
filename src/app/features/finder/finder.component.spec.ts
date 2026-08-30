import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { FinderComponent } from './finder.component';
import { GeolocationService } from '../../core/services/geolocation.service';
import { CampgroundsService } from '../../core/services/campgrounds.service';

describe('FinderComponent', () => {
  let fixture: ComponentFixture<FinderComponent>;
  let component: FinderComponent;
  let geolocationSpy: { getCurrentPosition: ReturnType<typeof vi.fn> };
  let campgroundsSpy: { getNearest: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    geolocationSpy = { getCurrentPosition: vi.fn() };
    campgroundsSpy = { getNearest: vi.fn() };

    TestBed.configureTestingModule({
      imports: [FinderComponent],
      providers: [
        { provide: GeolocationService, useValue: geolocationSpy },
        { provide: CampgroundsService, useValue: campgroundsSpy },
      ],
    });

    fixture = TestBed.createComponent(FinderComponent);
    component = fixture.componentInstance;
  });

  it('loads nearest campgrounds using the browser location on init', async () => {
    geolocationSpy.getCurrentPosition.mockResolvedValue({ lat: 44.3, lng: -68.2 });
    campgroundsSpy.getNearest.mockResolvedValue([{ id: '1', name: 'A' } as any]);

    await component.ngOnInit();

    expect(component.campgrounds().length).toBe(1);
    expect(component.error()).toBeNull();
  });

  it('shows an error and stops loading when geolocation fails', async () => {
    geolocationSpy.getCurrentPosition.mockRejectedValue(new Error('denied'));

    await component.ngOnInit();

    expect(component.error()).toBe('denied');
    expect(component.loading()).toBe(false);
  });

  it('defaults to all agencies selected', () => {
    expect(component.selectedAgencies).toEqual(component.ALL_AGENCIES);
  });

  it('reloads with the selected agencies and the last-used coordinates when the filter changes', async () => {
    geolocationSpy.getCurrentPosition.mockResolvedValue({ lat: 44.3, lng: -68.2 });
    campgroundsSpy.getNearest.mockResolvedValue([]);
    await component.ngOnInit();

    component.selectedAgencies = ['USFS'];
    await component.onAgencyFilterChange();

    expect(campgroundsSpy.getNearest).toHaveBeenLastCalledWith(
      { lat: 44.3, lng: -68.2 }, 50, ['USFS'],
    );
  });

  it('does not reload on filter change before any coordinates have been resolved', async () => {
    await component.onAgencyFilterChange();

    expect(campgroundsSpy.getNearest).not.toHaveBeenCalled();
  });
});
