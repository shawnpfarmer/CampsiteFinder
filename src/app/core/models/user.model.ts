export interface UserProfile {
  id: string;
  displayName: string;
  theme: 'light' | 'dark' | null;
  role: 'user' | 'moderator' | 'admin';
}

export interface AdminUserSummary {
  id: string;
  displayName: string;
  role: 'user' | 'moderator' | 'admin';
}
