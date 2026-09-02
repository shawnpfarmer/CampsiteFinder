import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { CampgroundDetailPanelComponent } from './campground-detail-panel.component';
import { FavoritesService } from '../../../../core/services/favorites.service';
import { TripsService } from '../../../../core/services/trips.service';
import { SupabaseService } from '../../../../core/services/supabase.service';
import { Campground } from '../../../../core/models/campground.model';

describe('CampgroundDetailPanelComponent', () => {
  let fixture: ComponentFixture<CampgroundDetailPanelComponent>;
  let component: CampgroundDetailPanelComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [CampgroundDetailPanelComponent],
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
    fixture = TestBed.createComponent(CampgroundDetailPanelComponent);
    component = fixture.componentInstance;
  });

  function setCampground(overrides: Partial<Campground>): void {
    component.campground = {
      id: '1',
      parkCode: null,
      name: 'Test Campground',
      description: '',
      lat: 0,
      lng: 0,
      agency: 'NPS',
      amenities: {},
      fees: [],
      reservationUrl: '',
      directionsUrl: '',
      images: [],
      contact: null,
      distanceMeters: 0,
      ...overrides,
    };
  }

  it('renders HTML markup in the description instead of showing raw tags', () => {
    setCampground({ description: '<p>Great <strong>views</strong>.</p>' });
    fixture.detectChanges();

    const strong = fixture.nativeElement.querySelector('strong');
    expect(strong).toBeTruthy();
    expect(strong.textContent).toBe('views');
    expect(fixture.nativeElement.textContent).not.toContain('<strong>');
  });

  it('renders the campground name', () => {
    setCampground({ name: 'Riverbend Campground' });
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Riverbend Campground');
  });

  it('renders reservation and directions links', () => {
    setCampground({
      reservationUrl: 'https://recreation.gov/camping/1',
      directionsUrl: 'https://maps.example/1',
    });
    fixture.detectChanges();

    const links: HTMLAnchorElement[] = Array.from(fixture.nativeElement.querySelectorAll('a'));
    expect(links.some((a) => a.href === 'https://recreation.gov/camping/1')).toBe(true);
    expect(links.some((a) => a.href === 'https://maps.example/1')).toBe(true);
  });
});
