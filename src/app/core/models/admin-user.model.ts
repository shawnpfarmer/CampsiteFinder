export interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  role: 'user' | 'moderator' | 'admin';
  suspended: boolean;
  createdAt: string;
}
