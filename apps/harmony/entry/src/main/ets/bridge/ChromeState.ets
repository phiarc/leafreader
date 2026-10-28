export class ReaderChrome {
  title: string = '';
  chapter: string = '';
  format: string = 'txt';
  progress: number = 0;
  encoding: string = 'auto';
  zoom: number = 1;
  visible: boolean = true;
  loading: boolean = true;
}
export class ChromeState {
  mode: string = 'library';
  theme: string = 'paper';
  fontSize: number = 20;
  animation: string = 'slide';
  pageMargin: number = 0;
  bookCount: number = 0;
  bookmarkCount: number = 0;
  bookmarkView: boolean = false;
  search: string = '';
  syncState: string = '';
  busy: boolean = false;
  blocked: boolean = false;
  reader: ReaderChrome | null = null;
}
export class PreferencesValue {
  theme: string = 'paper';
  fontSize: number = 20;
  animation: string = 'slide';
}
export class ChromeAction {
  action: string = '';
  value: Object | null = null;
}
