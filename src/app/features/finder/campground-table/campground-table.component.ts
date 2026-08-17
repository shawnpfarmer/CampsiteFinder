import { Component, EventEmitter, Input, Output } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { TableModule } from 'primeng/table';
import { FavoriteToggleComponent } from '../../../shared/favorite-toggle/favorite-toggle.component';
import { Campground } from '../../../core/models/campground.model';

@Component({
  selector: 'app-campground-table',
  standalone: true,
  imports: [TableModule, DecimalPipe, FavoriteToggleComponent],
  template: `
    <p-table
      [value]="campgrounds"
      [paginator]="true"
      [rows]="10"
      selectionMode="single"
      [(selection)]="selected"
      (selectionChange)="onSelectionChange($event)"
    >
      <ng-template #header>
        <tr>
          <th pSortableColumn="name">Name <p-sort-icon field="name" /></th>
          <th pSortableColumn="parkCode">Park <p-sort-icon field="parkCode" /></th>
          @if (showDistance) {
            <th pSortableColumn="distanceMeters">Distance <p-sort-icon field="distanceMeters" /></th>
          }
          <th></th>
        </tr>
      </ng-template>
      <ng-template #body let-campground>
        <tr [pSelectableRow]="campground">
          <td>{{ campground.name }}</td>
          <td>{{ campground.parkCode }}</td>
          @if (showDistance) {
            <td>{{ campground.distanceMeters / 1609.34 | number: '1.1-1' }} mi</td>
          }
          <td><app-favorite-toggle [campgroundId]="campground.id" /></td>
        </tr>
      </ng-template>
    </p-table>
  `,
})
export class CampgroundTableComponent {
  @Input({ required: true }) campgrounds: Campground[] = [];
  @Input() selected: Campground | null = null;
  @Input() showDistance = true;
  @Output() selectedChange = new EventEmitter<Campground | null>();

  onSelectionChange(campground: Campground): void {
    this.selectedChange.emit(campground);
  }
}
