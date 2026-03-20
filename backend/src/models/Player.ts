export interface Player {
  id: string;
  name: string;
  position: number; // 0 = dealer, 1 = left of dealer, etc.
  isBot?: boolean;
  difficulty?: 'easy' | 'medium' | 'hard';
}
