import { TestBed } from '@angular/core/testing';
import { AboutComponent } from './about.component';

describe('AboutComponent', () => {
  it('shows the tagline and admin contact email', () => {
    TestBed.configureTestingModule({ imports: [AboutComponent] });
    const fixture = TestBed.createComponent(AboutComponent);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Because it sounded fun.');
    expect(text).toContain('shawnpfarmer@gmail.com');

    const mailLink: HTMLAnchorElement = fixture.nativeElement.querySelector('a[href^="mailto:"]');
    expect(mailLink.href).toBe('mailto:shawnpfarmer@gmail.com');
  });
});
