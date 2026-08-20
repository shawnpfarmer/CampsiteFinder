import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CampgroundTableComponent } from './campground-table.component';

describe('CampgroundTableComponent', () => {
  let fixture: ComponentFixture<CampgroundTableComponent>;
  let component: CampgroundTableComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [CampgroundTableComponent] });
    fixture = TestBed.createComponent(CampgroundTableComponent);
    component = fixture.componentInstance;
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

  it('emits noteChange with the current draft value on blur', () => {
    let emitted: any;
    component.noteChange.subscribe((e) => (emitted = e));
    component.noteDrafts['cg-1'] = 'updated note';

    component.onNoteBlur('cg-1');

    expect(emitted).toEqual({ campgroundId: 'cg-1', note: 'updated note' });
  });
});
