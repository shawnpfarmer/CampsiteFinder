import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { FinderComponent, SHOW_ALL_RADIUS_M, METERS_PER_MILE } from './finder.component';
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

  it('defaults to near-me off (show all)', () => {
    expect(component.nearMeEnabled).toBe(false);
  });

  it('defaults the near-me radius to 50 miles', () => {
    expect(component.radiusMiles).toBe(50);
  });

  it('loads with the show-all radius by default', async () => {
    geolocationSpy.getCurrentPosition.mockResolvedValue({ lat: 44.3, lng: -68.2 });
    campgroundsSpy.getNearest.mockResolvedValue([]);

    await component.ngOnInit();

    expect(campgroundsSpy.getNearest).toHaveBeenLastCalledWith(
      { lat: 44.3, lng: -68.2 }, 50, component.ALL_AGENCIES, SHOW_ALL_RADIUS_M, undefined,
    );
  });

  it('reloads with the selected agencies and the last-used coordinates when the filter changes', async () => {
    geolocationSpy.getCurrentPosition.mockResolvedValue({ lat: 44.3, lng: -68.2 });
    campgroundsSpy.getNearest.mockResolvedValue([]);
    await component.ngOnInit();

    component.selectedAgencies = ['USFS'];
    await component.onFilterChange();

    expect(campgroundsSpy.getNearest).toHaveBeenLastCalledWith(
      { lat: 44.3, lng: -68.2 }, 50, ['USFS'], SHOW_ALL_RADIUS_M, undefined,
    );
  });

  it('applies the selected radius in meters when near-me is enabled', async () => {
    geolocationSpy.getCurrentPosition.mockResolvedValue({ lat: 44.3, lng: -68.2 });
    campgroundsSpy.getNearest.mockResolvedValue([]);
    await component.ngOnInit();

    component.nearMeEnabled = true;
    component.radiusMiles = 100;
    await component.onFilterChange();

    expect(campgroundsSpy.getNearest).toHaveBeenLastCalledWith(
      { lat: 44.3, lng: -68.2 }, 50, component.ALL_AGENCIES, 100 * METERS_PER_MILE, undefined,
    );
  });

  it('reverts to the show-all radius when near-me is turned back off', async () => {
    geolocationSpy.getCurrentPosition.mockResolvedValue({ lat: 44.3, lng: -68.2 });
    campgroundsSpy.getNearest.mockResolvedValue([]);
    await component.ngOnInit();

    component.nearMeEnabled = true;
    component.radiusMiles = 25;
    await component.onFilterChange();
    component.nearMeEnabled = false;
    await component.onFilterChange();

    expect(campgroundsSpy.getNearest).toHaveBeenLastCalledWith(
      { lat: 44.3, lng: -68.2 }, 50, component.ALL_AGENCIES, SHOW_ALL_RADIUS_M, undefined,
    );
  });

  it('does not reload on filter change before any coordinates have been resolved', async () => {
    await component.onFilterChange();

    expect(campgroundsSpy.getNearest).not.toHaveBeenCalled();
  });

  it('defaults to all states and all regions selected', () => {
    expect(component.selectedStates).toEqual(component.ALL_STATES);
    expect(component.selectedRegions).toEqual(component.REGION_NAMES);
  });

  it('sends no state filter when all states are selected', async () => {
    geolocationSpy.getCurrentPosition.mockResolvedValue({ lat: 44.3, lng: -68.2 });
    campgroundsSpy.getNearest.mockResolvedValue([]);

    await component.ngOnInit();

    expect(campgroundsSpy.getNearest).toHaveBeenLastCalledWith(
      { lat: 44.3, lng: -68.2 }, 50, component.ALL_AGENCIES, SHOW_ALL_RADIUS_M, undefined,
    );
  });

  it('reloads with the selected states when the filter changes', async () => {
    geolocationSpy.getCurrentPosition.mockResolvedValue({ lat: 44.3, lng: -68.2 });
    campgroundsSpy.getNearest.mockResolvedValue([]);
    await component.ngOnInit();

    component.selectedStates = ['CO'];
    await component.onFilterChange();

    expect(campgroundsSpy.getNearest).toHaveBeenLastCalledWith(
      { lat: 44.3, lng: -68.2 }, 50, component.ALL_AGENCIES, SHOW_ALL_RADIUS_M, ['CO'],
    );
  });

  it('recomputes selected states from the selected regions', async () => {
    geolocationSpy.getCurrentPosition.mockResolvedValue({ lat: 44.3, lng: -68.2 });
    campgroundsSpy.getNearest.mockResolvedValue([]);
    await component.ngOnInit();

    component.selectedRegions = ['West'];
    await component.onRegionFilterChange();

    expect(component.selectedStates).toEqual(component.REGIONS['West']);
    expect(campgroundsSpy.getNearest).toHaveBeenLastCalledWith(
      { lat: 44.3, lng: -68.2 }, 50, component.ALL_AGENCIES, SHOW_ALL_RADIUS_M, component.REGIONS['West'],
    );
  });
});
