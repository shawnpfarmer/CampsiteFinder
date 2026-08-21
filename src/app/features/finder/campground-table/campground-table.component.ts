import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TableModule } from 'primeng/table';
import { InputTextModule } from 'primeng/inputtext';
import { FavoriteToggleComponent } from '../../../shared/favorite-toggle/favorite-toggle.component';
import { Campground } from '../../../core/models/campground.model';

@Component({
  selector: 'app-campground-table',
  standalone: true,
  imports: [TableModule, DecimalPipe, FormsModule, RouterLink, InputTextModule, FavoriteToggleComponent],
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
          @if (showNotes) {
            <th>Note</th>
          }
          <th></th>
        </tr>
      </ng-template>
      <ng-template #body let-campground>
        <tr [pSelectableRow]="campground">
          <td><a [routerLink]="['/campground', campground.id]">{{ campground.name }}</a></td>
          <td>{{ campground.parkCode }}</td>
          @if (showDistance) {
            <td>{{ campground.distanceMeters / 1609.34 | number: '1.1-1' }} mi</td>
          }
          @if (showNotes) {
            <td>
              <input
                pInputText
                [(ngModel)]="noteDrafts[campground.id]"
                (blur)="onNoteBlur(campground.id)"
              />
            </td>
          }
          <td><app-favorite-toggle [campgroundId]="campground.id" /></td>
        </tr>
      </ng-template>
    </p-table>
  `,
})
export class CampgroundTableComponent implements OnChanges {
  @Input({ required: true }) campgrounds: Campground[] = [];
  @Input() selected: Campground | null = null;
  @Input() showDistance = true;
  @Input() showNotes = false;
  @Input() notes: Map<string, string | null> = new Map();
  @Output() selectedChange = new EventEmitter<Campground | null>();
  @Output() noteChange = new EventEmitter<{ campgroundId: string; note: string }>();

  noteDrafts: Record<string, string> = {};

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['notes']) {
      // Merge, never replace. Saving one row's note updates the shared notes
      // map, which pushes a new `notes` input through here — rebuilding the
      // whole draft object would wipe whatever the user is mid-typing in
      // another row. A key already present in `noteDrafts` is either being
      // edited right now or already reflects what the user typed, so only
      // seed keys we haven't got yet.
      this.notes.forEach((note, campgroundId) => {
        if (!(campgroundId in this.noteDrafts)) {
          this.noteDrafts[campgroundId] = note ?? '';
        }
      });
    }
  }

  onSelectionChange(campground: Campground): void {
    this.selectedChange.emit(campground);
  }

  onNoteBlur(campgroundId: string): void {
    this.noteChange.emit({ campgroundId, note: this.noteDrafts[campgroundId] ?? '' });
  }
}
