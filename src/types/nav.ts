export type NavView =
  | 'dashboard'
  | 'pola'
  | 'gis'
  | 'teren'
  | 'polowa'
  | 'uprawy'
  | 'profil'
  | 'maszyny'
  | 'magazyn'
  | 'pogoda'
  | 'analizy'
  | 'alerts'
  | 'pracownicy'
  | 'dzierzawy'
  | 'ustawienia'
  | string;

export type Nav = {
  go: (view: NavView, id?: string) => void;
};
