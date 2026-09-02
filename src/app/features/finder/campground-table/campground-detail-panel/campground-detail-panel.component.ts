import { Component, Input } from '@angular/core';
import { FavoriteToggleComponent } from '../../../../shared/favorite-toggle/favorite-toggle.component';
import { AddToTripComponent } from '../../../../shared/add-to-trip/add-to-trip.component';
import { Campground } from '../../../../core/models/campground.model';

@Component({
  selector: 'app-campground-detail-panel',
  standalone: true,
  imports: [FavoriteToggleComponent, AddToTripComponent],
  template: `
    <div class="campground-detail-panel">
      <h3>{{ campground.name }}</h3>
      <app-favorite-toggle [campgroundId]="campground.id" />
      <app-add-to-trip [campgroundId]="campground.id" />
      <div [innerHTML]="campground.description"></div>
      <a [href]="campground.reservationUrl" target="_blank" rel="noopener">Reserve on recreation.gov</a>
      <a [href]="campground.directionsUrl" target="_blank" rel="noopener">Directions</a>
    </div>
  `,
})
export class CampgroundDetailPanelComponent {
  @Input({ required: true }) campground!: Campground;
}
