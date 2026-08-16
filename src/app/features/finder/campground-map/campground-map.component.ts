import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { LeafletModule } from '@bluehalo/ngx-leaflet';
import * as L from 'leaflet';
import { Campground } from '../../../core/models/campground.model';

// Leaflet's Icon.Default always prepends an auto-detected `imagePath`
// directory to its icon filenames — it reads the computed background-image
// of a `.leaflet-default-icon-path` element (set via leaflet.css) and uses
// that directory. Angular's build hashes the CSS-referenced marker-icon.png
// into /media/, but the shadow image (only referenced from JS, not CSS)
// never gets copied there, so the guessed URL 404s. Setting `imagePath`
// explicitly (matching the `leaflet/dist/images` assets rule in
// angular.json, which serves these at the site root) bypasses that
// detection entirely.
L.Icon.Default.imagePath = '';
L.Icon.Default.mergeOptions({
  iconUrl: 'marker-icon.png',
  iconRetinaUrl: 'marker-icon-2x.png',
  shadowUrl: 'marker-shadow.png',
});

@Component({
  selector: 'app-campground-map',
  standalone: true,
  imports: [LeafletModule],
  template: `
    <div
      class="campground-map"
      leaflet
      [leafletOptions]="mapOptions"
      [leafletLayers]="markerLayers"
      (leafletMapReady)="onMapReady($event)"
    ></div>
  `,
  styleUrl: './campground-map.component.scss',
})
export class CampgroundMapComponent implements OnChanges {
  @Input({ required: true }) campgrounds: Campground[] = [];
  @Input() selectedId: string | null = null;

  private map: L.Map | undefined;

  readonly mapOptions: L.MapOptions = {
    layers: [
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
      }),
    ],
    zoom: 6,
    center: L.latLng(39.8283, -98.5795),
  };

  markerLayers: L.Layer[] = [];

  onMapReady(map: L.Map): void {
    this.map = map;
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['campgrounds']) {
      this.markerLayers = this.campgrounds.map((c) => L.marker([c.lat, c.lng]).bindPopup(c.name));
    }
    if (changes['selectedId'] && this.selectedId && this.map) {
      const selected = this.campgrounds.find((c) => c.id === this.selectedId);
      if (selected) {
        this.map.setView([selected.lat, selected.lng], 12);
      }
    }
  }
}
