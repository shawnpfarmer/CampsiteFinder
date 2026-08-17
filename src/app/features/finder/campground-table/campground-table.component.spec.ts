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
});
