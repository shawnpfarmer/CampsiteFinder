import { Component, EventEmitter, Input, Output } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { TableModule } from 'primeng/table';
import { Campground } from '../../../core/models/campground.model';

@Component({
  selector: 'app-campground-table',
  standalone: true,
  imports: [TableModule, DecimalPipe],
  template: `
    <p-table
      [value]="campgrounds"
      [paginator]="true"
      [rows]="10"
      selectionMode="single"
      [(selection)]="selected"
      (selectionChange)="onSelectionChange($event)"
    >
      <ng-template pTemplate="header">
        <tr>
          <th pSortableColumn="name">Name <p-sort-icon field="name" /></th>
          <th pSortableColumn="parkCode">Park <p-sort-icon field="parkCode" /></th>
          <th pSortableColumn="distanceMeters">Distance <p-sort-icon field="distanceMeters" /></th>
        </tr>
      </ng-template>
      <ng-template pTemplate="body" let-campground>
        <tr [pSelectableRow]="campground">
          <td>{{ campground.name }}</td>
          <td>{{ campground.parkCode }}</td>
          <td>{{ campground.distanceMeters / 1609.34 | number: '1.1-1' }} mi</td>
        </tr>
      </ng-template>
    </p-table>
  `,
})
export class CampgroundTableComponent {
  @Input({ required: true }) campgrounds: Campground[] = [];
  @Input() selected: Campground | null = null;
  @Output() selectedChange = new EventEmitter<Campground | null>();

  onSelectionChange(campground: Campground): void {
    this.selectedChange.emit(campground);
  }
}
