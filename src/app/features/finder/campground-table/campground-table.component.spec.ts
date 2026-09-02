import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { vi } from 'vitest';
import { CampgroundTableComponent } from './campground-table.component';
import { AddToTripComponent } from '../../../shared/add-to-trip/add-to-trip.component';
import { CampgroundDetailPanelComponent } from './campground-detail-panel/campground-detail-panel.component';
import { FavoritesService } from '../../../core/services/favorites.service';
import { TripsService } from '../../../core/services/trips.service';
import { SupabaseService } from '../../../core/services/supabase.service';

describe('CampgroundTableComponent', () => {
  let fixture: ComponentFixture<CampgroundTableComponent>;
  let component: CampgroundTableComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [CampgroundTableComponent],
      providers: [
        { provide: SupabaseService, useValue: { isAuthenticated: true } },
        {
          provide: FavoritesService,
          useValue: {
            favoriteIds: () => new Set(),
            toggleFavorite: vi.fn(),
            loadFavoriteIds: () => Promise.resolve(),
          },
        },
        {
          provide: TripsService,
          useValue: {
            trips: () => [],
            loadTrips: vi.fn().mockResolvedValue(undefined),
            getTripIdsForCampground: vi.fn().mockResolvedValue(new Set()),
            addStop: vi.fn(),
            createTrip: vi.fn(),
          },
        },
      ],
    });
    fixture = TestBed.createComponent(CampgroundTableComponent);
    component = fixture.componentInstance;
  });

  it('renders an Add to Trip control for each row', () => {
    component.campgrounds = [{ id: '1', name: 'A' } as any];
    fixture.detectChanges();

    const addToTrip = fixture.debugElement.query(By.directive(AddToTripComponent));
    expect(addToTrip).toBeTruthy();
    expect(addToTrip.componentInstance.campgroundId).toBe('1');
  });

  it('emits selectedChange when a row is selected', () => {
    const campground = { id: '1', name: 'A' } as any;
    let emitted: any;
    component.selectedChange.subscribe((c) => (emitted = c));

    component.onSelectionChange(campground);

    expect(emitted).toBe(campground);
  });

  it('shows the Distance column by default', () => {
    component.campgrounds = [];
    fixture.detectChanges();

    const header = fixture.nativeElement.textContent;
    expect(header).toContain('Distance');
  });

  it('hides the Distance column when showDistance is false', () => {
    component.campgrounds = [];
    component.showDistance = false;
    fixture.detectChanges();

    const header = fixture.nativeElement.textContent;
    expect(header).not.toContain('Distance');
  });

  it('hides the Note column by default', () => {
    component.campgrounds = [];
    fixture.detectChanges();

    const header = fixture.nativeElement.textContent;
    expect(header).not.toContain('Note');
  });

  it('shows a Note column when showNotes is true', () => {
    component.campgrounds = [];
    component.showNotes = true;
    fixture.detectChanges();

    const header = fixture.nativeElement.textContent;
    expect(header).toContain('Note');
  });

  it('seeds noteDrafts from the notes input on change', () => {
    component.notes = new Map([['cg-1', 'great sites']]);

    component.ngOnChanges({ notes: {} as any });

    expect(component.noteDrafts['cg-1']).toBe('great sites');
  });

  it('seeds a note for a campground it has not seen before on a later notes change', () => {
    component.notes = new Map([['cg-1', 'great sites']]);
    component.ngOnChanges({ notes: {} as any });

    component.notes = new Map([
      ['cg-1', 'great sites'],
      ['cg-2', 'quiet loop'],
    ]);
    component.ngOnChanges({ notes: {} as any });

    expect(component.noteDrafts['cg-2']).toBe('quiet loop');
  });

  it('does not overwrite a draft the user has already started editing', () => {
    component.notes = new Map([['cg-1', 'great sites']]);
    component.ngOnChanges({ notes: {} as any });

    // User types in row cg-1 while another row's save round-trip is in flight.
    component.noteDrafts['cg-1'] = 'half-typed edit';

    // That other save resolves and pushes a fresh notes map through.
    component.notes = new Map([['cg-1', 'great sites']]);
    component.ngOnChanges({ notes: {} as any });

    expect(component.noteDrafts['cg-1']).toBe('half-typed edit');
  });

  it('emits noteChange with the current draft value on blur', () => {
    let emitted: any;
    component.noteChange.subscribe((e) => (emitted = e));
    component.noteDrafts['cg-1'] = 'updated note';

    component.onNoteBlur('cg-1');

    expect(emitted).toEqual({ campgroundId: 'cg-1', note: 'updated note' });
  });

  it('shows the Agency column with each campground\'s agency', () => {
    component.campgrounds = [{ id: '1', name: 'A', parkCode: null, agency: 'USFS' } as any];
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Agency');
    expect(text).toContain('USFS');
  });

  it('expands a row to show its details when the name is clicked', () => {
    component.campgrounds = [{ id: '1', name: 'A' } as any];
    fixture.detectChanges();

    fixture.debugElement.query(By.css('.campground-name-link')).triggerEventHandler('click', null);
    fixture.detectChanges();

    const panel = fixture.debugElement.query(By.directive(CampgroundDetailPanelComponent));
    expect(panel).toBeTruthy();
    expect(panel.componentInstance.campground.id).toBe('1');
  });

  it('collapses an expanded row when its name is clicked again', () => {
    component.campgrounds = [{ id: '1', name: 'A' } as any];
    fixture.detectChanges();
    const nameLink = fixture.debugElement.query(By.css('.campground-name-link'));

    nameLink.triggerEventHandler('click', null);
    fixture.detectChanges();
    nameLink.triggerEventHandler('click', null);
    fixture.detectChanges();

    const panel = fixture.debugElement.query(By.directive(CampgroundDetailPanelComponent));
    expect(panel).toBeFalsy();
  });

  it('only expands one row at a time', () => {
    component.campgrounds = [{ id: '1', name: 'A' } as any, { id: '2', name: 'B' } as any];
    fixture.detectChanges();
    const nameLinks = fixture.debugElement.queryAll(By.css('.campground-name-link'));

    nameLinks[0].triggerEventHandler('click', null);
    fixture.detectChanges();
    nameLinks[1].triggerEventHandler('click', null);
    fixture.detectChanges();

    const panels = fixture.debugElement.queryAll(By.directive(CampgroundDetailPanelComponent));
    expect(panels.length).toBe(1);
    expect(panels[0].componentInstance.campground.id).toBe('2');
  });
});
