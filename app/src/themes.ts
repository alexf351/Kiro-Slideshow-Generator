// Curated background "theme packs". Instead of a blank search box, the Media
// Bank offers named aesthetics — one tap runs a tuned query against the stock
// providers and surfaces a cohesive, slide-ready set. Each theme is just a
// query (+ optional forced provider for the art/vintage looks that land best
// on the public-domain art source); the rest reuses the existing stock search.

import type { StockProvider } from './stockPhotos';

export type ThemePack = {
  id: string;
  label: string;
  emoji: string;
  accent: string;
  query: string;
  // Force a provider when a look lands best there (e.g. classical art).
  // Omit to use the creator's best available provider.
  provider?: StockProvider;
};

export const THEME_PACKS: ThemePack[] = [
  { id: 'dark-academia', label: 'Dark Academia', emoji: '📚', accent: '#a78b6a', query: 'dark academia library old books candle' },
  { id: 'cozy-study', label: 'Cozy Study', emoji: '🕯️', accent: '#d9a066', query: 'cozy desk study lamp night warm' },
  { id: 'airport', label: 'Airport / Travel', emoji: '✈️', accent: '#7cc5ff', query: 'airplane window sunset sky clouds' },
  { id: 'luxury', label: 'Luxury', emoji: '🥂', accent: '#e7c873', query: 'luxury interior marble gold aesthetic' },
  { id: 'nature-calm', label: 'Nature / Calm', emoji: '🌲', accent: '#6fae7a', query: 'misty forest mountains fog calm' },
  { id: 'beach', label: 'Beach / Summer', emoji: '🌅', accent: '#ffb27a', query: 'beach ocean golden hour summer' },
  { id: 'city-night', label: 'City Night', emoji: '🌃', accent: '#8b9bff', query: 'city skyline night neon lights' },
  { id: 'minimal', label: 'Minimal / Clean', emoji: '⚪', accent: '#cbd5e1', query: 'minimal white clean aesthetic negative space' },
  { id: 'coffee', label: 'Coffee / Café', emoji: '☕', accent: '#c08552', query: 'coffee cup cafe aesthetic morning' },
  { id: 'reading', label: 'Books / Reading', emoji: '📖', accent: '#b08968', query: 'open book reading aesthetic study' },
  { id: 'fitness', label: 'Gym / Fitness', emoji: '🏋️', accent: '#ff7a7a', query: 'gym workout fitness training' },
  { id: 'tech', label: 'Tech / Coding', emoji: '💻', accent: '#62d4c4', query: 'laptop code desk setup workspace' },
  { id: 'classical-art', label: 'Classical Art', emoji: '🖼️', accent: '#d6b370', query: 'landscape painting', provider: 'artic' },
  { id: 'vintage', label: 'Vintage / Film', emoji: '📷', accent: '#caa472', query: 'vintage film grain retro nostalgic' },
  { id: 'flowers', label: 'Flowers / Soft', emoji: '🌸', accent: '#f3a6c4', query: 'flowers pastel soft aesthetic spring' },
  { id: 'moody-rain', label: 'Rain / Moody', emoji: '🌧️', accent: '#7f93b3', query: 'rain window moody dark cinematic' },
  { id: 'mountains', label: 'Adventure', emoji: '🏔️', accent: '#7fb1c9', query: 'mountain landscape adventure hiking' },
  { id: 'money', label: 'Money / Finance', emoji: '💸', accent: '#67c98a', query: 'money finance laptop chart desk' },
];
