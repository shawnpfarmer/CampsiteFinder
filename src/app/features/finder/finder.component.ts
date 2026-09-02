import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { MultiSelectModule } from 'primeng/multiselect';
import { SelectModule } from 'primeng/select';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { CampgroundMapComponent } from './campground-map/campground-map.component';
import { CampgroundTableComponent } from './campground-table/campground-table.component';
import { GeolocationService, Coordinates } from '../../core/services/geolocation.service';
import { CampgroundsService } from '../../core/services/campgrounds.service';
import { Campground } from '../../core/models/campground.model';

export const METERS_PER_MILE = 1609.34;
// Half of Earth's circumference — larger than any possible distance between
// two points, so passing this as max_distance_m hits nearest_campgrounds's
// "no count cap" branch and returns every matching row, however large the
// dataset grows. This is how "Show all" is implemented, not a real radius.
export const SHOW_ALL_RADIUS_M = 20_038_000;

@Component({
  selector: 'app-finder',
  standalone: true,
  imports: [
    CampgroundMapComponent,
    CampgroundTableComponent,
    MessageModule,
    FormsModule,
    ButtonModule,
    InputTextModule,
    MultiSelectModule,
    SelectModule,
    ToggleSwitchModule,
  ],
  templateUrl: './finder.component.html',
  styleUrl: './finder.component.scss',
})
export class FinderComponent implements OnInit {
  readonly campgrounds = signal<Campground[]>([]);
  readonly selected = signal<Campground | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  readonly ALL_AGENCIES = ['NPS', 'USFS', 'BLM', 'USACE', 'FWS'];
  readonly RADIUS_OPTIONS = [25, 50, 100, 250];
  selectedAgencies: string[] = [...this.ALL_AGENCIES];
  nearMeEnabled = false;
  radiusMiles = 50;

  manualLat: number | null = null;
  manualLng: number | null = null;

  private lastCoords: Coordinates | null = null;

  constructor(
    private readonly geolocation: GeolocationService,
    private readonly campgroundsService: CampgroundsService,
  ) {}

  async ngOnInit(): Promise<void> {
    await this.loadNearest();
  }

  async loadNearest(coords?: Coordinates): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const location = coords ?? (await this.geolocation.getCurrentPosition());
      this.lastCoords = location;
      const maxDistanceMeters = this.nearMeEnabled
        ? this.radiusMiles * METERS_PER_MILE
        : SHOW_ALL_RADIUS_M;
      const results = await this.campgroundsService.getNearest(
        location,
        50,
        this.selectedAgencies,
        maxDistanceMeters,
      );
      this.campgrounds.set(results);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Unable to load nearby campgrounds.');
    } finally {
      this.loading.set(false);
    }
  }

  onManualSubmit(): void {
    if (this.manualLat != null && this.manualLng != null) {
      this.loadNearest({ lat: this.manualLat, lng: this.manualLng });
    }
  }

  onFilterChange(): Promise<void> {
    return this.lastCoords ? this.loadNearest(this.lastCoords) : Promise.resolve();
  }

  onSelectionChange(campground: Campground | null): void {
    this.selected.set(campground);
  }
}
