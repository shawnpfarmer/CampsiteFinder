import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { TripsListComponent } from './trips-list.component';
import { TripsService } from '../../core/services/trips.service';

describe('TripsListComponent', () => {
  it('loads trips on init', async () => {
    const loadTripsSpy = vi.fn().mockResolvedValue(undefined);
    TestBed.configureTestingModule({
      imports: [TripsListComponent],
      providers: [{ provide: TripsService, useValue: { trips: () => [], loadTrips: loadTripsSpy } }],
    });

    const component = TestBed.createComponent(TripsListComponent).componentInstance;
    await component.ngOnInit();

    expect(loadTripsSpy).toHaveBeenCalled();
  });

  it('deletes a trip when the user confirms', async () => {
    const deleteTripSpy = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    TestBed.configureTestingModule({
      imports: [TripsListComponent],
      providers: [
        { provide: TripsService, useValue: { trips: () => [], loadTrips: vi.fn(), deleteTrip: deleteTripSpy } },
      ],
    });

    const component = TestBed.createComponent(TripsListComponent).componentInstance;
    await component.onDelete('trip-1');

    expect(deleteTripSpy).toHaveBeenCalledWith('trip-1');
  });

  it('does not delete when the user cancels the confirm', async () => {
    const deleteTripSpy = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    TestBed.configureTestingModule({
      imports: [TripsListComponent],
      providers: [
        { provide: TripsService, useValue: { trips: () => [], loadTrips: vi.fn(), deleteTrip: deleteTripSpy } },
      ],
    });

    const component = TestBed.createComponent(TripsListComponent).componentInstance;
    await component.onDelete('trip-1');

    expect(deleteTripSpy).not.toHaveBeenCalled();
  });
});
