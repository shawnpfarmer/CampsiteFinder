export interface UserProfile {
  id: string;
  displayName: string;
  theme: 'light' | 'dark' | null;
  role: 'user' | 'moderator' | 'admin';
}
