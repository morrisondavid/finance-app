declare module 'date-holidays' {
  interface HolidayEntry {
    readonly date: string;
    readonly start: Date;
    readonly end: Date;
    readonly name: string;
    readonly type: 'public' | 'bank' | 'school' | 'observance' | 'optional';
    readonly rule: string;
  }

  class Holidays {
    constructor(country?: string, state?: string, region?: string, opts?: Record<string, unknown>);
    init(country: string, state?: string, region?: string, opts?: Record<string, unknown>): void;
    getHolidays(year: number, language?: string): HolidayEntry[];
    isHoliday(date: Date): HolidayEntry[] | false;
  }

  export default Holidays;
}
